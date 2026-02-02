// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Diagnostic cache with version-tracked storage.
//!
//! This module provides a thread-safe cache for LSP diagnostics with
//! version tracking to optimize UI updates and avoid unnecessary recomputation.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use super::types::{Diagnostic, DiagnosticCounts, DiagnosticSeverity};

/// Thread-safe diagnostic cache with version tracking.
///
/// The cache tracks a version number that increments on any modification,
/// allowing consumers to efficiently detect changes without comparing contents.
pub struct DiagnosticCache {
    /// Diagnostics by file URI.
    diagnostics: RwLock<HashMap<String, Vec<Diagnostic>>>,
    /// Version counter (increments on any change).
    version: AtomicU64,
    /// Cached diagnostic counts.
    counts_cache: RwLock<Option<(u64, DiagnosticCounts)>>,
}

impl Default for DiagnosticCache {
    fn default() -> Self {
        Self::new()
    }
}

impl DiagnosticCache {
    /// Create a new empty cache.
    pub fn new() -> Self {
        Self {
            diagnostics: RwLock::new(HashMap::new()),
            version: AtomicU64::new(0),
            counts_cache: RwLock::new(None),
        }
    }

    /// Get the current version number.
    ///
    /// The version increments on any modification to the cache.
    pub fn version(&self) -> u64 {
        self.version.load(Ordering::SeqCst)
    }

    /// Set diagnostics for a file URI.
    ///
    /// Replaces all existing diagnostics for the file.
    pub fn set(&self, uri: impl Into<String>, diagnostics: Vec<Diagnostic>) {
        let uri = uri.into();
        let mut map = self.diagnostics.write().unwrap();

        // Only update if actually changed
        let changed = match map.get(&uri) {
            Some(existing) => existing != &diagnostics,
            None => !diagnostics.is_empty(),
        };

        if changed {
            if diagnostics.is_empty() {
                map.remove(&uri);
            } else {
                map.insert(uri, diagnostics);
            }
            self.version.fetch_add(1, Ordering::SeqCst);

            // Invalidate counts cache
            *self.counts_cache.write().unwrap() = None;
        }
    }

    /// Get diagnostics for a file URI.
    pub fn get(&self, uri: &str) -> Vec<Diagnostic> {
        self.diagnostics
            .read()
            .unwrap()
            .get(uri)
            .cloned()
            .unwrap_or_default()
    }

    /// Get all diagnostics.
    pub fn all(&self) -> HashMap<String, Vec<Diagnostic>> {
        self.diagnostics.read().unwrap().clone()
    }

    /// Remove diagnostics for a file URI.
    pub fn remove(&self, uri: &str) {
        let mut map = self.diagnostics.write().unwrap();
        if map.remove(uri).is_some() {
            self.version.fetch_add(1, Ordering::SeqCst);
            *self.counts_cache.write().unwrap() = None;
        }
    }

    /// Clear all diagnostics.
    pub fn clear(&self) {
        let mut map = self.diagnostics.write().unwrap();
        if !map.is_empty() {
            map.clear();
            self.version.fetch_add(1, Ordering::SeqCst);
            *self.counts_cache.write().unwrap() = None;
        }
    }

    /// Get diagnostic counts, using cache when possible.
    ///
    /// The counts are cached and only recomputed when the cache version changes.
    pub fn counts(&self) -> DiagnosticCounts {
        let current_version = self.version();

        // Check cache first
        {
            let cache = self.counts_cache.read().unwrap();
            if let Some((cached_version, ref counts)) = *cache {
                if cached_version == current_version {
                    return counts.clone();
                }
            }
        }

        // Recompute counts
        let counts = self.compute_counts();

        // Update cache
        {
            let mut cache = self.counts_cache.write().unwrap();
            *cache = Some((current_version, counts.clone()));
        }

        counts
    }

    /// Compute diagnostic counts (internal, does not use cache).
    fn compute_counts(&self) -> DiagnosticCounts {
        let mut counts = DiagnosticCounts::new();
        let map = self.diagnostics.read().unwrap();

        for diagnostics in map.values() {
            for diag in diagnostics {
                counts.add(diag.severity);
            }
        }

        counts
    }

    /// Get counts for a specific file.
    pub fn file_counts(&self, uri: &str) -> DiagnosticCounts {
        let mut counts = DiagnosticCounts::new();
        let map = self.diagnostics.read().unwrap();

        if let Some(diagnostics) = map.get(uri) {
            for diag in diagnostics {
                counts.add(diag.severity);
            }
        }

        counts
    }

    /// Check if there are any errors.
    pub fn has_errors(&self) -> bool {
        self.counts().has_errors()
    }

    /// Check if there are any issues (errors or warnings).
    pub fn has_issues(&self) -> bool {
        self.counts().has_issues()
    }

