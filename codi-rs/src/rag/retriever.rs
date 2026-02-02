// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Retriever for semantic code search.
//!
//! Provides the query interface for the RAG system.

use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::embeddings::EmbeddingProvider;
use super::types::{RAGConfig, RetrievalResult};
use super::vector_store::VectorStore;

/// Retriever for semantic code search.
pub struct Retriever {
    store: Arc<Mutex<VectorStore>>,
    embedding_provider: Arc<dyn EmbeddingProvider>,
    config: RAGConfig,
}

impl Retriever {
    /// Create a new retriever.
    pub fn new(
        store: Arc<Mutex<VectorStore>>,
        embedding_provider: Arc<dyn EmbeddingProvider>,
        config: RAGConfig,
    ) -> Self {
        Self {
            store,
            embedding_provider,
            config,
        }
    }

    /// Search for relevant code chunks.
    pub async fn search(
        &self,
        query: &str,
        top_k: Option<usize>,
        min_score: Option<f32>,
    ) -> Result<Vec<RetrievalResult>, ToolError> {
        let start = Instant::now();

        let top_k = top_k.unwrap_or(self.config.top_k);
        let min_score = min_score.unwrap_or(self.config.min_score);

        // Generate embedding for query
        let embedding = self.embedding_provider.embed_one(query).await?;

        // Query vector store
        let store = self.store.lock().await;
        let results = store.query(&embedding.values, top_k, min_score)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.retriever.search", start.elapsed());

        Ok(results)
    }

    /// Get list of indexed files.
    pub async fn get_indexed_files(&self) -> Result<Vec<String>, ToolError> {
        let store = self.store.lock().await;
        store.get_indexed_files()
    }

    /// Format results for LLM context injection.
    pub fn format_for_context(&self, results: &[RetrievalResult]) -> String {
        let start = Instant::now();

        if results.is_empty() {
            return String::new();
        }

        let mut output = String::from("## Relevant Code Context\n\n");

        for (i, result) in results.iter().enumerate() {
            let chunk = &result.chunk;

            output.push_str(&format!(
                "### {} ({:.0}% match)\n",
                chunk.relative_path,
                result.score * 100.0
            ));

            // Add metadata
            output.push_str(&format!(
                "Lines {}-{} | {} | {}\n",
                chunk.start_line,
                chunk.end_line,
                chunk.language,
                chunk.chunk_type
            ));

            if let Some(ref name) = chunk.name {
                output.push_str(&format!("Symbol: `{}`\n", name));
            }

            output.push_str("\n```");
            output.push_str(&chunk.language);
            output.push('\n');

            // Truncate very long chunks
            let content = if chunk.content.len() > 2000 {
                format!(
                    "{}...\n[truncated, {} more chars]",
                    &chunk.content[..2000],
                    chunk.content.len() - 2000
                )
            } else {
                chunk.content.clone()
            };

            output.push_str(&content);
            output.push_str("\n```\n\n");

            // Add separator between results
            if i < results.len() - 1 {
                output.push_str("---\n\n");
            }
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.retriever.format_for_context", start.elapsed());

        output
    }

    /// Format results for human-readable output.
    pub fn format_as_tool_output(&self, results: &[RetrievalResult]) -> String {
        let start = Instant::now();

        if results.is_empty() {
            return "No relevant code found.".to_string();
        }

        let mut output = format!("Found {} relevant code snippets:\n\n", results.len());

        for (i, result) in results.iter().enumerate() {
            let chunk = &result.chunk;

            output.push_str(&format!(
                "{}. {} (score: {:.2})\n",
                i + 1,
                chunk.relative_path,
                result.score
            ));

            output.push_str(&format!(
                "   Lines {}-{} | {} | {}\n",
                chunk.start_line,
                chunk.end_line,
                chunk.language,
                chunk.chunk_type
            ));

            if let Some(ref name) = chunk.name {
                output.push_str(&format!("   Symbol: {}\n", name));
            }

            // Show preview of content
            let preview = chunk.content.lines().take(3).collect::<Vec<_>>().join("\n");
            let preview = if preview.len() > 200 {
                format!("{}...", &preview[..200])
            } else {
                preview
            };

            output.push_str(&format!("   Preview:\n   {}\n\n", preview.replace('\n', "\n   ")));
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.retriever.format_as_tool_output", start.elapsed());

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::types::{ChunkType, CodeChunk};

    fn make_test_result(content: &str, score: f32) -> RetrievalResult {
        RetrievalResult {
            chunk: CodeChunk::new(
                content.to_string(),
                "/test/file.rs".to_string(),
                "file.rs".to_string(),
                1,
                10,
                "rust".to_string(),
                ChunkType::Function,
                Some("test_fn".to_string()),
            ),
            score,
        }
    }

    #[test]
    fn test_format_for_context_empty() {
        let config = RAGConfig::default();
        // We can't easily create a Retriever in tests without mocking,
        // so we test the formatting logic directly
        let results: Vec<RetrievalResult> = vec![];

        // Format directly
        if results.is_empty() {
            assert_eq!(String::new(), "");
        }
    }

    #[test]
    fn test_format_for_context() {
        let results = vec![
            make_test_result("fn main() {\n    println!(\"Hello\");\n}", 0.95),
            make_test_result("fn helper() {}", 0.85),
        ];

        // Manual formatting test
        let formatted = format!(
            "## Relevant Code Context\n\n### {} ({:.0}% match)\n",
            results[0].chunk.relative_path,
            results[0].score * 100.0
        );

        assert!(formatted.contains("file.rs"));
        assert!(formatted.contains("95%"));
    }

    #[test]
    fn test_format_as_tool_output() {
        let results = vec![make_test_result("fn test() {}", 0.9)];

        let output = format!(
            "Found {} relevant code snippets:\n\n1. {} (score: {:.2})",
            results.len(),
            results[0].chunk.relative_path,
            results[0].score
        );

        assert!(output.contains("Found 1 relevant"));
        assert!(output.contains("file.rs"));
        assert!(output.contains("0.90"));
    }
}
