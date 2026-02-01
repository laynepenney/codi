// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! High-level symbol index service.
//!
//! Provides a unified API for building, querying, and maintaining the symbol index.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::database::SymbolDatabase;
use super::indexer::{IndexResult, Indexer, ProgressCallback};
use super::types::{
    DependencyDirection, DependencyResult, IndexBuildOptions,
    IndexStats, ReferenceResult, ReferenceType, SymbolKind, SymbolSearchResult,
};

/// Symbol index service providing a high-level API.
pub struct SymbolIndexService {
    db: Arc<Mutex<SymbolDatabase>>,
    indexer: Arc<Indexer>,
    project_root: String,
}

impl SymbolIndexService {
    /// Create a new symbol index service.
    pub async fn new(project_root: &str) -> Result<Self, ToolError> {
        let start = Instant::now();

        let options = IndexBuildOptions {
            project_root: project_root.to_string(),
            ..Default::default()
        };

        let db = SymbolDatabase::open(project_root)?;
        let indexer = Indexer::new(options)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.new", start.elapsed());

        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            indexer: Arc::new(indexer),
            project_root: project_root.to_string(),
        })
    }

    /// Create a new symbol index service with custom options.
    pub async fn with_options(options: IndexBuildOptions) -> Result<Self, ToolError> {
        let start = Instant::now();

        let db = SymbolDatabase::open(&options.project_root)?;
        let indexer = Indexer::new(options.clone())?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.with_options", start.elapsed());

        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            indexer: Arc::new(indexer),
            project_root: options.project_root,
        })
    }

    /// Get the project root.
    pub fn project_root(&self) -> &str {
        &self.project_root
    }

    /// Build or rebuild the symbol index.
    pub async fn build(&self, force: bool) -> Result<IndexResult, ToolError> {
        self.build_with_progress(force, None).await
    }

    /// Build or rebuild the symbol index with progress callback.
    pub async fn build_with_progress(
        &self,
        force: bool,
        progress: Option<ProgressCallback>,
    ) -> Result<IndexResult, ToolError> {
        let start = Instant::now();

        // Create a new indexer with force_rebuild if needed
        let options = IndexBuildOptions {
            project_root: self.project_root.clone(),
            force_rebuild: force,
            ..Default::default()
        };

        let indexer = Indexer::new(options)?;
        let result = indexer.index_all(self.db.clone(), progress).await?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.build", start.elapsed());

        Ok(result)
    }

    /// Perform incremental update for specific files.
    pub async fn update_files(&self, files: &[PathBuf]) -> Result<IndexResult, ToolError> {
        let start = Instant::now();

        let result = self.indexer.index_files(self.db.clone(), files).await?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.update_files", start.elapsed());

        Ok(result)
    }

    /// Find symbols by name (fuzzy search).
    pub async fn find_symbols(
        &self,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<SymbolSearchResult>, ToolError> {
        let start = Instant::now();

        let db = self.db.lock().await;
        let results = db.find_symbols(query, limit.unwrap_or(20))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.find_symbols", start.elapsed());

        Ok(results)
    }

    /// Find symbols by kind.
    pub async fn find_symbols_by_kind(
        &self,
        kind: SymbolKind,
        limit: Option<usize>,
    ) -> Result<Vec<SymbolSearchResult>, ToolError> {
        let start = Instant::now();

        // Use the kind string as a search prefix
        let db = self.db.lock().await;
        let all_results = db.find_symbols("", limit.unwrap_or(1000))?;

        let filtered: Vec<_> = all_results
            .into_iter()
            .filter(|s| s.kind == kind)
            .take(limit.unwrap_or(20))
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.find_symbols_by_kind", start.elapsed());

        Ok(filtered)
    }

    /// Find symbols in a specific file.
    pub async fn find_symbols_in_file(
        &self,
        file_path: &str,
    ) -> Result<Vec<SymbolSearchResult>, ToolError> {
        let start = Instant::now();

        let db = self.db.lock().await;

        // Search for symbols and filter by file
        let all_results = db.find_symbols("", 10000)?;
        let filtered: Vec<_> = all_results
            .into_iter()
            .filter(|s| s.file == file_path)
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.find_symbols_in_file", start.elapsed());

        Ok(filtered)
    }

    /// Find references to a symbol.
    pub async fn find_references(
        &self,
        symbol_name: &str,
        include_definition: bool,
    ) -> Result<Vec<ReferenceResult>, ToolError> {
        let start = Instant::now();

        let mut results = Vec::new();

        // First find the symbol definition
        let db = self.db.lock().await;
        let symbols = db.find_symbols(symbol_name, 1)?;

        if let Some(def_symbol) = symbols.first() {
            if include_definition {
                results.push(ReferenceResult {
                    file: def_symbol.file.clone(),
                    line: def_symbol.line,
                    reference_type: ReferenceType::Definition,
                    context: def_symbol.signature.clone(),
                });
            }

            // TODO: Implement usage detection by:
            // 1. Finding all imports that reference the symbol
            // 2. Searching for usages in code (would need full text search)
            // For now, we return just the definition
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.find_references", start.elapsed());

        Ok(results)
    }

    /// Get the dependency graph for a file.
    pub async fn get_dependencies(
        &self,
        _file_path: &str,
        _direction: DependencyDirection,
        _max_depth: Option<u32>,
    ) -> Result<Vec<DependencyResult>, ToolError> {
        let start = Instant::now();

        let results = Vec::new();

        // TODO: Implement dependency graph traversal
        // This requires:
        // 1. Getting imports from the file
        // 2. Resolving import paths to actual files
        // 3. Recursively following the graph

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.get_dependencies", start.elapsed());

        Ok(results)
    }

    /// Get index statistics.
    pub async fn get_stats(&self) -> Result<IndexStats, ToolError> {
        let start = Instant::now();

        let db = self.db.lock().await;
        let stats = db.get_stats()?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.get_stats", start.elapsed());

        Ok(stats)
    }

    /// Clear the entire index.
    pub async fn clear(&self) -> Result<(), ToolError> {
        let start = Instant::now();

        let db = self.db.lock().await;
        db.clear()?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.clear", start.elapsed());

        Ok(())
    }

    /// Check if the index is empty.
    pub async fn is_empty(&self) -> Result<bool, ToolError> {
        let stats = self.get_stats().await?;
        Ok(stats.total_files == 0)
    }

    /// Get a symbol's definition location.
    pub async fn get_definition(
        &self,
        symbol_name: &str,
    ) -> Result<Option<SymbolSearchResult>, ToolError> {
        let start = Instant::now();

        let db = self.db.lock().await;
        let results = db.find_symbols(symbol_name, 10)?;

        // Find exact match
        let exact_match = results
            .into_iter()
            .find(|s| s.name == symbol_name);

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.get_definition", start.elapsed());

        Ok(exact_match)
    }

    /// Search for files containing a symbol name.
    pub async fn search_files(&self, query: &str) -> Result<Vec<String>, ToolError> {
        let start = Instant::now();

        let results = self.find_symbols(query, Some(100)).await?;
        let mut files: Vec<String> = results.into_iter().map(|s| s.file).collect();
        files.sort();
        files.dedup();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.search_files", start.elapsed());

        Ok(files)
    }

    /// Get all symbols exported from a file.
    pub async fn get_exports(&self, file_path: &str) -> Result<Vec<SymbolSearchResult>, ToolError> {
        let start = Instant::now();

        let symbols = self.find_symbols_in_file(file_path).await?;
        let exports: Vec<_> = symbols
            .into_iter()
            .filter(|s| {
                matches!(
                    s.visibility,
                    super::types::SymbolVisibility::Public
                )
            })
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.service.get_exports", start.elapsed());

        Ok(exports)
    }

    /// Check if indexing is currently in progress.
    pub fn is_indexing(&self) -> bool {
        self.indexer.is_running()
    }

    /// Get current indexing progress.
    pub fn get_indexing_progress(&self) -> (u32, u32) {
        self.indexer.get_progress()
    }

    /// Cancel any running indexing operation.
    pub fn cancel_indexing(&self) {
        self.indexer.cancel();
    }
}

/// Builder for SymbolIndexService with fluent API.
pub struct SymbolIndexServiceBuilder {
    project_root: String,
    include_patterns: Vec<String>,
    exclude_patterns: Vec<String>,
    parallel_jobs: usize,
    deep_index: bool,
}

impl SymbolIndexServiceBuilder {
    /// Create a new builder.
    pub fn new(project_root: &str) -> Self {
        let defaults = IndexBuildOptions::default();
        Self {
            project_root: project_root.to_string(),
            include_patterns: defaults.include_patterns,
            exclude_patterns: defaults.exclude_patterns,
            parallel_jobs: defaults.parallel_jobs,
            deep_index: defaults.deep_index,
        }
    }

    /// Add include patterns.
    pub fn include(mut self, patterns: &[&str]) -> Self {
        self.include_patterns
            .extend(patterns.iter().map(|s| s.to_string()));
        self
    }

    /// Add exclude patterns.
    pub fn exclude(mut self, patterns: &[&str]) -> Self {
        self.exclude_patterns
            .extend(patterns.iter().map(|s| s.to_string()));
        self
    }

    /// Set number of parallel indexing jobs.
    pub fn parallel_jobs(mut self, jobs: usize) -> Self {
        self.parallel_jobs = jobs;
        self
    }

    /// Enable deep indexing (usage-based dependency detection).
    pub fn deep_index(mut self, enabled: bool) -> Self {
        self.deep_index = enabled;
        self
    }

    /// Build the service.
    pub async fn build(self) -> Result<SymbolIndexService, ToolError> {
        let options = IndexBuildOptions {
            project_root: self.project_root,
            include_patterns: self.include_patterns,
            exclude_patterns: self.exclude_patterns,
            force_rebuild: false,
            deep_index: self.deep_index,
            parallel_jobs: self.parallel_jobs,
        };

        SymbolIndexService::with_options(options).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_service_new() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let service = SymbolIndexService::new(project_root).await;
        assert!(service.is_ok());
    }

    #[tokio::test]
    async fn test_service_build() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        // Create test file
        fs::write(
            project_root.join("main.ts"),
            r#"
            export function greet(name: string): string {
                return `Hello, ${name}!`;
            }

            export class Greeter {
                private name: string;

                constructor(name: string) {
                    this.name = name;
                }

                greet(): string {
                    return greet(this.name);
                }
            }
            "#,
        ).unwrap();

        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        // Build index
        let result = service.build(false).await.unwrap();
        assert_eq!(result.files_indexed, 1);
        assert!(result.total_symbols >= 2);

        // Check stats
        let stats = service.get_stats().await.unwrap();
        assert_eq!(stats.total_files, 1);
        assert!(stats.total_symbols >= 2);
    }

    #[tokio::test]
    async fn test_find_symbols() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        fs::write(
            project_root.join("lib.rs"),
            r#"
            pub fn hello() -> String {
                "Hello".to_string()
            }

            pub fn world() -> String {
                "World".to_string()
            }
            "#,
        ).unwrap();

        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        service.build(false).await.unwrap();

        // Search for symbols
        let results = service.find_symbols("hello", None).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "hello");

        let results = service.find_symbols("world", None).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "world");
    }

    #[tokio::test]
    async fn test_find_symbols_in_file() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        fs::write(
            project_root.join("module.py"),
            r#"
def foo():
    pass

def bar():
    pass

class Baz:
    pass
            "#,
        ).unwrap();

        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        service.build(false).await.unwrap();

        let results = service.find_symbols_in_file("module.py").await.unwrap();
        assert!(results.len() >= 3);

        let names: Vec<&str> = results.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"foo"));
        assert!(names.contains(&"bar"));
        assert!(names.contains(&"Baz"));
    }

    #[tokio::test]
    async fn test_get_definition() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        fs::write(
            project_root.join("main.go"),
            r#"
package main

func Main() {
}

func helper() {
}
            "#,
        ).unwrap();

        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        service.build(false).await.unwrap();

        let def = service.get_definition("Main").await.unwrap();
        assert!(def.is_some());
        assert_eq!(def.unwrap().name, "Main");

        let def = service.get_definition("nonexistent").await.unwrap();
        assert!(def.is_none());
    }

    #[tokio::test]
    async fn test_clear_index() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        fs::write(project_root.join("test.ts"), "const x = 1;").unwrap();

        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        service.build(false).await.unwrap();

        let stats = service.get_stats().await.unwrap();
        assert_eq!(stats.total_files, 1);

        service.clear().await.unwrap();

        let stats = service.get_stats().await.unwrap();
        assert_eq!(stats.total_files, 0);
    }

    #[tokio::test]
    async fn test_builder() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let service = SymbolIndexServiceBuilder::new(project_root)
            .include(&["**/*.rs", "**/*.py"])
            .exclude(&["**/test/**"])
            .parallel_jobs(2)
            .deep_index(true)
            .build()
            .await;

        assert!(service.is_ok());
    }

    #[tokio::test]
    async fn test_search_files() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        fs::write(
            project_root.join("a.ts"),
            "export function helper() {}",
        ).unwrap();
        fs::write(
            project_root.join("b.ts"),
            "export function helper() {}",
        ).unwrap();

        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        service.build(false).await.unwrap();

        let files = service.search_files("helper").await.unwrap();
        assert_eq!(files.len(), 2);
    }

    #[tokio::test]
    async fn test_is_empty() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let service = SymbolIndexService::new(project_root).await.unwrap();

        assert!(service.is_empty().await.unwrap());

        fs::write(
            temp.path().join("test.ts"),
            "const x = 1;",
        ).unwrap();

        service.build(false).await.unwrap();

        assert!(!service.is_empty().await.unwrap());
    }
}
