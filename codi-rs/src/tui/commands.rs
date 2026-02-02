// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Slash command handling for the TUI.

use super::app::App;

/// Handle a slash command.
pub fn handle_command(app: &mut App, input: &str) {
    let parts: Vec<&str> = input.trim().splitn(2, ' ').collect();
    let command = parts[0].to_lowercase();
    let _args = parts.get(1).copied().unwrap_or("");

    match command.as_str() {
        "/help" | "/h" | "/?" => {
            app.show_help();
        }
        "/clear" | "/c" => {
            app.clear_messages();
        }
        "/exit" | "/quit" | "/q" => {
            app.should_quit = true;
        }
        "/version" | "/v" => {
            app.status = Some(format!("Codi v{}", crate::VERSION));
        }
        _ => {
            app.status = Some(format!("Unknown command: {}. Type /help for commands.", command));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_help_command() {
        let mut app = App::default();
        handle_command(&mut app, "/help");
        assert_eq!(app.mode, super::super::app::AppMode::Help);
    }

    #[test]
    fn test_clear_command() {
        let mut app = App::default();
        app.messages.push(super::super::app::Message::user("test"));
        handle_command(&mut app, "/clear");
        assert!(app.messages.is_empty());
    }

    #[test]
    fn test_exit_command() {
        let mut app = App::default();
        handle_command(&mut app, "/exit");
        assert!(app.should_quit);
    }

    #[test]
    fn test_quit_command() {
        let mut app = App::default();
        handle_command(&mut app, "/quit");
        assert!(app.should_quit);
    }

    #[test]
    fn test_version_command() {
        let mut app = App::default();
        handle_command(&mut app, "/version");
        assert!(app.status.is_some());
        assert!(app.status.as_ref().unwrap().contains("Codi"));
    }

    #[test]
    fn test_unknown_command() {
        let mut app = App::default();
        handle_command(&mut app, "/unknown");
        assert!(app.status.is_some());
        assert!(app.status.as_ref().unwrap().contains("Unknown command"));
    }
}
