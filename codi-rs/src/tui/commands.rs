// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Slash command handling for the TUI.
//!
//! Session commands provide basic session management but require a SessionService
//! to be configured in the App for full functionality. Without a session service,
//! session operations will show "not yet implemented" messages.

use super::app::App;

/// Command result that can include an optional prompt to send to the AI.
pub enum CommandResult {
    /// Command executed successfully.
    Ok,
    /// Command resulted in an error.
    Error(String),
    /// Command produced a prompt to send to the AI.
    Prompt(String),
}

/// Handle a slash command.
pub fn handle_command(app: &mut App, input: &str) -> CommandResult {
    let parts: Vec<&str> = input.trim().splitn(2, ' ').collect();
    let command = parts[0].to_lowercase();
    let args = parts.get(1).copied().unwrap_or("");

    match command.as_str() {
        // Help commands
        "/help" | "/h" | "/?" => {
            app.show_help();
            CommandResult::Ok
        }

        // Exit commands
        "/exit" | "/quit" | "/q" => {
            app.should_quit = true;
            CommandResult::Ok
        }

        // Clear conversation
        "/clear" | "/c" => {
            app.clear_messages();
            CommandResult::Ok
        }

        // Version info
        "/version" | "/v" => {
            app.status = Some(format!("Codi v{}", crate::VERSION));
            CommandResult::Ok
        }

        // Status command
        "/status" => {
            handle_status(app)
        }

        // Context commands
        "/compact" => {
            handle_compact(app, args)
        }

        // Model commands
        "/model" | "/switch" => {
            handle_model(app, args)
        }
        "/models" => {
            handle_models(app)
        }

        // Session commands
        "/session" | "/s" => {
            handle_session(app, args)
        }

        // Debug commands
        "/debug" => {
            handle_debug(app)
        }

        // Unknown command
        _ => {
            app.status = Some(format!("Unknown command: {}. Type /help for commands.", command));
            CommandResult::Error(format!("Unknown command: {}", command))
        }
    }
}

/// Handle /status command - show context and session info.
fn handle_status(app: &mut App) -> CommandResult {
    let mut status_lines = Vec::new();

    // Provider status
    if app.has_provider() {
        status_lines.push("Provider: Configured".to_string());
    } else {
        status_lines.push("Provider: Not configured".to_string());
    }

    // Message count
    status_lines.push(format!("Messages: {}", app.messages.len()));

    // Token stats from last turn
    if let Some(ref stats) = app.last_turn_stats {
        status_lines.push(format!(
            "Last turn: {} input, {} output tokens, {} tool calls",
            stats.input_tokens,
            stats.output_tokens,
            stats.tool_call_count
        ));
    }

    // Input history count
    status_lines.push(format!("Input history: {} entries", app.input_history.len()));

    app.status = Some(status_lines.join(" | "));
    CommandResult::Ok
}

/// Handle /compact command - context compaction commands.
fn handle_compact(app: &mut App, args: &str) -> CommandResult {
    match args {
        "status" | "" => {
            // Show current context status
            app.status = Some(format!(
                "Context: {} messages",
                app.messages.len()
            ));
            CommandResult::Ok
        }
        "summarize" => {
            // TODO: Implement context summarization
            app.status = Some("Context summarization not yet implemented".to_string());
            CommandResult::Ok
        }
        _ => {
            app.status = Some("Usage: /compact [status|summarize]".to_string());
            CommandResult::Error("Invalid compact subcommand".to_string())
        }
    }
}

/// Handle /model and /switch commands.
fn handle_model(app: &mut App, args: &str) -> CommandResult {
    if args.is_empty() {
        // Show current model
        let info = app.model_info();
        if info.is_empty() {
            app.status = Some("No model configured".to_string());
        } else {
            app.status = Some(format!("Current model: {}", info));
        }
        CommandResult::Ok
    } else {
        // TODO: Implement model switching
        app.status = Some(format!("Model switching not yet implemented. Requested: {}", args));
        CommandResult::Ok
    }
}

