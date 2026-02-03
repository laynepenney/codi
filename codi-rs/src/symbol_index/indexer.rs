// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Background indexer for the symbol index.
//!
//! Provides parallel file indexing using tokio tasks and incremental updates.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Instant;

use globset::{Glob, GlobSet, GlobSetBuilder};
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, Mutex};
use walkdir::WalkDir;

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::database::SymbolDatabase;
use super::parser::SymbolParser;
use super::types::{IndexBuildOptions, Language};

/// Progress callback for indexing operations.
pub type ProgressCallback = Box<dyn Fn(IndexProgress) + Send + Sync>;

/// Indexing progress update.
#[derive(Debug, Clone)]
pub struct IndexProgress {
    /// Current file being processed.
    pub current_file: Option<String>,
    /// Number of files processed.
    pub files_processed: u32,
    /// Total number of files to process.
    pub total_files: u32,
    /// Number of symbols extracted.
    pub symbols_extracted: u32,
    /// Whether indexing is complete.
    pub is_complete: bool,
    /// Error message if any.
    pub error: Option<String>,
}

/// Result of an indexing operation.
#[derive(Debug, Clone)]
pub struct IndexResult {
    /// Number of files indexed.
    pub files_indexed: u32,
    /// Number of files skipped (unchanged).
    pub files_skipped: u32,
    /// Number of files with errors.
    pub files_errored: u32,
    /// Total symbols extracted.
    pub total_symbols: u32,
    /// Total imports extracted.
    pub total_imports: u32,
    /// Indexing duration in milliseconds.
    pub duration_ms: u64,
}

/// File to be indexed.
#[derive(Debug, Clone)]
struct FileToIndex {
    path: PathBuf,
    relative_path: String,
}

/// Background indexer for symbol extraction.
pub struct Indexer {
    options: IndexBuildOptions,
    include_globs: GlobSet,
    exclude_globs: GlobSet,
    is_running: Arc<AtomicBool>,
    files_processed: Arc<AtomicU32>,
    symbols_extracted: Arc<AtomicU32>,
}

