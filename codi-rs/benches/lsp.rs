// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for the LSP module.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::path::Path;

use codi::lsp::{
    Diagnostic, DiagnosticCache, DiagnosticCounts, DiagnosticSeverity, LspConfig,
    LspServerConfig, Position, Range,
};

/// Benchmark diagnostic cache operations.
fn bench_diagnostic_cache(c: &mut Criterion) {
    let mut group = c.benchmark_group("lsp_diagnostic_cache");

    // Benchmark cache set
    group.bench_function("set_single", |b| {
        let cache = DiagnosticCache::new();
        let diag = Diagnostic::new(
            Range::from_coords(10, 0, 10, 20),
            DiagnosticSeverity::Error,
            "test error",
        );
        b.iter(|| {
            cache.set(black_box("file:///test.rs"), vec![diag.clone()]);
        });
    });

    // Benchmark cache get
    group.bench_function("get_single", |b| {
        let cache = DiagnosticCache::new();
        cache.set(
            "file:///test.rs",
            vec![Diagnostic::new(
                Range::from_coords(10, 0, 10, 20),
                DiagnosticSeverity::Error,
                "test error",
            )],
        );
        b.iter(|| {
            black_box(cache.get("file:///test.rs"));
        });
    });

    // Benchmark counts computation
    group.bench_function("counts", |b| {
        let cache = DiagnosticCache::new();
        for i in 0..100 {
            cache.set(
                format!("file:///test_{}.rs", i),
                vec![
                    Diagnostic::new(
                        Range::from_coords(i as u32, 0, i as u32, 10),
                        DiagnosticSeverity::Error,
                        format!("error {}", i),
                    ),
                    Diagnostic::new(
                        Range::from_coords(i as u32 + 1, 0, i as u32 + 1, 10),
                        DiagnosticSeverity::Warning,
                        format!("warning {}", i),
                    ),
                ],
            );
        }
        b.iter(|| {
            black_box(cache.counts());
        });
    });

    // Benchmark counts caching (repeated access)
    group.bench_function("counts_cached", |b| {
        let cache = DiagnosticCache::new();
        for i in 0..100 {
            cache.set(
                format!("file:///test_{}.rs", i),
                vec![Diagnostic::new(
                    Range::from_coords(i as u32, 0, i as u32, 10),
                    DiagnosticSeverity::Error,
                    format!("error {}", i),
                )],
            );
        }
        // Prime the cache
        let _ = cache.counts();
        b.iter(|| {
            black_box(cache.counts());
        });
    });

    // Benchmark version tracking
    group.bench_function("version", |b| {
        let cache = DiagnosticCache::new();
        b.iter(|| {
            black_box(cache.version());
        });
    });

    group.finish();
}

/// Benchmark config operations.
fn bench_lsp_config(c: &mut Criterion) {
    let mut group = c.benchmark_group("lsp_config");

    // Benchmark default config creation
    group.bench_function("with_defaults", |b| {
        b.iter(|| {
            black_box(LspConfig::with_defaults());
        });
    });

    // Benchmark server lookup by extension
    group.bench_function("server_for_extension", |b| {
        let config = LspConfig::with_defaults();
        b.iter(|| {
            black_box(config.server_for_extension("rs"));
            black_box(config.server_for_extension("ts"));
            black_box(config.server_for_extension("py"));
        });
    });

    // Benchmark server handles file check
    group.bench_function("handles_extension", |b| {
        let server = LspServerConfig::new("rust-analyzer", "rust-analyzer")
            .with_file_types(&["rs"]);
        b.iter(|| {
            black_box(server.handles_extension("rs"));
            black_box(server.handles_extension("py"));
        });
    });

    // Benchmark config merge
    group.bench_function("merge", |b| {
        let mut config = LspConfig::with_defaults();
        let user_config = LspConfig::new();
        b.iter(|| {
            config.merge(black_box(&user_config));
        });
    });

    group.finish();
}

/// Benchmark type operations.
fn bench_lsp_types(c: &mut Criterion) {
    let mut group = c.benchmark_group("lsp_types");

    // Benchmark position creation
    group.bench_function("position_new", |b| {
        b.iter(|| {
            black_box(Position::new(100, 50));
        });
    });

    // Benchmark range creation
    group.bench_function("range_new", |b| {
        b.iter(|| {
            black_box(Range::from_coords(10, 0, 10, 50));
        });
    });

    // Benchmark range contains
    group.bench_function("range_contains", |b| {
        let range = Range::from_coords(10, 0, 20, 0);
        let pos = Position::new(15, 10);
        b.iter(|| {
            black_box(range.contains(pos));
        });
    });

    // Benchmark diagnostic creation
    group.bench_function("diagnostic_new", |b| {
        b.iter(|| {
            black_box(
                Diagnostic::new(
                    Range::from_coords(10, 0, 10, 20),
                    DiagnosticSeverity::Error,
                    "expected `;`",
                )
                .with_code("E0001")
                .with_source("rustc"),
            );
        });
    });

    // Benchmark counts merge
    group.bench_function("counts_merge", |b| {
        let mut counts1 = DiagnosticCounts::new();
        counts1.errors = 10;
        counts1.warnings = 5;
        let counts2 = DiagnosticCounts {
            errors: 3,
            warnings: 2,
            info: 1,
            hints: 0,
        };
        b.iter(|| {
            let mut c = counts1.clone();
            c.merge(black_box(&counts2));
            black_box(c);
        });
    });

    group.finish();
}

/// Benchmark serialization.
fn bench_lsp_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("lsp_serialization");

    // Benchmark diagnostic serialization
    group.bench_function("diagnostic_serialize", |b| {
        let diag = Diagnostic::new(
            Range::from_coords(10, 0, 10, 20),
            DiagnosticSeverity::Error,
            "expected `;`",
        )
        .with_code("E0001")
        .with_source("rustc");
        b.iter(|| {
            black_box(serde_json::to_string(&diag).unwrap());
        });
    });

    // Benchmark diagnostic deserialization
    group.bench_function("diagnostic_deserialize", |b| {
        let json = r#"{
            "range": {"start": {"line": 10, "character": 0}, "end": {"line": 10, "character": 20}},
            "severity": 1,
            "code": "E0001",
            "source": "rustc",
            "message": "expected `;`"
        }"#;
        b.iter(|| {
            black_box(serde_json::from_str::<serde_json::Value>(json).unwrap());
        });
    });

    // Benchmark server config serialization
    group.bench_function("config_serialize", |b| {
        let config = LspServerConfig::new("rust-analyzer", "rust-analyzer")
            .with_file_types(&["rs"])
            .with_root_markers(&["Cargo.toml"]);
        b.iter(|| {
            black_box(serde_json::to_string(&config).unwrap());
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_diagnostic_cache,
    bench_lsp_config,
    bench_lsp_types,
    bench_lsp_serialization,
);
criterion_main!(benches);
