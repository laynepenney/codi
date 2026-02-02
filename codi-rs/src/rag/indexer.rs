// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Background indexer for the RAG system.
//!
//! Handles parallel file indexing with incremental updates.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Instant;

use globset::{Glob, GlobSet, GlobSetBuilder};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use walkdir::WalkDir;

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::chunker::CodeChunker;
use super::embeddings::EmbeddingProvider;
use super::types::{IndexProgress, IndexResult, RAGConfig};
use super::vector_store::VectorStore;

/// Progress callback for indexing operations.
pub type ProgressCallback = Box<dyn Fn(IndexProgress) + Send + Sync>;

/// File to be indexed.
struct FileToIndex {
    path: PathBuf,
    relative_path: String,
}

/// Background indexer for RAG.
pub struct RAGIndexer {
    config: RAGConfig,
    include_globs: GlobSet,
    exclude_globs: GlobSet,
    is_running: Arc<AtomicBool>,
    files_processed: Arc<AtomicU32>,
    chunks_created: Arc<AtomicU32>,
}

impl RAGIndexer {
    /// Create a new indexer.
    pub fn new(config: RAGConfig) -> Result<Self, ToolError> {
        let start = Instant::now();

        let include_globs = Self::build_globset(&config.include_patterns)?;
        let exclude_globs = Self::build_globset(&config.exclude_patterns)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.indexer.new", start.elapsed());

        Ok(Self {
            config,
            include_globs,
            exclude_globs,
            is_running: Arc::new(AtomicBool::new(false)),
            files_processed: Arc::new(AtomicU32::new(0)),
            chunks_created: Arc::new(AtomicU32::new(0)),
        })
    }

