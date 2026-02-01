// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Edit file tool handler.
//!
//! Performs exact string replacements in files.

use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;
use tokio::fs;

use crate::error::ToolError;
use crate::tools::parse_arguments;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::{InputSchema, ToolDefinition};

/// Handler for the `edit_file` tool.
pub struct EditFileHandler;

/// Arguments for the edit_file tool.
#[derive(Debug, Deserialize)]
struct EditFileArgs {
    /// Absolute path to the file to edit.
    file_path: String,

    /// The exact text to find and replace.
    old_string: String,

    /// The text to replace it with.
    new_string: String,

    /// If true, replace all occurrences (default: false).
    #[serde(default)]
    replace_all: bool,
}

#[async_trait]
impl ToolHandler for EditFileHandler {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("edit_file", "Edit a file by replacing text")
            .with_schema(
                InputSchema::new()
                    .with_property("file_path", serde_json::json!({
                        "type": "string",
                        "description": "The absolute path to the file to edit"
                    }))
                    .with_property("old_string", serde_json::json!({
                        "type": "string",
                        "description": "The exact text to find and replace"
                    }))
                    .with_property("new_string", serde_json::json!({
                        "type": "string",
                        "description": "The text to replace it with"
                    }))
                    .with_property("replace_all", serde_json::json!({
                        "type": "boolean",
                        "description": "Replace all occurrences (default: false)"
                    }))
                    .with_required(vec![
                        "file_path".to_string(),
                        "old_string".to_string(),
                        "new_string".to_string(),
                    ]),
            )
    }

    fn is_mutating(&self) -> bool {
        true
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: EditFileArgs = parse_arguments(&input)?;

        let path = PathBuf::from(&args.file_path);

        if !path.is_absolute() {
            return Err(ToolError::InvalidInput(
                "file_path must be an absolute path".to_string(),
            ));
        }

        // Validate old_string is not empty
        if args.old_string.is_empty() {
            return Err(ToolError::InvalidInput(
                "old_string must not be empty".to_string(),
            ));
        }

        // Check if new_string is the same as old_string
        if args.old_string == args.new_string {
            return Err(ToolError::InvalidInput(
                "new_string must be different from old_string".to_string(),
            ));
        }

        // Read the file
        let content = fs::read_to_string(&path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ToolError::FileNotFound(path.display().to_string())
            } else if e.kind() == std::io::ErrorKind::PermissionDenied {
                ToolError::PermissionDenied(path.display().to_string())
            } else {
                ToolError::IoError(format!("Failed to read file: {e}"))
            }
        })?;

        // Count occurrences
        let count = content.matches(&args.old_string).count();

        if count == 0 {
            return Err(ToolError::InvalidInput(format!(
                "old_string not found in file. The exact text '{}' was not found.",
                truncate_for_error(&args.old_string, 50)
            )));
        }

        // For non-replace_all mode, ensure uniqueness
        if !args.replace_all && count > 1 {
            return Err(ToolError::InvalidInput(format!(
                "old_string appears {count} times in the file. \
                 Either provide more context to make it unique, or use replace_all: true"
            )));
        }

        // Perform replacement
        let new_content = if args.replace_all {
            content.replace(&args.old_string, &args.new_string)
        } else {
            content.replacen(&args.old_string, &args.new_string, 1)
        };

        // Write the file
        fs::write(&path, &new_content).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                ToolError::PermissionDenied(path.display().to_string())
            } else {
                ToolError::IoError(format!("Failed to write file: {e}"))
            }
        })?;

        let replaced_count = if args.replace_all { count } else { 1 };
        Ok(ToolOutput::success(format!(
            "Edited {} - replaced {replaced_count} occurrence(s)",
            path.display()
        )))
    }
}

/// Truncate a string for error messages.
fn truncate_for_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_edit_file_single() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "hello world").unwrap();

        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "old_string": "world",
                "new_string": "rust"
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello rust");
    }

    #[tokio::test]
    async fn test_edit_file_replace_all() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "foo bar foo baz foo").unwrap();

        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "old_string": "foo",
                "new_string": "qux",
                "replace_all": true
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(result.content().contains("3 occurrence"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "qux bar qux baz qux");
    }

    #[tokio::test]
    async fn test_edit_file_not_unique() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "foo bar foo").unwrap();

        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "old_string": "foo",
                "new_string": "qux"
            }))
            .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
        assert!(err.to_string().contains("appears 2 times"));
    }

    #[tokio::test]
    async fn test_edit_file_not_found() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "hello world").unwrap();

        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "old_string": "nonexistent",
                "new_string": "replacement"
            }))
            .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
        assert!(err.to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_edit_file_same_string() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();

        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "old_string": "hello",
                "new_string": "hello"
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn test_edit_file_empty_old_string() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();

        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "old_string": "",
                "new_string": "new"
            }))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_file_relative_path_rejected() {
        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": "relative/path.txt",
                "old_string": "old",
                "new_string": "new"
            }))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_file_multiline() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        std::fs::write(&file, "line1\nline2\nline3").unwrap();

        let handler = EditFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "old_string": "line1\nline2",
                "new_string": "new_line1\nnew_line2"
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "new_line1\nnew_line2\nline3"
        );
    }
}
