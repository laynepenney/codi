// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! List directory tool handler.
//!
//! Lists contents of a directory with file metadata.

use async_trait::async_trait;
use serde::Deserialize;
use std::path::PathBuf;
use tokio::fs;

#[cfg(feature = "telemetry")]
use tracing::{debug, instrument};

use crate::error::ToolError;
use crate::tools::parse_arguments;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::{InputSchema, ToolDefinition};

/// Handler for the `list_directory` tool.
pub struct ListDirHandler;

const DEFAULT_LIMIT: usize = 200;

/// Arguments for the list_directory tool.
#[derive(Debug, Deserialize)]
struct ListDirArgs {
    /// Path to the directory to list.
    path: String,

    /// Maximum number of entries to return.
    #[serde(default = "default_limit")]
    limit: usize,

    /// Show hidden files (starting with .).
    #[serde(default)]
    show_hidden: bool,
}

fn default_limit() -> usize {
    DEFAULT_LIMIT
}

#[async_trait]
impl ToolHandler for ListDirHandler {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("list_directory", "List contents of a directory")
            .with_schema(
                InputSchema::new()
                    .with_property("path", serde_json::json!({
                        "type": "string",
                        "description": "Path to the directory to list"
                    }))
                    .with_property("limit", serde_json::json!({
                        "type": "integer",
                        "description": "Maximum number of entries (default: 200)"
                    }))
                    .with_property("show_hidden", serde_json::json!({
                        "type": "boolean",
                        "description": "Show hidden files (default: false)"
                    }))
                    .with_required(vec!["path".to_string()]),
            )
    }

    fn is_mutating(&self) -> bool {
        false
    }

    #[cfg_attr(feature = "telemetry", instrument(skip(self, input), fields(path, entries)))]
    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: ListDirArgs = parse_arguments(&input)?;

        // Record span fields (only with telemetry)
        #[cfg(feature = "telemetry")]
        tracing::Span::current().record("path", args.path.as_str());

        let path = PathBuf::from(&args.path);

        // Check if path exists and is a directory
        let metadata = fs::metadata(&path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ToolError::FileNotFound(path.display().to_string())
            } else {
                ToolError::IoError(format!("Failed to access path: {e}"))
            }
        })?;

        if !metadata.is_dir() {
            return Err(ToolError::InvalidInput(format!(
                "Path is not a directory: {}",
                path.display()
            )));
        }

        // Read directory entries
        let entries = list_directory(&path, args.limit, args.show_hidden).await?;

        // Record entry count (only with telemetry)
        #[cfg(feature = "telemetry")]
        {
            tracing::Span::current().record("entries", entries.len());
            debug!(path = %path.display(), entries = entries.len(), "Directory listed");
        }

        if entries.is_empty() {
            Ok(ToolOutput::success("[Empty directory]"))
        } else {
            Ok(ToolOutput::success(entries.join("\n")))
        }
    }
}

/// Entry in a directory listing.
struct DirEntry {
    name: String,
    is_dir: bool,
    size: Option<u64>,
}

async fn list_directory(
    path: &PathBuf,
    limit: usize,
    show_hidden: bool,
) -> Result<Vec<String>, ToolError> {
    let mut entries = Vec::new();

    let mut dir = fs::read_dir(path).await.map_err(|e| {
        ToolError::IoError(format!("Failed to read directory: {e}"))
    })?;

    let mut dir_entries: Vec<DirEntry> = Vec::new();

    while let Some(entry) = dir.next_entry().await.map_err(|e| {
        ToolError::IoError(format!("Failed to read directory entry: {e}"))
    })? {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        // Skip hidden files if not showing them
        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let metadata = entry.metadata().await.ok();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = if is_dir {
            None
        } else {
            metadata.as_ref().map(|m| m.len())
        };

        dir_entries.push(DirEntry { name, is_dir, size });
    }

    // Sort: directories first, then alphabetically
    dir_entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    // Format entries
    for entry in dir_entries.into_iter().take(limit) {
        let formatted = if entry.is_dir {
            format!("📁 {}/", entry.name)
        } else {
            match entry.size {
                Some(size) => format!("📄 {} ({})", entry.name, format_size(size)),
                None => format!("📄 {}", entry.name),
            }
        };
        entries.push(formatted);
    }

    Ok(entries)
}

/// Format file size in human-readable form.
fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_list_dir_basic() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join("file1.txt"), "content").unwrap();
        fs::write(temp.path().join("file2.txt"), "content").unwrap();
        fs::create_dir(temp.path().join("subdir")).unwrap();

        let handler = ListDirHandler;
        let result = handler
            .execute(serde_json::json!({
                "path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        let content = result.content();
        assert!(content.contains("subdir"));
        assert!(content.contains("file1.txt"));
        assert!(content.contains("file2.txt"));
        // Directories should be first
        let subdir_pos = content.find("subdir").unwrap();
        let file1_pos = content.find("file1.txt").unwrap();
        assert!(subdir_pos < file1_pos);
    }

    #[tokio::test]
    async fn test_list_dir_hidden() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join(".hidden"), "content").unwrap();
        fs::write(temp.path().join("visible.txt"), "content").unwrap();

        let handler = ListDirHandler;

        // Without show_hidden
        let result = handler
            .execute(serde_json::json!({
                "path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        assert!(!result.content().contains(".hidden"));
        assert!(result.content().contains("visible.txt"));

        // With show_hidden
        let result = handler
            .execute(serde_json::json!({
                "path": temp.path().to_str().unwrap(),
                "show_hidden": true
            }))
            .await
            .unwrap();

        assert!(result.content().contains(".hidden"));
    }

    #[tokio::test]
    async fn test_list_dir_not_found() {
        let handler = ListDirHandler;
        let result = handler
            .execute(serde_json::json!({
                "path": "/nonexistent/path"
            }))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_dir_not_a_directory() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("file.txt");
        fs::write(&file, "content").unwrap();

        let handler = ListDirHandler;
        let result = handler
            .execute(serde_json::json!({
                "path": file.to_str().unwrap()
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidInput(_)));
    }

    #[test]
    fn test_format_size() {
        assert_eq!(format_size(500), "500 B");
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(1048576), "1.0 MB");
        assert_eq!(format_size(1073741824), "1.0 GB");
    }
}
