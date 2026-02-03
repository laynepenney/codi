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

    // Orchestration commands
    /// Delegate a task to a worker (branch, task).
    Delegate(String, String),
    /// List all workers.
    WorkersList,
    /// Cancel a worker by ID.
    WorkersCancel(String),
    /// List all worktrees.
    WorktreesList,
    /// Cleanup completed worktrees.
    WorktreesCleanup,
    /// Respond to a permission request (worker_id, request_id, approved).
    PermissionRespond(String, String, bool),
}

/// Check if arguments contain a help flag (-h, --help, ?)
fn has_help_flag(args: &str) -> bool {
    let trimmed = args.trim();
    trimmed == "-h" || trimmed == "--help" || trimmed == "?" || trimmed == "help"
}

/// Handle a slash command synchronously. Returns `CommandResult::Async` for
/// commands that need async execution.
pub fn handle_command(app: &mut App, input: &str) -> CommandResult {
    // Check for command aliases from config before parsing
    if let Some(expanded) = app.resolve_command_alias(input) {
        return handle_command(app, &expanded);
    }

    let parts: Vec<&str> = input.trim().splitn(2, ' ').collect();
    let command = parts[0].to_lowercase();
    let args = parts.get(1).copied().unwrap_or("");

    // Check if this is a help request
    if has_help_flag(args) {
        return handle_command_help(app, &command, args);
    }

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

        // Git commands
        "/git" => handle_git(args),
        "/commit" | "/ci" => handle_git(&format!("commit {}", args)),
        "/branch" | "/br" => handle_git(&format!("branch {}", args)),
        "/diff" => handle_git(&format!("diff {}", args)),
        "/pr" => handle_git(&format!("pr {}", args)),
        "/stash" => handle_git(&format!("stash {}", args)),
        "/log" => handle_git(&format!("log {}", args)),
        "/merge" => handle_git(&format!("merge {}", args)),
        "/rebase" => handle_git(&format!("rebase {}", args)),

        // Code commands
        "/code" => handle_code(args),
        "/refactor" | "/r" => handle_code(&format!("refactor {}", args)),
        "/fix" | "/f" => handle_code(&format!("fix {}", args)),
        "/test" | "/t" => handle_code(&format!("test {}", args)),
        "/doc" => handle_code(&format!("doc {}", args)),
        "/optimize" => handle_code(&format!("optimize {}", args)),

        // Prompt commands (read-only analysis)
        "/explain" => handle_prompt_command("explain", args),
        "/review" => handle_prompt_command("review", args),
        "/analyze" => handle_prompt_command("analyze", args),
        "/summarize" => handle_prompt_command("summarize", args),

        // Memory/profile commands
        "/memory" | "/mem" | "/remember" => handle_memory(app, args),
        "/profile" | "/me" => handle_profile(app, args),

        // Orchestration commands
        "/delegate" | "/spawn" | "/worker" => {
            handle_delegate(app, args)
        }
        "/workers" | "/wk" => {
            handle_workers(app, args)
        }
        "/worktrees" | "/wt" => {
            handle_worktrees(app, args)
        }

        // Unknown command
        _ => {
            app.status = Some(format!("Unknown command: {}. Type /help for commands.", command));
            CommandResult::Error(format!("Unknown command: {}", command))
        }
    }
}

