// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Application state and main loop for the TUI.

use std::io;
use std::path::Path;
use std::sync::Arc;

use crossterm::event::{KeyCode, KeyModifiers};
use ratatui::prelude::*;
use ratatui::text::Line;
use tokio::sync::mpsc;

use crate::agent::{
    Agent, AgentCallbacks, AgentConfig, AgentOptions,
    ConfirmationResult, ToolConfirmation, TurnStats,
};
use crate::config::ResolvedConfig;
use crate::error::{Result as CodiResult, ToolError};
use crate::completion::{complete_line, get_completion_matches};
use crate::orchestrate::{Commander, CommanderConfig, WorkerConfig, WorkerStatus, WorkspaceInfo, PermissionResult};
use crate::session::{Session, SessionInfo, SessionService};
use crate::tools::ToolRegistry;
use crate::types::{BoxedProvider, MessageContent, Role};

use super::commands::{execute_async_command, handle_command, CommandResult};
use super::events::{Event, EventHandler};
use super::streaming::{StreamController, StreamStatus};
use super::ui;

/// Application mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMode {
    /// Normal input mode.
    Normal,
    /// Waiting for AI response.
    Waiting,
    /// Showing help.
    Help,
    /// Showing tool confirmation dialog.
    ConfirmTool,
}

/// A message in the conversation.
#[derive(Debug, Clone)]
pub struct Message {
    /// Message role (user or assistant).
    pub role: Role,
    /// Message content.
    pub content: String,
    /// Whether this message is still being streamed.
    pub streaming: bool,
    /// Rendered lines (cached for display).
    pub rendered_lines: Vec<Line<'static>>,
}

impl Message {
    /// Create a user message.
    pub fn user(content: impl Into<String>) -> Self {
        let content = content.into();
        Self {
            role: Role::User,
            content,
            streaming: false,
            rendered_lines: Vec::new(),
        }
    }

    /// Create an assistant message.
    pub fn assistant(content: impl Into<String>) -> Self {
        let content = content.into();
        Self {
            role: Role::Assistant,
            content,
            streaming: false,
            rendered_lines: Vec::new(),
        }
    }

    /// Create a streaming assistant message.
    pub fn streaming() -> Self {
        Self {
            role: Role::Assistant,
            content: String::new(),
            streaming: true,
            rendered_lines: Vec::new(),
        }
    }

    /// Mark the message as complete (no longer streaming).
    pub fn complete(&mut self) {
        self.streaming = false;
    }

    /// Append content to a streaming message.
    pub fn append(&mut self, text: &str) {
        self.content.push_str(text);
    }

    /// Set rendered lines from streaming.
    pub fn set_rendered_lines(&mut self, lines: Vec<Line<'static>>) {
        self.rendered_lines = lines;
    }

    /// Append rendered lines from streaming.
    pub fn append_rendered_lines(&mut self, lines: Vec<Line<'static>>) {
        self.rendered_lines.extend(lines);
    }

    /// Convert to a session message for persistence.
    pub fn to_session_message(&self) -> crate::types::Message {
        crate::types::Message {
            role: self.role,
            content: MessageContent::Text(self.content.clone()),
        }
    }

    /// Create from a session message.
    pub fn from_session_message(msg: &crate::types::Message) -> Self {
        let content = match &msg.content {
            MessageContent::Text(text) => text.clone(),
            MessageContent::Blocks(blocks) => {
                // Extract text from blocks
                blocks
                    .iter()
                    .filter_map(|block| block.text.as_ref())
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        };
        Self {
            role: msg.role,
            content,
            streaming: false,
            rendered_lines: Vec::new(),
        }
    }
}

/// Event for internal communication between agent callbacks and the app.
#[derive(Debug, Clone)]
pub enum AppEvent {
    /// Text delta received from streaming.
    TextDelta(String),
    /// Tool call started (id, name, input).
    ToolStart(String, String, serde_json::Value),
    /// Tool output line received during execution.
    ToolOutput(String, String),
    /// Tool call completed (id, result, is_error).
    ToolResult(String, String, bool),
    /// Turn completed with stats.
    TurnComplete(TurnStats),
    /// Confirmation request.
    ConfirmRequest(ToolConfirmation),
    /// Context compaction started (true) or finished (false).
    Compaction(bool),
}

/// Pending tool confirmation.
#[derive(Debug)]
pub struct PendingConfirmation {
    pub confirmation: ToolConfirmation,
    pub response_tx: Option<tokio::sync::oneshot::Sender<ConfirmationResult>>,
}

/// Application state.
pub struct App {
    /// Current mode.
    pub mode: AppMode,
    /// Conversation messages.
    pub messages: Vec<Message>,
    /// Current input text.
    pub input: String,
    /// Cursor position in input.
    pub cursor_pos: usize,
    /// Scroll offset for messages.
    pub scroll_offset: u16,
    /// Whether the app should quit.
    pub should_quit: bool,
    /// Status message to display.
    pub status: Option<String>,
    /// AI agent.
    agent: Option<Agent>,
    /// Terminal width for streaming.
    terminal_width: Option<u16>,
    /// Stream controller for current response.
    stream_controller: Option<StreamController>,
    /// Event channel for agent callbacks.
    event_rx: Option<mpsc::UnboundedReceiver<AppEvent>>,
    /// Event sender (held to keep channel alive).
    event_tx: Option<mpsc::UnboundedSender<AppEvent>>,
    /// Pending confirmation request.
    pending_confirmation: Option<PendingConfirmation>,
    /// Last turn stats.
    pub last_turn_stats: Option<TurnStats>,
    /// Input history.
    pub input_history: Vec<String>,
    /// Current position in input history.
    history_index: Option<usize>,
    /// Current input (saved when navigating history).
    saved_input: String,
    /// Session service for persistence.
    pub session_service: Option<SessionService>,
    /// Current session ID.
    pub current_session_id: Option<String>,
    /// Current session (cached for quick access).
    pub current_session: Option<Session>,
    /// Project path for session creation.
    project_path: String,
    /// Tab completion hint to display.
    pub completion_hint: Option<String>,
    /// Resolved configuration from config files and CLI.
    config: Option<ResolvedConfig>,
    /// Auto-approve all tool operations (from --yes CLI flag).
    auto_approve_all: bool,