    /// Build a globset from patterns.
    fn build_globset(patterns: &[String]) -> Result<GlobSet, ToolError> {
        let mut builder = GlobSetBuilder::new();
        for pattern in patterns {
            let glob = Glob::new(pattern).map_err(|e| {
                ToolError::InvalidInput(format!("Invalid glob pattern '{}': {}", pattern, e))
            })?;
            builder.add(glob);
        }
        builder.build().map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to build globset: {}", e))
        })
    }

    /// Check if indexing is running.
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }

    /// Get current progress.
    pub fn get_progress(&self) -> (u32, u32) {
        (
            self.files_processed.load(Ordering::SeqCst),
            self.chunks_created.load(Ordering::SeqCst),
        )
    }

    /// Cancel indexing.
    pub fn cancel(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    /// Index all files in the project.
    pub async fn index_all(
        &self,
        store: Arc<Mutex<VectorStore>>,
        embedding_provider: Arc<dyn EmbeddingProvider>,
        progress_callback: Option<ProgressCallback>,
    ) -> Result<IndexResult, ToolError> {
        let start = Instant::now();

        // Reset state
        self.is_running.store(true, Ordering::SeqCst);
        self.files_processed.store(0, Ordering::SeqCst);
        self.chunks_created.store(0, Ordering::SeqCst);

        // Collect files to index
        let files = self.collect_files()?;
        let total_files = files.len() as u32;

        // Report initial progress
        if let Some(ref callback) = progress_callback {
            callback(IndexProgress {
                current_file: None,
                files_processed: 0,
                total_files,
                chunks_created: 0,
                is_complete: false,
                error: None,
            });
        }

        let chunker = CodeChunker::new();
        let project_root = Path::new(&self.config.project_root);

        let mut files_indexed = 0u32;
        let mut files_skipped = 0u32;
        let mut files_errored = 0u32;
        let mut total_chunks = 0u32;

        // Process files (with batching for embeddings)
        const BATCH_SIZE: usize = 10;
        let mut batch_chunks = Vec::new();
        let mut batch_contents = Vec::new();

        for file in files {
            if !self.is_running.load(Ordering::SeqCst) {
                break;
            }

            // Report progress
            if let Some(ref callback) = progress_callback {
                callback(IndexProgress {
                    current_file: Some(file.relative_path.clone()),
                    files_processed: self.files_processed.load(Ordering::SeqCst),
                    total_files,
                    chunks_created: self.chunks_created.load(Ordering::SeqCst),
                    is_complete: false,
                    error: None,
                });
            }

            // Read file
            let content = match tokio::fs::read_to_string(&file.path).await {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!("Failed to read {}: {}", file.relative_path, e);
                    files_errored += 1;
                    continue;
                }
            };

            // Check if file has changed
            let hash = Self::compute_hash(&content);
            {
                let store_lock = store.lock().await;
                if let Ok(Some(stored_hash)) = store_lock.get_file_hash(&file.path.to_string_lossy()) {
                    if stored_hash == hash {
                        files_skipped += 1;
                        self.files_processed.fetch_add(1, Ordering::SeqCst);
                        continue;
                    }
                }
            }

            // Delete existing chunks for this file
            {
                let store_lock = store.lock().await;
                let _ = store_lock.delete_by_file(&file.path.to_string_lossy());
            }

            // Chunk the file
            let chunks = match chunker.chunk_file(&file.path, &content, project_root) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!("Failed to chunk {}: {}", file.relative_path, e);
                    files_errored += 1;
                    continue;
                }
            };

            // Add to batch
            for chunk in chunks {
                batch_contents.push(chunk.content.clone());
                batch_chunks.push(chunk);
            }

            // Process batch if full
            if batch_chunks.len() >= BATCH_SIZE {
                let chunk_count = self.process_batch(
                    &store,
                    &embedding_provider,
                    &mut batch_chunks,
                    &mut batch_contents,
                ).await?;
                total_chunks += chunk_count;
                self.chunks_created.fetch_add(chunk_count, Ordering::SeqCst);
            }

            // Update file hash
            {
                let store_lock = store.lock().await;
                store_lock.set_file_hash(&file.path.to_string_lossy(), &hash)?;
            }

            files_indexed += 1;
            self.files_processed.fetch_add(1, Ordering::SeqCst);
        }

        // Process remaining batch
        if !batch_chunks.is_empty() {
            let chunk_count = self.process_batch(
                &store,
                &embedding_provider,
                &mut batch_chunks,
                &mut batch_contents,
            ).await?;
            total_chunks += chunk_count;
            self.chunks_created.fetch_add(chunk_count, Ordering::SeqCst);
        }

        self.is_running.store(false, Ordering::SeqCst);

        let duration = start.elapsed();
        let result = IndexResult {
            files_indexed,
            files_skipped,
            files_errored,
            total_chunks,
            duration_ms: duration.as_millis() as u64,
        };

        // Report completion
        if let Some(callback) = progress_callback {
            callback(IndexProgress {
                current_file: None,
                files_processed: files_indexed + files_skipped,
                total_files,
                chunks_created: total_chunks,
                is_complete: true,
                error: None,
            });
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.indexer.index_all", duration);

        Ok(result)
    }

    /// Process a batch of chunks.
    async fn process_batch(
        &self,
        store: &Arc<Mutex<VectorStore>>,
        embedding_provider: &Arc<dyn EmbeddingProvider>,
        chunks: &mut Vec<super::types::CodeChunk>,
        contents: &mut Vec<String>,
    ) -> Result<u32, ToolError> {
        if chunks.is_empty() {
            return Ok(0);
        }

        // Generate embeddings
        let embeddings = embedding_provider.embed(contents).await?;

        // Convert to Vec<Vec<f32>>
        let embedding_vecs: Vec<Vec<f32>> = embeddings
            .into_iter()
            .map(|e| e.values)
            .collect();

        // Store in vector store
        {
            let store_lock = store.lock().await;
            store_lock.batch_upsert(chunks, &embedding_vecs)?;
        }

        let count = chunks.len() as u32;

        // Clear batches
        chunks.clear();
        contents.clear();

        Ok(count)
    }

    /// Collect files to index.
    fn collect_files(&self) -> Result<Vec<FileToIndex>, ToolError> {
        let start = Instant::now();

        let project_root = Path::new(&self.config.project_root);
        let mut files = Vec::new();

        for entry in WalkDir::new(project_root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                if e.path() == project_root {
                    return true;
                }
                let relative = e.path().strip_prefix(project_root).unwrap_or(e.path());
                !self.should_exclude(relative)
            })
        {
            let entry = entry.map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to walk directory: {}", e))
            })?;

            if entry.file_type().is_file() {
                let path = entry.path();
                let relative_path = path
                    .strip_prefix(project_root)
                    .unwrap_or(path);

                if self.should_include(relative_path) {
                    files.push(FileToIndex {
                        path: path.to_path_buf(),
                        relative_path: relative_path.to_string_lossy().to_string(),
                    });
                }
            }
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.indexer.collect_files", start.elapsed());

        Ok(files)
    }

    /// Check if a path should be included.
    fn should_include(&self, relative_path: &Path) -> bool {
        self.include_globs.is_match(relative_path)
    }

    /// Check if a path should be excluded.
    fn should_exclude(&self, relative_path: &Path) -> bool {
        // Skip hidden files/directories
        if let Some(name) = relative_path.file_name() {
            if name.to_string_lossy().starts_with('.') {
                return true;
            }
        }

        // Check path components
        for component in relative_path.components() {
            if let std::path::Component::Normal(name) = component {
                if name.to_string_lossy().starts_with('.') {
                    return true;
                }
            }
        }

        // Common exclusions
        if let Some(name) = relative_path.file_name() {
            let name_str = name.to_string_lossy();
            if matches!(
                name_str.as_ref(),
                "node_modules" | "target" | "dist" | "build" | "__pycache__" | "venv"
            ) {
                return true;
            }
        }

        self.exclude_globs.is_match(relative_path)
    }

    /// Compute SHA-256 hash of content.
    fn compute_hash(content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_indexer_new() {
        let config = RAGConfig::default();
        let indexer = RAGIndexer::new(config);
        assert!(indexer.is_ok());
    }

    #[test]
    fn test_compute_hash() {
        let hash1 = RAGIndexer::compute_hash("hello world");
        let hash2 = RAGIndexer::compute_hash("hello world");
        let hash3 = RAGIndexer::compute_hash("different");

        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_should_exclude() {
        let config = RAGConfig::default();
        let indexer = RAGIndexer::new(config).unwrap();

        assert!(indexer.should_exclude(Path::new(".git")));
        assert!(indexer.should_exclude(Path::new("node_modules")));
        assert!(indexer.should_exclude(Path::new("src/.hidden")));
        assert!(!indexer.should_exclude(Path::new("src/main.rs")));
    }

    #[test]
    fn test_should_include() {
        let config = RAGConfig::default();
        let indexer = RAGIndexer::new(config).unwrap();

        assert!(indexer.should_include(Path::new("src/main.rs")));
        assert!(indexer.should_include(Path::new("lib.ts")));
        assert!(indexer.should_include(Path::new("app.py")));
        assert!(!indexer.should_include(Path::new("readme.md")));
    }
}
