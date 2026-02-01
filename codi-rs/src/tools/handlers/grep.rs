// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Grep tool handler.
//!
//! Searches for patterns in files using ripgrep (rg).

use async_trait::async_trait;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

#[cfg(feature = "telemetry")]
use tracing::{debug, instrument};

use crate::error::ToolError;
use crate::tools::parse_arguments;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::{InputSchema, ToolDefinition};

/// Handler for the `grep` tool.
pub struct GrepHandler;

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 2000;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// Arguments for the grep tool.
#[derive(Debug, Deserialize)]
struct GrepArgs {
    /// Regular expression pattern to search for.
    pattern: String,

    /// Optional glob pattern to filter files (e.g., "*.ts", "*.{js,ts}").
    #[serde(default)]
    glob: Option<String>,

    /// Directory or file to search in.
    #[serde(default)]
    path: Option<String>,

    /// Maximum number of results to return.
    #[serde(default = "default_limit")]
    limit: usize,

    /// Output mode: "files_with_matches", "content", or "count".
    #[serde(default = "default_output_mode")]
    output_mode: String,

    /// Case insensitive search.
    #[serde(default, rename = "-i")]
    case_insensitive: bool,

    /// Lines of context to show after match.
    #[serde(default, rename = "-A")]
    context_after: Option<usize>,

    /// Lines of context to show before match.
    #[serde(default, rename = "-B")]
    context_before: Option<usize>,
}

fn default_limit() -> usize {
    DEFAULT_LIMIT
}

fn default_output_mode() -> String {
    "files_with_matches".to_string()
}

#[async_trait]
impl ToolHandler for GrepHandler {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("grep", "Search for patterns in files using ripgrep")
            .with_schema(
                InputSchema::new()
                    .with_property("pattern", serde_json::json!({
                        "type": "string",
                        "description": "Regular expression pattern to search for"
                    }))
                    .with_property("glob", serde_json::json!({
                        "type": "string",
                        "description": "Glob pattern to filter files (e.g., '*.ts', '*.{js,ts}')"
                    }))
                    .with_property("path", serde_json::json!({
                        "type": "string",
                        "description": "Directory or file to search in (defaults to current directory)"
                    }))
                    .with_property("limit", serde_json::json!({
                        "type": "integer",
                        "description": "Maximum number of results (default: 100, max: 2000)"
                    }))
                    .with_property("output_mode", serde_json::json!({
                        "type": "string",
                        "enum": ["files_with_matches", "content", "count"],
                        "description": "Output mode: files_with_matches (default), content, or count"
                    }))
                    .with_property("-i", serde_json::json!({
                        "type": "boolean",
                        "description": "Case insensitive search"
                    }))
                    .with_property("-A", serde_json::json!({
                        "type": "integer",
                        "description": "Lines of context to show after each match"
                    }))
                    .with_property("-B", serde_json::json!({
                        "type": "integer",
                        "description": "Lines of context to show before each match"
                    }))
                    .with_required(vec!["pattern".to_string()]),
            )
    }

    fn is_mutating(&self) -> bool {
        false
    }

    #[cfg_attr(feature = "telemetry", instrument(skip(self, input), fields(pattern, path, output_mode, matches)))]
    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: GrepArgs = parse_arguments(&input)?;

        // Record span fields (only with telemetry)
        #[cfg(feature = "telemetry")]
        {
            let span = tracing::Span::current();
            span.record("pattern", args.pattern.as_str());
            span.record("output_mode", args.output_mode.as_str());
            if let Some(ref p) = args.path {
                span.record("path", p.as_str());
            }
        }

        let pattern = args.pattern.trim();
        if pattern.is_empty() {
            return Err(ToolError::InvalidInput(
                "pattern must not be empty".to_string(),
            ));
        }

        if args.limit == 0 {
            return Err(ToolError::InvalidInput(
                "limit must be greater than zero".to_string(),
            ));
        }

        let limit = args.limit.min(MAX_LIMIT);

        // Resolve search path
        let search_path = match &args.path {
            Some(p) => PathBuf::from(p),
            None => std::env::current_dir().map_err(|e| {
                ToolError::IoError(format!("Failed to get current directory: {e}"))
            })?,
        };

        // Verify path exists
        verify_path_exists(&search_path).await?;

        // Get glob pattern
        let glob = args.glob.as_deref().and_then(|g| {
            let trimmed = g.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        // Run ripgrep
        let results = run_rg_search(
            pattern,
            glob.as_deref(),
            &search_path,
            limit,
            &args.output_mode,
            args.case_insensitive,
            args.context_after,
            args.context_before,
        )
        .await?;

        // Record match count (only with telemetry)
        #[cfg(feature = "telemetry")]
        {
            tracing::Span::current().record("matches", results.len());
            debug!(pattern, matches = results.len(), "Grep search complete");
        }

        if results.is_empty() {
            Ok(ToolOutput::success("No matches found."))
        } else {
            Ok(ToolOutput::success(results.join("\n")))
        }
    }
}