    // Background agent task
    /// Receiver for agent returning from a background chat task.
    pending_agent: Option<tokio::sync::oneshot::Receiver<(Agent, CodiResult<String>)>>,
    // Tool execution visualization
    /// Manager for tool execution cells.
    pub exec_cells: crate::tui::components::ExecCellManager,

    // Orchestration
    /// Commander for multi-agent orchestration.
    commander: Option<Commander>,
    /// Pending worker permission requests (worker_id, request_id, tool_name, input).
    pending_worker_permissions: Vec<(String, String, String, serde_json::Value)>,
}

impl App {
    /// Create a new application.
    pub fn new() -> Self {
        Self::with_project_path(".")
    }

    /// Create a new application with a specific project path.
    pub fn with_project_path(project_path: impl AsRef<Path>) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let project_path = project_path.as_ref().to_string_lossy().to_string();

        // Try to initialize session service
        let session_service = SessionService::new(&project_path).ok();

        Self {
            mode: AppMode::Normal,
            messages: Vec::new(),
            input: String::new(),
            cursor_pos: 0,
            scroll_offset: 0,
            should_quit: false,
            status: None,
            agent: None,
            terminal_width: None,
            stream_controller: None,
            event_rx: Some(rx),
            event_tx: Some(tx),
            pending_confirmation: None,
            last_turn_stats: None,
            input_history: Vec::new(),
            history_index: None,
            saved_input: String::new(),
            session_service,
            current_session_id: None,
            current_session: None,
            project_path,
            completion_hint: None,
            config: None,
            auto_approve_all: false,
            pending_agent: None,
            exec_cells: crate::tui::components::ExecCellManager::new(),
            commander: None,
            pending_worker_permissions: Vec::new(),
        }
    }

    /// Create with a provider.
    ///
    /// **Deprecated**: Bypasses config wiring. Use `with_project_path()` +
    /// `set_config()` + `set_provider()` instead (see `run_repl()`).
    #[deprecated(note = "bypasses config; use with_project_path() + set_config() + set_provider()")]
    pub fn with_provider(provider: BoxedProvider) -> Self {
        let mut app = Self::new();
        app.set_provider(provider);
        app
    }

    /// Create with a provider and project path.
    ///
    /// **Deprecated**: Bypasses config wiring. Use `with_project_path()` +
    /// `set_config()` + `set_provider()` instead (see `run_repl()`).
    #[deprecated(note = "bypasses config; use with_project_path() + set_config() + set_provider()")]
    pub fn with_provider_and_path(provider: BoxedProvider, project_path: impl AsRef<Path>) -> Self {
        let mut app = Self::with_project_path(project_path);
        app.set_provider(provider);
        app
    }

    /// Set the resolved configuration. Call before `set_provider` to apply config values.
    pub fn set_config(&mut self, config: ResolvedConfig) {
        self.config = Some(config);
    }

    /// Set auto-approve-all flag (from --yes CLI flag). Call before `set_provider`.
    pub fn set_auto_approve(&mut self, auto_approve: bool) {
        self.auto_approve_all = auto_approve;
    }

    /// Build an `AgentConfig` from the stored `ResolvedConfig`, or use defaults.
    fn build_agent_config(&self) -> AgentConfig {
        if let Some(ref config) = self.config {
            AgentConfig {
                max_iterations: 50,
                max_consecutive_errors: 3,
                max_turn_duration_ms: 120_000,
                max_context_tokens: config.max_context_tokens as usize,
                use_tools: !config.no_tools,
                extract_tools_from_text: config.extract_tools_from_text,
                auto_approve_all: self.auto_approve_all,
                auto_approve_tools: config.auto_approve.clone(),
                dangerous_patterns: config.dangerous_patterns.clone(),
            }
        } else {
            let mut default_config = AgentConfig::default();
            default_config.auto_approve_all = self.auto_approve_all;
            default_config
        }
    }

    /// Build the system prompt, incorporating config additions and project context.
    fn build_system_prompt(&self) -> String {
        build_system_prompt_from_config(self.config.as_ref())
    }

    /// Set the AI provider and create an agent.
    pub fn set_provider(&mut self, provider: BoxedProvider) {
        let registry = Arc::new(ToolRegistry::with_defaults());
        let event_tx = self.event_tx.clone().unwrap();

        let callbacks = AgentCallbacks {
            on_text: Some(Arc::new({
                let tx = event_tx.clone();
                move |text: &str| {
                    let _ = tx.send(AppEvent::TextDelta(text.to_string()));
                }
            })),
            on_tool_call: Some(Arc::new({
                let tx = event_tx.clone();
                move |tool_id: &str, name: &str, input: &serde_json::Value| {
                    let _ = tx.send(AppEvent::ToolStart(tool_id.to_string(), name.to_string(), input.clone()));
                }
            })),
            on_tool_result: Some(Arc::new({
                let tx = event_tx.clone();
                move |tool_id: &str, _name: &str, result: &str, is_error: bool| {
                    let _ = tx.send(AppEvent::ToolResult(tool_id.to_string(), result.to_string(), is_error));
                }
            })),
            on_confirm: None, // Handled via channel-based approach
            on_compaction: Some(Arc::new({
                let tx = event_tx.clone();
                move |is_starting: bool| {
                    let _ = tx.send(AppEvent::Compaction(is_starting));
                }
            })),
            on_turn_complete: Some(Arc::new({
                let tx = event_tx.clone();
                move |stats: &TurnStats| {
                    let _ = tx.send(AppEvent::TurnComplete(stats.clone()));
                }
            })),
            on_stream_event: None,
        };

        self.agent = Some(Agent::new(AgentOptions {
            provider,
            tool_registry: registry,
            system_prompt: Some(self.build_system_prompt()),
            config: self.build_agent_config(),
            callbacks,
        }));
    }

