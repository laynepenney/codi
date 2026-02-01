// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Write file tool handler.
//!
//! Writes content to a file, creating directories as needed.

use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;
use tokio::fs;

use crate::error::ToolError;
use crate::tools::parse_arguments;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::{InputSchema, ToolDefinition};

/// Handler for the `write_file` tool.
pub struct WriteFileHandler;

/// Arguments for the write_file tool.
#[derive(Debug, Deserialize)]
struct WriteFileArgs {
    /// Absolute path to the file to write.
    file_path: String,

    /// Content to write to the file.
    content: String,
}

#[async_trait]
impl ToolHandler for WriteFileHandler {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("write_file", "Write content to a file (creates file if it doesn't exist)")
            .with_schema(
                InputSchema::new()
                    .with_property("file_path", serde_json::json!({
                        "type": "string",
                        "description": "The absolute path to the file to write"
                    }))
                    .with_property("content", serde_json::json!({
                        "type": "string",
                        "description": "The content to write to the file"
                    }))
                    .with_required(vec!["file_path".to_string(), "content".to_string()]),
            )
    }

    fn is_mutating(&self) -> bool {
        true
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: WriteFileArgs = parse_arguments(&input)?;

        let path = PathBuf::from(&args.file_path);

        if !path.is_absolute() {
            return Err(ToolError::InvalidInput(
                "file_path must be an absolute path".to_string(),
            ));
        }

        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await.map_err(|e| {
                    ToolError::IoError(format!("Failed to create parent directories: {e}"))
                })?;
            }
        }

        // Check if file exists (for output message)
        let existed = path.exists();

        // Write the file
        fs::write(&path, &args.content).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                ToolError::PermissionDenied(path.display().to_string())
            } else {
                ToolError::IoError(format!("Failed to write file: {e}"))
            }
        })?;

        let action = if existed { "Updated" } else { "Created" };
        let lines = args.content.lines().count();
        let bytes = args.content.len();

        Ok(ToolOutput::success(format!(
            "{action} {path} ({lines} lines, {bytes} bytes)",
            path = path.display()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_write_file_new() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("new_file.txt");

        let handler = WriteFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "content": "Hello, world!"
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(result.content().contains("Created"));
        assert!(file.exists());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "Hello, world!");
    }

    #[tokio::test]
    async fn test_write_file_overwrite() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("existing.txt");
        std::fs::write(&file, "old content").unwrap();

        let handler = WriteFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "content": "new content"
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(result.content().contains("Updated"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "new content");
    }

    #[tokio::test]
    async fn test_write_file_creates_dirs() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("nested").join("dir").join("file.txt");

        let handler = WriteFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": file.to_str().unwrap(),
                "content": "content"
            }))
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(file.exists());
    }

    #[tokio::test]
    async fn test_write_file_relative_path_rejected() {
        let handler = WriteFileHandler;
        let result = handler
            .execute(serde_json::json!({
                "file_path": "relative/path.txt",
                "content": "content"
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidInput(_)));
    }
}
