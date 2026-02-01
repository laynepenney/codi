// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Bash tool handler.
//!
//! Executes shell commands with timeout support.

use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::ToolError;
use crate::tools::{parse_arguments, truncate_output, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS};
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::{InputSchema, ToolDefinition};

/// Handler for the `bash` tool.
pub struct BashHandler;

const MAX_OUTPUT_LINES: usize = 500;

/// Arguments for the bash tool.
#[derive(Debug, Deserialize)]
struct BashArgs {
    /// The command to execute.
    command: String,

    /// Working directory for the command.
    #[serde(default)]
    cwd: Option<String>,

    /// Timeout in milliseconds (default: 120000, max: 600000).
    #[serde(default = "default_timeout")]
    timeout: u64,

    /// Optional description of what the command does.
    #[serde(default)]
    description: Option<String>,
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_MS
}

#[async_trait]
impl ToolHandler for BashHandler {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("bash", "Execute a bash command")
            .with_schema(
                InputSchema::new()
                    .with_property("command", serde_json::json!({
                        "type": "string",
                        "description": "The bash command to execute"
                    }))
                    .with_property("cwd", serde_json::json!({
                        "type": "string",
                        "description": "Working directory for the command"
                    }))
                    .with_property("timeout", serde_json::json!({
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 120000, max: 600000)"
                    }))
                    .with_property("description", serde_json::json!({
                        "type": "string",
                        "description": "Description of what the command does"
                    }))
                    .with_required(vec!["command".to_string()]),
            )
    }

    fn is_mutating(&self) -> bool {
        true // Shell commands can modify the system
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: BashArgs = parse_arguments(&input)?;

        if args.command.trim().is_empty() {
            return Err(ToolError::InvalidInput(
                "command must not be empty".to_string(),
            ));
        }

        // Clamp timeout
        let timeout_ms = args.timeout.min(MAX_TIMEOUT_MS);
        let timeout_duration = Duration::from_millis(timeout_ms);

        // Resolve working directory
        let cwd = match &args.cwd {
            Some(dir) => {
                let path = PathBuf::from(dir);
                if !path.exists() {
                    return Err(ToolError::FileNotFound(format!(
                        "Working directory does not exist: {dir}"
                    )));
                }
                path
            }
            None => std::env::current_dir().map_err(|e| {
                ToolError::IoError(format!("Failed to get current directory: {e}"))
            })?,
        };

        // Execute the command
        let result = run_bash_command(&args.command, &cwd, timeout_duration).await?;

        // Format output
        let output = format_bash_output(&result);

        if result.exit_code != 0 {
            Ok(ToolOutput::Structured {
                content: output,
                success: false,
                metadata: Some(serde_json::json!({
                    "exit_code": result.exit_code,
                    "duration_ms": result.duration.as_millis() as u64,
                    "timed_out": result.timed_out,
                })),
            })
        } else {
            Ok(ToolOutput::Structured {
                content: output,
                success: true,
                metadata: Some(serde_json::json!({
                    "exit_code": result.exit_code,
                    "duration_ms": result.duration.as_millis() as u64,
                })),
            })
        }
    }
}

/// Result of executing a bash command.
struct BashResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    duration: Duration,
    timed_out: bool,
}

async fn run_bash_command(
    command: &str,
    cwd: &PathBuf,
    timeout_duration: Duration,
) -> Result<BashResult, ToolError> {
    let start = Instant::now();

    // Determine shell
    let shell = if cfg!(windows) { "cmd" } else { "bash" };
    let shell_flag = if cfg!(windows) { "/C" } else { "-c" };

    let mut cmd = Command::new(shell);
    cmd.arg(shell_flag)
        .arg(command)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Execute with timeout
    let output_result = timeout(timeout_duration, cmd.output()).await;

    let duration = start.elapsed();

    match output_result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            let exit_code = output.status.code().unwrap_or(-1);

            Ok(BashResult {
                stdout,
                stderr,
                exit_code,
                duration,
                timed_out: false,
            })
        }
        Ok(Err(e)) => Err(ToolError::ExecutionFailed(format!(
            "Failed to execute command: {e}"
        ))),
        Err(_) => {
            // Timeout occurred
            Ok(BashResult {
                stdout: String::new(),
                stderr: format!(
                    "Command timed out after {} seconds",
                    timeout_duration.as_secs()
                ),
                exit_code: -1,
                duration,
                timed_out: true,
            })
        }
    }
}

fn format_bash_output(result: &BashResult) -> String {
    let mut parts = Vec::new();

    // Add timeout warning if applicable
    if result.timed_out {
        parts.push(format!(
            "⏱️ Command timed out after {:.1}s",
            result.duration.as_secs_f64()
        ));
    }

    // Add stdout
    if !result.stdout.is_empty() {
        let truncated = truncate_output(&result.stdout, MAX_OUTPUT_LINES);
        parts.push(truncated);
    }

    // Add stderr if present
    if !result.stderr.is_empty() {
        let truncated = truncate_output(&result.stderr, MAX_OUTPUT_LINES / 4);
        parts.push(format!("\n[stderr]\n{truncated}"));
    }

    // Add exit code if non-zero
    if result.exit_code != 0 && !result.timed_out {
        parts.push(format!("\n[exit code: {}]", result.exit_code));
    }

    if parts.is_empty() {
        "[No output]".to_string()
    } else {
        parts.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_bash_echo() {
        let handler = BashHandler;
        let result = handler
            .execute(serde_json::json!({
                "command": "echo 'hello world'"
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(result.content().contains("hello world"));
    }

    #[tokio::test]
    async fn test_bash_with_cwd() {
        let temp = tempdir().unwrap();
        std::fs::write(temp.path().join("test.txt"), "content").unwrap();

        let handler = BashHandler;
        let result = handler
            .execute(serde_json::json!({
                "command": "ls",
                "cwd": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(result.content().contains("test.txt"));
    }

    #[tokio::test]
    async fn test_bash_exit_code() {
        let handler = BashHandler;
        let result = handler
            .execute(serde_json::json!({
                "command": "exit 1"
            }))
            .await
            .unwrap();

        assert!(!result.is_success());
        assert!(result.content().contains("exit code: 1"));
    }

    #[tokio::test]
    async fn test_bash_stderr() {
        let handler = BashHandler;
        let result = handler
            .execute(serde_json::json!({
                "command": "echo 'error' >&2"
            }))
            .await
            .unwrap();

        assert!(result.content().contains("[stderr]"));
        assert!(result.content().contains("error"));
    }

    #[tokio::test]
    async fn test_bash_empty_command() {
        let handler = BashHandler;
        let result = handler
            .execute(serde_json::json!({
                "command": "   "
            }))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_bash_nonexistent_cwd() {
        let handler = BashHandler;
        let result = handler
            .execute(serde_json::json!({
                "command": "echo test",
                "cwd": "/nonexistent/path"
            }))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_bash_timeout() {
        let handler = BashHandler;
        let result = handler
            .execute(serde_json::json!({
                "command": "sleep 10",
                "timeout": 100  // 100ms timeout
            }))
            .await
            .unwrap();

        assert!(!result.is_success());
        assert!(result.content().contains("timed out"));
    }

    #[test]
    fn test_format_bash_output_empty() {
        let result = BashResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
            duration: Duration::from_millis(100),
            timed_out: false,
        };

        assert_eq!(format_bash_output(&result), "[No output]");
    }
}