    /// Run the main event loop.
    pub async fn run<B: Backend>(
        &mut self,
        terminal: &mut Terminal<B>,
        mut events: EventHandler,
    ) -> io::Result<()> {
        // Get initial terminal size
        let size = terminal.size()?;
        self.terminal_width = Some(size.width);

        while !self.should_quit {
            // Draw UI
            terminal.draw(|f| {
                self.terminal_width = Some(f.area().width);
                ui::draw(f, self);
            })?;

            // Process any pending app events (from agent callbacks)
            self.process_app_events();

            // Handle events with timeout for animation
            tokio::select! {
                Some(event) = events.next() => {
                    self.handle_event(event).await;
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(50)) => {
                    // Tick for streaming animation
                    self.tick_streaming();
                }
            }
        }

        Ok(())
    }

    /// Process any pending app events from agent callbacks.
    fn process_app_events(&mut self) {
        // Check if the background agent task has completed
        if let Some(ref mut rx) = self.pending_agent {
            match rx.try_recv() {
                Ok((agent, result)) => {
                    self.agent = Some(agent);
                    self.pending_agent = None;
                    match result {
                        Ok(_) => {
                            // Response was streamed via callbacks; TurnComplete will finalize
                        }
                        Err(e) => {
                            self.status = Some(format!("Error: {}", e));
                            self.mode = AppMode::Normal;
                            self.finalize_streaming();
                        }
                    }
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    // Task panicked or was dropped
                    self.pending_agent = None;
                    self.status = Some("Agent task failed unexpectedly".to_string());
                    self.mode = AppMode::Normal;
                    self.finalize_streaming();
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                    // Still running, keep waiting
                }
            }
        }

        // Collect events first to avoid borrow issues
        let mut events = Vec::new();
        if let Some(ref mut rx) = self.event_rx {
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
        }

        // Process collected events
        for event in events {
            match event {
                AppEvent::TextDelta(text) => {
                    self.handle_text_delta(&text);
                }
                AppEvent::ToolStart(id, name, input) => {
                    // Create a new exec cell for this tool
                    let cell = crate::tui::components::ExecCell::new(
                        id.clone(),
                        name.clone(),
                        input,
                    );
                    self.exec_cells.add(cell);
                    self.status = Some(format!("Running: {} ...", name));
                }
                AppEvent::ToolOutput(id, line) => {
                    // Add output line to the exec cell
                    if let Some(cell) = self.exec_cells.get_mut(&id) {
                        cell.add_output_line(line);
                    }
                }
                AppEvent::ToolResult(id, result, is_error) => {
                    // Update the exec cell with the result
                    if let Some(cell) = self.exec_cells.get_mut(&id) {
                        if is_error {
                            cell.mark_error(&result);
                            self.status = Some(format!("Tool {} failed", cell.tool_name));
                        } else {
                            cell.mark_success(&result);
                            self.status = Some(format!("Completed: {}", cell.tool_name));
                        }
                    }
                }
                AppEvent::TurnComplete(stats) => {
                    self.last_turn_stats = Some(stats);
                    self.mode = AppMode::Normal;
                    self.status = None;

                    // Finalize streaming
                    self.finalize_streaming();
                }
                AppEvent::ConfirmRequest(_) => {
                    // Handled separately via channel
                }
                AppEvent::Compaction(is_starting) => {
                    if is_starting {
                        self.status = Some("Compacting context...".to_string());
                    } else {
                        self.status = Some("Context compacted".to_string());
                    }
                }
            }
        }
    }

    /// Handle text delta from streaming.
    fn handle_text_delta(&mut self, text: &str) {
        // Initialize stream controller if needed
        if self.stream_controller.is_none() {
            let width = self.terminal_width.map(|w| (w.saturating_sub(4)) as usize);
            self.stream_controller = Some(StreamController::new(width));

            // Add streaming message
            self.messages.push(Message::streaming());
        }

        // Push delta to controller
        if let Some(ref mut controller) = self.stream_controller {
            controller.push(text);
        }

        // Update the current message content
        if let Some(msg) = self.messages.last_mut() {
            if msg.streaming {
                msg.append(text);
            }
        }
    }

    /// Tick the streaming animation.
    fn tick_streaming(&mut self) {
        if let Some(ref mut controller) = self.stream_controller {
            let (status, lines) = controller.step();

            if !lines.is_empty() {
                // Append lines to the current streaming message
                if let Some(msg) = self.messages.last_mut() {
                    if msg.streaming {
                        msg.append_rendered_lines(lines);
                    }
                }
            }

            // Auto-scroll to bottom when new content arrives
            if status == StreamStatus::HasContent {
                self.scroll_to_bottom();
            }
        }
    }

    /// Finalize streaming and mark message as complete.
    fn finalize_streaming(&mut self) {
        if let Some(ref mut controller) = self.stream_controller {
            controller.finalize();

            // Drain remaining lines
            let remaining = controller.drain_all();
            if !remaining.is_empty() {
                if let Some(msg) = self.messages.last_mut() {
                    if msg.streaming {
                        msg.append_rendered_lines(remaining);
                    }
                }
            }
        }

        // Mark message as complete
        if let Some(msg) = self.messages.last_mut() {
            if msg.streaming {
                msg.complete();
            }
        }

        // Clear controller
        self.stream_controller = None;
    }

