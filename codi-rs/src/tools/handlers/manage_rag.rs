// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! RAG (Retrieval-Augmented Generation) management tools.

use async_trait::async_trait;
use serde::Deserialize;

use crate::error::ToolError;
use crate::rag::RAGService;
use crate::tools::{ToolHandler, ToolOutput};

/// Manage the RAG index for semantic search.
#[derive(Debug, Clone, Default)]
pub struct ManageRAGHandler;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RAGAction {
    Index,
    Rebuild,
    Stats,
}

#[derive(Debug, Deserialize)]
struct ManageRAGArgs {
    action: RAGAction,
    #[serde(default)]
    #[allow(dead_code)]
    force: Option<bool>,
}

#[async_trait]
impl ToolHandler for ManageRAGHandler {
    fn definition(&self) -> crate::types::ToolDefinition {
        crate::types::ToolDefinition::new(
            "manage_rag",
            "Manage the RAG index for semantic code search"
        )
    }

    fn is_mutating(&self) -> bool {
        true // This can modify the vector index
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args = serde_json::from_value::<ManageRAGArgs>(input)
            .map_err(|e| ToolError::InvalidInput(format!("Invalid arguments: {}", e)))?;
        
        let working_dir = std::env::current_dir()?;
        let working_dir_str = working_dir.to_str()
            .ok_or_else(|| ToolError::InvalidInput("Invalid working directory".to_string()))?;
        
        // Initialize RAG service
        let service = RAGService::new(working_dir_str)
            .await
            .map_err(|e| ToolError::IoError(format!("Failed to create RAG service: {}", e)))?;
        
        match args.action {
            RAGAction::Index => {
                eprintln!("Performing RAG indexing...");
                let result = service.index().await?;
                Ok(ToolOutput::success(format!(
                    "RAG index updated:\n- {} files indexed\n- {} chunks created in {}ms",
                    result.files_indexed,
                    result.total_chunks,
                    result.duration_ms
                )))
            }
            RAGAction::Rebuild => {
                eprintln!("Performing full RAG rebuild...");
                let result = service.index().await?;
                Ok(ToolOutput::success(format!(
                    "RAG index rebuilt:\n- {} files indexed\n- {} chunks created in {}ms",
                    result.files_indexed,
                    result.total_chunks,
                    result.duration_ms
                )))
            }
            RAGAction::Stats => {
                let stats = service.get_stats().await?;
                Ok(ToolOutput::success(format!(
                    "RAG system stats:\n- {} files with {} chunks\n- Index size: {} MB",
                    stats.total_files,
                    stats.total_chunks,
                    stats.index_size_bytes / (1024 * 1024)
                )))
            }
        }
    }
}