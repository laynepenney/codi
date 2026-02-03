// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tool system for Codi.
//!
//! This module provides the infrastructure for defining and executing tools
//! that the AI model can call to interact with the filesystem, run commands,
//! and perform other operations.
//!
//! # Architecture
//!
//! The tool system follows these patterns (inspired by codex-rs):
//!
//! - [`ToolHandler`] trait - Core abstraction for tool implementations
//! - [`ToolRegistry`] - Maps tool names to handlers, dispatches calls
//! - Individual handlers in the [`handlers`] module
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::tools::{ToolRegistry, ToolOutput};
//!
//! // Create registry with default tools
//! let registry = ToolRegistry::with_defaults();
//!
//! // Execute a tool
//! let output = registry.dispatch("read_file", json!({"file_path": "/path/to/file"})).await?;
//! ```

pub mod handlers;
pub mod registry;

pub use handlers::*;
pub use registry::{DispatchResult, ToolHandler, ToolOutput, ToolRegistry, ToolRegistryBuilder};

use serde::Deserialize;
use crate::error::ToolError;

/// Parse JSON arguments into a typed struct.
///
/// This is a helper function for tool handlers to deserialize their input.
pub fn parse_arguments<T>(arguments: &serde_json::Value) -> Result<T, ToolError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(arguments.clone())
        .map_err(|err| ToolError::InvalidInput(format!("Failed to parse arguments: {err}")))
}

/// Telemetry preview limits for log output.
pub const TELEMETRY_PREVIEW_MAX_BYTES: usize = 2 * 1024; // 2 KiB
pub const TELEMETRY_PREVIEW_MAX_LINES: usize = 64;

/// Default limit for file reading operations.
pub const DEFAULT_READ_LIMIT: usize = 2000;

/// Maximum line length before truncation.
pub const MAX_LINE_LENGTH: usize = 2000;

/// Default timeout for command execution in milliseconds.
pub const DEFAULT_TIMEOUT_MS: u64 = 120_000; // 2 minutes

/// Maximum timeout for command execution in milliseconds.
pub const MAX_TIMEOUT_MS: u64 = 600_000; // 10 minutes

/// Truncate text to a maximum byte length, respecting UTF-8 boundaries.
pub fn truncate_text(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    // Find the last valid char boundary within max_bytes
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }

    if end == 0 {
        return String::new();
    }

    format!("{}... [truncated]", &text[..end])
}

/// Truncate output by lines, keeping first and last portions.
pub fn truncate_output(output: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = output.lines().collect();
    let total = lines.len();

    if total <= max_lines {
        return output.to_string();
    }

    // Keep first half and last half
    let keep = max_lines / 2;
    let first_part: Vec<&str> = lines.iter().take(keep).copied().collect();
    let last_part: Vec<&str> = lines.iter().skip(total - keep).copied().collect();
    let omitted = total - max_lines;

    format!(
        "{}\n\n... [{omitted} lines omitted] ...\n\n{}",
        first_part.join("\n"),
        last_part.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_text_short() {
        let text = "Hello, world!";
        assert_eq!(truncate_text(text, 100), text);
    }

    #[test]
    fn test_truncate_text_long() {
        let text = "Hello, world!";
        let truncated = truncate_text(text, 5);
        assert!(truncated.starts_with("Hello"));
        assert!(truncated.contains("truncated"));
    }

    #[test]
    fn test_truncate_text_utf8() {
        let text = "こんにちは"; // 5 characters, 15 bytes
        let truncated = truncate_text(text, 6);
        // Should cut at valid UTF-8 boundary (after 2 chars = 6 bytes)
        assert!(truncated.starts_with("こん"));
    }

    #[test]
    fn test_truncate_output_short() {
        let output = "line1\nline2\nline3";
        assert_eq!(truncate_output(output, 10), output);
    }

    #[test]
    fn test_truncate_output_long() {
        let lines: Vec<String> = (1..=20).map(|i| format!("line{i}")).collect();
        let output = lines.join("\n");
        let truncated = truncate_output(&output, 6);
        assert!(truncated.contains("line1"));
        assert!(truncated.contains("line20"));
        assert!(truncated.contains("omitted"));
    }

    #[test]
    fn test_parse_arguments() {
        #[derive(Deserialize)]
        struct TestArgs {
            path: String,
        }

        let value = serde_json::json!({"path": "/test"});
        let result: Result<TestArgs, _> = parse_arguments(&value);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().path, "/test");
    }

    #[test]
    fn test_parse_arguments_invalid() {
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct TestArgs {
            required_field: String,
        }

        let value = serde_json::json!({"wrong_field": "value"});
        let result: Result<TestArgs, _> = parse_arguments(&value);
        assert!(result.is_err());
    }
}