/// Handle /models command - list available models.
fn handle_models(app: &mut App) -> CommandResult {
    // TODO: Implement model listing
    app.status = Some("Model listing not yet implemented".to_string());
    CommandResult::Ok
}

/// Handle /session commands.
fn handle_session(app: &mut App, args: &str) -> CommandResult {
    let parts: Vec<&str> = args.splitn(2, ' ').collect();
    let subcommand = parts.first().copied().unwrap_or("");
    let subargs = parts.get(1).copied().unwrap_or("");

    match subcommand {
        "" | "status" => {
            // Show session status
            app.status = Some(format!("Session: {} messages", app.messages.len()));
            CommandResult::Ok
        }
        "new" => {
            // Create new session
            app.clear_messages();
            app.status = Some("New session started".to_string());
            CommandResult::Ok
        }
        "save" => {
            // TODO: Save session
            let name = if subargs.is_empty() { "default" } else { subargs };
            app.status = Some(format!("Session save not yet implemented. Name: {}", name));
            CommandResult::Ok
        }
        "load" => {
            // TODO: Load session
            if subargs.is_empty() {
                app.status = Some("Usage: /session load <name>".to_string());
                return CommandResult::Error("No session name provided".to_string());
            }
            app.status = Some(format!("Session load not yet implemented. Name: {}", subargs));
            CommandResult::Ok
        }
        "list" => {
            // TODO: List sessions
            app.status = Some("Session listing not yet implemented".to_string());
            CommandResult::Ok
        }
        "delete" => {
            // TODO: Delete session
            if subargs.is_empty() {
                app.status = Some("Usage: /session delete <name>".to_string());
                return CommandResult::Error("No session name provided".to_string());
            }
            app.status = Some(format!("Session delete not yet implemented. Name: {}", subargs));
            CommandResult::Ok
        }
        _ => {
            app.status = Some("Usage: /session [new|save|load|list|delete|status]".to_string());
            CommandResult::Error(format!("Unknown session subcommand: {}", subcommand))
        }
    }
}

/// Handle /debug command - show internal state.
fn handle_debug(app: &mut App) -> CommandResult {
    let mut info = Vec::new();

    info.push(format!("Mode: {:?}", app.mode));
    info.push(format!("Messages: {}", app.messages.len()));
    info.push(format!("Input len: {}", app.input.len()));
    info.push(format!("Cursor pos: {}", app.cursor_pos));
    info.push(format!("Scroll offset: {}", app.scroll_offset));
    info.push(format!("History entries: {}", app.input_history.len()));

    if let Some(ref stats) = app.last_turn_stats {
        info.push(format!(
            "Last turn: {}ms, {} tools",
            stats.duration_ms,
            stats.tool_call_count
        ));
    }

    app.status = Some(info.join(" | "));
    CommandResult::Ok
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
        let result = handle_command(&mut app, "/unknown");
        assert!(app.status.is_some());
        assert!(app.status.as_ref().unwrap().contains("Unknown command"));
        assert!(matches!(result, CommandResult::Error(_)));
    }

    #[test]
    fn test_status_command() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/status");
        assert!(matches!(result, CommandResult::Ok));
        assert!(app.status.is_some());
    }

    #[test]
    fn test_compact_command() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/compact status");
        assert!(matches!(result, CommandResult::Ok));
        assert!(app.status.is_some());
    }

    #[test]
    fn test_session_new_command() {
        let mut app = App::default();
        app.messages.push(super::super::app::Message::user("test"));

        let result = handle_command(&mut app, "/session new");
        assert!(matches!(result, CommandResult::Ok));
        assert!(app.messages.is_empty());
        assert!(app.status.as_ref().unwrap().contains("New session"));
    }

    #[test]
    fn test_debug_command() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/debug");
        assert!(matches!(result, CommandResult::Ok));
        assert!(app.status.is_some());
        assert!(app.status.as_ref().unwrap().contains("Mode:"));
    }
}
