// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for agent operations.
//!
//! These benchmark the parts we can test without network calls:
//! - Configuration creation
//! - State management
//! - Message building
//! - Tool result processing
//!
//! Run with: `cargo bench --bench agent`

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::hint::black_box;

use codi::agent::{AgentConfig, AgentState, TurnStats, TurnToolCall, ToolConfirmation, ConfirmationResult};
use codi::types::{ContentBlock, Message, Role, MessageContent, ToolCall, ToolResult};

/// Benchmark agent configuration creation.
fn bench_agent_config(c: &mut Criterion) {
    let mut group = c.benchmark_group("agent_config");

    group.bench_function("default", |b| {
        b.iter(|| {
            black_box(AgentConfig::default())
        });
    });

    group.bench_function("should_auto_approve", |b| {
        let config = AgentConfig::default();
        b.iter(|| {
            black_box(config.should_auto_approve("bash"))
        });
    });

    group.bench_function("requires_confirmation", |b| {
        let config = AgentConfig::default();
        b.iter(|| {
            black_box(config.requires_confirmation("write_file"))
        });
    });

    group.finish();
}

/// Benchmark agent state operations.
fn bench_agent_state(c: &mut Criterion) {
    let mut group = c.benchmark_group("agent_state");

    group.bench_function("default", |b| {
        b.iter(|| {
            black_box(AgentState::default())
        });
    });

    group.finish();
}

/// Benchmark turn stats tracking.
fn bench_turn_stats(c: &mut Criterion) {
    let mut group = c.benchmark_group("turn_stats");

    group.bench_function("default", |b| {
        b.iter(|| {
            black_box(TurnStats::default())
        });
    });

    group.bench_function("add_tool_call", |b| {
        b.iter(|| {
            let mut stats = TurnStats::default();
            stats.tool_call_count += 1;
            stats.tool_calls.push(TurnToolCall {
                name: "read_file".to_string(),
                duration_ms: 50,
                is_error: false,
            });
            black_box(stats)
        });
    });

    let sizes = [1, 5, 10, 25];
    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("accumulate_tool_calls", size), &size, |b, &size| {
            b.iter(|| {
                let mut stats = TurnStats::default();
                for i in 0..size {
                    stats.tool_call_count += 1;
                    stats.tool_calls.push(TurnToolCall {
                        name: format!("tool_{}", i),
                        duration_ms: 50 + i as u64,
                        is_error: i % 5 == 0,
                    });
                }
                black_box(stats)
            });
        });
    }

    group.finish();
}

/// Create sample messages for benchmarking.
fn create_messages(count: usize) -> Vec<Message> {
    (0..count)
        .map(|i| {
            if i % 2 == 0 {
                Message::user(format!("User message {}: some content here", i))
            } else {
                Message::assistant(format!("Assistant response {}: helpful answer", i))
            }
        })
        .collect()
}

/// Create sample tool calls for benchmarking.
fn create_tool_calls(count: usize) -> Vec<ToolCall> {
    (0..count)
        .map(|i| ToolCall {
            id: format!("call_{}", i),
            name: format!("tool_{}", i % 5),
            input: serde_json::json!({
                "arg1": format!("value_{}", i),
                "arg2": i,
            }),
        })
        .collect()
}

/// Create sample tool results for benchmarking.
fn create_tool_results(count: usize) -> Vec<ToolResult> {
    (0..count)
        .map(|i| ToolResult {
            tool_use_id: format!("call_{}", i),
            content: format!("Result from tool {}: success with some output data", i),
            is_error: if i % 10 == 0 { Some(true) } else { None },
        })
        .collect()
}

/// Benchmark message creation.
fn bench_message_building(c: &mut Criterion) {
    let mut group = c.benchmark_group("message_building");

    let sizes = [5, 10, 25, 50];

    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("create_messages", size), &size, |b, &size| {
            b.iter(|| {
                black_box(create_messages(size))
            });
        });
    }

    // Benchmark building assistant message with tool calls
    group.bench_function("assistant_with_tools", |b| {
        let tool_calls = create_tool_calls(3);
        b.iter(|| {
            let mut blocks: Vec<ContentBlock> = Vec::new();
            blocks.push(ContentBlock::text("Here is my response with tool calls."));
            for tc in &tool_calls {
                blocks.push(ContentBlock::tool_use(&tc.id, &tc.name, tc.input.clone()));
            }
            black_box(Message {
                role: Role::Assistant,
                content: MessageContent::Blocks(blocks),
            })
        });
    });

    group.finish();
}

/// Benchmark tool result processing.
fn bench_tool_results(c: &mut Criterion) {
    let mut group = c.benchmark_group("tool_results");

    let sizes = [1, 3, 5, 10];

    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("create_results", size), &size, |b, &size| {
            b.iter(|| {
                black_box(create_tool_results(size))
            });
        });
    }

    // Benchmark converting tool results to content blocks
    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("to_content_blocks", size), &size, |b, &size| {
            let results = create_tool_results(size);
            b.iter(|| {
                let blocks: Vec<ContentBlock> = results
                    .iter()
                    .map(|r| ContentBlock::tool_result(&r.tool_use_id, &r.content, r.is_error.unwrap_or(false)))
                    .collect();
                black_box(blocks)
            });
        });
    }

    group.finish();
}

/// Benchmark tool confirmation creation.
fn bench_tool_confirmation(c: &mut Criterion) {
    let mut group = c.benchmark_group("tool_confirmation");

    group.bench_function("create", |b| {
        b.iter(|| {
            black_box(ToolConfirmation {
                tool_name: "bash".to_string(),
                input: serde_json::json!({"command": "ls -la"}),
                is_dangerous: true,
                danger_reason: Some("Shell command execution".to_string()),
            })
        });
    });

    group.bench_function("confirmation_result_eq", |b| {
        let result = ConfirmationResult::Approve;
        b.iter(|| {
            black_box(result == ConfirmationResult::Approve)
        });
    });

    group.finish();
}

/// Benchmark conversation history operations.
fn bench_conversation_history(c: &mut Criterion) {
    let mut group = c.benchmark_group("conversation_history");

    // Simulate adding messages to history
    let sizes = [10, 50, 100, 200];

    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("build_history", size), &size, |b, &size| {
            b.iter(|| {
                let mut messages = Vec::with_capacity(size);
                for i in 0..size {
                    if i % 3 == 0 {
                        messages.push(Message::user(format!("User query {}", i)));
                    } else if i % 3 == 1 {
                        messages.push(Message::assistant(format!("Assistant response {}", i)));
                    } else {
                        // Tool result message
                        let blocks = vec![
                            ContentBlock::tool_result(
                                &format!("call_{}", i),
                                &format!("Tool output {}", i),
                                false,
                            ),
                        ];
                        messages.push(Message {
                            role: Role::User,
                            content: MessageContent::Blocks(blocks),
                        });
                    }
                }
                black_box(messages)
            });
        });
    }

    // Benchmark cloning conversation history (relevant for provider calls)
    for size in sizes {
        let messages = create_messages(size);
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("clone_history", size), &messages, |b, messages| {
            b.iter(|| {
                black_box(messages.clone())
            });
        });
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_agent_config,
    bench_agent_state,
    bench_turn_stats,
    bench_message_building,
    bench_tool_results,
    bench_tool_confirmation,
    bench_conversation_history,
);

criterion_main!(benches);