    /// Scroll to the bottom of the message list.
    fn scroll_to_bottom(&mut self) {
        // This will be computed during rendering based on content height
        self.scroll_offset = u16::MAX;
    }

    /// Handle an input event.
    async fn handle_event(&mut self, event: Event) {
        match event {
            Event::Tick => {}
            Event::Key(key) => self.handle_key(key.code, key.modifiers).await,
            Event::Mouse(_) => {}
            Event::Resize(w, _h) => {
                self.terminal_width = Some(w);
            }
        }
    }

    /// Handle a key press.
    async fn handle_key(&mut self, key: KeyCode, modifiers: KeyModifiers) {
        match self.mode {
            AppMode::Normal => self.handle_normal_key(key, modifiers).await,
            AppMode::Waiting => self.handle_waiting_key(key),
            AppMode::Help => self.handle_help_key(key),
            AppMode::ConfirmTool => self.handle_confirm_key(key),
        }
    }

    /// Handle key in normal mode.
    async fn handle_normal_key(&mut self, key: KeyCode, modifiers: KeyModifiers) {
        match key {
            KeyCode::Enter => {
                if !self.input.is_empty() {
                    // Check for Shift+Enter for multi-line
                    if modifiers.contains(KeyModifiers::SHIFT) {
                        self.input.insert(self.cursor_pos, '\n');
                        self.cursor_pos += 1;
                    } else {
                        self.submit_input().await;
                    }
                }
            }
            KeyCode::Char(c) => {
                // Handle Ctrl+C
                if c == 'c' && modifiers.contains(KeyModifiers::CONTROL) {
                    self.should_quit = true;
                    return;
                }
                // Handle Ctrl+D
                if c == 'd' && modifiers.contains(KeyModifiers::CONTROL) {
                    self.should_quit = true;
                    return;
                }

                self.input.insert(self.cursor_pos, c);
                self.cursor_pos += 1;
                // Clear history navigation when typing
                self.history_index = None;
            }
            KeyCode::Backspace => {
                if self.cursor_pos > 0 {
                    self.cursor_pos -= 1;
                    self.input.remove(self.cursor_pos);
                }
            }
            KeyCode::Delete => {
                if self.cursor_pos < self.input.len() {
                    self.input.remove(self.cursor_pos);
                }
            }
            KeyCode::Left => {
                if self.cursor_pos > 0 {
                    self.cursor_pos -= 1;
                }
            }
            KeyCode::Right => {
                if self.cursor_pos < self.input.len() {
                    self.cursor_pos += 1;
                }
            }
            KeyCode::Home => {
                self.cursor_pos = 0;
            }
            KeyCode::End => {
                self.cursor_pos = self.input.len();
            }
            KeyCode::Up => {
                self.navigate_history_back();
            }
            KeyCode::Down => {
                self.navigate_history_forward();
            }
            KeyCode::PageUp => {
                self.scroll_offset = self.scroll_offset.saturating_sub(10);
            }
            KeyCode::PageDown => {
                self.scroll_offset = self.scroll_offset.saturating_add(10);
            }
            KeyCode::Tab => {
                // Handle tab completion for slash commands
                if !self.input.is_empty() {
                    self.handle_tab_completion();
                }
            }
            _ => {}
        }
    }

