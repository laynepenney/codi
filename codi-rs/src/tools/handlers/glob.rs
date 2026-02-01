// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Glob tool handler.
//!
//! Finds files matching glob patterns using the globset crate.

use async_trait::async_trait;
use globset::{Glob, GlobSetBuilder};
use serde::Deserialize;
use std::path::PathBuf;
use tracing::{debug, instrument};
use walkdir::WalkDir;

use crate::error::ToolError;
use crate::tools::parse_arguments;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::{InputSchema, ToolDefinition};

/// Handler for the `glob` tool.
pub struct GlobHandler;

const DEFAULT_LIMIT: usize = 1000;

/// Arguments for the glob tool.
#[derive(Debug, Deserialize)]
struct GlobArgs {
    /// Glob pattern to match files against (e.g., "**/*.ts", "src/**/*.rs").
    pattern: String,

    /// Directory to search in (defaults to current directory).
    #[serde(default)]
    path: Option<String>,

    /// Maximum number of results to return.
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    DEFAULT_LIMIT
}

#[async_trait]
impl ToolHandler for GlobHandler {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("glob", "Find files matching a glob pattern")
            .with_schema(
                InputSchema::new()
                    .with_property("pattern", serde_json::json!({
                        "type": "string",
                        "description": "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.rs')"
                    }))
                    .with_property("path", serde_json::json!({
                        "type": "string",
                        "description": "Directory to search in (defaults to current directory)"
                    }))
                    .with_property("limit", serde_json::json!({
                        "type": "integer",
                        "description": "Maximum number of results (default: 1000)"
                    }))
                    .with_required(vec!["pattern".to_string()]),
            )
    }

    fn is_mutating(&self) -> bool {
        false
    }

    #[instrument(skip(self, input), fields(pattern, path, files_found))]
    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: GlobArgs = parse_arguments(&input)?;

        // Record span fields
        let span = tracing::Span::current();
        span.record("pattern", args.pattern.as_str());
        if let Some(ref p) = args.path {
            span.record("path", p.as_str());
        }

        let pattern = args.pattern.trim();
        if pattern.is_empty() {
            return Err(ToolError::InvalidInput(
                "pattern must not be empty".to_string(),
            ));
        }

        // Resolve base path
        let base_path = match &args.path {
            Some(p) => PathBuf::from(p),
            None => std::env::current_dir().map_err(|e| {
                ToolError::IoError(format!("Failed to get current directory: {e}"))
            })?,
        };

        // Verify path exists
        if !base_path.exists() {
            return Err(ToolError::FileNotFound(base_path.display().to_string()));
        }

        // Compile glob pattern
        let glob = Glob::new(pattern)
            .map_err(|e| ToolError::InvalidInput(format!("Invalid glob pattern: {e}")))?;

        let mut glob_builder = GlobSetBuilder::new();
        glob_builder.add(glob);
        let glob_set = glob_builder
            .build()
            .map_err(|e| ToolError::InvalidInput(format!("Failed to build glob set: {e}")))?;

        // Walk directory and collect matches
        let matches = find_matching_files(&base_path, &glob_set, args.limit);

        // Record files found
        tracing::Span::current().record("files_found", matches.len());
        debug!(pattern, files = matches.len(), "Glob search complete");

        if matches.is_empty() {
            Ok(ToolOutput::success("No files found matching pattern."))
        } else {
            Ok(ToolOutput::success(matches.join("\n")))
        }
    }
}

fn find_matching_files(
    base_path: &PathBuf,
    glob_set: &globset::GlobSet,
    limit: usize,
) -> Vec<String> {
    let mut matches = Vec::new();

    // Collect file metadata for sorting
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();

    for entry in WalkDir::new(base_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        // Get relative path for matching
        let path = entry.path();
        let relative = match path.strip_prefix(base_path) {
            Ok(r) => r,
            Err(_) => continue,
        };

        // Check if matches pattern
        if glob_set.is_match(relative) {
            // Get modification time for sorting
            let mtime = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

            entries.push((path.to_path_buf(), mtime));
        }
    }

    // Sort by modification time (most recent first)
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    // Take up to limit entries
    for (path, _) in entries.into_iter().take(limit) {
        matches.push(path.display().to_string());
    }

    matches
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_glob_basic() {
        let temp = tempdir().unwrap();
        let src = temp.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("main.rs"), "fn main() {}").unwrap();
        fs::write(src.join("lib.rs"), "// lib").unwrap();
        fs::write(temp.path().join("readme.md"), "# Readme").unwrap();

        let handler = GlobHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "**/*.rs",
                "path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        let content = result.content();
        assert!(content.contains("main.rs"));
        assert!(content.contains("lib.rs"));
        assert!(!content.contains("readme.md"));
    }

    #[tokio::test]
    async fn test_glob_with_limit() {
        let temp = tempdir().unwrap();
        for i in 1..=10 {
            fs::write(temp.path().join(format!("file{i}.txt")), "content").unwrap();
        }

        let handler = GlobHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "*.txt",
                "path": temp.path().to_str().unwrap(),
                "limit": 3
            }))
            .await
            .unwrap();

        let content = result.content();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);
    }

    #[tokio::test]
    async fn test_glob_no_matches() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join("test.txt"), "content").unwrap();

        let handler = GlobHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "*.xyz",
                "path": temp.path().to_str().unwrap()
            }))
            .await
            .unwrap();

        assert_eq!(result.content(), "No files found matching pattern.");
    }

    #[tokio::test]
    async fn test_glob_invalid_pattern() {
        let handler = GlobHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "[invalid"
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn test_glob_empty_pattern() {
        let handler = GlobHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "   "
            }))
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_glob_nonexistent_path() {
        let handler = GlobHandler;
        let result = handler
            .execute(serde_json::json!({
                "pattern": "*.txt",
                "path": "/nonexistent/path"
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::FileNotFound(_)));
    }
}
