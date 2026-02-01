// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Read file tool handler.
//!
//! Reads the contents of a file with support for:
//! - Offset and limit for reading portions of large files
//! - Line numbers in output
//! - UTF-8 handling with lossy conversion

use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, BufReader};

#[cfg(feature = "telemetry")]
use tracing::{debug, instrument};

use crate::error::ToolError;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::tools::{parse_arguments, DEFAULT_READ_LIMIT, MAX_LINE_LENGTH};
use crate::types::{InputSchema, ToolDefinition};

/// Handler for the `read_file` tool.
pub struct ReadFileHandler;

/// Arguments for the read_file tool.
#[derive(Debug, Deserialize)]
struct ReadFileArgs {
    /// Absolute path to the file to read.
    file_path: String,

    /// 1-indexed line number to start reading from (default: 1).
    #[serde(default = "default_offset")]
    offset: usize,

    /// Maximum number of lines to return (default: 2000).
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_offset() -> usize {
    1
}

fn default_limit() -> usize {
    DEFAULT_READ_LIMIT
}

#[async_trait]
impl ToolHandler for ReadFileHandler {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("read_file", "Read the contents of a file")
            .with_schema(
                InputSchema::new()
                    .with_property("file_path", serde_json::json!({
                        "type": "string",
                        "description": "The absolute path to the file to read"
                    }))
                    .with_property("offset", serde_json::json!({
                        "type": "integer",
                        "description": "1-indexed line number to start reading from (default: 1)"
                    }))
                    .with_property("limit", serde_json::json!({
                        "type": "integer",
                        "description": "Maximum number of lines to return (default: 2000)"
                    }))
                    .with_required(vec!["file_path".to_string()]),
            )
    }

    fn is_mutating(&self) -> bool {
        false
    }

    #[cfg_attr(feature = "telemetry", instrument(skip(self, input), fields(path, offset, limit, lines_read)))]
    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: ReadFileArgs = parse_arguments(&input)?;

        // Record span fields (only with telemetry)
        #[cfg(feature = "telemetry")]
        {
            let span = tracing::Span::current();
            span.record("path", &args.file_path);
            span.record("offset", args.offset);
            span.record("limit", args.limit);
        }

        // Validate arguments
        if args.offset == 0 {
            return Err(ToolError::InvalidInput(
                "offset must be a 1-indexed line number".to_string(),
            ));
        }

        if args.limit == 0 {
            return Err(ToolError::InvalidInput(
                "limit must be greater than zero".to_string(),
            ));
        }

        let path = PathBuf::from(&args.file_path);
        if !path.is_absolute() {
            return Err(ToolError::InvalidInput(
                "file_path must be an absolute path".to_string(),
            ));
        }

        // Read the file
        let lines = read_file_lines(&path, args.offset, args.limit).await?;

        // Record how many lines were actually read (only with telemetry)
        #[cfg(feature = "telemetry")]
        {
            tracing::Span::current().record("lines_read", lines.len());
            debug!(path = %args.file_path, lines = lines.len(), "File read complete");
        }

        if lines.is_empty() {
            Ok(ToolOutput::success("[Empty file or no lines in range]"))
        } else {
            Ok(ToolOutput::success(lines.join("\n")))
        }
    }
}

/// Read lines from a file with offset and limit.
async fn read_file_lines(
    path: &PathBuf,
    offset: usize,
    limit: usize,
) -> Result<Vec<String>, ToolError> {
    let file = File::open(path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ToolError::FileNotFound(path.display().to_string())
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            ToolError::PermissionDenied(path.display().to_string())
        } else {
            ToolError::IoError(format!("Failed to open file: {e}"))
        }
    })?;

    let mut reader = BufReader::new(file);
    let mut collected = Vec::new();
    let mut line_number = 0usize;
    let mut buffer = Vec::new();

    loop {
        buffer.clear();
        let bytes_read = reader.read_until(b'\n', &mut buffer).await.map_err(|e| {
            ToolError::IoError(format!("Failed to read file: {e}"))
        })?;

        if bytes_read == 0 {
            break;
        }

        // Remove trailing newlines (LF and CRLF)
        if buffer.last() == Some(&b'\n') {
            buffer.pop();
            if buffer.last() == Some(&b'\r') {
                buffer.pop();
            }
        }

        line_number += 1;

        // Skip lines before offset
        if line_number < offset {
            continue;
        }

        // Check if we've collected enough lines
        if collected.len() >= limit {
            break;
        }

        // Format the line with line number prefix
        let formatted = format_line(&buffer);
        collected.push(format!("L{line_number}: {formatted}"));
    }

    // Check if offset was beyond file length
    if line_number < offset {
        return Err(ToolError::InvalidInput(
            "offset exceeds file length".to_string(),
        ));
    }

    Ok(collected)
}

/// Format a line for output, handling encoding and truncation.
fn format_line(bytes: &[u8]) -> String {
    // Use lossy conversion for non-UTF8 bytes
    let decoded = String::from_utf8_lossy(bytes);

    // Truncate long lines
    if decoded.len() > MAX_LINE_LENGTH {
        // Find valid UTF-8 boundary
        let mut end = MAX_LINE_LENGTH;
        while end > 0 && !decoded.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &decoded[..end])
    } else {
        decoded.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_read_file_basic() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "line1").unwrap();
        writeln!(temp, "line2").unwrap();
        writeln!(temp, "line3").unwrap();

        let handler = ReadFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        let content = result.content();
        assert!(content.contains("L1: line1"));
        assert!(content.contains("L2: line2"));
        assert!(content.contains("L3: line3"));
    }

    #[tokio::test]
    async fn test_read_file_with_offset() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "line1").unwrap();
        writeln!(temp, "line2").unwrap();
        writeln!(temp, "line3").unwrap();

        let handler = ReadFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": temp.path().to_str().unwrap(),
                "offset": 2
            }))
            .await
            .unwrap();

        let content = result.content();
        assert!(!content.contains("L1:"));
        assert!(content.contains("L2: line2"));
        assert!(content.contains("L3: line3"));
    }

    #[tokio::test]
    async fn test_read_file_with_limit() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "line1").unwrap();
        writeln!(temp, "line2").unwrap();
        writeln!(temp, "line3").unwrap();

        let handler = ReadFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": temp.path().to_str().unwrap(),
                "limit": 2
            }))
            .await
            .unwrap();

        let content = result.content();
        assert!(content.contains("L1: line1"));
        assert!(content.contains("L2: line2"));
        assert!(!content.contains("L3:"));
    }

    #[tokio::test]
    async fn test_read_file_not_found() {
        let handler = ReadFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": "/nonexistent/path/to/file.txt"
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::FileNotFound(_)));
    }

    #[tokio::test]
    async fn test_read_file_relative_path_rejected() {
        let handler = ReadFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": "relative/path.txt"
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn test_read_file_crlf() {
        let mut temp = NamedTempFile::new().unwrap();
        temp.write_all(b"line1\r\nline2\r\n").unwrap();

        let handler = ReadFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        let content = result.content();
        // Lines should not have \r
        assert!(!content.contains('\r'));
        assert!(content.contains("L1: line1"));
        assert!(content.contains("L2: line2"));
    }

    #[test]
    fn test_format_line_basic() {
        let bytes = b"hello world";
        assert_eq!(format_line(bytes), "hello world");
    }

    #[test]
    fn test_format_line_non_utf8() {
        let bytes = &[0xff, 0xfe, b'a', b'b'];
        let result = format_line(bytes);
        // Should contain replacement characters
        assert!(result.contains("ab"));
    }
}
