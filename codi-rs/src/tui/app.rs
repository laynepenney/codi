// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Application state and main loop for the TUI.

use std::io;

use crossterm::event::KeyCode;
use ratatui::prelude::*;

use crate::types::{BoxedProvider, Role};

use super::commands::handle_command;
use super::events::{Event, EventHandler};
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
}

impl Message {
    /// Create a user message.
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
            streaming: false,
        }
    }

    /// Create an assistant message.
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            streaming: false,
        }
    }

    /// Create a streaming assistant message.
    pub fn streaming() -> Self {
        Self {
            role: Role::Assistant,
            content: String::new(),
            streaming: true,
        }
    }
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
    /// AI provider.
    provider: Option<BoxedProvider>,
}

impl App {
    /// Create a new application.
    pub fn new() -> Self {
        Self {
            mode: AppMode::Normal,
            messages: Vec::new(),
            input: String::new(),
            cursor_pos: 0,
            scroll_offset: 0,
            should_quit: false,
            status: None,
            provider: None,
        }
    }

    /// Create with a provider.
    pub fn with_provider(provider: BoxedProvider) -> Self {
        Self {
            provider: Some(provider),
            ..Self::new()
        }
    }

    /// Run the main event loop.
    pub async fn run<B: Backend>(
        &mut self,
        terminal: &mut Terminal<B>,
        mut events: EventHandler,
    ) -> io::Result<()> {
        while !self.should_quit {
            // Draw UI
            terminal.draw(|f| ui::draw(f, self))?;

            // Handle events
            if let Some(event) = events.next().await {
                self.handle_event(event).await;
            }
        }

        Ok(())
    }

    /// Handle an input event.
    async fn handle_event(&mut self, event: Event) {
        match event {
            Event::Tick => {}
            Event::Key(key) => self.handle_key(key.code).await,
            Event::Mouse(_) => {}
            Event::Resize(_, _) => {}
        }
    }

    /// Handle a key press.
    async fn handle_key(&mut self, key: KeyCode) {
        match self.mode {
            AppMode::Normal => self.handle_normal_key(key).await,
            AppMode::Waiting => self.handle_waiting_key(key),
            AppMode::Help => self.handle_help_key(key),
        }
    }

    /// Handle key in normal mode.
    async fn handle_normal_key(&mut self, key: KeyCode) {
        match key {
            KeyCode::Enter => {
                if !self.input.is_empty() {
                    self.submit_input().await;
                }
            }
            KeyCode::Char(c) => {
                self.input.insert(self.cursor_pos, c);
                self.cursor_pos += 1;
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
                if self.scroll_offset > 0 {
                    self.scroll_offset -= 1;
                }
            }
            KeyCode::Down => {
                self.scroll_offset += 1;
            }
            KeyCode::PageUp => {
                self.scroll_offset = self.scroll_offset.saturating_sub(10);
            }
            KeyCode::PageDown => {
                self.scroll_offset += 10;
            }
            KeyCode::Esc => {
                self.should_quit = true;
            }
            _ => {}
        }
    }

    /// Handle key while waiting for response.
    fn handle_waiting_key(&mut self, key: KeyCode) {
        if key == KeyCode::Esc {
            // Cancel request (TODO: actually cancel)
            self.mode = AppMode::Normal;
            self.status = Some("Cancelled".to_string());
        }
    }

    /// Handle key in help mode.
    fn handle_help_key(&mut self, key: KeyCode) {
        if key == KeyCode::Esc || key == KeyCode::Char('q') || key == KeyCode::Enter {
            self.mode = AppMode::Normal;
        }
    }

    /// Submit the current input.
    async fn submit_input(&mut self) {
        let input = std::mem::take(&mut self.input);
        self.cursor_pos = 0;

        // Check for commands
        if input.starts_with('/') {
            handle_command(self, &input);
            return;
        }

        // Add user message
        self.messages.push(Message::user(&input));

        // Get AI response
        if let Some(ref provider) = self.provider {
            self.mode = AppMode::Waiting;
            self.status = Some("Thinking...".to_string());

            // Convert messages to API format
            let api_messages: Vec<crate::types::Message> = self
                .messages
                .iter()
                .filter(|m| !m.streaming)
                .map(|m| crate::types::Message {
                    role: m.role,
                    content: crate::types::MessageContent::Text(m.content.clone()),
                })
                .collect();

            // Call the provider
            match provider.chat(&api_messages, None, None).await {
                Ok(response) => {
                    self.messages.push(Message::assistant(&response.content));
                    self.status = None;
                }
                Err(e) => {
                    self.status = Some(format!("Error: {}", e));
                }
            }

            self.mode = AppMode::Normal;
        } else {
            // No provider, just echo
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
    }

    /// Show help.
    pub fn show_help(&mut self) {
        self.mode = AppMode::Help;
    }
}

impl App {
    /// Check if a provider is configured.
    pub fn has_provider(&self) -> bool {
        self.provider.is_some()
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
    fn test_clear_messages() {
        let mut app = App::new();
        app.messages.push(Message::user("test"));
        app.messages.push(Message::assistant("response"));

        app.clear_messages();

        assert!(app.messages.is_empty());
        assert!(app.status.is_some());
    }
}
