// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Symbol index system for code navigation.
//!
//! This module provides a fast, multi-language symbol index using tree-sitter
//! for AST parsing and SQLite for storage. It supports:
//!
//! - **Multi-language support**: TypeScript, JavaScript, Rust, Python, Go
//! - **Symbol extraction**: Functions, classes, structs, enums, interfaces, etc.
//! - **Import tracking**: Import statements with resolution
//! - **Fuzzy search**: Find symbols by name with fuzzy matching
//! - **Incremental updates**: Only re-index changed files
//! - **Background indexing**: Parallel indexing with progress tracking
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                  SymbolIndexService                      │
//! │  (High-level API: build, find_symbols, get_stats, etc.) │
//! └─────────────────────────────────────────────────────────┘
//!                            │
//!          ┌─────────────────┼─────────────────┐
//!          ▼                 ▼                 ▼
//! ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
//! │     Indexer     │ │   Parser    │ │    Database     │
//! │  (Parallel file │ │ (tree-sitter│ │   (SQLite       │
//! │   processing)   │ │   AST)      │ │    storage)     │
//! └─────────────────┘ └─────────────┘ └─────────────────┘
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::symbol_index::{SymbolIndexService, SymbolIndexServiceBuilder};
//!
//! // Create service with defaults
//! let service = SymbolIndexService::new("/path/to/project").await?;
//!
//! // Or use the builder for custom configuration
//! let service = SymbolIndexServiceBuilder::new("/path/to/project")
//!     .include(&["**/*.rs", "**/*.py"])
//!     .exclude(&["**/test/**"])
//!     .parallel_jobs(4)
//!     .build()
//!     .await?;
//!
//! // Build the index
//! let result = service.build(false).await?;
//! println!("Indexed {} files with {} symbols", result.files_indexed, result.total_symbols);
//!
//! // Find symbols
//! let symbols = service.find_symbols("Config", None).await?;
//! for symbol in symbols {
//!     println!("{}:{} - {} ({})", symbol.file, symbol.line, symbol.name, symbol.kind);
//! }
//!
//! // Get statistics
//! let stats = service.get_stats().await?;
//! println!("Index contains {} files and {} symbols", stats.total_files, stats.total_symbols);
//! ```
//!
//! # Telemetry
//!
//! All operations record telemetry metrics when the `telemetry` feature is enabled:
//!
//! - `symbol_index.service.*` - Service-level operations
//! - `symbol_index.indexer.*` - Indexing operations
//! - `symbol_index.parser.*` - Parsing operations
//! - `symbol_index.db.*` - Database operations

pub mod database;
pub mod indexer;
pub mod parser;
pub mod service;
pub mod types;

// Re-export commonly used types
pub use database::{SymbolDatabase, INDEX_VERSION};
pub use indexer::{FileWatcher, IndexProgress, IndexResult, Indexer, ProgressCallback};
pub use parser::{ParseResult, SymbolParser};
pub use service::{SymbolIndexService, SymbolIndexServiceBuilder};
pub use types::{
    CodeSymbol, DependencyDirection, DependencyResult, DependencyType, ExtractionMethod,
    ImportStatement, ImportedSymbol, IndexBuildOptions, IndexStats, IndexedFile, IndexedSymbol,
    Language, ReferenceResult, ReferenceType, SymbolKind, SymbolSearchResult, SymbolVisibility,
};

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_full_workflow() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        // Create some test files
        fs::create_dir(project_root.join("src")).unwrap();

        fs::write(
            project_root.join("src/main.ts"),
            r#"
import { Config } from './config';

export function main() {
    const config = new Config();
    console.log(config.toString());
}

export class App {
    private config: Config;

    constructor() {
        this.config = new Config();
    }

    run(): void {
        main();
    }
}
"#,
        )
        .unwrap();

        fs::write(
            project_root.join("src/config.ts"),
            r#"
export interface ConfigOptions {
    name: string;
    debug: boolean;
}

export class Config {
    private options: ConfigOptions;

    constructor(options?: Partial<ConfigOptions>) {
        this.options = {
            name: 'default',
            debug: false,
            ...options,
        };
    }

    toString(): string {
        return JSON.stringify(this.options);
    }
}

export const DEFAULT_CONFIG: ConfigOptions = {
    name: 'default',
    debug: false,
};
"#,
        )
        .unwrap();

        // Create service and build index
        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        let result = service.build(false).await.unwrap();

        // Verify indexing results
        assert_eq!(result.files_indexed, 2);
        assert!(result.total_symbols >= 6); // main, App, Config, ConfigOptions, toString, DEFAULT_CONFIG
        assert!(result.total_imports >= 1); // import from ./config

        // Test symbol search
        let configs = service.find_symbols("Config", None).await.unwrap();
        assert!(!configs.is_empty());
        assert!(configs.iter().any(|s| s.name == "Config"));

        // Test find by kind
        let classes = service
            .find_symbols_by_kind(SymbolKind::Class, None)
            .await
            .unwrap();
        assert!(!classes.is_empty());

        // Test get definition
        let def = service.get_definition("App").await.unwrap();
        assert!(def.is_some());
        assert_eq!(def.unwrap().kind, SymbolKind::Class);

        // Test stats
        let stats = service.get_stats().await.unwrap();
        assert_eq!(stats.total_files, 2);
        assert!(stats.total_symbols >= 6);

        // Test incremental update - modify a file
        fs::write(
            project_root.join("src/main.ts"),
            r#"
import { Config } from './config';

export function main() {
    console.log('Hello');
}

export function newFunction() {
    return 42;
}
"#,
        )
        .unwrap();

        let result2 = service.build(false).await.unwrap();
        assert_eq!(result2.files_indexed, 1); // Only main.ts changed
        assert_eq!(result2.files_skipped, 1); // config.ts unchanged

        // Verify new function is indexed
        let new_fn = service.find_symbols("newFunction", None).await.unwrap();
        assert_eq!(new_fn.len(), 1);
    }

    #[tokio::test]
    async fn test_multi_language() {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        // Create files in different languages
        fs::write(project_root.join("main.ts"), "export function ts_func() {}").unwrap();
        fs::write(project_root.join("lib.rs"), "pub fn rust_func() {}").unwrap();
        fs::write(project_root.join("utils.py"), "def python_func():\n    pass").unwrap();
        fs::write(project_root.join("helper.go"), "package main\nfunc GoFunc() {}").unwrap();

        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();

        let result = service.build(false).await.unwrap();

        // All files should be indexed
        assert_eq!(result.files_indexed, 4);

        // Each function should be findable
        let ts = service.find_symbols("ts_func", None).await.unwrap();
        assert_eq!(ts.len(), 1);

        let rust = service.find_symbols("rust_func", None).await.unwrap();
        assert_eq!(rust.len(), 1);

        let python = service.find_symbols("python_func", None).await.unwrap();
        assert_eq!(python.len(), 1);

        let go = service.find_symbols("GoFunc", None).await.unwrap();
        assert_eq!(go.len(), 1);
    }
}
