// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! LSP (Language Server Protocol) integration for code intelligence.
//!
//! This module provides LSP client functionality for communicating with
//! language servers to get diagnostics, code navigation, and other
//! code intelligence features.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                      LspManager                              │
//! │  (High-level API: start servers, get diagnostics, etc.)     │
//! └─────────────────────────────────────────────────────────────┘
//!                            │
//!          ┌─────────────────┼─────────────────┐
//!          ▼                 ▼                 ▼
//! ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
//! │   LspClient     │ │   Config    │ │ DiagnosticCache │
//! │  (Per-server    │ │ (Server     │ │   (Versioned    │
//! │   connection)   │ │  configs)   │ │    storage)     │
//! └─────────────────┘ └─────────────┘ └─────────────────┘
//! ```
//!
//! # Features
//!
//! - **Multi-language support**: Configure different LSP servers per language
//! - **Diagnostic caching**: Version-tracked diagnostic storage with counts
//! - **Document synchronization**: Open/change/save/close notifications
//! - **Code navigation**: Go to definition, find references
//! - **Symbol search**: Document and workspace symbol queries
//! - **Hover information**: Type information and documentation
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::lsp::{LspClient, LspServerConfig, LspConfig};
//!
//! // Get config with defaults
//! let config = LspConfig::with_defaults();
//!
//! // Find server for a file
//! if let Some(server_config) = config.server_for_extension("rs") {
//!     let client = LspClient::new(server_config.clone(), "/path/to/project");
//!     client.start().await?;
//!
//!     // Open a file
//!     let content = std::fs::read_to_string("src/main.rs")?;
//!     client.did_open("file:///path/to/project/src/main.rs", "rust", 1, &content).await?;
//!
//!     // Get diagnostics
//!     let counts = client.diagnostic_counts();
//!     println!("Diagnostics: {}", counts);
//!
//!     // Go to definition
//!     let locations = client.definition("file:///path/to/project/src/main.rs", 10, 5).await?;
//!     for loc in locations {
//!         println!("Definition at: {}", loc);
//!     }
//! }
//! ```
//!
//! # Configuration
//!
//! LSP servers can be configured via the codi config file:
//!
//! ```yaml
//! lsp:
//!   auto_detect: true
//!   debug: false
//!   servers:
//!     rust-analyzer:
//!       command: /custom/path/rust-analyzer
//!       settings:
//!         rust-analyzer.checkOnSave.command: clippy
//! ```

pub mod client;
pub mod config;
pub mod diagnostics;
pub mod error;
pub mod types;

// Re-export commonly used types
pub use client::LspClient;
pub use config::{
    default_server_configs, language_id_for_extension, LspConfig, LspServerConfig,
};
pub use diagnostics::DiagnosticCache;
pub use error::{error_codes, LspError, LspResult};
pub use types::{
    Diagnostic, DiagnosticCounts, DiagnosticRelatedInformation, DiagnosticSeverity, DiagnosticTag,
    DocumentSymbol, Location, LspSymbolKind, Position, Range, ServerState, TextDocumentInfo,
    WorkspaceSymbol,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        // Verify key types are accessible
        let _ = Position::new(0, 0);
        let _ = Range::default();
        let _ = DiagnosticCounts::new();
        let _ = LspConfig::new();
    }

    #[test]
    fn test_server_config_for_languages() {
        let config = LspConfig::with_defaults();

        // Rust
        let rust = config.server_for_extension("rs");
        assert!(rust.is_some());
        assert_eq!(rust.unwrap().name, "rust-analyzer");

        // TypeScript
        let ts = config.server_for_extension("ts");
        assert!(ts.is_some());
        assert_eq!(ts.unwrap().name, "typescript-language-server");

        // Python
        let py = config.server_for_extension("py");
        assert!(py.is_some());
        assert_eq!(py.unwrap().name, "pyright");

        // Go
        let go = config.server_for_extension("go");
        assert!(go.is_some());
        assert_eq!(go.unwrap().name, "gopls");
    }

    #[test]
    fn test_diagnostic_types() {
        let diag = Diagnostic::new(
            Range::from_coords(10, 0, 10, 5),
            DiagnosticSeverity::Error,
            "test error",
        )
        .with_code("E001")
        .with_source("test");

        assert!(diag.is_error());
        assert_eq!(diag.code, Some("E001".to_string()));
        assert_eq!(diag.source, Some("test".to_string()));
    }

    #[test]
    fn test_diagnostic_cache_workflow() {
        let cache = DiagnosticCache::new();

        // Initially empty
        assert_eq!(cache.counts().total(), 0);

        // Add diagnostics
        cache.set(
            "file:///test.rs",
            vec![
                Diagnostic::new(
                    Range::default(),
                    DiagnosticSeverity::Error,
                    "error 1",
                ),
                Diagnostic::new(
                    Range::default(),
                    DiagnosticSeverity::Warning,
                    "warning 1",
                ),
            ],
        );

        let counts = cache.counts();
        assert_eq!(counts.errors, 1);
        assert_eq!(counts.warnings, 1);

        // Format for display
        let formatted = cache.format(None);
        assert!(formatted.contains("error 1"));
        assert!(formatted.contains("warning 1"));
    }

    #[test]
    fn test_location_display() {
        let loc = Location::new(
            "file:///home/user/project/src/main.rs",
            Range::from_coords(10, 5, 10, 15),
        );

        let display = loc.to_string();
        assert!(display.contains("main.rs"));
        assert!(display.contains("11:6")); // 1-indexed
    }

    #[test]
    fn test_language_id_mapping() {
        assert_eq!(language_id_for_extension("rs"), "rust");
        assert_eq!(language_id_for_extension("ts"), "typescript");
        assert_eq!(language_id_for_extension("tsx"), "typescriptreact");
        assert_eq!(language_id_for_extension("py"), "python");
        assert_eq!(language_id_for_extension("go"), "go");
        assert_eq!(language_id_for_extension("c"), "c");
        assert_eq!(language_id_for_extension("cpp"), "cpp");
    }
}