    /// Get usage example for a completed command.
    pub fn get_usage_example(cmd: &str) -> Option<&'static str> {
    match cmd {
        "/help" => Some("Show available commands"),
        "/exit" => Some("Exit the application"),
        "/clear" => Some("Clear the conversation"),
        "/status" => Some("Show current status"),
        "/versions" => Some("Show version information"),
        "/context" => Some("Show/compact conversation context"),
        "/compact" => Some("Compress context to save tokens"),
        "/save" => Some("Save current session"),
        "/load" => Some("Load a session"),
        "/sessions" => Some("List all sessions"),
        "/models" => Some("List available AI models"),
        "/models anthropic" => Some("Show Claude models"),
        "/models openai" => Some("Show GPT models"),
        "/models --local" => Some("Show local Ollama models"),
        "/session label" => Some("Label current session"),
        "/memory remember" => Some("Remember a fact"),
        "/memory memories" => Some("Show stored memories"),
        "/memory clear" => Some("Clear all memories"),
        "/worktrees" => Some("Manage git worktrees"),
        "/workers" => Some("Manage AI workers"),
        "--local" => Some("Show only local models"),
        "-f" => Some("Output format (json/text)"),
        _ => None,
    }
}

    /// Handle tab completion for input (slash commands only) with full telemetry.
    fn handle_tab_completion(&mut self) {
        let start_time = std::time::Instant::now();
        
        // Only provide completion for slash commands
        let trimmed = self.input.trim();
        if trimmed.starts_with('/') {
            // Record telemetry for tab completion attempt in UI
            #[cfg(feature = "telemetry")]
            crate::telemetry::metrics::record_operation("tui.completion.attempt", start_time.elapsed());
            
            // Attempt completion
            let completed = complete_line(&self.input);
            
            if let Some(completed) = completed {
                if completed != self.input {
                    // Successful completion
                    #[cfg(feature = "telemetry")]
                    crate::telemetry::metrics::record_operation("tui.completion.success", start_time.elapsed());
                    
                    self.input = completed;
                    self.cursor_pos = self.input.len();
                }
            } else {
                // No completion found
                #[cfg(feature = "telemetry")]
                crate::telemetry::metrics::record_operation("tui.completion.no_match", start_time.elapsed());
            }
            
            // Show completion hints
            let matches = get_completion_matches(&self.input);
            if !matches.is_empty() {
                if matches.len() > 1 {
                    // Show first few matches as hint
                    let hint = format!("  Commands: {}", matches.iter().take(3).cloned().collect::<Vec<_>>().join(" | "));
                    self.status = Some(hint);
                    
                    #[cfg(feature = "telemetry")]
                    crate::telemetry::metrics::record_operation("tui.completion.multi_hints", start_time.elapsed());
                } else if matches.len() == 1 {
                    // Show usage hint for single match
                    let first = matches[0].clone();
                    if let Some(example) = Self::get_usage_example(&first) {
                        self.completion_hint = Some(example.to_string()); // example is &str
                        self.status = Some(format!("  {} - {}", first, example.trim()));
                        
                        #[cfg(feature = "telemetry")]
                        crate::telemetry::metrics::record_operation("tui.completion.single_hint", start_time.elapsed());
                    }
                }
            }
        }
    }

    /// Navigate back through input history.
    fn navigate_history_back(&mut self) {
        if self.input_history.is_empty() {
            return;
        }

        match self.history_index {
            None => {
                // Save current input and go to most recent history
                self.saved_input = self.input.clone();
                self.history_index = Some(self.input_history.len() - 1);
            }
            Some(idx) if idx > 0 => {
                self.history_index = Some(idx - 1);
            }
            _ => return, // Already at oldest
        }

        if let Some(idx) = self.history_index {
            self.input = self.input_history[idx].clone();
            self.cursor_pos = self.input.len();
        }
    }

    /// Navigate forward through input history.
    fn navigate_history_forward(&mut self) {
        match self.history_index {
            Some(idx) if idx + 1 < self.input_history.len() => {
                self.history_index = Some(idx + 1);
                self.input = self.input_history[idx + 1].clone();
                self.cursor_pos = self.input.len();
            }
            Some(_) => {
                // Return to saved input
                self.history_index = None;
                self.input = self.saved_input.clone();
                self.cursor_pos = self.input.len();
            }
            None => {
                // Already at current input
            }
        }
    }

    /// Handle key while waiting for response.
    fn handle_waiting_key(&mut self, key: KeyCode) {
        if key == KeyCode::Esc {
            // Cancel request (TODO: actually cancel)
            self.mode = AppMode::Normal;
            self.status = Some("Cancelled".to_string());
            self.finalize_streaming();
        }
    }

    /// Handle key in help mode.
    fn handle_help_key(&mut self, key: KeyCode) {
        if key == KeyCode::Esc || key == KeyCode::Char('q') || key == KeyCode::Enter {
            self.mode = AppMode::Normal;
        }
    }

    /// Handle key in confirmation mode.
    fn handle_confirm_key(&mut self, key: KeyCode) {
        match key {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                self.respond_to_confirmation(ConfirmationResult::Approve);
            }
            KeyCode::Char('n') | KeyCode::Char('N') => {
                self.respond_to_confirmation(ConfirmationResult::Deny);
            }
            KeyCode::Char('a') | KeyCode::Char('A') | KeyCode::Esc => {
                self.respond_to_confirmation(ConfirmationResult::Abort);
            }
            _ => {}
        }
    }

    /// Respond to a pending confirmation.
    fn respond_to_confirmation(&mut self, result: ConfirmationResult) {
        if let Some(mut pending) = self.pending_confirmation.take() {
            if let Some(tx) = pending.response_tx.take() {
                let _ = tx.send(result);
            }
        }
        self.mode = AppMode::Waiting;
    }

    /// Submit the current input.
    async fn submit_input(&mut self) {
        let input = std::mem::take(&mut self.input);
        self.cursor_pos = 0;
        self.history_index = None;

        // Add to history
        if !input.is_empty() {
            self.input_history.push(input.clone());
        }

        // Check for commands
        if input.starts_with('/') {
            match handle_command(self, &input) {
                CommandResult::Async(cmd) => {
                    // Execute async command
                    let _ = execute_async_command(self, cmd).await;
                }
                CommandResult::Prompt(prompt) => {
                    // Command generated a prompt to send to the AI
                    self.messages.push(Message::user(&prompt));
                    self.scroll_to_bottom();

                    if let Some(mut agent) = self.agent.take() {
                        self.mode = AppMode::Waiting;
                        self.status = Some("Thinking...".to_string());

                        let (tx, rx) = tokio::sync::oneshot::channel();
                        self.pending_agent = Some(rx);

                        tokio::spawn(async move {
                            let result = agent.chat(&prompt).await;
                            let _ = tx.send((agent, result));
                        });
                    }
                }
                CommandResult::Ok | CommandResult::Error(_) => {
                    // Already handled synchronously
                }
            }
            return;
        }

        // Add user message
        self.messages.push(Message::user(&input));
        self.scroll_to_bottom();

        // Get AI response - spawn on background task so the event loop stays responsive
        if let Some(mut agent) = self.agent.take() {
            self.mode = AppMode::Waiting;
            self.status = Some("Thinking...".to_string());

            // Create a oneshot channel to get the agent back when done
            let (tx, rx) = tokio::sync::oneshot::channel();
            self.pending_agent = Some(rx);

            // Spawn the agent chat on a background task
            tokio::spawn(async move {
                let result = agent.chat(&input).await;
                // Send the agent and result back (ignore error if receiver dropped)
                let _ = tx.send((agent, result));
            });
        } else {
            // No agent, just echo
            self.messages.push(Message::assistant(
                "No AI provider configured. Use --provider to specify one.",
            ));
        }
    }

    /// Clear conversation history.
    pub fn clear_messages(&mut self) {
        self.messages.clear();
        self.scroll_offset = 0;
        self.status = Some("Conversation cleared".to_string());

        // Also clear agent history
        if let Some(ref mut agent) = self.agent {
            agent.clear();
        }
    }

    /// Show help.
    pub fn show_help(&mut self) {
        self.mode = AppMode::Help;
    }

    /// Get the pending confirmation for UI display.
    pub fn get_pending_confirmation(&self) -> Option<&ToolConfirmation> {
        self.pending_confirmation.as_ref().map(|p| &p.confirmation)
    }

    /// Resolve a command alias from config. Returns the expanded command if an alias matches,
    /// or `None` if no alias applies. Aliases are checked against the command portion after `/`.
    pub fn resolve_command_alias(&self, input: &str) -> Option<String> {
        let config = self.config.as_ref()?;
        if config.command_aliases.is_empty() {
            return None;
        }

        let trimmed = input.trim();
        if !trimmed.starts_with('/') {
            return None;
        }

        // Extract the command name (without /) and any trailing args
        let without_slash = &trimmed[1..];
        let (cmd, extra_args) = match without_slash.split_once(' ') {
            Some((c, a)) => (c, Some(a)),
            None => (without_slash, None),
        };

        // Check if this command matches an alias
        if let Some(expansion) = config.command_aliases.get(cmd) {
            let expanded = if let Some(args) = extra_args {
                format!("{} {}", expansion, args)
            } else {
                expansion.clone()
            };
            // Ensure the expansion starts with /
            let result = if expanded.starts_with('/') {
                expanded
            } else {
                format!("/{}", expanded)
            };
            Some(result)
        } else {
            None
        }
    }

    /// Check if a provider is configured.
    pub fn has_provider(&self) -> bool {
        self.agent.is_some()
    }

    /// Get model info string for status bar.
    pub fn model_info(&self) -> String {
        if self.agent.is_some() {
            // TODO: Add method to get provider name and model from agent
            String::new()
        } else {
            String::new()
        }
    }

    /// Get streaming buffer preview (partial line being typed).
    pub fn streaming_buffer(&self) -> &str {
        self.stream_controller
            .as_ref()
            .map(|c| c.buffer_preview())
            .unwrap_or("")
    }

    // ========================================================================
    // Session Management
    // ========================================================================

    /// Create a new session.
    pub async fn create_session(&mut self, title: Option<String>) -> Result<(), ToolError> {
        let service = self.session_service.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Session service not available".to_string())
        })?;

        let title = title.unwrap_or_else(|| "New Session".to_string());
        let session = service.create(title, self.project_path.clone()).await?;

        self.current_session_id = Some(session.id.clone());
        self.current_session = Some(session);
        self.messages.clear();
        self.scroll_offset = 0;

        // Clear agent history too
        if let Some(ref mut agent) = self.agent {
            agent.clear();
        }

        Ok(())
    }

    /// Save the current message to the session.
    pub async fn save_message_to_session(&self, message: &Message) -> Result<(), ToolError> {
        let service = self.session_service.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Session service not available".to_string())
        })?;

        let session_id = self.current_session_id.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("No active session".to_string())
        })?;

        let session_message = message.to_session_message();
        service.add_message(session_id, &session_message).await?;

        Ok(())
    }

    /// Update session usage stats from turn stats.
    pub async fn update_session_usage(&self, stats: &TurnStats) -> Result<(), ToolError> {
        let service = self.session_service.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Session service not available".to_string())
        })?;

        let session_id = self.current_session_id.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("No active session".to_string())
        })?;

        service
            .update_usage(
                session_id,
                stats.input_tokens,
                stats.output_tokens,
                stats.cost,
            )
            .await?;

        Ok(())
    }

    /// Load a session by ID.
    pub async fn load_session(&mut self, id: &str) -> Result<(), ToolError> {
        let service = self.session_service.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Session service not available".to_string())
        })?;

        let session: Session = service.get(id).await?.ok_or_else(|| {
            ToolError::ExecutionFailed(format!("Session not found: {}", id))
        })?;

        let session_messages: Vec<crate::types::Message> = service.get_messages(id).await?;

        // Convert session messages to TUI messages
        self.messages = session_messages.iter().map(Message::from_session_message).collect();
        self.current_session_id = Some(session.id.clone());
        self.current_session = Some(session);
        self.scroll_offset = 0;

        // Scroll to bottom to show most recent messages
        self.scroll_to_bottom();

        Ok(())
    }

    /// Save the current session (update timestamp).
    pub async fn save_current_session(&mut self) -> Result<(), ToolError> {
        let service = self.session_service.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Session service not available".to_string())
        })?;

        if let Some(ref mut session) = self.current_session {
            service.save(session).await?;
        }

        Ok(())
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Result<Vec<SessionInfo>, ToolError> {
        let service = self.session_service.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Session service not available".to_string())
        })?;

        service.list().await
    }

    /// Delete a session by ID.
    pub async fn delete_session(&mut self, id: &str) -> Result<bool, ToolError> {
        let service = self.session_service.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Session service not available".to_string())
        })?;

        let deleted = service.delete(id).await?;

        // If we deleted the current session, clear it
        if deleted && self.current_session_id.as_deref() == Some(id) {
            self.current_session_id = None;
            self.current_session = None;
        }

        Ok(deleted)
    }

    /// Get session info for status bar display.
    pub fn session_status(&self) -> Option<String> {
        self.current_session.as_ref().map(|session| {
            let title = if session.title.len() > 20 {
                format!("{}...", &session.title[..17])
            } else {
                session.title.clone()
            };

            let tokens = session.total_tokens();
            let cost = session.cost;

            if cost > 0.001 {
                format!("[{}] {} msgs | {} tokens | ${:.2}", title, self.messages.len(), tokens, cost)
            } else {
                format!("[{}] {} msgs | {} tokens", title, self.messages.len(), tokens)
            }
        })
    }

    // ========================================================================
    // Orchestration (Multi-Agent)
    // ========================================================================

    /// Initialize the commander for multi-agent orchestration.
    pub async fn init_commander(&mut self) -> Result<(), ToolError> {
        if self.commander.is_some() {
            return Ok(()); // Already initialized
        }

        let project_path = std::path::Path::new(&self.project_path);
        let config = CommanderConfig::for_project(project_path);

        match Commander::new(project_path, config).await {
            Ok(commander) => {
                self.commander = Some(commander);
                Ok(())
            }
            Err(e) => Err(ToolError::ExecutionFailed(format!(
                "Failed to initialize commander: {}",
                e
            ))),
        }
    }

    /// Delegate a task to a worker.
    pub async fn delegate_task(&mut self, branch: &str, task: &str) -> Result<String, ToolError> {
        // Initialize commander if needed
        self.init_commander().await?;

        let commander = self.commander.as_mut().ok_or_else(|| {
            ToolError::ExecutionFailed("Commander not available".to_string())
        })?;

        // Generate worker ID from branch
        let worker_id = branch.replace('/', "-");

        let config = WorkerConfig::new(&worker_id, branch, task);

        commander
            .spawn_worker(config)
            .await
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to spawn worker: {}", e)))
    }

    /// List all workers and their status.
    pub async fn list_workers(&self) -> Result<Vec<(String, String)>, ToolError> {
        let commander = self.commander.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("No commander initialized. Use /delegate first.".to_string())
        })?;

        let workers = commander.list_workers().await;
        Ok(workers
            .into_iter()
            .map(|(id, status)| (id, format_worker_status(&status)))
            .collect())
    }

    /// Cancel a worker.
    pub async fn cancel_worker(&self, worker_id: &str) -> Result<(), ToolError> {
        let commander = self.commander.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("No commander initialized".to_string())
        })?;

        commander
            .cancel_worker(worker_id)
            .await
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to cancel worker: {}", e)))
    }

    /// List managed worktrees.
    pub async fn list_worktrees(&self) -> Result<Vec<WorkspaceInfo>, ToolError> {
        let _commander = self.commander.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("No commander initialized".to_string())
        })?;

        // For now, we return an empty vec as we don't track worktrees separately
        // The isolator tracks them internally
        // TODO: Expose worktree listing from the Commander/Isolator
        Ok(Vec::new())
    }

    /// Cleanup completed worktrees.
    pub async fn cleanup_worktrees(&mut self) -> Result<usize, ToolError> {
        let commander = self.commander.as_mut().ok_or_else(|| {
            ToolError::ExecutionFailed("No commander initialized".to_string())
        })?;

        // Get completed workers
        let workers = commander.list_workers().await;
        let mut cleaned = 0;

        for (worker_id, status) in workers {
            if status.is_terminal() {
                if let Err(e) = commander.cleanup_worker(&worker_id).await {
                    tracing::warn!("Failed to cleanup worker {}: {}", worker_id, e);
                } else {
                    cleaned += 1;
                }
            }
        }

        Ok(cleaned)
    }

    /// Respond to a worker's permission request.
    pub async fn respond_to_worker_permission(
        &self,
        worker_id: &str,
        request_id: &str,
        approved: bool,
    ) -> Result<(), ToolError> {
        let commander = self.commander.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("No commander initialized".to_string())
        })?;

        let result = if approved {
            PermissionResult::Approve
        } else {
            PermissionResult::Deny {
                reason: "User denied".to_string(),
            }
        };

        commander
            .respond_permission(worker_id, request_id, result)
            .await
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to respond: {}", e)))
    }

    /// Process worker events (called from event loop).
    pub async fn process_worker_events(&mut self) {
        // This would need the event receiver from Commander
        // For now, this is a placeholder for the event processing logic
    }

    /// Check if there are pending worker permission requests.
    pub fn has_pending_worker_permissions(&self) -> bool {
        !self.pending_worker_permissions.is_empty()
    }

    /// Get the next pending worker permission for UI.
    pub fn next_worker_permission(&self) -> Option<&(String, String, String, serde_json::Value)> {
        self.pending_worker_permissions.first()
    }

    /// Shutdown the commander.
    pub async fn shutdown_commander(&mut self) {
        if let Some(ref mut commander) = self.commander {
            if let Err(e) = commander.shutdown().await {
                tracing::warn!("Error shutting down commander: {}", e);
            }
        }
        self.commander = None;
    }
}

