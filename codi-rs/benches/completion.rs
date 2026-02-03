// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for the completion system.
//!
//! These benchmarks measure tab completion performance:
//! - Command completion speed
//! - Complexity handling
//! - Memory usage efficiency

use codi::completion::{
    complete_line, get_command_names, get_common_prefix, get_completion_matches,
};
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

/// Generate realistic completion test inputs
fn generate_completion_inputs() -> Vec<String> {
    vec![
        "/h".to_string(),
        "/br".to_string(),
        "/branch".to_string(),
        "/models".to_string(),
        "/models anthropic".to_string(),
        "/commit fix".to_string(),
        "/git/rebase master".to_string(),
        "/code/refactor optimize".to_string(),
    ]
}

/// Performance benchmark for command name retrieval
fn bench_command_names(c: &mut Criterion) {
    let mut group = c.benchmark_group("completion");

    group.bench_function("get_command_names", |b| {
        b.iter(|| black_box(get_command_names()));
    });
}

/// Benchmark tab completion speed
fn bench_completion_speed(c: &mut Criterion) {
    let mut group = c.benchmark_group("completion");

    let test_inputs = generate_completion_inputs();

    // Simple text only
    group.bench_function("simple", |b| {
        b.iter(|| black_box(complete_line("/h")));
    });

    // Complex input
    group.bench_function("complex", |b| {
        b.iter_batched(
            || test_inputs.clone(),
            |inputs| {
                let mut results = Vec::new();
                for input in inputs {
                    results.push(black_box(complete_line(&input)));
                }
                results
            },
            criterion::BatchSize::SmallInput,
        );
    });

    group.finish();
}

/// Benchmark completion matches lookup
fn bench_completion_matches(c: &mut Criterion) {
    let mut group = c.benchmark_group("completion");

    group.bench_function("matches_lookup", |b| {
        b.iter(|| black_box(get_completion_matches("/models")));
    });

    group.bench_function("matches_complex", |b| {
        b.iter(|| black_box(get_completion_matches("/git/branch")));
    });

    group.finish();
}

/// Benchmark LCP calculation performance
fn bench_common_prefix(c: &mut Criterion) {
    let mut group = c.benchmark_group("completion");

    group.bench_function("small_set", |b| {
        let matches = vec!["branch", "branching", "branch"]
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<String>>();
        b.iter(|| black_box(get_common_prefix(&matches)));
    });

    // Get command names for medium-size test
    group.bench_function("medium_set", |b| {
        b.iter_batched(
            || {
                let commands = get_command_names();
                commands.iter().map(|s| s.as_str()).collect::<Vec<&str>>()
            },
            |commands| {
                let string_refs: Vec<&str> = commands.iter().copied().collect();
                black_box(get_common_prefix(&string_refs))
            },
            criterion::BatchSize::SmallInput,
        );
    });

    group.finish();
}

/// Benchmark completion under load stress
fn bench_completion_stress(c: &mut Criterion) {
    let mut group = c.benchmark_group("completion_stress");

    // Stress test with many sequential completions
    group.bench_function("sequential_stress", |b| {
        b.iter(|| {
            let start = std::time::Instant::now();
            let mut results = Vec::new();
            let commands = get_command_names(); // Generate test commands
            for cmd in commands.iter() {
                results.push(black_box(complete_line(&format!("/{}", cmd))));
            }
            black_box(results)
        });
    });

    // Memory usage test
    group.bench_function("memory_efficiency", |b| {
        b.iter_batched(
            || (0..100).map(|i| "/h".to_string()).collect::<Vec<String>>(),
            |strings| {
                let mut completions = Vec::new();
                for s in strings {
                    completions.push(black_box(complete_line(&s)));
                }
                completions
            },
            criterion::BatchSize::SmallInput,
        );
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_command_names,
    bench_completion_speed,
    bench_completion_matches,
    bench_common_prefix,
    bench_completion_stress
);
criterion_main!(benches);
