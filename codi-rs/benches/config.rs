// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for configuration loading and merging.
//!
//! Run with: `cargo bench --bench config`

use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use std::fs;
use std::hint::black_box;
use tempfile::TempDir;

use codi::config::{
    is_tool_disabled, load_config, merge_config, should_auto_approve, CliOptions, ResolvedConfig,
    WorkspaceConfig,
};

/// Benchmark config loading from different sources.
fn bench_config_loading(c: &mut Criterion) {
    let temp = TempDir::new().unwrap();

    // Create a sample config file
    let config_content = r#"{
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "autoApprove": ["read_file", "glob", "grep"],
        "systemPromptAdditions": "Always use TypeScript.",
        "projectContext": "A Rust CLI application."
    }"#;
    fs::write(temp.path().join(".codi.json"), config_content).unwrap();

    let mut group = c.benchmark_group("config_loading");
    group.throughput(Throughput::Elements(1));

    group.bench_function("load_json_config", |b| {
        b.iter(|| load_config(black_box(temp.path()), black_box(CliOptions::default())));
    });

    // Create YAML config
    let yaml_content = r#"
provider: anthropic
model: claude-sonnet-4-20250514
autoApprove:
  - read_file
  - glob
  - grep
systemPromptAdditions: Always use TypeScript.
projectContext: A Rust CLI application.
"#;
    let yaml_dir = TempDir::new().unwrap();
    fs::write(yaml_dir.path().join(".codi.yaml"), yaml_content).unwrap();

    group.bench_function("load_yaml_config", |b| {
        b.iter(|| load_config(black_box(yaml_dir.path()), black_box(CliOptions::default())));
    });

    // Benchmark with no config file (defaults only)
    let empty_dir = TempDir::new().unwrap();
    group.bench_function("load_defaults_only", |b| {
        b.iter(|| load_config(black_box(empty_dir.path()), black_box(CliOptions::default())));
    });

    group.finish();
}

/// Benchmark config merging with various options.
fn bench_config_merging(c: &mut Criterion) {
    let global_config = WorkspaceConfig {
        provider: Some("ollama".to_string()),
        model: Some("llama3.2".to_string()),
        ..Default::default()
    };

    let workspace_config = WorkspaceConfig {
        provider: Some("anthropic".to_string()),
        model: Some("claude-sonnet-4-20250514".to_string()),
        auto_approve: Some(vec!["read_file".to_string(), "glob".to_string()]),
        ..Default::default()
    };

    let local_config = WorkspaceConfig {
        model: Some("claude-opus-4-20250514".to_string()),
        ..Default::default()
    };

    let cli_options = CliOptions {
        provider: Some("openai".to_string()),
        model: Some("gpt-4o".to_string()),
        ..Default::default()
    };

    let mut group = c.benchmark_group("config_merging");
    group.throughput(Throughput::Elements(1));

    group.bench_function("merge_with_cli_overrides", |b| {
        b.iter(|| {
            merge_config(
                black_box(Some(global_config.clone())),
                black_box(Some(workspace_config.clone())),
                black_box(None),
                black_box(cli_options.clone()),
            )
        });
    });

    group.bench_function("merge_all_layers", |b| {
        b.iter(|| {
            merge_config(
                black_box(Some(global_config.clone())),
                black_box(Some(workspace_config.clone())),
                black_box(Some(local_config.clone())),
                black_box(cli_options.clone()),
            )
        });
    });

    group.bench_function("merge_defaults_only", |b| {
        b.iter(|| {
            merge_config(
                black_box(None),
                black_box(None),
                black_box(None),
                black_box(CliOptions::default()),
            )
        });
    });

    group.finish();
}

/// Benchmark config serialization.
fn bench_config_serialization(c: &mut Criterion) {
    let config = WorkspaceConfig {
        provider: Some("anthropic".to_string()),
        model: Some("claude-sonnet-4-20250514".to_string()),
        base_url: Some("https://api.example.com".to_string()),
        auto_approve: Some(vec![
            "read_file".to_string(),
            "glob".to_string(),
            "grep".to_string(),
            "list_directory".to_string(),
        ]),
        system_prompt_additions: Some("Always be helpful.".to_string()),
        project_context: Some("A large Rust project.".to_string()),
        default_session: Some("my-session".to_string()),
        ..Default::default()
    };

    let mut group = c.benchmark_group("config_serialization");

    group.bench_function("to_json", |b| {
        b.iter(|| serde_json::to_string(black_box(&config)));
    });

    group.bench_function("to_yaml", |b| {
        b.iter(|| serde_yaml::to_string(black_box(&config)));
    });

    let json_str = serde_json::to_string(&config).unwrap();
    let yaml_str = serde_yaml::to_string(&config).unwrap();

    group.bench_function("from_json", |b| {
        b.iter(|| serde_json::from_str::<WorkspaceConfig>(black_box(&json_str)));
    });

    group.bench_function("from_yaml", |b| {
        b.iter(|| serde_yaml::from_str::<WorkspaceConfig>(black_box(&yaml_str)));
    });

    group.finish();
}

/// Benchmark resolved config operations.
fn bench_resolved_config(c: &mut Criterion) {
    let config = ResolvedConfig {
        provider: "anthropic".to_string(),
        model: Some("claude-sonnet-4-20250514".to_string()),
        auto_approve: vec![
            "read_file".to_string(),
            "glob".to_string(),
            "grep".to_string(),
        ],
        ..Default::default()
    };

    let mut group = c.benchmark_group("resolved_config");

    group.bench_function("should_auto_approve_hit", |b| {
        b.iter(|| should_auto_approve(black_box(&config), black_box("read_file")));
    });

    group.bench_function("should_auto_approve_miss", |b| {
        b.iter(|| should_auto_approve(black_box(&config), black_box("bash")));
    });

    group.bench_function("is_tool_disabled_miss", |b| {
        b.iter(|| is_tool_disabled(black_box(&config), black_box("read_file")));
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_config_loading,
    bench_config_merging,
    bench_config_serialization,
    bench_resolved_config,
);

criterion_main!(benches);
