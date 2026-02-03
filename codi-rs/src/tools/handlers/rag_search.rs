// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! RAG (Retrieval-Augmented Generation) tools for semantic code search.

use async_trait::async_trait;
use serde::Deserialize;

use crate::error::ToolError;
use crate::rag::RAGService;
use crate::tools::{ToolHandler, ToolOutput};

/// Search codebase using semantic search and embeddings.
#[derive(Debug, Clone, Default)]
pub struct RAGSearchHandler;

#[derive(Debug, Deserialize)]
struct RAGSearchArgs {
    /// Natural language query for semantic search.
    query: String,
    /// Maximum number of results to return.
    #[serde(default)]
    limit: Option<usize>,
}

#[async_trait]
impl ToolHandler for RAGSearchHandler {
    fn definition(&self) -> crate::types::ToolDefinition {
        crate::types::ToolDefinition::new(
            "rag_search",
            "Search the codebase using semantic search with RAG embeddings and vector similarity"
        )
    }

    fn is_mutating(&self) -> bool {
        false
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args = serde_json::from_value::<RAGSearchArgs>(input)
            .map_err(|e| ToolError::InvalidInput(format!("Invalid arguments: {}", e)))?;
        
        let working_dir = std::env::current_dir()?;
        let working_dir_str = working_dir.to_str()
            .ok_or_else(|| ToolError::InvalidInput("Invalid working directory".to_string()))?;
            
        // Initialize RAG service
        let service = RAGService::new(working_dir_str)
            .await
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to create RAG service: {}", e)))?;
        
        // Build index if not exists
        if service.get_stats().await.is_err() {
            eprintln!("RAG index not found. Attempting to build it...");
            let result = service.index().await?;
            eprintln!("Indexed {} files with {} chunks in {}ms", result.files_indexed, result.total_chunks, result.duration_ms);
        }
        
        // Perform search
        let mut results: Vec<_> = service.search(&args.query).await?;
        
        // Apply limit if specified
        if let Some(limit) = args.limit {
            results = results.into_iter().take(limit).collect();
        }
        
        if results.is_empty() {
            return Ok(ToolOutput::success("No relevant code found for your query"));
        }
        
        let mut output = format!("Found {} relevant code chunks:\n\n", results.len());
        for (i, result) in results.iter().enumerate() {
            if i > 0 { output.push('\n'); }
            output.push_str(&format!(
                "**{}** (Score: {:.3})\n\n```\n{}\n```",
                result.chunk.file_path,
                result.score,
                result.chunk.content.lines().take(8).collect::<Vec<_>>().join("\n")
            ));
        }
        
        Ok(ToolOutput::success(output))
    }
}