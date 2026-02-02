// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! RAG (Retrieval-Augmented Generation) system for semantic code search.
//!
//! This module provides a complete RAG pipeline for indexing and searching code:
//!
//! - **Embedding providers**: OpenAI and Ollama support for generating embeddings
//! - **Code chunking**: Semantic chunking that preserves code structure
//! - **Vector storage**: SQLite-based vector store with cosine similarity search
//! - **Background indexing**: Parallel file processing with incremental updates
//! - **Retrieval**: Query interface with formatted output for LLM context
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                      RAGService                              │
//! │  (High-level API: index, search, get_stats, etc.)           │
//! └─────────────────────────────────────────────────────────────┘
//!                            │
//!          ┌─────────────────┼─────────────────┐
//!          ▼                 ▼                 ▼
//! ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
//! │     Indexer     │ │  Retriever  │ │  VectorStore    │
//! │  (Parallel file │ │   (Query    │ │   (SQLite +     │
//! │   processing)   │ │  interface) │ │    vectors)     │
//! └─────────────────┘ └─────────────┘ └─────────────────┘
//!          │                 │
//!          ▼                 ▼
//! ┌─────────────────┐ ┌─────────────────┐
//! │   CodeChunker   │ │   Embeddings    │
//! │   (Semantic     │ │   (OpenAI /     │
//! │    splitting)   │ │    Ollama)      │
//! └─────────────────┘ └─────────────────┘
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::rag::{RAGService, RAGConfig};
//!
//! // Create service with defaults
//! let service = RAGService::new("/path/to/project").await?;
//!
//! // Build the index
//! let result = service.index().await?;
//! println!("Indexed {} files with {} chunks", result.files_indexed, result.total_chunks);
//!
//! // Search for relevant code
//! let results = service.search("how to handle errors").await?;
//! for result in results {
//!     println!("{}:{} - {} (score: {:.2})",
//!         result.chunk.relative_path,
//!         result.chunk.start_line,
//!         result.chunk.name.unwrap_or_default(),
//!         result.score
//!     );
//! }
//!
//! // Get formatted context for LLM
//! let context = service.format_context(&results);
//! ```
//!
//! # Telemetry
//!
//! All operations record telemetry metrics when the `telemetry` feature is enabled:
//!
//! - `rag.service.*` - Service-level operations
//! - `rag.indexer.*` - Indexing operations
//! - `rag.retriever.*` - Search operations
//! - `rag.embeddings.*` - Embedding generation
//! - `rag.vector_store.*` - Vector storage operations

pub mod chunker;
pub mod embeddings;
pub mod indexer;
pub mod retriever;
pub mod types;
pub mod vector_store;

// Re-export commonly used types
pub use chunker::{ChunkerConfig, CodeChunker};
pub use embeddings::{
    create_embedding_provider, detect_available_providers, EmbeddingCache, EmbeddingProvider,
    OllamaEmbeddingProvider, OpenAIEmbeddingProvider,
};
pub use indexer::{ProgressCallback, RAGIndexer};
pub use retriever::Retriever;
pub use types::{
    ChunkStrategy, ChunkType, CodeChunk, EmbeddingModelInfo, EmbeddingProviderType,
    EmbeddingVector, IndexProgress, IndexResult, IndexStats, RAGConfig, RetrievalResult,
};
pub use vector_store::{get_rag_directory, VectorStore, VECTOR_STORE_VERSION};

use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

/// High-level RAG service providing a unified API.
pub struct RAGService {
    store: Arc<Mutex<VectorStore>>,
    embedding_provider: Arc<dyn EmbeddingProvider>,
    indexer: RAGIndexer,
    retriever: Retriever,
    config: RAGConfig,
    project_root: String,
}

impl RAGService {
    /// Create a new RAG service with default configuration.
    pub async fn new(project_root: &str) -> Result<Self, ToolError> {
        let config = RAGConfig {
            enabled: true,
            ..Default::default()
        };
        Self::with_config(project_root, config).await
    }