    /// Get diagnostics filtered by severity.
    pub fn by_severity(&self, severity: DiagnosticSeverity) -> Vec<(String, Diagnostic)> {
        let map = self.diagnostics.read().unwrap();
        let mut result = Vec::new();

        for (uri, diagnostics) in map.iter() {
            for diag in diagnostics {
                if diag.severity == severity {
                    result.push((uri.clone(), diag.clone()));
                }
            }
        }

        result
    }

    /// Get all errors.
    pub fn errors(&self) -> Vec<(String, Diagnostic)> {
        self.by_severity(DiagnosticSeverity::Error)
    }

    /// Get all warnings.
    pub fn warnings(&self) -> Vec<(String, Diagnostic)> {
        self.by_severity(DiagnosticSeverity::Warning)
    }

    /// Get the number of files with diagnostics.
    pub fn file_count(&self) -> usize {
        self.diagnostics.read().unwrap().len()
    }

    /// Get all file URIs with diagnostics.
    pub fn files(&self) -> Vec<String> {
        self.diagnostics.read().unwrap().keys().cloned().collect()
    }

    /// Iterate over diagnostics (yields (uri, diagnostics) pairs).
    pub fn iter(&self) -> Vec<(String, Vec<Diagnostic>)> {
        self.diagnostics
            .read()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Format diagnostics for display.
    ///
    /// Returns a formatted string suitable for showing to users or AI agents.
    /// Optionally limits the number of diagnostics per severity.
    pub fn format(&self, max_per_severity: Option<usize>) -> String {
        let mut output = Vec::new();
        let counts = self.counts();

        if counts.total() == 0 {
            return "No diagnostics.".to_string();
        }

        output.push(format!("Diagnostics: {}", counts));
        output.push(String::new());

        // Group by severity
        for severity in &[
            DiagnosticSeverity::Error,
            DiagnosticSeverity::Warning,
            DiagnosticSeverity::Information,
            DiagnosticSeverity::Hint,
        ] {
            let items = self.by_severity(*severity);
            if items.is_empty() {
                continue;
            }

            let total = items.len();
            let limit = max_per_severity.unwrap_or(usize::MAX);
            let display_items: Vec<_> = items.into_iter().take(limit).collect();

            output.push(format!("## {} ({})", severity.label(), total));

            for (uri, diag) in &display_items {
                let path = uri.strip_prefix("file://").unwrap_or(uri);
                output.push(format!(
                    "- {}:{}: {}",
                    path,
                    diag.range.start,
                    diag.message
                ));
                if let Some(ref code) = diag.code {
                    output.push(format!("  Code: {}", code));
                }
                if let Some(ref source) = diag.source {
                    output.push(format!("  Source: {}", source));
                }
            }

            if total > limit {
                output.push(format!("  ... and {} more", total - limit));
            }

            output.push(String::new());
        }

        output.join("\n")
    }
}

impl std::fmt::Debug for DiagnosticCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let map = self.diagnostics.read().unwrap();
        f.debug_struct("DiagnosticCache")
            .field("version", &self.version())
            .field("file_count", &map.len())
            .field("counts", &self.counts())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::types::Range;

    fn test_diagnostic(line: u32, severity: DiagnosticSeverity, message: &str) -> Diagnostic {
        Diagnostic::new(
            Range::from_coords(line, 0, line, 10),
            severity,
            message,
        )
    }

    #[test]
    fn test_cache_basic() {
        let cache = DiagnosticCache::new();
        assert_eq!(cache.version(), 0);

        cache.set(
            "file://test.rs",
            vec![test_diagnostic(1, DiagnosticSeverity::Error, "test error")],
        );

        assert_eq!(cache.version(), 1);
        assert_eq!(cache.get("file://test.rs").len(), 1);
        assert_eq!(cache.counts().errors, 1);
    }

    #[test]
    fn test_cache_version_tracking() {
        let cache = DiagnosticCache::new();
        let v0 = cache.version();

        cache.set("file://a.rs", vec![test_diagnostic(1, DiagnosticSeverity::Error, "e1")]);
        let v1 = cache.version();
        assert!(v1 > v0);

        // Setting same diagnostics should not change version
        cache.set("file://a.rs", vec![test_diagnostic(1, DiagnosticSeverity::Error, "e1")]);
        assert_eq!(cache.version(), v1);

        // Different diagnostics should change version
        cache.set("file://a.rs", vec![test_diagnostic(2, DiagnosticSeverity::Error, "e2")]);
        assert!(cache.version() > v1);
    }

