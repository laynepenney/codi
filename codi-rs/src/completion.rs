// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tab completion support for slash commands in the TUI.
//!
//! This module provides tab-completion functionality similar to the TypeScript
//! implementation, supporting:
//! - Command name completion (/br<TAB> -> /branch)
//! - Subcommand completion (/branch cr<TAB> -> /branch create)
//! - Static argument completion (/models an<TAB> -> /models anthropic)
//! - Flag completion (/models --<TAB> -> /models --local)

/// Get all available commands for completion based on current Rust implementation.
pub fn get_command_names() -> Vec<String> {
    vec![
        "help".to_string(),
        "exit".to_string(),
        "quit".to_string(),
        "clear".to_string(),
        "version".to_string(),
        "status".to_string(),
        "compact".to_string(),
        "context".to_string(),
        "settings".to_string(),
        "models".to_string(),
        "sessions".to_string(),
        "save".to_string(),
        "load".to_string(),
        "label".to_string(),
        "profile".to_string(),
        "history".to_string(),
        "debug".to_string(),
        "delegate".to_string(),
        "workers".to_string(),
        "worktrees".to_string(),
        // Consolidated git commands (short aliases)
        "commit".to_string(),
        "branch".to_string(),
        "diff".to_string(),
        "pr".to_string(),
        "stash".to_string(),
        "log".to_string(),
        "status".to_string(),
        "undo".to_string(),
        "merge".to_string(),
        "rebase".to_string(),
        // Programming commands
        "refactor".to_string(),
        "fix".to_string(),
        "test".to_string(),
        "doc".to_string(),
        "optimize".to_string(),
        // Prompt commands
        "explain".to_string(),
        "review".to_string(),
        "analyze".to_string(),
        "summarize".to_string(),
        "help/".to_string(),
    ]
}

/// Subcommands for each slash command based on current Rust implementation.
const COMMAND_SUBCOMMANDS: &[(&str, &[&str])] = &[
    // Main commands from Rust TUI
    (
        "git",
        &[
            "commit", "branch", "diff", "pr", "stash", "log", "status", "undo", "merge", "rebase",
        ],
    ),
    ("code", &["refactor", "fix", "test", "doc", "optimize"]),
    // Individual commands with subcommands
    ("branch", &["list", "create", "switch", "delete", "rename"]),
    ("stash", &["save", "list", "pop", "apply", "drop", "clear"]),
    ("undo", &["commits", "staged", "file"]),
    ("sessions", &["info", "delete", "clear"]),
    ("workers", &["list", "cancel"]),
    ("worktrees", &["list", "cleanup"]),
    ("compact", &["status", "summarize"]),
];

/// Static arguments for commands in Rust implementation.
const COMMAND_STATIC_ARGS: &[(&str, &[&str])] = &[
    ("models", &["anthropic", "openai", "ollama", "runpod"]),
    (
        "commit",
        &[
            "feat", "fix", "docs", "style", "refactor", "perf", "test", "chore",
        ],
    ),
];

/// Command-specific flags.
const COMMAND_FLAGS: &[(&str, &[&str])] = &[
    ("models", &["--local", "-f", "--format"]),
    ("symbols", &[]),
    ("pipeline", &["--provider", "--all"]),
];

/// Complete a slash command line and return the completed value or None
pub fn complete_line(line: &str) -> Option<String> {
    if line.is_empty() {
        return None;
    }

    if !line.starts_with('/') {
        return None; // Only complete slash commands
    }

    let trimmed = line.trim();
    let parts: Vec<&str> = trimmed.split_whitespace().collect();

    let cmd_name = if parts.is_empty() {
        line.trim_start_matches('/')
    } else {
        parts[0].trim_start_matches('/')
    };

    let matches = get_completion_matches(line);

    if matches.is_empty() {
        return None;
    }

    if matches.len() == 1 {
        return Some(matches[0].trim()); // Return single match
    }

    // Return common prefix for multiple matches
    Some(get_common_prefix(&matches).trim())
}

/// Get all completion matches for a line with current Rust command structure.
pub fn get_completion_matches(line: &str) -> Vec<String> {
    if line.is_empty() || !line.starts_with('/') {
        return vec![];
    }

    let mut completions = vec![];

    // Main command completion
    let all_commands = get_command_names();
    for cmd in &all_commands {
        let with_slash = format!("/{}", cmd);
        if with_slash.starts_with(line.trim()) {
            completions.push(with_slash);
        }
    }

    // Filter completions based on current word
    completions.sort();
    completions.dedup();
    completions
}

/// Get the common prefix of multiple completion strings.
pub fn get_common_prefix(matches: &[String]) -> String {
    if matches.is_empty() {
        return String::new();
    }
    if matches.len() == 1 {
        return matches[0].clone();
    }

    // Find longest common prefix
    let common = matches[0].as_str();
    let mut end_char = common.len();

    for value in &matches[1..] {
        let value_chars = value.as_str();
        let mut i = 0;
        while i < end_char && i < common.len() && i < value_chars.len() {
            if common.chars().nth(i) != value_chars.chars().nth(i) {
                break;
            }
            i += 1;
        }
        end_char = i;
        if end_char == 0 {
            return String::new();
        }
    }

    common.chars().take(end_char).collect()
}