    /// Create a RAG service with custom configuration.
    pub async fn with_config(project_root: &str, config: RAGConfig) -> Result<Self, ToolError> {
        let start = Instant::now();

        // Create embedding provider
        let embedding_provider = create_embedding_provider(&config).await?;
        let dimensions = embedding_provider.dimensions();

        // Create vector store
        let store = VectorStore::open(project_root, dimensions)?;
        let store = Arc::new(Mutex::new(store));

        // Create indexer
        let mut indexer_config = config.clone();
        indexer_config.enabled = true;
        let indexer = RAGIndexer::new(indexer_config)?;

        // Create retriever
        let retriever = Retriever::new(
            store.clone(),
            Arc::clone(&embedding_provider),
            config.clone(),
        );

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.service.new", start.elapsed());

        Ok(Self {
            store,
            embedding_provider,
            indexer,
            retriever,
            config,
            project_root: project_root.to_string(),
        })
    }

    /// Get the project root.
    pub fn project_root(&self) -> &str {
        &self.project_root
    }

    /// Get the configuration.
    pub fn config(&self) -> &RAGConfig {
        &self.config
    }

    /// Index all files in the project.
    pub async fn index(&self) -> Result<IndexResult, ToolError> {
        self.index_with_progress(None).await
    }

    /// Index all files with progress callback.
    pub async fn index_with_progress(
        &self,
        progress: Option<ProgressCallback>,
    ) -> Result<IndexResult, ToolError> {
        let start = Instant::now();

        let result = self.indexer.index_all(
            self.store.clone(),
            self.embedding_provider.clone(),
            progress,
        ).await?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.service.index", start.elapsed());

        Ok(result)
    }

    /// Search for relevant code.
    pub async fn search(&self, query: &str) -> Result<Vec<RetrievalResult>, ToolError> {
        self.search_with_options(query, None, None).await
    }

    /// Search with custom options.
    pub async fn search_with_options(
        &self,
        query: &str,
        top_k: Option<usize>,
        min_score: Option<f32>,
    ) -> Result<Vec<RetrievalResult>, ToolError> {
        let start = Instant::now();

        let results = self.retriever.search(query, top_k, min_score).await?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.service.search", start.elapsed());

        Ok(results)
    }

    /// Format results for LLM context.
    pub fn format_context(&self, results: &[RetrievalResult]) -> String {
        self.retriever.format_for_context(results)
    }

    /// Format results for human output.
    pub fn format_output(&self, results: &[RetrievalResult]) -> String {
        self.retriever.format_as_tool_output(results)
    }

    /// Get list of indexed files.
    pub async fn get_indexed_files(&self) -> Result<Vec<String>, ToolError> {
        self.retriever.get_indexed_files().await
    }

    /// Get index statistics.
    pub async fn get_stats(&self) -> Result<IndexStats, ToolError> {
        let start = Instant::now();

        let store = self.store.lock().await;
        let mut stats = store.get_stats()?;

        // Add provider info
        stats.embedding_provider = self.embedding_provider.name().to_string();
        stats.embedding_model = self.embedding_provider.model().to_string();
        stats.is_indexing = self.indexer.is_running();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.service.get_stats", start.elapsed());

        Ok(stats)
    }

    /// Clear the entire index.
    pub async fn clear(&self) -> Result<(), ToolError> {
        let start = Instant::now();

        let store = self.store.lock().await;
        store.clear()?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.service.clear", start.elapsed());

        Ok(())
    }

    /// Check if the index is empty.
    pub async fn is_empty(&self) -> Result<bool, ToolError> {
        let stats = self.get_stats().await?;
        Ok(stats.total_chunks == 0)
    }

    /// Check if indexing is running.
    pub fn is_indexing(&self) -> bool {
        self.indexer.is_running()
    }

    /// Cancel any running indexing operation.
    pub fn cancel_indexing(&self) {
        self.indexer.cancel();
    }

    /// Get embedding provider info.
    pub fn embedding_info(&self) -> EmbeddingModelInfo {
        self.embedding_provider.model_info()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RAGConfig::default();
        assert!(config.enabled);
        assert_eq!(config.top_k, 5);
        assert!((config.min_score - 0.7).abs() < 0.001);
    }

    #[test]
    fn test_chunk_type_display() {
        assert_eq!(ChunkType::Function.to_string(), "function");
        assert_eq!(ChunkType::Class.to_string(), "class");
        assert_eq!(ChunkType::Method.to_string(), "method");
    }

    #[test]
    fn test_embedding_vector() {
        let vec = EmbeddingVector::new(vec![1.0, 2.0, 3.0]);
        assert_eq!(vec.dimensions, 3);
        assert_eq!(vec.values.len(), 3);
    }
}
