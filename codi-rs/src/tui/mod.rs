// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Terminal User Interface for Codi.
//!
//! This module provides a ratatui-based terminal interface for interactive
//! conversations with AI models.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                        App                                  │
//! │  (Application state: messages, input, mode, session)        │
//! └─────────────────────────────────────────────────────────────┘
//!                            │
//!          ┌─────────────────┼─────────────────┐
//!          ▼                 ▼                 ▼
//! ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
//! │     Events      │ │     UI      │ │    Commands     │
//! │  (Keyboard/Term)│ │  (Render)   │ │  (Slash cmds)   │
//! └─────────────────┘ └─────────────┘ └─────────────────┘
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::tui::{App, run};
//!
//! // Create the app with a provider
//! let provider = create_provider_from_env()?;
//! let mut app = App::new(provider);
//!
//! // Run the TUI event loop
//! run(&mut app)?;
//! ```

pub mod app;
pub mod commands;
pub mod components;
pub mod events;
pub mod streaming;
pub mod syntax;
pub mod ui;

pub use app::{App, AppMode, Message as ChatMessage, build_system_prompt_from_config};
pub use events::{Event, EventHandler};
pub use streaming::{MarkdownStreamCollector, StreamController, StreamState, StreamStatus};
pub use syntax::{HighlightType, SupportedLanguage, SyntaxHighlighter, Theme};

use std::io;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;

/// Initialize the terminal for TUI mode.
pub fn init_terminal() -> io::Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend)
}

/// Restore the terminal to normal mode.
pub fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;
    Ok(())
}

/// Run the TUI application.
pub async fn run(app: &mut App) -> io::Result<()> {
    let mut terminal = init_terminal()?;
    let events = EventHandler::new(250);

    let result = app.run(&mut terminal, events).await;

    restore_terminal(&mut terminal)?;
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_exports() {
        // Verify key types are accessible
        // Note: Can't test terminal init/restore in unit tests
    }
}