/// Build a system prompt from an optional `ResolvedConfig`.
///
/// This is the standalone version used by both the TUI (`App::build_system_prompt`)
/// and the non-interactive `-P` mode so that config-driven prompt additions are
/// applied consistently.
pub fn build_system_prompt_from_config(config: Option<&ResolvedConfig>) -> String {
    let mut prompt = "You are Codi, a helpful AI coding assistant. Help the user with their programming tasks.".to_string();

    if let Some(config) = config {
        if let Some(ref additions) = config.system_prompt_additions {
            prompt.push_str("\n\n");
            prompt.push_str(additions);
        }

        if let Some(ref project_context) = config.project_context {
            prompt.push_str("\n\n## Project Context\n");
            prompt.push_str(project_context);
        }
    }

    prompt
}

/// Format worker status for display.
fn format_worker_status(status: &WorkerStatus) -> String {
    match status {
        WorkerStatus::Starting => "starting".to_string(),
        WorkerStatus::Idle => "idle".to_string(),
        WorkerStatus::Thinking => "thinking".to_string(),
        WorkerStatus::ToolCall { tool } => format!("running {}", tool),
        WorkerStatus::WaitingPermission { tool } => format!("awaiting permission for {}", tool),
        WorkerStatus::Complete { .. } => "complete".to_string(),
        WorkerStatus::Failed { error, .. } => format!("failed: {}", error),
        WorkerStatus::Cancelled => "cancelled".to_string(),
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_new() {
        let app = App::new();
        assert_eq!(app.mode, AppMode::Normal);
        assert!(app.messages.is_empty());
        assert!(app.input.is_empty());
    }

    #[test]
    fn test_message_user() {
        let msg = Message::user("Hello");
        assert_eq!(msg.role, Role::User);
        assert_eq!(msg.content, "Hello");
        assert!(!msg.streaming);
    }

    #[test]
    fn test_message_assistant() {
        let msg = Message::assistant("Hi there");
        assert_eq!(msg.role, Role::Assistant);
        assert_eq!(msg.content, "Hi there");
        assert!(!msg.streaming);
    }

    #[test]
    fn test_message_streaming() {
        let mut msg = Message::streaming();
        assert!(msg.streaming);
        assert!(msg.content.is_empty());

        msg.append("Hello");
        assert_eq!(msg.content, "Hello");

        msg.complete();
        assert!(!msg.streaming);
    }

    #[test]
    fn test_clear_messages() {
        let mut app = App::new();
        app.messages.push(Message::user("test"));
        app.messages.push(Message::assistant("response"));

        app.clear_messages();

        assert!(app.messages.is_empty());
        assert!(app.status.is_some());
    }

    #[test]
    fn test_resolve_command_alias_no_config() {
        let app = App::new();
        // No config set, should return None
        assert!(app.resolve_command_alias("/t").is_none());
    }

    #[test]
    fn test_resolve_command_alias_basic() {
        let mut app = App::new();
        let mut config = crate::config::default_config();
        config.command_aliases.insert("t".to_string(), "/test src/".to_string());
        config.command_aliases.insert("b".to_string(), "/build".to_string());
        app.set_config(config);

        // Basic alias
        assert_eq!(app.resolve_command_alias("/t"), Some("/test src/".to_string()));
        assert_eq!(app.resolve_command_alias("/b"), Some("/build".to_string()));

        // Non-matching command
        assert!(app.resolve_command_alias("/help").is_none());

        // Non-slash input
        assert!(app.resolve_command_alias("hello").is_none());
    }

    #[test]
    fn test_resolve_command_alias_with_extra_args() {
        let mut app = App::new();
        let mut config = crate::config::default_config();
        config.command_aliases.insert("t".to_string(), "/test src/".to_string());
        app.set_config(config);

        // Extra args appended
        assert_eq!(
            app.resolve_command_alias("/t --verbose"),
            Some("/test src/ --verbose".to_string())
        );
    }

    #[test]
    fn test_resolve_command_alias_bare_expansion() {
        let mut app = App::new();
        let mut config = crate::config::default_config();
        // Alias without leading /
        config.command_aliases.insert("x".to_string(), "exit".to_string());
        app.set_config(config);

        // Should auto-prepend /
        assert_eq!(app.resolve_command_alias("/x"), Some("/exit".to_string()));
    }

    #[test]
    fn test_build_system_prompt_no_config() {
        let app = App::new();
        let prompt = app.build_system_prompt();
        assert!(prompt.contains("Codi"));
        assert!(!prompt.contains("Project Context"));
    }

    #[test]
    fn test_build_system_prompt_with_additions() {
        let mut app = App::new();
        let mut config = crate::config::default_config();
        config.system_prompt_additions = Some("Always use strict mode.".to_string());
        config.project_context = Some("This is a React app.".to_string());
        app.set_config(config);

        let prompt = app.build_system_prompt();
        assert!(prompt.contains("Always use strict mode."));
        assert!(prompt.contains("## Project Context"));
        assert!(prompt.contains("This is a React app."));
    }

    #[test]
    fn test_build_agent_config_defaults() {
        let app = App::new();
        let config = app.build_agent_config();
        assert!(config.use_tools);
        assert!(!config.auto_approve_all);
        assert!(config.auto_approve_tools.is_empty());
    }

    #[test]
    fn test_build_agent_config_from_resolved() {
        let mut app = App::new();
        let mut config = crate::config::default_config();
        config.no_tools = true;
        config.auto_approve = vec!["read_file".to_string()];
        app.set_config(config);
        app.set_auto_approve(true);

        let agent_config = app.build_agent_config();
        assert!(!agent_config.use_tools);
        assert!(agent_config.auto_approve_all);
        assert_eq!(agent_config.auto_approve_tools, vec!["read_file".to_string()]);
    }

    #[test]
    fn test_input_history() {
        let mut app = App::new();

        // Add some history
        app.input_history.push("first".to_string());
        app.input_history.push("second".to_string());
        app.input = "current".to_string();

        // Navigate back
        app.navigate_history_back();
        assert_eq!(app.input, "second");
        assert_eq!(app.history_index, Some(1));

        app.navigate_history_back();
        assert_eq!(app.input, "first");
        assert_eq!(app.history_index, Some(0));

        // Navigate forward
        app.navigate_history_forward();
        assert_eq!(app.input, "second");
        assert_eq!(app.history_index, Some(1));

        app.navigate_history_forward();
        assert_eq!(app.input, "current");
        assert_eq!(app.history_index, None);
    }

    #[test]
    fn test_build_system_prompt_from_config_none() {
        let prompt = build_system_prompt_from_config(None);
        assert!(prompt.contains("Codi"));
        assert!(!prompt.contains("Project Context"));
    }

    #[test]
    fn test_build_system_prompt_from_config_with_additions() {
        let mut config = crate::config::default_config();
        config.system_prompt_additions = Some("Be concise.".to_string());
        config.project_context = Some("Rust CLI app.".to_string());

        let prompt = build_system_prompt_from_config(Some(&config));
        assert!(prompt.contains("Be concise."));
        assert!(prompt.contains("## Project Context"));
        assert!(prompt.contains("Rust CLI app."));
    }

    #[test]
    fn test_app_event_compaction_variant() {
        // Verify the Compaction variant exists and can be constructed
        let start = AppEvent::Compaction(true);
        let end = AppEvent::Compaction(false);
        // Pattern match to confirm the variant works
        match start {
            AppEvent::Compaction(is_starting) => assert!(is_starting),
            _ => panic!("expected Compaction variant"),
        }
        match end {
            AppEvent::Compaction(is_starting) => assert!(!is_starting),
            _ => panic!("expected Compaction variant"),
        }
    }
}