/// Handle help requests for commands - show command usage and examples.
pub fn handle_command_help(app: &mut App, command: &str, _args: &str) -> CommandResult {
    let help_text = match command {
        "/help" | "/h" => {
            "
Usage: /help [command]

Show available commands and their usage. Type a command name for specific help.

Categories:
  Info:        status, version
  Navigation:  compact, models, sessions  
  Git:         branch, diff, pr, stash, undo
  Code:        refactor, fix, test, optimize
  Memory:      memory

Try: /help models
Try: /help git/branch
            "
        }
        "/status" => {
            "
Usage: /status

Get detailed information about current session including:
- Current provider and model  
- Session name, duration, message count
- Context usage statistics
- Active conversations and workers

Example: /status
            "
        }
        "/models" => {
            "
Usage: /models [provider] [--local]

List available AI models with capability details:
- Model names and identifiers
- Context window sizes  
- Pricing information
- Vision and tool support

Options:
  provider    Filter by provider: anthropic, openai, ollama, runpod
  --local     Show only local Ollama models

Examples:
  /models                    List all models
  /models anthropic          Show Claude models only
  /models --local            List local Ollama models
            "
        }
        "/profile" | "/me" => {
            "
Usage: /profile set <key> <value>

Configure your coding wingman profile for personalized responses

Keys:
  set name <name>          Set your name
  set preferences.language <lang>    Primary programming language
  set preferences.style <style>      Coding style preference (functional, OOP, procedural)
  set preferences.verbosity level    Response detail level (concise, normal, detailed)
  set expertise <area>     Add expertise area
  set avoid <pattern>      Pattern to avoid in responses

Example: /profile set name Alice
            "
        }
        "/memory" => {
            "
Usage: /memory <note>
Usage: /memory clear
Usage: /memory memories

Personal knowledge management system.

Commands:
  <note>          Store a fact for future sessions
  clear           Delete all memories  
  memories/mem    List stored memories

Examples:
  /memory I prefer functional programming style
  /memory This project uses React + TypeScript
  /memory I'm learning Rust async/await patterns
            "
        }
        "/sessions" | "/session" => {
            "
Usage: /sessions [info|info <name>|clear]
Usage: /session label [text]

Manage conversation sessions with SQLite persistence.

Commands:
  save                    Save current conversation
  load <name>            Load a session  
  label [text]           Set current session label/name
  sessions               List all sessions
  sessions info [name]   Show session details

Options:
  label <text>           Set session name/description

Example: /sessions
            "
        }
        "/git/branch" => {
            "
Usage: /git/branch [action] [name]

Git branch management actions.

Actions:
  list                List all branches
  create <name>      Create a new branch  
  switch <name>      Switch to existing branch
  delete <name>      Delete a branch (safety checks)
  rename <old> <new> Rename a branch
  cleanup            Delete merged branches

Example: /git/branch list
            "
        }
        _ => {
            return CommandResult::Error(format!("No help available for {}. Type /help for all commands.", command));
        }
    };

    app.status = Some(format!("\n{}\n", help_text.trim()));
    CommandResult::Ok
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

        // Orchestration commands
        AsyncCommand::Delegate(branch, task) => {
            match app.delegate_task(&branch, &task).await {
                Ok(worker_id) => {
                    app.status = Some(format!("Spawned worker {} on {}", worker_id, branch));
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to spawn worker: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::WorkersList => {
            match app.list_workers().await {
                Ok(workers) => {
                    if workers.is_empty() {
                        app.status = Some("No active workers".to_string());
                    } else {
                        let list: Vec<String> = workers
                            .iter()
                            .map(|(id, status)| format!("{}: {}", id, status))
                            .collect();
                        app.status = Some(format!("Workers: {}", list.join(", ")));
                    }
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to list workers: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::WorkersCancel(worker_id) => {
            match app.cancel_worker(&worker_id).await {
                Ok(()) => {
                    app.status = Some(format!("Cancelled worker: {}", worker_id));
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to cancel worker: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::WorktreesList => {
            match app.list_worktrees().await {
                Ok(worktrees) => {
                    if worktrees.is_empty() {
                        app.status = Some("No managed worktrees".to_string());
                    } else {
                        let list: Vec<String> = worktrees
                            .iter()
                            .map(|wt| format!("{} ({})", wt.branch(), wt.path().display()))
                            .collect();
                        app.status = Some(format!("Worktrees: {}", list.join(", ")));
                    }
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to list worktrees: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::WorktreesCleanup => {
            match app.cleanup_worktrees().await {
                Ok(count) => {
                    app.status = Some(format!("Cleaned up {} worktrees", count));
                    CommandResult::Ok
                }
                Err(e) => {
                    app.status = Some(format!("Failed to cleanup worktrees: {}", e));
                    CommandResult::Error(e.to_string())
                }
            }
        }

        AsyncCommand::PermissionRespond(worker_id, request_id, approved) => {
            match app.respond_to_worker_permission(&worker_id, &request_id, approved).await {
                Ok(()) => CommandResult::Ok,
                Err(e) => {
                    app.status = Some(format!("Failed to respond to permission: {}", e));
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

// ============================================================================
// Orchestration Commands
// ============================================================================

/// Handle /delegate command - spawn a worker.
fn handle_delegate(app: &mut App, args: &str) -> CommandResult {
    let parts: Vec<&str> = args.splitn(2, ' ').collect();

    if parts.len() < 2 {
        app.status = Some("Usage: /delegate <branch> <task>".to_string());
        return CommandResult::Error("Missing branch or task".to_string());
    }

    let branch = parts[0].to_string();
    let task = parts[1].to_string();

    if branch.is_empty() || task.is_empty() {
        app.status = Some("Usage: /delegate <branch> <task>".to_string());
        return CommandResult::Error("Branch and task are required".to_string());
    }

    CommandResult::Async(AsyncCommand::Delegate(branch, task))
}

/// Handle /workers command - list or manage workers.
fn handle_workers(app: &mut App, args: &str) -> CommandResult {
    let parts: Vec<&str> = args.splitn(2, ' ').collect();
    let subcommand = parts.first().copied().unwrap_or("");
    let subargs = parts.get(1).copied().unwrap_or("");

    match subcommand {
        "" | "list" => {
            CommandResult::Async(AsyncCommand::WorkersList)
        }
        "cancel" => {
            if subargs.is_empty() {
                app.status = Some("Usage: /workers cancel <id>".to_string());
                return CommandResult::Error("Worker ID required".to_string());
            }
            CommandResult::Async(AsyncCommand::WorkersCancel(subargs.to_string()))
        }
        _ => {
            app.status = Some("Usage: /workers [list|cancel <id>]".to_string());
            CommandResult::Error(format!("Unknown workers subcommand: {}", subcommand))
        }
    }
}

/// Handle /worktrees command - list or manage worktrees.
fn handle_worktrees(app: &mut App, args: &str) -> CommandResult {
    let subcommand = args.trim();

    match subcommand {
        "" | "list" => {
            CommandResult::Async(AsyncCommand::WorktreesList)
        }
        "cleanup" => {
            CommandResult::Async(AsyncCommand::WorktreesCleanup)
        }
        _ => {
            app.status = Some("Usage: /worktrees [list|cleanup]".to_string());
            CommandResult::Error(format!("Unknown worktrees subcommand: {}", subcommand))
        }
    }
}

// ============================================================================
// Git Commands
// ============================================================================

/// Handle /git command - routes to appropriate git subcommand prompt.
fn handle_git(args: &str) -> CommandResult {
    let parts: Vec<&str> = args.trim().splitn(2, ' ').collect();
    let subcommand = parts.first().copied().unwrap_or("").trim();
    let subargs = parts.get(1).copied().unwrap_or("").trim();

    if subcommand.is_empty() {
        return CommandResult::Error(
            "Usage: /git <commit|branch|diff|pr|stash|log|status|merge|rebase> [args]".to_string(),
        );
    }

    let prompt = match subcommand {
        "commit" => {
            if subargs.is_empty() {
                "Run `git diff --staged` to see staged changes, then generate a concise conventional commit message (feat/fix/docs/chore etc). Show the message and ask for confirmation before committing.".to_string()
            } else {
                format!(
                    "Create a git commit with type '{}'. Run `git diff --staged` first, \
                     then generate an appropriate commit message and commit.",
                    subargs
                )
            }
        }
        "branch" => {
            if subargs.is_empty() {
                "Run `git branch -a` and list all branches with the current branch highlighted.".to_string()
            } else {
                let branch_parts: Vec<&str> = subargs.splitn(2, ' ').collect();
                match branch_parts[0] {
                    "create" | "new" => format!("Create a new git branch named '{}'.", branch_parts.get(1).unwrap_or(&"")),
                    "switch" | "checkout" => format!("Switch to git branch '{}'.", branch_parts.get(1).unwrap_or(&"")),
                    "delete" | "rm" => format!("Delete git branch '{}'. Ask for confirmation first.", branch_parts.get(1).unwrap_or(&"")),
                    "list" => "Run `git branch -a` and list all branches.".to_string(),
                    name => format!("Switch to git branch '{}'.", name),
                }
            }
        }
        "diff" => {
            if subargs.is_empty() {
                "Run `git diff` and `git diff --staged` to show all current changes. Provide a brief summary of what changed.".to_string()
            } else {
                format!("Run `git diff {}` and explain the changes.", subargs)
            }
        }
        "pr" => {
            if subargs.is_empty() {
                "Generate a pull request description based on the current branch's commits. Run `git log main..HEAD --oneline` to see the commits, then create a PR title and description.".to_string()
            } else {
                format!("Generate a pull request targeting '{}'. Run `git log {}..HEAD --oneline` to see commits.", subargs, subargs)
            }
        }
        "stash" => {
            match subargs {
                "" | "save" => "Run `git stash` to stash current changes.".to_string(),
                "list" => "Run `git stash list` and show all stashed changes.".to_string(),
                "pop" => "Run `git stash pop` to apply and remove the latest stash.".to_string(),
                "apply" => "Run `git stash apply` to apply the latest stash without removing it.".to_string(),
                "clear" => "Run `git stash clear` to remove all stashes. Ask for confirmation first.".to_string(),
                _ => format!("Run `git stash {}` and show the result.", subargs),
            }
        }
        "log" => {
            if subargs.is_empty() {
                "Run `git log --oneline -20` and explain the recent commit history.".to_string()
            } else {
                format!("Run `git log {}` and explain the history.", subargs)
            }
        }
        "status" => "Run `git status` and provide a summary of the current repository state.".to_string(),
        "merge" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /git merge <branch>".to_string());
            }
            format!(
                "Merge branch '{}' into the current branch. Run `git merge {}` and report any conflicts.",
                subargs, subargs
            )
        }
        "rebase" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /git rebase <branch>".to_string());
            }
            format!(
                "Rebase the current branch onto '{}'. Run `git rebase {}` and report any conflicts.",
                subargs, subargs
            )
        }
        _ => {
            return CommandResult::Error(format!("Unknown git subcommand: {}", subcommand));
        }
    };

    CommandResult::Prompt(prompt)
}

// ============================================================================
// Code Commands
// ============================================================================

/// Handle /code command - routes to code action prompts.
fn handle_code(args: &str) -> CommandResult {
    let parts: Vec<&str> = args.trim().splitn(2, ' ').collect();
    let subcommand = parts.first().copied().unwrap_or("").trim();
    let subargs = parts.get(1).copied().unwrap_or("").trim();

    if subcommand.is_empty() {
        return CommandResult::Error(
            "Usage: /code <refactor|fix|test|doc|optimize> <file> [focus]".to_string(),
        );
    }

    let prompt = match subcommand {
        "refactor" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /code refactor <file> [focus]".to_string());
            }
            format!(
                "Read the file '{}' and refactor it for better quality, readability, and maintainability. \
                 Use edit_file to make the changes directly.",
                subargs
            )
        }
        "fix" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /code fix <file> <issue>".to_string());
            }
            format!(
                "Read the relevant code and fix this issue: {}. \
                 Use edit_file to make the changes directly.",
                subargs
            )
        }
        "test" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /code test <file> [function]".to_string());
            }
            format!(
                "Read the file '{}' and generate comprehensive unit tests for it. \
                 Use write_file to create the test file.",
                subargs
            )
        }
        "doc" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /code doc <file>".to_string());
            }
            format!(
                "Read the file '{}' and add documentation comments to all public functions, \
                 structs, and modules. Use edit_file to add the docs.",
                subargs
            )
        }
        "optimize" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /code optimize <file>".to_string());
            }
            format!(
                "Read the file '{}' and optimize it for performance. \
                 Identify bottlenecks and apply optimizations using edit_file.",
                subargs
            )
        }
        _ => {
            return CommandResult::Error(format!("Unknown code subcommand: {}", subcommand));
        }
    };

    CommandResult::Prompt(prompt)
}

// ============================================================================
// Prompt Commands (read-only analysis)
// ============================================================================

/// Handle prompt commands like /explain, /review, /analyze, /summarize.
fn handle_prompt_command(action: &str, args: &str) -> CommandResult {
    if args.trim().is_empty() {
        return CommandResult::Error(format!("Usage: /{} <file or description>", action));
    }

    let prompt = match action {
        "explain" => format!(
            "Read the file '{}' and explain what it does, its key components, \
             and how they work together. Be thorough but concise.",
            args.trim()
        ),
        "review" => format!(
            "Read the file '{}' and perform a code review. Look for bugs, \
             security issues, performance problems, and code quality issues. \
             Provide specific suggestions for improvement.",
            args.trim()
        ),
        "analyze" => format!(
            "Read the file '{}' and analyze its structure: dependencies, \
             public API, complexity, and patterns used. Identify any \
             architectural concerns.",
            args.trim()
        ),
        "summarize" => format!(
            "Read the file '{}' and provide a brief summary of its purpose, \
             main functions, and how it fits into the codebase.",
            args.trim()
        ),
        _ => format!("Analyze '{}': {}", args.trim(), action),
    };

    CommandResult::Prompt(prompt)
}

// ============================================================================
// Memory & Profile Commands
// ============================================================================

/// Handle /memory command.
fn handle_memory(app: &mut App, args: &str) -> CommandResult {
    let parts: Vec<&str> = args.trim().splitn(2, ' ').collect();
    let subcommand = parts.first().copied().unwrap_or("").trim();
    let subargs = parts.get(1).copied().unwrap_or("").trim();

    match subcommand {
        "" | "list" => {
            app.status = Some("Memory system: use '/memory store <fact>' to remember, '/memory clear' to forget all".to_string());
            CommandResult::Ok
        }
        "store" | "remember" | "add" => {
            if subargs.is_empty() {
                return CommandResult::Error("Usage: /memory store <fact to remember>".to_string());
            }
            app.status = Some(format!("Remembered: {}", subargs));
            CommandResult::Ok
        }
        "clear" => {
            app.status = Some("Memory cleared".to_string());
            CommandResult::Ok
        }
        _ => {
            // Treat the entire args as something to remember
            app.status = Some(format!("Remembered: {}", args.trim()));
            CommandResult::Ok
        }
    }
}

/// Handle /profile command.
fn handle_profile(app: &mut App, args: &str) -> CommandResult {
    if args.trim().is_empty() {
        app.status = Some("Profile: use '/profile set <key> <value>' to update".to_string());
        CommandResult::Ok
    } else {
        app.status = Some(format!("Profile updated: {}", args.trim()));
        CommandResult::Ok
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

    // Orchestration command tests
    #[test]
    fn test_delegate_requires_args() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/delegate");
        assert!(matches!(result, CommandResult::Error(_)));
        assert!(app.status.as_ref().unwrap().contains("Usage"));
    }

    #[test]
    fn test_delegate_requires_both_args() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/delegate feat/test");
        assert!(matches!(result, CommandResult::Error(_)));
    }

    #[test]
    fn test_delegate_returns_async() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/delegate feat/test implement feature");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::Delegate(_, _))));

        if let CommandResult::Async(AsyncCommand::Delegate(branch, task)) = result {
            assert_eq!(branch, "feat/test");
            assert_eq!(task, "implement feature");
        }
    }

    #[test]
    fn test_workers_list_returns_async() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/workers");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::WorkersList)));
    }

    #[test]
    fn test_workers_cancel_requires_id() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/workers cancel");
        assert!(matches!(result, CommandResult::Error(_)));
    }

    #[test]
    fn test_workers_cancel_returns_async() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/workers cancel worker-1");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::WorkersCancel(_))));

        if let CommandResult::Async(AsyncCommand::WorkersCancel(id)) = result {
            assert_eq!(id, "worker-1");
        }
    }

    #[test]
    fn test_worktrees_list_returns_async() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/worktrees");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::WorktreesList)));
    }

    #[test]
    fn test_worktrees_cleanup_returns_async() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/worktrees cleanup");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::WorktreesCleanup)));
    }

    #[test]
    fn test_spawn_alias() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/spawn feat/test do something");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::Delegate(_, _))));
    }

    #[test]
    fn test_wk_alias() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/wk");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::WorkersList)));
    }

    #[test]
    fn test_wt_alias() {
        let mut app = App::default();
        let result = handle_command(&mut app, "/wt");
        assert!(matches!(result, CommandResult::Async(AsyncCommand::WorktreesList)));
    }
}
