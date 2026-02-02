// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for the RAG system.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

use codi::rag::{
    ChunkerConfig, CodeChunk, CodeChunker, ChunkType, EmbeddingVector, RAGConfig, VectorStore,
};

/// Sample TypeScript code for chunking benchmarks.
const SAMPLE_TS: &str = r#"
import { Config, Options } from './config';
import * as utils from '../utils';

/**
 * Greet someone by name.
 */
export function greet(name: string): string {
    return `Hello, ${name}!`;
}

export class Greeter {
    private name: string;
    private config: Config;

    constructor(name: string, config?: Config) {
        this.name = name;
        this.config = config ?? new Config();
    }

    greet(): string {
        return greet(this.name);
    }

    async asyncGreet(): Promise<string> {
        return new Promise(resolve => {
            setTimeout(() => resolve(this.greet()), 100);
        });
    }
}

export interface GreetingOptions {
    formal: boolean;
    language: string;
}

export type GreetingType = 'formal' | 'casual' | 'friendly';

export enum GreetingLevel {
    Casual,
    Normal,
    Formal,
}

export const DEFAULT_NAME = 'World';
"#;

/// Sample Rust code for chunking benchmarks.
const SAMPLE_RUST: &str = r#"
//! Module documentation.

use std::collections::HashMap;
use std::sync::Arc;

/// Greet someone by name.
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

/// A greeter struct.
pub struct Greeter {
    name: String,
    config: Config,
}

impl Greeter {
    /// Create a new greeter.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            config: Config::default(),
        }
    }

    /// Greet using this greeter.
    pub fn greet(&self) -> String {
        greet(&self.name)
    }
}

/// Configuration options.
#[derive(Default)]
pub struct Config {
    debug: bool,
    level: GreetingLevel,
}

/// Greeting level.
pub enum GreetingLevel {
    Casual,
    Normal,
    Formal,
}

pub const DEFAULT_NAME: &str = "World";
"#;

fn bench_chunker_new(c: &mut Criterion) {
    c.bench_function("chunker_new", |b| {
        b.iter(|| {
            let chunker = CodeChunker::new();
            black_box(chunker)
        })
    });
}

fn bench_chunk_typescript(c: &mut Criterion) {
    let chunker = CodeChunker::new();
    let temp = tempdir().unwrap();
    let file_path = temp.path().join("test.ts");
    fs::write(&file_path, SAMPLE_TS).unwrap();

    c.bench_function("chunk_typescript", |b| {
        b.iter(|| {
            let chunks = chunker
                .chunk_file(&file_path, black_box(SAMPLE_TS), temp.path())
                .unwrap();
            black_box(chunks)
        })
    });
}

fn bench_chunk_rust(c: &mut Criterion) {
    let chunker = CodeChunker::new();
    let temp = tempdir().unwrap();
    let file_path = temp.path().join("test.rs");
    fs::write(&file_path, SAMPLE_RUST).unwrap();

    c.bench_function("chunk_rust", |b| {
        b.iter(|| {
            let chunks = chunker
                .chunk_file(&file_path, black_box(SAMPLE_RUST), temp.path())
                .unwrap();
            black_box(chunks)
        })
    });
}

fn bench_vector_store_open(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();

    c.bench_function("vector_store_open", |b| {
        b.iter(|| {
            let store = VectorStore::open(black_box(project_root), 384).unwrap();
            black_box(store)
        })
    });
}

fn bench_vector_store_upsert(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();
    let store = VectorStore::open(project_root, 384).unwrap();

    let embedding: Vec<f32> = (0..384).map(|i| (i as f32) / 384.0).collect();

    c.bench_function("vector_store_upsert", |b| {
        let mut counter = 0u64;
        b.iter(|| {
            counter += 1;
            let chunk = CodeChunk::new(
                format!("fn func_{counter}() {{}}", counter = counter),
                format!("/test/file_{}.rs", counter),
                format!("file_{}.rs", counter),
                1,
                1,
                "rust".to_string(),
                ChunkType::Function,
                Some(format!("func_{}", counter)),
            );
            store.upsert(&chunk, black_box(&embedding)).unwrap();
        })
    });
}

fn bench_vector_store_query(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();
    let store = VectorStore::open(project_root, 384).unwrap();

    // Insert some data
    for i in 0..100 {
        let chunk = CodeChunk::new(
            format!("fn func_{}() {{}}", i),
            format!("/test/file_{}.rs", i),
            format!("file_{}.rs", i),
            1,
            1,
            "rust".to_string(),
            ChunkType::Function,
            Some(format!("func_{}", i)),
        );
        let embedding: Vec<f32> = (0..384).map(|j| ((i + j) as f32) / 384.0).collect();
        store.upsert(&chunk, &embedding).unwrap();
    }

    let query_embedding: Vec<f32> = (0..384).map(|i| (i as f32) / 384.0).collect();

    c.bench_function("vector_store_query_100", |b| {
        b.iter(|| {
            let results = store.query(black_box(&query_embedding), 10, 0.5).unwrap();
            black_box(results)
        })
    });
}

fn bench_cosine_similarity(c: &mut Criterion) {
    let a: Vec<f32> = (0..384).map(|i| (i as f32) / 384.0).collect();
    let b: Vec<f32> = (0..384).map(|i| ((384 - i) as f32) / 384.0).collect();

    c.bench_function("cosine_similarity_384d", |b_iter| {
        b_iter.iter(|| {
            let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
            let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
            let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
            let sim = dot_product / (norm_a * norm_b);
            black_box(sim)
        })
    });
}

fn bench_embedding_serialization(c: &mut Criterion) {
    let embedding: Vec<f32> = (0..768).map(|i| (i as f32) / 768.0).collect();

    c.bench_function("embedding_serialize_768d", |b| {
        b.iter(|| {
            let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
            black_box(bytes)
        })
    });

    let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

    c.bench_function("embedding_deserialize_768d", |b| {
        b.iter(|| {
            let restored: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|chunk| {
                    let arr: [u8; 4] = chunk.try_into().unwrap();
                    f32::from_le_bytes(arr)
                })
                .collect();
            black_box(restored)
        })
    });
}

criterion_group!(
    benches,
    bench_chunker_new,
    bench_chunk_typescript,
    bench_chunk_rust,
    bench_vector_store_open,
    bench_vector_store_upsert,
    bench_vector_store_query,
    bench_cosine_similarity,
    bench_embedding_serialization,
);

criterion_main!(benches);
