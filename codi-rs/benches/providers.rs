// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for provider operations.
//!
//! These benchmark the parts we can test without network calls:
//! - Message conversion
//! - Request building
//! - Response parsing
//! - Provider creation
//!
//! Run with: `cargo bench --bench providers`

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::hint::black_box;

use codi::types::{
    ContentBlock, InputSchema, Message, ProviderConfig, ToolDefinition,
};
use codi::providers::{create_provider, ProviderType};

/// Create sample messages of various sizes.
fn create_messages(count: usize) -> Vec<Message> {
    (0..count)
        .map(|i| {
            if i % 2 == 0 {
                Message::user(format!("User message {}: some content here with reasonable length", i))
            } else {
                Message::assistant(format!("Assistant response {}: here is a helpful answer with some detail", i))
            }
        })
        .collect()
}

/// Create sample tool definitions.
fn create_tools(count: usize) -> Vec<ToolDefinition> {
    (0..count)
        .map(|i| {
            ToolDefinition::new(
                format!("tool_{}", i),
                format!("A tool that does something useful, number {}", i),
            )
            .with_schema(
                InputSchema::new()
                    .with_property("arg1", serde_json::json!({"type": "string", "description": "First argument"}))
                    .with_property("arg2", serde_json::json!({"type": "integer", "description": "Second argument"}))
                    .with_required(vec!["arg1".to_string()]),
            )
        })
        .collect()
}

/// Benchmark provider creation.
fn bench_provider_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("provider_creation");

    group.bench_function("anthropic", |b| {
        b.iter(|| {
            let config = ProviderConfig::new("test-key", "claude-sonnet-4-20250514");
            black_box(create_provider(ProviderType::Anthropic, config))
        });
    });

    group.bench_function("openai", |b| {
        b.iter(|| {
            let config = ProviderConfig::new("test-key", "gpt-4o");
            black_box(create_provider(ProviderType::OpenAI, config))
        });
    });

    group.bench_function("ollama", |b| {
        b.iter(|| {
            let config = ProviderConfig {
                model: Some("llama3.2".to_string()),
                ..Default::default()
            };
            black_box(create_provider(ProviderType::Ollama, config))
        });
    });

    group.finish();
}

/// Benchmark message content block creation.
fn bench_content_blocks(c: &mut Criterion) {
    let mut group = c.benchmark_group("content_blocks");

    group.bench_function("text", |b| {
        b.iter(|| {
            black_box(ContentBlock::text("Hello, this is a sample text message with some content."))
        });
    });

    group.bench_function("tool_use", |b| {
        b.iter(|| {
            black_box(ContentBlock::tool_use(
                "call_123",
                "read_file",
                serde_json::json!({"file_path": "/path/to/file.txt"}),
            ))
        });
    });

    group.bench_function("tool_result", |b| {
        b.iter(|| {
            black_box(ContentBlock::tool_result(
                "call_123",
                "File contents here with some sample data for the benchmark",
                false,
            ))
        });
    });

    group.finish();
}

/// Benchmark message creation with different sizes.
fn bench_message_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("message_creation");

    let sizes = [1, 10, 50, 100];

    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("messages", size), &size, |b, &size| {
            b.iter(|| {
                black_box(create_messages(size))
            });
        });
    }

    group.finish();
}

/// Benchmark tool definition creation.
fn bench_tool_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("tool_creation");

    let sizes = [5, 10, 25, 50];

    for size in sizes {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("tools", size), &size, |b, &size| {
            b.iter(|| {
                black_box(create_tools(size))
            });
        });
    }

    group.finish();
}

/// Benchmark JSON serialization (simulating request building).
fn bench_serialization(c: &mut Criterion) {
    let messages = create_messages(20);
    let tools = create_tools(10);

    let mut group = c.benchmark_group("serialization");

    group.bench_function("messages_to_json", |b| {
        b.iter(|| {
            black_box(serde_json::to_string(&messages))
        });
    });

    group.bench_function("tools_to_json", |b| {
        b.iter(|| {
            black_box(serde_json::to_string(&tools))
        });
    });

    // Simulate a full request
    let request = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 8192,
        "messages": messages,
        "tools": tools,
        "system": "You are a helpful assistant.",
    });

    group.bench_function("full_request", |b| {
        b.iter(|| {
            black_box(serde_json::to_string(&request))
        });
    });

    group.finish();
}

