// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for the session module.

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use tempfile::TempDir;

use codi::session::{
    estimate_message_tokens, estimate_messages_tokens, estimate_text_tokens,
    select_messages_to_keep, ContextConfig, SessionStorage, WorkingSet,
};
use codi::types::{Message, Role};

/// Benchmark token estimation.
fn bench_token_estimation(c: &mut Criterion) {
    let mut group = c.benchmark_group("session/token_estimation");

    // Different text sizes
    let sizes = [100, 1000, 10000, 100000];

    for size in sizes {
        let text = "a".repeat(size);

        group.bench_with_input(
            BenchmarkId::new("estimate_text_tokens", size),
            &text,
            |b, text| {
                b.iter(|| estimate_text_tokens(black_box(text)));
            },
        );
    }

    // Message token estimation
    let message = Message::user("This is a test message with some content.");
    group.bench_function("estimate_message_tokens", |b| {
        b.iter(|| estimate_message_tokens(black_box(&message)));
    });

    // Multiple messages
    let messages: Vec<Message> = (0..100)
        .map(|i| {
            if i % 2 == 0 {
                Message::user(format!("User message {}", i))
            } else {
                Message::assistant(format!("Assistant response {}", i))
            }
        })
        .collect();

    group.bench_function("estimate_messages_tokens/100", |b| {
        b.iter(|| estimate_messages_tokens(black_box(&messages)));
    });

    group.finish();
}

/// Benchmark message selection for context windowing.
fn bench_message_selection(c: &mut Criterion) {
    let mut group = c.benchmark_group("session/message_selection");

    let config = ContextConfig::default();
    let working_set = WorkingSet::new();

    // Different message counts
    let counts = [10, 50, 100, 500];

    for count in counts {
        let messages: Vec<Message> = (0..count)
            .map(|i| {
                if i % 2 == 0 {
                    Message::user(format!("User message {}", i))
                } else {
                    Message::assistant(format!("Assistant response {}", i))
                }
            })
            .collect();

        group.bench_with_input(
            BenchmarkId::new("select_messages_to_keep", count),
            &messages,
            |b, messages| {
                b.iter(|| {
                    select_messages_to_keep(black_box(messages), black_box(&config), black_box(&working_set))
                });
            },
        );
    }

    group.finish();
}

/// Benchmark working set operations.
fn bench_working_set(c: &mut Criterion) {
    let mut group = c.benchmark_group("session/working_set");

    // Add files
    group.bench_function("add_file", |b| {
        let mut ws = WorkingSet::new();
        let mut i = 0;
        b.iter(|| {
            ws.add_file(&format!("/path/to/file{}.rs", i));
            i += 1;
        });
    });

    // Check file references
    let mut ws = WorkingSet::new();
    for i in 0..50 {
        ws.add_file(&format!("/path/to/file{}.rs", i));
    }

    group.bench_function("references_files/hit", |b| {
        b.iter(|| ws.references_files(black_box("Looking at file25.rs")));
    });

    group.bench_function("references_files/miss", |b| {
        b.iter(|| ws.references_files(black_box("Some random text without file references")));
    });

    group.finish();
}

/// Benchmark storage operations.
fn bench_storage(c: &mut Criterion) {
    let mut group = c.benchmark_group("session/storage");

    // Create storage
    group.bench_function("open", |b| {
        b.iter_with_setup(
            || TempDir::new().unwrap(),
            |temp_dir| {
                let db_path = temp_dir.path().join("sessions.db");
                let _ = SessionStorage::open_at(black_box(&db_path));
            },
        );
    });

    // Create session
    group.bench_function("create_session", |b| {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("sessions.db");
        let storage = SessionStorage::open_at(&db_path).unwrap();

        let mut i = 0;
        b.iter(|| {
            let session = codi::session::Session::new(
                format!("session-{}", i),
                "Test Session".to_string(),
                "/path/to/project".to_string(),
            );
            let _ = storage.create_session(black_box(&session));
            i += 1;
        });
    });

    // Get session
    group.bench_function("get_session", |b| {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("sessions.db");
        let storage = SessionStorage::open_at(&db_path).unwrap();

        let session = codi::session::Session::new(
            "test-session".to_string(),
            "Test Session".to_string(),
            "/path/to/project".to_string(),
        );
        storage.create_session(&session).unwrap();

        b.iter(|| {
            let _ = storage.get_session(black_box("test-session"));
        });
    });

    // List sessions
    group.bench_function("list_sessions/50", |b| {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("sessions.db");
        let storage = SessionStorage::open_at(&db_path).unwrap();

        for i in 0..50 {
            let session = codi::session::Session::new(
                format!("session-{}", i),
                format!("Session {}", i),
                "/path/to/project".to_string(),
            );
            storage.create_session(&session).unwrap();
        }

        b.iter(|| {
            let _ = storage.list_sessions();
        });
    });

    // Add message
    group.bench_function("add_message", |b| {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("sessions.db");
        let storage = SessionStorage::open_at(&db_path).unwrap();

        let session = codi::session::Session::new(
            "msg-test".to_string(),
            "Message Test".to_string(),
            "/path/to/project".to_string(),
        );
        storage.create_session(&session).unwrap();

        let mut i = 0;
        b.iter(|| {
            let msg = codi::session::SessionMessage::new(
                "msg-test".to_string(),
                Role::User,
                vec![codi::ContentBlock::text(format!("Message {}", i))],
            );
            let _ = storage.add_message(black_box(&msg));
            i += 1;
        });
    });

    // Get messages
    group.bench_function("get_messages/100", |b| {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("sessions.db");
        let storage = SessionStorage::open_at(&db_path).unwrap();

        let session = codi::session::Session::new(
            "get-msg-test".to_string(),
            "Get Message Test".to_string(),
            "/path/to/project".to_string(),
        );
        storage.create_session(&session).unwrap();

        for i in 0..100 {
            let msg = codi::session::SessionMessage::new(
                "get-msg-test".to_string(),
                if i % 2 == 0 { Role::User } else { Role::Assistant },
                vec![codi::ContentBlock::text(format!("Message {}", i))],
            );
            storage.add_message(&msg).unwrap();
        }

        b.iter(|| {
            let _ = storage.get_messages(black_box("get-msg-test"));
        });
    });

    group.finish();
}

/// Benchmark context config operations.
fn bench_context_config(c: &mut Criterion) {
    let mut group = c.benchmark_group("session/context_config");

    group.bench_function("for_model/small", |b| {
        b.iter(|| ContextConfig::for_model(black_box(8_000)));
    });

    group.bench_function("for_model/large", |b| {
        b.iter(|| ContextConfig::for_model(black_box(200_000)));
    });

    group.bench_function("summarization_threshold", |b| {
        let config = ContextConfig::for_model(128_000);
        b.iter(|| config.summarization_threshold());
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_token_estimation,
    bench_message_selection,
    bench_working_set,
    bench_storage,
    bench_context_config,
);

criterion_main!(benches);