    #[test]
    fn test_cache_counts() {
        let cache = DiagnosticCache::new();

        cache.set("file://a.rs", vec![
            test_diagnostic(1, DiagnosticSeverity::Error, "e1"),
            test_diagnostic(2, DiagnosticSeverity::Error, "e2"),
        ]);
        cache.set("file://b.rs", vec![
            test_diagnostic(1, DiagnosticSeverity::Warning, "w1"),
        ]);

        let counts = cache.counts();
        assert_eq!(counts.errors, 2);
        assert_eq!(counts.warnings, 1);
        assert_eq!(counts.total(), 3);
    }

    #[test]
    fn test_cache_file_counts() {
        let cache = DiagnosticCache::new();

        cache.set("file://a.rs", vec![
            test_diagnostic(1, DiagnosticSeverity::Error, "e1"),
            test_diagnostic(2, DiagnosticSeverity::Warning, "w1"),
        ]);
        cache.set("file://b.rs", vec![
            test_diagnostic(1, DiagnosticSeverity::Error, "e2"),
        ]);

        let a_counts = cache.file_counts("file://a.rs");
        assert_eq!(a_counts.errors, 1);
        assert_eq!(a_counts.warnings, 1);

        let b_counts = cache.file_counts("file://b.rs");
        assert_eq!(b_counts.errors, 1);
        assert_eq!(b_counts.warnings, 0);
    }

    #[test]
    fn test_cache_remove() {
        let cache = DiagnosticCache::new();

        cache.set("file://a.rs", vec![test_diagnostic(1, DiagnosticSeverity::Error, "e1")]);
        assert_eq!(cache.file_count(), 1);

        cache.remove("file://a.rs");
        assert_eq!(cache.file_count(), 0);
        assert!(cache.get("file://a.rs").is_empty());
    }

    #[test]
    fn test_cache_clear() {
        let cache = DiagnosticCache::new();

        cache.set("file://a.rs", vec![test_diagnostic(1, DiagnosticSeverity::Error, "e1")]);
        cache.set("file://b.rs", vec![test_diagnostic(1, DiagnosticSeverity::Error, "e2")]);
        assert_eq!(cache.file_count(), 2);

        cache.clear();
        assert_eq!(cache.file_count(), 0);
        assert_eq!(cache.counts().total(), 0);
    }

    #[test]
    fn test_cache_by_severity() {
        let cache = DiagnosticCache::new();

        cache.set("file://a.rs", vec![
            test_diagnostic(1, DiagnosticSeverity::Error, "e1"),
            test_diagnostic(2, DiagnosticSeverity::Warning, "w1"),
        ]);
        cache.set("file://b.rs", vec![
            test_diagnostic(1, DiagnosticSeverity::Error, "e2"),
        ]);

        let errors = cache.errors();
        assert_eq!(errors.len(), 2);

        let warnings = cache.warnings();
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn test_cache_counts_caching() {
        let cache = DiagnosticCache::new();

        cache.set("file://a.rs", vec![test_diagnostic(1, DiagnosticSeverity::Error, "e1")]);

        // First call computes
        let counts1 = cache.counts();
        assert_eq!(counts1.errors, 1);

        // Second call should use cache (same version)
        let counts2 = cache.counts();
        assert_eq!(counts2.errors, 1);

        // After modification, cache should be invalidated
        cache.set("file://b.rs", vec![test_diagnostic(1, DiagnosticSeverity::Error, "e2")]);
        let counts3 = cache.counts();
        assert_eq!(counts3.errors, 2);
    }

    #[test]
    fn test_cache_format() {
        let cache = DiagnosticCache::new();

        cache.set("file://test.rs", vec![
            test_diagnostic(1, DiagnosticSeverity::Error, "missing semicolon")
                .with_code("E0001")
                .with_source("rustc"),
        ]);

        let output = cache.format(None);
        assert!(output.contains("1 errors"));
        assert!(output.contains("missing semicolon"));
        assert!(output.contains("E0001"));
        assert!(output.contains("rustc"));
    }

    #[test]
    fn test_cache_format_empty() {
        let cache = DiagnosticCache::new();
        assert_eq!(cache.format(None), "No diagnostics.");
    }

    #[test]
    fn test_cache_thread_safety() {
        use std::sync::Arc;
        use std::thread;

        let cache = Arc::new(DiagnosticCache::new());
        let mut handles = vec![];

        // Spawn multiple threads that read and write
        for i in 0..10 {
            let cache = Arc::clone(&cache);
            handles.push(thread::spawn(move || {
                for j in 0..100 {
                    cache.set(
                        format!("file://test_{}.rs", i * 100 + j),
                        vec![test_diagnostic(1, DiagnosticSeverity::Error, "error")],
                    );
                    let _ = cache.counts();
                    let _ = cache.get(&format!("file://test_{}.rs", i * 100 + j));
                }
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // Should have diagnostics from all threads
        assert!(cache.file_count() > 0);
    }
}
