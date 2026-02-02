// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for the MCP module.
//!
//! These benchmarks measure:
//! - Configuration parsing
//! - Type serialization/deserialization
//! - Tool info operations

use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

use codi::mcp::config::{McpConfig, ServerConfig};
use codi::mcp::types::{McpContent, McpToolInfo, McpToolResult};

/// Benchmark configuration parsing.
fn bench_config_parsing(c: &mut Criterion) {
    let json = r#"
    {
        "mcp_servers": {
            "filesystem": {
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                "enabled": true,
                "startup_timeout_sec": 30,
                "tool_timeout_sec": 300
            },
            "github": {
                "transport": "http",
                "url": "https://mcp.github.com/v1",
                "bearer_token": "${GITHUB_TOKEN}",
                "enabled": false
            }
        }
    }
    "#;

    c.bench_function("mcp_config_parse", |b| {
        b.iter(|| McpConfig::from_json(black_box(json)).unwrap());
    });
}

/// Benchmark server config builder.
fn bench_config_builder(c: &mut Criterion) {
    c.bench_function("mcp_config_builder_stdio", |b| {
        b.iter(|| {
            ServerConfig::stdio(black_box("npx"))
                .with_args(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])
                .with_cwd("/home/user")
                .with_env([("NODE_ENV", "production")])
        });
    });

    c.bench_function("mcp_config_builder_http", |b| {
        b.iter(|| {
            ServerConfig::http(black_box("https://api.example.com"))
                .with_bearer_token("secret_token")
                .with_enabled_tools(["read_file", "write_file"])
                .with_auto_approve(["read_file"])
        });
    });
}

/// Benchmark tool info operations.
fn bench_tool_info(c: &mut Criterion) {
    let tool_info = McpToolInfo {
        name: "read_file".to_string(),
        description: Some("Read the contents of a file".to_string()),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to read"
                }
            },
            "required": ["path"]
        }),
        server: "filesystem".to_string(),
        destructive: false,
        read_only: true,
        idempotent: true,
    };

    c.bench_function("mcp_tool_info_qualified_name", |b| {
        b.iter(|| black_box(&tool_info).qualified_name());
    });

    c.bench_function("mcp_tool_info_serialize", |b| {
        b.iter(|| serde_json::to_string(black_box(&tool_info)).unwrap());
    });

    let json = serde_json::to_string(&tool_info).unwrap();
    c.bench_function("mcp_tool_info_deserialize", |b| {
        b.iter(|| serde_json::from_str::<McpToolInfo>(black_box(&json)).unwrap());
    });
}

/// Benchmark tool result operations.
fn bench_tool_result(c: &mut Criterion) {
    c.bench_function("mcp_tool_result_text", |b| {
        b.iter(|| McpToolResult::text(black_box("File contents here")));
    });

    c.bench_function("mcp_tool_result_error", |b| {
        b.iter(|| McpToolResult::error(black_box("File not found")));
    });

    let result = McpToolResult::text("Line 1\nLine 2\nLine 3");
    c.bench_function("mcp_tool_result_as_text", |b| {
        b.iter(|| black_box(&result).as_text());
    });
}

/// Benchmark content serialization.
fn bench_content_serialization(c: &mut Criterion) {
    let text_content = McpContent::Text {
        text: "Hello, world!".to_string(),
    };

    c.bench_function("mcp_content_text_serialize", |b| {
        b.iter(|| serde_json::to_string(black_box(&text_content)).unwrap());
    });

    let json = serde_json::to_string(&text_content).unwrap();
    c.bench_function("mcp_content_text_deserialize", |b| {
        b.iter(|| serde_json::from_str::<McpContent>(black_box(&json)).unwrap());
    });
}

/// Benchmark tool filtering in config.
fn bench_tool_filtering(c: &mut Criterion) {
    let config = ServerConfig::stdio("test")
        .with_enabled_tools(["read_file", "write_file", "list_dir", "search"])
        .with_auto_approve(["read_file", "list_dir"]);

    c.bench_function("mcp_config_is_tool_enabled", |b| {
        b.iter(|| {
            config.is_tool_enabled(black_box("read_file"));
            config.is_tool_enabled(black_box("delete_file"));
        });
    });

    c.bench_function("mcp_config_should_auto_approve", |b| {
        b.iter(|| {
            config.should_auto_approve(black_box("read_file"));
            config.should_auto_approve(black_box("write_file"));
        });
    });
}

criterion_group!(
    benches,
    bench_config_parsing,
    bench_config_builder,
    bench_tool_info,
    bench_tool_result,
    bench_content_serialization,
    bench_tool_filtering,
);

criterion_main!(benches);
