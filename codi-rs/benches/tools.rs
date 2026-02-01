// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for tool handlers.
//!
//! Run with: `cargo bench --bench tools`

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::hint::black_box;
use std::fs;
use tempfile::TempDir;

use codi::tools::registry::ToolRegistry;

/// Setup helper to create test files for benchmarking.
fn setup_test_files(dir: &TempDir, count: usize, lines_per_file: usize) {
    for i in 0..count {
        let content: String = (0..lines_per_file)
            .map(|j| format!("Line {} of file {}: some sample content here\n", j, i))
            .collect();
        fs::write(dir.path().join(format!("file_{}.txt", i)), content).unwrap();
    }
}

/// Benchmark glob pattern matching.
fn bench_glob(c: &mut Criterion) {
    let temp = TempDir::new().unwrap();
    setup_test_files(&temp, 100, 10);

    // Create nested structure
    let nested = temp.path().join("src").join("components");
    fs::create_dir_all(&nested).unwrap();
    for i in 0..50 {
        fs::write(nested.join(format!("component_{}.tsx", i)), "export {}").unwrap();
    }

    let rt = tokio::runtime::Runtime::new().unwrap();
    let registry = ToolRegistry::with_defaults();
    let handler = registry.get("glob").unwrap();

    let mut group = c.benchmark_group("glob");
    group.throughput(Throughput::Elements(1));

    group.bench_function("simple_pattern", |b| {
        b.iter(|| {
            rt.block_on(async {
                handler
                    .execute(black_box(serde_json::json!({
                        "pattern": "*.txt",
                        "path": temp.path().to_str().unwrap()
                    })))
                    .await
            })
        });
    });

    group.bench_function("recursive_pattern", |b| {
        b.iter(|| {
            rt.block_on(async {
                handler
                    .execute(black_box(serde_json::json!({
                        "pattern": "**/*.tsx",
                        "path": temp.path().to_str().unwrap()
                    })))
                    .await
            })
        });
    });

    group.finish();
}

/// Benchmark read_file with different sizes.
fn bench_read_file(c: &mut Criterion) {
    let temp = TempDir::new().unwrap();

    // Create files of different sizes
    let sizes = [100, 1000, 10000];
    for &size in &sizes {
        let content: String = (0..size).map(|i| format!("Line {}\n", i)).collect();
        fs::write(temp.path().join(format!("file_{}_lines.txt", size)), content).unwrap();
    }

    let rt = tokio::runtime::Runtime::new().unwrap();
    let registry = ToolRegistry::with_defaults();
    let handler = registry.get("read_file").unwrap();

    let mut group = c.benchmark_group("read_file");

    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("lines", size), &size, |b, &size| {
            let path = temp.path().join(format!("file_{}_lines.txt", size));
            b.iter(|| {
                rt.block_on(async {
                    handler
                        .execute(black_box(serde_json::json!({
                            "file_path": path.to_str().unwrap()
                        })))
                        .await
                })
            });
        });
    }

    group.finish();
}

/// Benchmark write_file operations.
fn bench_write_file(c: &mut Criterion) {
    let temp = TempDir::new().unwrap();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let registry = ToolRegistry::with_defaults();
    let handler = registry.get("write_file").unwrap();

    let mut group = c.benchmark_group("write_file");

    let sizes = [100, 1000, 10000];
    for size in sizes {
        let content: String = (0..size).map(|i| format!("Line {}\n", i)).collect();
        group.throughput(Throughput::Bytes(content.len() as u64));

        group.bench_with_input(BenchmarkId::new("lines", size), &content, |b, content| {
            let mut counter = 0u64;
            b.iter(|| {
                counter += 1;
                let path = temp.path().join(format!("bench_write_{}.txt", counter));
                rt.block_on(async {
                    handler
                        .execute(black_box(serde_json::json!({
                            "file_path": path.to_str().unwrap(),
                            "content": content
                        })))
                        .await
                })
            });
        });
    }

    group.finish();
}

