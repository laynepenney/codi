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
use crate::error::ToolError;
use crate::completion::{complete_line, get_completion_matches};
use crate::orchestrate::{
    AsyncCommand, AsyncCommandResult, DelegationRequest, DelegationResult, Worker, WorkerResult,
};
use crate::error::ToolError;
use crate::orchestrate::{
    Commander, CommanderConfig, WorkerConfig, WorkerStatus, WorkspaceInfo,
    ipc::PermissionResult,
};
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
    /// Tool call started.
    ToolStart(String, serde_json::Value),
    /// Tool call completed.
    ToolResult(String, String, bool),
    /// Turn completed with stats.
    TurnComplete(TurnStats),
    /// Confirmation request.
    ConfirmRequest(ToolConfirmation),
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
            commander: None,
            pending_worker_permissions: Vec::new(),
        }
    }

    /// Create with a provider.
    pub fn with_provider(provider: BoxedProvider) -> Self {
        let mut app = Self::new();
        app.set_provider(provider);
        app
    }

    /// Create with a provider and project path.
    pub fn with_provider_and_path(provider: BoxedProvider, project_path: impl AsRef<Path>) -> Self {
        let mut app = Self::with_project_path(project_path);
        app.set_provider(provider);
        app
    }

    /// Set the AI provider and create an agent.
    pub fn set_provider(&mut self, provider: BoxedProvider) {
        let registry = Arc::new(ToolRegistry::with_defaults());
        let event_tx = self.event_tx.clone().unwrap();

        let callbacks = AgentCallbacks {
            on_text: Some(Box::new({
                let tx = event_tx.clone();
                move |text: &str| {
                    let _ = tx.send(AppEvent::TextDelta(text.to_string()));
                }
            })),
            on_tool_call: Some(Box::new({
                let tx = event_tx.clone();
                move |name: &str, input: &serde_json::Value| {
                    let _ = tx.send(AppEvent::ToolStart(name.to_string(), input.clone()));
                }
            })),
            on_tool_result: Some(Box::new({
                let tx = event_tx.clone();
                move |name: &str, result: &str, is_error: bool| {
                    let _ = tx.send(AppEvent::ToolResult(name.to_string(), result.to_string(), is_error));
                }
            })),
            on_confirm: None, // Handled via channel-based approach
            on_compaction: None,
            on_turn_complete: Some(Box::new({
                let tx = event_tx.clone();
                move |stats: &TurnStats| {
                    let _ = tx.send(AppEvent::TurnComplete(stats.clone()));
                }
            })),
        };

        self.agent = Some(Agent::new(AgentOptions {
            provider,
            tool_registry: registry,
            system_prompt: Some("You are Codi, a helpful AI coding assistant. Help the user with their programming tasks.".to_string()),
            config: AgentConfig::default(),
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
                AppEvent::ToolStart(name, _input) => {
                    self.status = Some(format!("Running: {} ...", name));
                }
                AppEvent::ToolResult(name, _result, is_error) => {
                    if is_error {
                        self.status = Some(format!("Tool {} failed", name));
                    } else {
                        self.status = Some(format!("Completed: {}", name));
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
fn get_usage_example(cmd: &str) -> Option<&'static str> {
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

    /// Handle tab completion for input (slash commands only).
    fn handle_tab_completion(&mut self) {
        // Only provide completion for slash commands
        let trimmed = self.input.trim();
        if trimmed.starts_with('/') {
            if let Some(completed) = complete_line(&self.input) {
                if completed != self.input {
                    self.input = completed;
                    self.cursor_pos = self.input.len();
                }
            }
            
            // Show completion hints
            let matches = get_completion_matches(&self.input);
            if !matches.is_empty() {
                if matches.len() > 1 {
                    // Show first few matches as hint
                    let hint = format!("  Commands: {}", matches.iter().take(3).cloned().collect::<Vec<_>>().join(" | "));
                    self.status = Some(hint);
                } else if matches.len() == 1 {
                    // Show usage hint for single match
                    let first = matches[0].clone();
                    if let Some(example) = get_usage_example(&first) {
                        self.completion_hint = Some(example.to_string());
                        self.status = Some(format!("  {} - {}", first, example.trim()));
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
                CommandResult::Ok | CommandResult::Error(_) | CommandResult::Prompt(_) => {
                    // Already handled synchronously
                }
            }
            return;
        }

        // Add user message
        self.messages.push(Message::user(&input));
        self.scroll_to_bottom();

        // Get AI response
        if let Some(ref mut agent) = self.agent {
            self.mode = AppMode::Waiting;
            self.status = Some("Thinking...".to_string());

            // Call the agent
            match agent.chat(&input).await {
                Ok(_response) => {
                    // Response is handled via callbacks
                }
                Err(e) => {
                    self.status = Some(format!("Error: {}", e));
                    self.mode = AppMode::Normal;
                }
            }
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
}
