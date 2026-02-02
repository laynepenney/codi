// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for the TUI module.
//!
//! These benchmarks measure:
//! - Streaming collector performance
//! - Markdown rendering speed
//! - Command parsing
//! - Message rendering

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

use codi::tui::streaming::{MarkdownStreamCollector, StreamController};

/// Generate test markdown content of varying sizes.
fn generate_markdown(lines: usize) -> String {
    let mut content = String::new();
    for i in 0..lines {
        match i % 5 {
            0 => content.push_str(&format!("## Heading {}\n", i)),
            1 => content.push_str(&format!("This is a paragraph with **bold** and `code`.\n")),
            2 => content.push_str(&format!("- List item {}\n", i)),
            3 => content.push_str(&format!("> Blockquote line {}\n", i)),
            _ => content.push_str(&format!("Regular text line {}.\n", i)),
        }
    }
    content
}

/// Benchmark the markdown stream collector.
fn bench_collector_push(c: &mut Criterion) {
    let mut group = c.benchmark_group("collector_push");

    for size in [10, 50, 100, 500] {
        let content = generate_markdown(size);

        group.bench_with_input(BenchmarkId::new("lines", size), &content, |b, content| {
            b.iter(|| {
                let mut collector = MarkdownStreamCollector::new(Some(80));
                collector.push_delta(black_box(content));
                collector.commit_complete_lines()
            });
        });
    }

    group.finish();
}

/// Benchmark incremental streaming (simulating actual usage).
fn bench_collector_incremental(c: &mut Criterion) {
    let mut group = c.benchmark_group("collector_incremental");

    // Simulate streaming: push content in small chunks
    let content = generate_markdown(100);
    let chunks: Vec<&str> = content
        .char_indices()
        .filter_map(|(i, c)| {
            if c == '\n' {
                Some(&content[..=i])
            } else {
                None
            }
        })
        .collect();

    group.bench_function("100_lines_chunked", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            let mut total_lines = 0;
            for chunk in &chunks {
                collector.push_delta(black_box(chunk));
                total_lines += collector.commit_complete_lines().len();
            }
            total_lines
        });
    });

    group.finish();
}

/// Benchmark the stream controller stepping.
fn bench_controller_step(c: &mut Criterion) {
    let mut group = c.benchmark_group("controller_step");

    let content = generate_markdown(100);

    group.bench_function("step_all_lines", |b| {
        b.iter(|| {
            let mut controller = StreamController::new(Some(80));
            controller.push(black_box(&content));

            let mut total_lines = 0;
            loop {
                let (status, lines) = controller.step();
                total_lines += lines.len();
                if matches!(status, codi::tui::streaming::StreamStatus::Idle) {
                    break;
                }
            }
            total_lines
        });
    });

    group.bench_function("drain_all", |b| {
        b.iter(|| {
            let mut controller = StreamController::new(Some(80));
            controller.push(black_box(&content));
            controller.drain_all().len()
        });
    });

    group.finish();
}

/// Benchmark word delta streaming (character-by-character).
fn bench_word_delta_streaming(c: &mut Criterion) {
    let mut group = c.benchmark_group("word_delta");

    let content = "This is a test message with some **bold** text and `inline code` formatting.\n";

    // Simulate word-by-word streaming
    let words: Vec<&str> = content.split_inclusive(' ').collect();

    group.bench_function("word_by_word", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            for word in &words {
                collector.push_delta(black_box(word));
            }
            collector.commit_complete_lines()
        });
    });

    // Simulate character-by-character streaming
    group.bench_function("char_by_char", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            for c in content.chars() {
                collector.push_delta(black_box(&c.to_string()));
            }
            collector.commit_complete_lines()
        });
    });

    group.finish();
}

/// Benchmark markdown element types.
fn bench_markdown_elements(c: &mut Criterion) {
    let mut group = c.benchmark_group("markdown_elements");

    // Headings
    let headings = "# H1\n## H2\n### H3\n".repeat(10);
    group.bench_function("headings", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            collector.push_delta(black_box(&headings));
            collector.commit_complete_lines()
        });
    });

    // Code blocks
    let code = "```rust\nfn main() {\n    println!(\"Hello\");\n}\n```\n".repeat(10);
    group.bench_function("code_blocks", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            collector.push_delta(black_box(&code));
            collector.commit_complete_lines()
        });
    });

    // Lists
    let lists = "- Item 1\n- Item 2\n- Item 3\n".repeat(20);
    group.bench_function("lists", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            collector.push_delta(black_box(&lists));
            collector.commit_complete_lines()
        });
    });

    // Blockquotes
    let quotes = "> Quote line\n".repeat(30);
    group.bench_function("blockquotes", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            collector.push_delta(black_box(&quotes));
            collector.commit_complete_lines()
        });
    });

    // Inline formatting
    let inline = "Text with **bold** and `code` and *italic* formatting.\n".repeat(20);
    group.bench_function("inline_formatting", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            collector.push_delta(black_box(&inline));
            collector.commit_complete_lines()
        });
    });

    group.finish();
}

/// Benchmark different terminal widths.
fn bench_width_variations(c: &mut Criterion) {
    let mut group = c.benchmark_group("width_variations");

    let content = generate_markdown(50);

    for width in [40, 80, 120, 200] {
        group.bench_with_input(BenchmarkId::new("width", width), &width, |b, &width| {
            b.iter(|| {
                let mut collector = MarkdownStreamCollector::new(Some(width));
                collector.push_delta(black_box(&content));
                collector.commit_complete_lines()
            });
        });
    }

    // No width (unlimited)
    group.bench_function("width_none", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(None);
            collector.push_delta(black_box(&content));
            collector.commit_complete_lines()
        });
    });

    group.finish();
}

/// Benchmark finalization.
fn bench_finalization(c: &mut Criterion) {
    let mut group = c.benchmark_group("finalization");

    // Content without trailing newline (requires finalization)
    let partial = "This is partial content without a newline";

    group.bench_function("finalize_partial", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            collector.push_delta(black_box(partial));
            let committed = collector.commit_complete_lines();
            let finalized = collector.finalize_and_drain();
            (committed.len(), finalized.len())
        });
    });

    // Mixed content
    let mixed = "Line 1\nLine 2\nPartial line";
    group.bench_function("finalize_mixed", |b| {
        b.iter(|| {
            let mut collector = MarkdownStreamCollector::new(Some(80));
            collector.push_delta(black_box(mixed));
            let committed = collector.commit_complete_lines();
            let finalized = collector.finalize_and_drain();
            (committed.len(), finalized.len())
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_collector_push,
    bench_collector_incremental,
    bench_controller_step,
    bench_word_delta_streaming,
    bench_markdown_elements,
    bench_width_variations,
    bench_finalization,
);

criterion_main!(benches);