/// Benchmark edit_file operations.
fn bench_edit_file(c: &mut Criterion) {
    let temp = TempDir::new().unwrap();
    let content = "fn main() {\n    println!(\"Hello\");\n}\n";
    let file_path = temp.path().join("bench_edit.rs");

    let rt = tokio::runtime::Runtime::new().unwrap();
    let registry = ToolRegistry::with_defaults();
    let handler = registry.get("edit_file").unwrap();

    let mut group = c.benchmark_group("edit_file");
    group.throughput(Throughput::Elements(1));

    group.bench_function("simple_replace", |b| {
        b.iter(|| {
            // Reset file
            fs::write(&file_path, content).unwrap();
            rt.block_on(async {
                handler
                    .execute(black_box(serde_json::json!({
                        "file_path": file_path.to_str().unwrap(),
                        "old_string": "Hello",
                        "new_string": "World"
                    })))
                    .await
            })
        });
    });

    group.finish();
}

/// Benchmark list_directory operations.
fn bench_list_dir(c: &mut Criterion) {
    let temp = TempDir::new().unwrap();
    setup_test_files(&temp, 100, 1);

    let rt = tokio::runtime::Runtime::new().unwrap();
    let registry = ToolRegistry::with_defaults();
    let handler = registry.get("list_directory").unwrap();

    let mut group = c.benchmark_group("list_directory");
    group.throughput(Throughput::Elements(100));

    group.bench_function("100_files", |b| {
        b.iter(|| {
            rt.block_on(async {
                handler
                    .execute(black_box(serde_json::json!({
                        "path": temp.path().to_str().unwrap()
                    })))
                    .await
            })
        });
    });

    group.finish();
}

/// Benchmark grep operations (requires rg installed).
fn bench_grep(c: &mut Criterion) {
    // Check if rg is available
    if std::process::Command::new("rg")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        let temp = TempDir::new().unwrap();

        // Create files with searchable content
        for i in 0..50 {
            let content = format!(
                "function foo_{i}() {{\n  const value = \"test_{i}\";\n  return value;\n}}\n"
            );
            fs::write(temp.path().join(format!("file_{}.js", i)), content).unwrap();
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let registry = ToolRegistry::with_defaults();
        let handler = registry.get("grep").unwrap();

        let mut group = c.benchmark_group("grep");
        group.throughput(Throughput::Elements(50));

        group.bench_function("simple_pattern", |b| {
            b.iter(|| {
                rt.block_on(async {
                    handler
                        .execute(black_box(serde_json::json!({
                            "pattern": "function",
                            "path": temp.path().to_str().unwrap()
                        })))
                        .await
                })
            });
        });

        group.bench_function("regex_pattern", |b| {
            b.iter(|| {
                rt.block_on(async {
                    handler
                        .execute(black_box(serde_json::json!({
                            "pattern": "function\\s+\\w+",
                            "path": temp.path().to_str().unwrap()
                        })))
                        .await
                })
            });
        });

        group.finish();
    }
}

/// Benchmark tool registry dispatch.
fn bench_registry_dispatch(c: &mut Criterion) {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "test content").unwrap();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let registry = ToolRegistry::with_defaults();

    let mut group = c.benchmark_group("registry");

    group.bench_function("dispatch_read_file", |b| {
        b.iter(|| {
            rt.block_on(async {
                registry
                    .dispatch(
                        black_box("read_file"),
                        black_box(serde_json::json!({
                            "file_path": file_path.to_str().unwrap()
                        })),
                    )
                    .await
            })
        });
    });

    group.bench_function("get_handler", |b| {
        b.iter(|| {
            black_box(registry.get("read_file"));
        });
    });

    group.bench_function("get_definitions", |b| {
        b.iter(|| {
            black_box(registry.definitions());
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_glob,
    bench_read_file,
    bench_write_file,
    bench_edit_file,
    bench_list_dir,
    bench_grep,
    bench_registry_dispatch,
);

criterion_main!(benches);