impl Indexer {
    /// Create a new indexer with the given options.
    pub fn new(options: IndexBuildOptions) -> Result<Self, ToolError> {
        let start = Instant::now();

        let include_globs = Self::build_globset(&options.include_patterns)?;
        let exclude_globs = Self::build_globset(&options.exclude_patterns)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.indexer.new", start.elapsed());

        Ok(Self {
            options,
            include_globs,
            exclude_globs,
            is_running: Arc::new(AtomicBool::new(false)),
            files_processed: Arc::new(AtomicU32::new(0)),
            symbols_extracted: Arc::new(AtomicU32::new(0)),
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

    /// Check if indexing is currently running.
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }

    /// Get current progress.
    pub fn get_progress(&self) -> (u32, u32) {
        (
            self.files_processed.load(Ordering::SeqCst),
            self.symbols_extracted.load(Ordering::SeqCst),
        )
    }

    /// Cancel the current indexing operation.
    pub fn cancel(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    /// Index all files in the project.
    pub async fn index_all(
        &self,
        db: Arc<Mutex<SymbolDatabase>>,
        progress_callback: Option<ProgressCallback>,
    ) -> Result<IndexResult, ToolError> {
        let start = Instant::now();

        // Reset state
        self.is_running.store(true, Ordering::SeqCst);
        self.files_processed.store(0, Ordering::SeqCst);
        self.symbols_extracted.store(0, Ordering::SeqCst);

        // Collect files to index
        let files = self.collect_files()?;
        let total_files = files.len() as u32;

        // Report initial progress
        if let Some(ref callback) = progress_callback {
            callback(IndexProgress {
                current_file: None,
                files_processed: 0,
                total_files,
                symbols_extracted: 0,
                is_complete: false,
                error: None,
            });
        }

        // Clear index if force rebuild
        if self.options.force_rebuild {
            let db_lock = db.lock().await;
            db_lock.clear()?;
        }

        // Create work channel
        let (tx, rx) = mpsc::channel::<FileToIndex>(self.options.parallel_jobs * 2);
        let rx = Arc::new(Mutex::new(rx));

        // Shared result counters
        let files_indexed = Arc::new(AtomicU32::new(0));
        let files_skipped = Arc::new(AtomicU32::new(0));
        let files_errored = Arc::new(AtomicU32::new(0));
        let total_symbols = Arc::new(AtomicU32::new(0));
        let total_imports = Arc::new(AtomicU32::new(0));

        // Spawn worker tasks
        let mut handles = Vec::new();
        for _ in 0..self.options.parallel_jobs {
            let rx_clone = rx.clone();
            let db_clone = db.clone();
            let is_running = self.is_running.clone();
            let files_processed = self.files_processed.clone();
            let symbols_extracted = self.symbols_extracted.clone();
            let files_indexed_clone = files_indexed.clone();
            let files_skipped_clone = files_skipped.clone();
            let files_errored_clone = files_errored.clone();
            let total_symbols_clone = total_symbols.clone();
            let total_imports_clone = total_imports.clone();
            let force_rebuild = self.options.force_rebuild;
            let _progress_callback = progress_callback.as_ref().map(|_| {
                // We can't clone the callback, so we use a channel instead
                ()
            });

            let handle = tokio::spawn(async move {
                // Create parser for this worker
                let mut parser = match SymbolParser::new() {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!("Failed to create parser: {}", e);
                        return;
                    }
                };

                loop {
                    if !is_running.load(Ordering::SeqCst) {
                        break;
                    }

                    let file = {
                        let mut rx_lock = rx_clone.lock().await;
                        rx_lock.recv().await
                    };

                    match file {
                        Some(file_info) => {
                            let result = Self::process_file(
                                &file_info,
                                &mut parser,
                                &db_clone,
                                force_rebuild,
                            ).await;

                            match result {
                                Ok((indexed, symbol_count, import_count)) => {
                                    if indexed {
                                        files_indexed_clone.fetch_add(1, Ordering::SeqCst);
                                        total_symbols_clone.fetch_add(symbol_count, Ordering::SeqCst);
                                        total_imports_clone.fetch_add(import_count, Ordering::SeqCst);
                                        symbols_extracted.fetch_add(symbol_count, Ordering::SeqCst);
                                    } else {
                                        files_skipped_clone.fetch_add(1, Ordering::SeqCst);
                                    }
                                }
                                Err(e) => {
                                    files_errored_clone.fetch_add(1, Ordering::SeqCst);
                                    tracing::warn!("Error indexing {}: {}", file_info.relative_path, e);
                                }
                            }

                            files_processed.fetch_add(1, Ordering::SeqCst);
                        }
                        None => break,
                    }
                }
            });

            handles.push(handle);
        }

        // Send files to workers
        for file in files {
            if !self.is_running.load(Ordering::SeqCst) {
                break;
            }

            if tx.send(file).await.is_err() {
                break;
            }
        }

        // Drop sender to signal completion
        drop(tx);

        // Wait for all workers to complete
        for handle in handles {
            let _ = handle.await;
        }

        // Mark as complete
        self.is_running.store(false, Ordering::SeqCst);

        // Update database timestamp
        {
            let db_lock = db.lock().await;
            db_lock.touch_update()?;
        }

        let duration = start.elapsed();
        let result = IndexResult {
            files_indexed: files_indexed.load(Ordering::SeqCst),
            files_skipped: files_skipped.load(Ordering::SeqCst),
            files_errored: files_errored.load(Ordering::SeqCst),
            total_symbols: total_symbols.load(Ordering::SeqCst),
            total_imports: total_imports.load(Ordering::SeqCst),
            duration_ms: duration.as_millis() as u64,
        };

        // Report final progress
        if let Some(callback) = progress_callback {
            callback(IndexProgress {
                current_file: None,
                files_processed: result.files_indexed + result.files_skipped,
                total_files,
                symbols_extracted: result.total_symbols,
                is_complete: true,
                error: None,
            });
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.indexer.index_all", duration);

        Ok(result)
    }

    /// Index specific files (for incremental updates).
    pub async fn index_files(
        &self,
        db: Arc<Mutex<SymbolDatabase>>,
        files: &[PathBuf],
    ) -> Result<IndexResult, ToolError> {
        let start = Instant::now();

        let project_root = Path::new(&self.options.project_root);
        let mut parser = SymbolParser::new()?;

        let mut files_indexed = 0u32;
        let mut files_skipped = 0u32;
        let mut files_errored = 0u32;
        let mut total_symbols = 0u32;
        let mut total_imports = 0u32;

        for path in files {
            let relative_path = path
                .strip_prefix(project_root)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();

            let file_info = FileToIndex {
                path: path.clone(),
                relative_path,
            };

            match Self::process_file(&file_info, &mut parser, &db, false).await {
                Ok((indexed, symbol_count, import_count)) => {
                    if indexed {
                        files_indexed += 1;
                        total_symbols += symbol_count;
                        total_imports += import_count;
                    } else {
                        files_skipped += 1;
                    }
                }
                Err(e) => {
                    files_errored += 1;
                    tracing::warn!("Error indexing {}: {}", file_info.relative_path, e);
                }
            }
        }

        // Update database timestamp
        {
            let db_lock = db.lock().await;
            db_lock.touch_update()?;
        }

        let duration = start.elapsed();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.indexer.index_files", duration);

        Ok(IndexResult {
            files_indexed,
            files_skipped,
            files_errored,
            total_symbols,
            total_imports,
            duration_ms: duration.as_millis() as u64,
        })
    }

    /// Process a single file.
    async fn process_file(
        file_info: &FileToIndex,
        parser: &mut SymbolParser,
        db: &Arc<Mutex<SymbolDatabase>>,
        force: bool,
    ) -> Result<(bool, u32, u32), ToolError> {
        let start = Instant::now();

        // Read file content
        let content = tokio::fs::read_to_string(&file_info.path).await.map_err(|e| {
            ToolError::ExecutionFailed(format!(
                "Failed to read file {}: {}",
                file_info.path.display(),
                e
            ))
        })?;

        // Calculate hash
        let hash = {
            let mut hasher = Sha256::new();
            hasher.update(content.as_bytes());
            format!("{:x}", hasher.finalize())
        };

        // Check if file has changed
        if !force {
            let db_lock = db.lock().await;
            if let Some(existing) = db_lock.get_file(&file_info.relative_path)? {
                if existing.hash == hash {
                    #[cfg(feature = "telemetry")]
                    GLOBAL_METRICS.record_operation("symbol_index.indexer.skip_file", start.elapsed());
                    return Ok((false, 0, 0));
                }
            }
        }

        // Parse file
        let parse_result = parser.parse_file(&file_info.path, &content)?;

        // Store in database
        let db_lock = db.lock().await;

        let file_id = db_lock.upsert_file(
            &file_info.relative_path,
            &parse_result.hash,
            parse_result.method,
        )?;

        db_lock.insert_symbols(file_id, &parse_result.symbols)?;
        db_lock.insert_imports(file_id, &parse_result.imports)?;

        let symbol_count = parse_result.symbols.len() as u32;
        let import_count = parse_result.imports.len() as u32;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.indexer.process_file", start.elapsed());

        Ok((true, symbol_count, import_count))
    }

    /// Collect all files to index.
    fn collect_files(&self) -> Result<Vec<FileToIndex>, ToolError> {
        let start = Instant::now();

        let project_root = Path::new(&self.options.project_root);
        let mut files = Vec::new();

        for entry in WalkDir::new(project_root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // Don't exclude the root directory itself
                if e.path() == project_root {
                    return true;
                }
                // Get the relative path for exclusion check
                let relative = e.path().strip_prefix(project_root).unwrap_or(e.path());
                let excluded = self.should_exclude_relative(relative);
                !excluded
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

                // Check if file matches include patterns (use relative path for matching)
                if self.should_include_relative(relative_path) {
                    files.push(FileToIndex {
                        path: path.to_path_buf(),
                        relative_path: relative_path.to_string_lossy().to_string(),
                    });
                }
            }
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.indexer.collect_files", start.elapsed());

        Ok(files)
    }

    /// Check if a relative path should be included.
    fn should_include_relative(&self, relative_path: &Path) -> bool {
        // Check file extension for supported languages
        let ext = relative_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = Language::from_extension(ext);
        if matches!(lang, Language::Unknown) {
            return false;
        }

        // Check against include patterns using relative path
        self.include_globs.is_match(relative_path)
    }

    /// Check if a path should be included (legacy, for tests).
    #[allow(dead_code)]
    fn should_include(&self, path: &Path) -> bool {
        self.should_include_relative(path)
    }

    /// Check if a relative path should be excluded.
    fn should_exclude_relative(&self, relative_path: &Path) -> bool {
        // Skip hidden files/directories (those starting with .)
        if let Some(name) = relative_path.file_name() {
            if name.to_string_lossy().starts_with('.') {
                return true;
            }
        }

        // Also check each path component for hidden directories
        for component in relative_path.components() {
            if let std::path::Component::Normal(name) = component {
                if name.to_string_lossy().starts_with('.') {
                    return true;
                }
            }
        }

        // Check against exclude patterns - try matching with filename for common dirs
        if let Some(name) = relative_path.file_name() {
            let name_str = name.to_string_lossy();
            // Common directories to exclude
            if matches!(
                name_str.as_ref(),
                "node_modules" | "target" | "dist" | "build" | "__pycache__" | "venv"
            ) {
                return true;
            }
        }

        // Check against exclude patterns
        self.exclude_globs.is_match(relative_path)
    }

    /// Check if a path should be excluded (legacy, for tests).
    #[allow(dead_code)]
    fn should_exclude(&self, path: &Path) -> bool {
        self.should_exclude_relative(path)
    }

    /// Remove deleted files from the index.
    pub async fn cleanup_deleted(
        &self,
        db: Arc<Mutex<SymbolDatabase>>,
    ) -> Result<u32, ToolError> {
        let start = Instant::now();

        let _project_root = Path::new(&self.options.project_root);
        let _db_lock = db.lock().await;

        // Get all indexed files
        // Note: We'd need to add a method to get all files from db
        // For now, this is a placeholder
        let deleted_count = 0u32;

        // TODO: Implement file cleanup
        // 1. Get all indexed file paths from database
        // 2. Check which ones no longer exist on disk
        // 3. Delete those from the database

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.indexer.cleanup_deleted", start.elapsed());

        Ok(deleted_count)
    }
}

/// Watch for file changes and trigger incremental indexing.
pub struct FileWatcher {
    _project_root: PathBuf,
    _indexer: Arc<Indexer>,
    _db: Arc<Mutex<SymbolDatabase>>,
    is_running: Arc<AtomicBool>,
}

impl FileWatcher {
    /// Create a new file watcher.
    pub fn new(
        project_root: PathBuf,
        indexer: Arc<Indexer>,
        db: Arc<Mutex<SymbolDatabase>>,
    ) -> Self {
        Self {
            _project_root: project_root,
            _indexer: indexer,
            _db: db,
            is_running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start watching for file changes.
    pub async fn start(&self) -> Result<(), ToolError> {
        let start = Instant::now();

        self.is_running.store(true, Ordering::SeqCst);

        // Note: Full file watching would require the `notify` crate
        // For now, this is a stub that could be expanded

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.watcher.start", start.elapsed());

        Ok(())
    }

    /// Stop watching for file changes.
    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    /// Check if watcher is running.
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs;

    #[tokio::test]
    async fn test_indexer_new() {
        let options = IndexBuildOptions::default();
        let indexer = Indexer::new(options);
        assert!(indexer.is_ok());
    }

    #[tokio::test]
    async fn test_collect_files() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        // Create test files
        fs::write(project_root.join("main.ts"), "const x = 1;").unwrap();
        fs::write(project_root.join("lib.rs"), "fn main() {}").unwrap();
        fs::create_dir(project_root.join("node_modules")).unwrap();
        fs::write(project_root.join("node_modules/pkg.js"), "// pkg").unwrap();

        let options = IndexBuildOptions {
            project_root: project_root.to_string_lossy().to_string(),
            ..Default::default()
        };

        let indexer = Indexer::new(options.clone()).unwrap();
        let files = indexer.collect_files().unwrap();

        // Should include main.ts and lib.rs, but not node_modules
        assert_eq!(files.len(), 2);
        let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();
        assert!(paths.contains(&"main.ts"));
        assert!(paths.contains(&"lib.rs"));
    }

    #[tokio::test]
    async fn test_index_all() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        // Create test files
        fs::write(
            project_root.join("main.ts"),
            r#"
            export function hello() {
                return "hello";
            }

            export class Greeter {
                greet() {}
            }
            "#,
        ).unwrap();

        fs::write(
            project_root.join("lib.rs"),
            r#"
            pub fn greet() -> String {
                "hello".to_string()
            }

            pub struct Config {
                name: String,
            }
            "#,
        ).unwrap();

        let options = IndexBuildOptions {
            project_root: project_root.to_string_lossy().to_string(),
            parallel_jobs: 2,
            ..Default::default()
        };

        let indexer = Arc::new(Indexer::new(options.clone()).unwrap());
        let db = Arc::new(Mutex::new(
            SymbolDatabase::open(&options.project_root).unwrap()
        ));

        let result = indexer.index_all(db.clone(), None).await.unwrap();

        assert_eq!(result.files_indexed, 2);
        assert!(result.total_symbols >= 4); // At least hello, Greeter, greet, Config
        assert_eq!(result.files_errored, 0);
    }

    #[tokio::test]
    async fn test_incremental_indexing() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        // Create initial file
        fs::write(project_root.join("main.ts"), "const a = 1;").unwrap();

        let options = IndexBuildOptions {
            project_root: project_root.to_string_lossy().to_string(),
            parallel_jobs: 1,
            ..Default::default()
        };

        let indexer = Arc::new(Indexer::new(options.clone()).unwrap());
        let db = Arc::new(Mutex::new(
            SymbolDatabase::open(&options.project_root).unwrap()
        ));

        // First index
        let result1 = indexer.index_all(db.clone(), None).await.unwrap();
        assert_eq!(result1.files_indexed, 1);

        // Second index without changes should skip
        let result2 = indexer.index_all(db.clone(), None).await.unwrap();
        assert_eq!(result2.files_indexed, 0);
        assert_eq!(result2.files_skipped, 1);

        // Modify file
        fs::write(project_root.join("main.ts"), "const b = 2;").unwrap();

        // Third index should re-index the changed file
        let result3 = indexer.index_all(db.clone(), None).await.unwrap();
        assert_eq!(result3.files_indexed, 1);
    }

    #[tokio::test]
    async fn test_force_rebuild() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        fs::write(project_root.join("main.ts"), "const a = 1;").unwrap();

        let options = IndexBuildOptions {
            project_root: project_root.to_string_lossy().to_string(),
            parallel_jobs: 1,
            force_rebuild: false,
            ..Default::default()
        };

        let indexer = Arc::new(Indexer::new(options.clone()).unwrap());
        let db = Arc::new(Mutex::new(
            SymbolDatabase::open(&options.project_root).unwrap()
        ));

        // First index
        indexer.index_all(db.clone(), None).await.unwrap();

        // Create new indexer with force_rebuild
        let options_force = IndexBuildOptions {
            force_rebuild: true,
            ..options
        };
        let indexer_force = Arc::new(Indexer::new(options_force).unwrap());

        // Force rebuild should re-index even unchanged files
        let result = indexer_force.index_all(db.clone(), None).await.unwrap();
        assert_eq!(result.files_indexed, 1);
    }

    #[test]
    fn test_should_exclude() {
        let options = IndexBuildOptions::default();
        let indexer = Indexer::new(options).unwrap();

        assert!(indexer.should_exclude(Path::new(".git/config")));
        assert!(indexer.should_exclude(Path::new("node_modules/pkg")));
        assert!(indexer.should_exclude(Path::new("target/debug")));
        assert!(!indexer.should_exclude(Path::new("src/main.rs")));
    }

    #[test]
    fn test_should_include() {
        let options = IndexBuildOptions::default();
        let indexer = Indexer::new(options).unwrap();

        assert!(indexer.should_include(Path::new("src/main.rs")));
        assert!(indexer.should_include(Path::new("lib/utils.ts")));
        assert!(indexer.should_include(Path::new("tests/test.py")));
        assert!(!indexer.should_include(Path::new("README.md")));
        assert!(!indexer.should_include(Path::new("data.json")));
    }
}