async fn verify_path_exists(path: &Path) -> Result<(), ToolError> {
    tokio::fs::metadata(path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ToolError::FileNotFound(path.display().to_string())
        } else {
            ToolError::IoError(format!("Unable to access path: {e}"))
        }
    })?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_rg_search(
    pattern: &str,
    glob: Option<&str>,
    search_path: &Path,
    limit: usize,
    output_mode: &str,
    case_insensitive: bool,
    context_after: Option<usize>,
    context_before: Option<usize>,
) -> Result<Vec<String>, ToolError> {
    let mut command = Command::new("rg");

    // Add output mode flags
    match output_mode {
        "files_with_matches" => {
            command.arg("--files-with-matches");
        }
        "count" => {
            command.arg("--count");
        }
        "content" => {
            command.arg("--line-number");
            if let Some(after) = context_after {
                command.arg("-A").arg(after.to_string());
            }
            if let Some(before) = context_before {
                command.arg("-B").arg(before.to_string());
            }
        }
        _ => {
            return Err(ToolError::InvalidInput(format!(
                "Invalid output_mode: {output_mode}"
            )));
        }
    }

    // Sort by modification time for files_with_matches mode
    if output_mode == "files_with_matches" {
        command.arg("--sortr=modified");
    }

    // Add case sensitivity
    if case_insensitive {
        command.arg("-i");
    }

    // Add pattern
    command.arg("--regexp").arg(pattern);

    // Suppress error messages for inaccessible files
    command.arg("--no-messages");

    // Add glob filter
    if let Some(g) = glob {
        command.arg("--glob").arg(g);
    }

    // Add search path
    command.arg("--").arg(search_path);

    // Execute with timeout
    let output = timeout(COMMAND_TIMEOUT, command.output())
        .await
        .map_err(|_| ToolError::Timeout(COMMAND_TIMEOUT.as_millis() as u64))?
        .map_err(|e| {
            ToolError::ExecutionFailed(format!(
                "Failed to run rg: {e}. Ensure ripgrep is installed."
            ))
        })?;

    match output.status.code() {
        Some(0) => Ok(parse_results(&output.stdout, limit)),
        Some(1) => Ok(Vec::new()), // No matches
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(ToolError::ExecutionFailed(format!("rg failed: {stderr}")))
        }
    }
}

fn parse_results(stdout: &[u8], limit: usize) -> Vec<String> {
    let mut results = Vec::new();

    for line in stdout.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }

        if let Ok(text) = std::str::from_utf8(line) {
            if !text.is_empty() {
                results.push(text.to_string());
                if results.len() >= limit {
                    break;
                }
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn rg_available() -> bool {
        std::process::Command::new("rg")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn test_grep_basic() {
        if !rg_available() {
            return;
        }

        let temp = tempdir().unwrap();
        let file1 = temp.path().join("test1.txt");
        let file2 = temp.path().join("test2.txt");

        std::fs::write(&file1, "hello world").unwrap();
        std::fs::write(&file2, "goodbye world").unwrap();

        let handler = GrepHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "world",
                "path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        let content = result.content();
        assert!(content.contains("test1.txt") || content.contains("test2.txt"));
    }

    #[tokio::test]
    async fn test_grep_with_glob() {
        if !rg_available() {
            return;
        }

        let temp = tempdir().unwrap();
        let file1 = temp.path().join("test.ts");
        let file2 = temp.path().join("test.js");

        std::fs::write(&file1, "const foo = 1").unwrap();
        std::fs::write(&file2, "const bar = 2").unwrap();

        let handler = GrepHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "const",
                "path": temp.path().to_str().unwrap(),
                "glob": "*.ts"
            }))
            .await
            .unwrap();

        let content = result.content();
        assert!(content.contains("test.ts"));
        assert!(!content.contains("test.js"));
    }

    #[tokio::test]
    async fn test_grep_no_matches() {
        if !rg_available() {
            return;
        }

        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "hello world").unwrap();

        let handler = GrepHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "xyz123",
                "path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        assert_eq!(result.content(), "No matches found.");
    }

    #[tokio::test]
    async fn test_grep_content_mode() {
        if !rg_available() {
            return;
        }

        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "line1\nfoo bar\nline3").unwrap();

        let handler = GrepHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "foo",
                "path": temp.path().to_str().unwrap(),
                "output_mode": "content"
            }))
            .await
            .unwrap();

        let content = result.content();
        // Content mode includes line numbers
        assert!(content.contains("2:foo bar") || content.contains(":foo bar"));
    }

    #[tokio::test]
    async fn test_grep_empty_pattern() {
        let handler = GrepHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "  "
            }))
            .await;

        assert!(result.is_err());
    }

    #[test]
    fn test_parse_results() {
        let stdout = b"/path/file1.txt\n/path/file2.txt\n/path/file3.txt\n";
        let results = parse_results(stdout, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0], "/path/file1.txt");
        assert_eq!(results[1], "/path/file2.txt");
    }
}
