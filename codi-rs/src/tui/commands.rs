// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Slash command handling for the TUI.
//!
//! Session commands provide session management with SQLite persistence.
//! Commands that require async operations (like session save/load) return
//! `CommandResult::Async` which signals that the command handler needs to
//! be awaited in the main event loop.

use super::app::App;

/// Command result that can include an optional prompt to send to the AI.
pub enum CommandResult {
    /// Command executed successfully.
    Ok,
    /// Command resulted in an error.
    Error(String),
    /// Command produced a prompt to send to the AI.
    Prompt(String),
    /// Command requires async execution (session operations).
    Async(AsyncCommand),
}

/// Async commands that need to be executed outside the synchronous command handler.
#[derive(Debug, Clone)]
pub enum AsyncCommand {
    /// Create a new session with optional title.
    SessionNew(Option<String>),
    /// Save the current session.
    SessionSave,
    /// Load a session by ID.
    SessionLoad(String),
    /// List all sessions.
    SessionList,
    /// Delete a session by ID.
    SessionDelete(String),
}

/// Handle a slash command synchronously. Returns `CommandResult::Async` for
/// commands that need async execution.
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

/// Execute an async command. Call this from the main event loop when
/// `handle_command` returns `CommandResult::Async`.
pub async fn execute_async_command(app: &mut App, cmd: AsyncCommand) -> CommandResult {
    match cmd {
        AsyncCommand::SessionNew(title) => {
            match app.create_session(title).await {
                Ok(()) => {
                    let session_name = app.current_session.as_ref()
                        .map(|s| s.title.as_str())
                        .unwrap_or("New Session");
                    app.status = Some(format!("Created session: {}", session_name));
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to create session: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::SessionSave => {
            if app.current_session_id.is_none() {
                // Create a new session first
                match app.create_session(None).await {
                    Ok(()) => {}
                    Err(e) => {
                        app.status = Some(format!("Failed to create session: {}", e));
                        return CommandResult::Error(e.to_string());
                    }
                }
            }

            // Save all current messages to the session
            for message in &app.messages {
                if let Err(e) = app.save_message_to_session(message).await {
                    app.status = Some(format!("Failed to save message: {}", e));
                    return CommandResult::Error(e.to_string());
                }
            }

            match app.save_current_session().await {
                Ok(()) => {
                    let session_name = app.current_session.as_ref()
                        .map(|s| s.title.as_str())
                        .unwrap_or("session");
                    app.status = Some(format!("Saved session: {}", session_name));
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to save session: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::SessionLoad(id) => {
            match app.load_session(&id).await {
                Ok(()) => {
                    let session_name = app.current_session.as_ref()
                        .map(|s| s.title.as_str())
                        .unwrap_or("session");
                    let msg_count = app.messages.len();
                    app.status = Some(format!("Loaded session: {} ({} messages)", session_name, msg_count));
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to load session: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::SessionList => {
            match app.list_sessions().await {
                Ok(sessions) => {
                    if sessions.is_empty() {
                        app.status = Some("No sessions found".to_string());
                    } else {
                        // Format session list for display
                        let session_list: Vec<String> = sessions
                            .iter()
                            .take(10)  // Limit to 10 for status bar
                            .map(|s| {
                                let date = chrono::DateTime::from_timestamp(s.updated_at, 0)
                                    .map(|dt| dt.format("%m/%d").to_string())
                                    .unwrap_or_default();
                                format!("{} ({})", s.title, date)
                            })
                            .collect();

                        let total = sessions.len();
                        let shown = session_list.len();
                        let suffix = if total > shown {
                            format!(" ... and {} more", total - shown)
                        } else {
                            String::new()
                        };

                        app.status = Some(format!("Sessions: {}{}", session_list.join(", "), suffix));
                    }
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to list sessions: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::SessionDelete(id) => {
            match app.delete_session(&id).await {
                Ok(deleted) => {
                    if deleted {
                        app.status = Some(format!("Deleted session: {}", id));
                    } else {
                        app.status = Some(format!("Session not found: {}", id));
                    }
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to delete session: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }
    }
}

/// Handle /status command - show context and session info.
fn handle_status(app: &mut App) -> CommandResult {
    let mut status_lines = Vec::new();

    // Session info
    if let Some(ref session) = app.current_session {
        status_lines.push(format!("Session: {}", session.title));
        let tokens = session.total_tokens();
        if tokens > 0 {
            status_lines.push(format!("{} tokens", tokens));
        }
        if session.cost > 0.001 {
            status_lines.push(format!("${:.3}", session.cost));
        }
    } else {
        status_lines.push("Session: None".to_string());
    }

    // Provider status
    if app.has_provider() {
        status_lines.push("Provider: OK".to_string());
    } else {
        status_lines.push("Provider: None".to_string());
    }

    // Message count
    status_lines.push(format!("{} msgs", app.messages.len()));

    // Token stats from last turn
    if let Some(ref stats) = app.last_turn_stats {
        status_lines.push(format!(
            "Last: {}in/{}out, {} tools",
            stats.input_tokens,
            stats.output_tokens,
            stats.tool_call_count
        ));
    }

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

    // Check if session service is available
    if app.session_service.is_none() {
        app.status = Some("Session service not available".to_string());
        return CommandResult::Error("Session service not available".to_string());
    }

    match subcommand {
        "" | "status" => {
            // Show session status (synchronous)
            if let Some(status) = app.session_status() {
                app.status = Some(status);
            } else {
                app.status = Some(format!("No active session ({} messages)", app.messages.len()));
            }
            CommandResult::Ok
        }
        "new" => {
            // Create new session (async)
            let title = if subargs.is_empty() {
                None
            } else {
                Some(subargs.to_string())
            };
            CommandResult::Async(AsyncCommand::SessionNew(title))
        }
        "save" => {
            // Save session (async)
            CommandResult::Async(AsyncCommand::SessionSave)
        }
        "load" => {
            // Load session (async)
            if subargs.is_empty() {
                app.status = Some("Usage: /session load <id>".to_string());
                return CommandResult::Error("No session ID provided".to_string());
            }
            CommandResult::Async(AsyncCommand::SessionLoad(subargs.to_string()))
        }
        "list" => {
            // List sessions (async)
            CommandResult::Async(AsyncCommand::SessionList)
        }
        "delete" => {
            // Delete session (async)
            if subargs.is_empty() {
                app.status = Some("Usage: /session delete <id>".to_string());
                return CommandResult::Error("No session ID provided".to_string());
            }
            CommandResult::Async(AsyncCommand::SessionDelete(subargs.to_string()))
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

    if let Some(ref session) = app.current_session {
        info.push(format!("Session: {}", session.id));
    }

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
    fn test_session_status_without_service() {
        let mut app = App::default();
        // Explicitly remove the session service to test behavior without it
        app.session_service = None;

        let result = handle_command(&mut app, "/session status");
        // Should error because no session service is available
        assert!(matches!(result, CommandResult::Error(_)));
        assert!(app.status.as_ref().unwrap().contains("not available"));
    }

    #[test]
    fn test_debug_command() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/debug");
        assert!(matches!(result, CommandResult::Ok));
        assert!(app.status.is_some());
        assert!(app.status.as_ref().unwrap().contains("Mode:"));
    }

    #[test]
    fn test_session_new_returns_async() {
        // Create app with a temp directory so session service is available
        let temp_dir = tempfile::TempDir::new().unwrap();
        let mut app = App::with_project_path(temp_dir.path());

        let result = handle_command(&mut app, "/session new Test");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::SessionNew(_))));

        if let CommandResult::Async(AsyncCommand::SessionNew(title)) = result {
            assert_eq!(title, Some("Test".to_string()));
        }
    }

    #[test]
    fn test_session_list_returns_async() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let mut app = App::with_project_path(temp_dir.path());

        let result = handle_command(&mut app, "/session list");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::SessionList)));
    }

    #[test]
    fn test_session_load_requires_id() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let mut app = App::with_project_path(temp_dir.path());

        let result = handle_command(&mut app, "/session load");
        assert!(matches!(result, CommandResult::Error(_)));
    }

    #[test]
    fn test_session_delete_requires_id() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let mut app = App::with_project_path(temp_dir.path());

        let result = handle_command(&mut app, "/session delete");
        assert!(matches!(result, CommandResult::Error(_)));
    }
}