/// Benchmark response parsing (simulating API response handling).
fn bench_response_parsing(c: &mut Criterion) {
    // Simulated Anthropic response
    let anthropic_response = r#"{
        "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
        "type": "message",
        "role": "assistant",
        "content": [
            {"type": "text", "text": "Here is a helpful response with some content."},
            {"type": "tool_use", "id": "toolu_01D7FLrfh4GYq7yT1ULFeyMV", "name": "read_file", "input": {"file_path": "/path/to/file.txt"}}
        ],
        "model": "claude-sonnet-4-20250514",
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 1234, "output_tokens": 567}
    }"#;

    // Simulated OpenAI response
    let openai_response = r#"{
        "id": "chatcmpl-123",
        "object": "chat.completion",
        "created": 1677652288,
        "model": "gpt-4o",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "Here is a helpful response with some content.",
                "tool_calls": [{
                    "id": "call_abc123",
                    "type": "function",
                    "function": {"name": "read_file", "arguments": "{\"file_path\": \"/path/to/file.txt\"}"}
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 1234, "completion_tokens": 567, "total_tokens": 1801}
    }"#;

    let mut group = c.benchmark_group("response_parsing");

    group.bench_function("anthropic_response", |b| {
        b.iter(|| {
            let parsed: serde_json::Value = serde_json::from_str(black_box(anthropic_response)).unwrap();
            black_box(parsed)
        });
    });

    group.bench_function("openai_response", |b| {
        b.iter(|| {
            let parsed: serde_json::Value = serde_json::from_str(black_box(openai_response)).unwrap();
            black_box(parsed)
        });
    });

    group.finish();
}

/// Benchmark SSE line parsing (for streaming).
fn bench_sse_parsing(c: &mut Criterion) {
    let sse_lines = vec![
        "event: message_start",
        "data: {\"type\": \"message_start\", \"message\": {\"id\": \"msg_01\", \"type\": \"message\", \"role\": \"assistant\", \"content\": [], \"model\": \"claude-sonnet-4-20250514\", \"usage\": {\"input_tokens\": 100}}}",
        "",
        "event: content_block_start",
        "data: {\"type\": \"content_block_start\", \"index\": 0, \"content_block\": {\"type\": \"text\", \"text\": \"\"}}",
        "",
        "event: content_block_delta",
        "data: {\"type\": \"content_block_delta\", \"index\": 0, \"delta\": {\"type\": \"text_delta\", \"text\": \"Hello\"}}",
        "",
        "event: content_block_delta",
        "data: {\"type\": \"content_block_delta\", \"index\": 0, \"delta\": {\"type\": \"text_delta\", \"text\": \" world!\"}}",
        "",
        "event: content_block_stop",
        "data: {\"type\": \"content_block_stop\", \"index\": 0}",
        "",
        "event: message_delta",
        "data: {\"type\": \"message_delta\", \"delta\": {\"stop_reason\": \"end_turn\"}, \"usage\": {\"output_tokens\": 50}}",
        "",
        "event: message_stop",
        "data: {\"type\": \"message_stop\"}",
    ];

    let sse_text = sse_lines.join("\n");

    let mut group = c.benchmark_group("sse_parsing");

    group.bench_function("parse_lines", |b| {
        b.iter(|| {
            let mut events = Vec::new();
            for line in black_box(&sse_text).lines() {
                if line.starts_with("event: ") {
                    events.push(("event", &line[7..]));
                } else if line.starts_with("data: ") {
                    events.push(("data", &line[6..]));
                }
            }
            black_box(events)
        });
    });

    group.bench_function("parse_json_data", |b| {
        b.iter(|| {
            let mut parsed = Vec::new();
            for line in black_box(&sse_text).lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        parsed.push(json);
                    }
                }
            }
            black_box(parsed)
        });
    });

    group.finish();
}

/// Benchmark provider type parsing.
fn bench_provider_type_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("provider_type");

    let types = ["anthropic", "claude", "openai", "gpt", "ollama", "ANTHROPIC"];

    for t in types {
        group.bench_with_input(BenchmarkId::new("parse", t), &t, |b, &t| {
            b.iter(|| {
                black_box(t.parse::<ProviderType>())
            });
        });
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_provider_creation,
    bench_content_blocks,
    bench_message_creation,
    bench_tool_creation,
    bench_serialization,
    bench_response_parsing,
    bench_sse_parsing,
    bench_provider_type_parsing,
);

criterion_main!(benches);
