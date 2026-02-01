// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Benchmarks for the symbol index system.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;
use tokio::runtime::Runtime;
use tokio::sync::Mutex;

use codi::symbol_index::{
    CodeSymbol, ExtractionMethod, IndexBuildOptions, Indexer, SymbolDatabase, SymbolIndexService,
    SymbolKind, SymbolParser, SymbolVisibility,
};

/// Sample TypeScript code for parsing benchmarks.
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

/// Sample Rust code for parsing benchmarks.
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

/// A greeting trait.
pub trait Greetable {
    fn greet(&self) -> String;
}

impl Greetable for Greeter {
    fn greet(&self) -> String {
        self.greet()
    }
}

pub const DEFAULT_NAME: &str = "World";
"#;

/// Sample Python code for parsing benchmarks.
const SAMPLE_PYTHON: &str = r#"
"""Module documentation."""

from typing import Optional, List
from dataclasses import dataclass
import asyncio


def greet(name: str) -> str:
    """Greet someone by name."""
    return f"Hello, {name}!"


class Greeter:
    """A greeter class."""

    def __init__(self, name: str, config: Optional["Config"] = None):
        self.name = name
        self.config = config or Config()

    def greet(self) -> str:
        """Greet using this greeter."""
        return greet(self.name)

    async def async_greet(self) -> str:
        """Async greet."""
        await asyncio.sleep(0.1)
        return self.greet()


@dataclass
class Config:
    """Configuration options."""
    debug: bool = False
    level: str = "normal"


DEFAULT_NAME = "World"
"#;

fn bench_parser_new(c: &mut Criterion) {
    c.bench_function("parser_new", |b| {
        b.iter(|| {
            let parser = SymbolParser::new().unwrap();
            black_box(parser)
        })
    });
}

fn bench_parse_typescript(c: &mut Criterion) {
    let mut parser = SymbolParser::new().unwrap();
    let path = PathBuf::from("test.ts");

    c.bench_function("parse_typescript", |b| {
        b.iter(|| {
            let result = parser.parse_file(&path, black_box(SAMPLE_TS)).unwrap();
            black_box(result)
        })
    });
}

fn bench_parse_rust(c: &mut Criterion) {
    let mut parser = SymbolParser::new().unwrap();
    let path = PathBuf::from("test.rs");

    c.bench_function("parse_rust", |b| {
        b.iter(|| {
            let result = parser.parse_file(&path, black_box(SAMPLE_RUST)).unwrap();
            black_box(result)
        })
    });
}

fn bench_parse_python(c: &mut Criterion) {
    let mut parser = SymbolParser::new().unwrap();
    let path = PathBuf::from("test.py");

    c.bench_function("parse_python", |b| {
        b.iter(|| {
            let result = parser.parse_file(&path, black_box(SAMPLE_PYTHON)).unwrap();
            black_box(result)
        })
    });
}

fn bench_parse_various_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_file_size");
    let mut parser = SymbolParser::new().unwrap();
    let path = PathBuf::from("test.ts");

    for size in [10, 50, 100, 200] {
        let content = generate_ts_file(size);
        group.throughput(Throughput::Bytes(content.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), &content, |b, content| {
            b.iter(|| {
                let result = parser.parse_file(&path, black_box(content)).unwrap();
                black_box(result)
            })
        });
    }
    group.finish();
}

fn bench_database_open(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();

    c.bench_function("database_open", |b| {
        b.iter(|| {
            let db = SymbolDatabase::open(black_box(project_root)).unwrap();
            black_box(db)
        })
    });
}

fn bench_database_upsert_file(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();
    let db = SymbolDatabase::open(project_root).unwrap();

    c.bench_function("database_upsert_file", |b| {
        let mut counter = 0u64;
        b.iter(|| {
            counter += 1;
            let path = format!("src/file_{}.ts", counter);
            let hash = format!("hash_{}", counter);
            let file_id = db
                .upsert_file(&path, &hash, ExtractionMethod::TreeSitter)
                .unwrap();
            black_box(file_id)
        })
    });
}

fn bench_database_insert_symbols(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();
    let db = SymbolDatabase::open(project_root).unwrap();
    let file_id = db
        .upsert_file("test.ts", "hash", ExtractionMethod::TreeSitter)
        .unwrap();

    let symbols = generate_symbols(50);

    c.bench_function("database_insert_symbols_50", |b| {
        b.iter(|| {
            db.insert_symbols(file_id, black_box(&symbols)).unwrap();
        })
    });
}

fn bench_database_find_symbols(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();
    let db = SymbolDatabase::open(project_root).unwrap();

    // Insert some symbols
    let file_id = db
        .upsert_file("test.ts", "hash", ExtractionMethod::TreeSitter)
        .unwrap();
    let symbols = generate_symbols(100);
    db.insert_symbols(file_id, &symbols).unwrap();

    c.bench_function("database_find_symbols", |b| {
        b.iter(|| {
            let results = db.find_symbols(black_box("Symbol"), 20).unwrap();
            black_box(results)
        })
    });
}

fn bench_database_get_stats(c: &mut Criterion) {
    let temp = tempdir().unwrap();
    let project_root = temp.path().to_str().unwrap();
    let db = SymbolDatabase::open(project_root).unwrap();

    // Insert some data
    let file_id = db
        .upsert_file("test.ts", "hash", ExtractionMethod::TreeSitter)
        .unwrap();
    db.insert_symbols(file_id, &generate_symbols(50)).unwrap();

    c.bench_function("database_get_stats", |b| {
        b.iter(|| {
            let stats = db.get_stats().unwrap();
            black_box(stats)
        })
    });
}

fn bench_indexer_collect_files(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let temp = tempdir().unwrap();
    let project_root = temp.path();

    // Create some test files
    fs::create_dir(project_root.join("src")).unwrap();
    for i in 0..50 {
        fs::write(project_root.join(format!("src/file_{}.ts", i)), SAMPLE_TS).unwrap();
    }

    let options = IndexBuildOptions {
        project_root: project_root.to_str().unwrap().to_string(),
        ..Default::default()
    };
    let indexer = Indexer::new(options).unwrap();

    c.bench_function("indexer_collect_files", |b| {
        b.iter(|| {
            // Access private method via reflection or test helper
            // For now, we benchmark the full index_all which includes collection
        })
    });
}

fn bench_service_build(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("service_build");

    for file_count in [10, 50, 100] {
        let temp = tempdir().unwrap();
        let project_root = temp.path();

        // Create test files
        fs::create_dir(project_root.join("src")).unwrap();
        for i in 0..file_count {
            fs::write(project_root.join(format!("src/file_{}.ts", i)), SAMPLE_TS).unwrap();
        }

        group.bench_with_input(
            BenchmarkId::from_parameter(file_count),
            &project_root,
            |b, project_root| {
                b.iter(|| {
                    rt.block_on(async {
                        let service = SymbolIndexService::new(project_root.to_str().unwrap())
                            .await
                            .unwrap();
                        let result = service.build(true).await.unwrap();
                        black_box(result)
                    })
                })
            },
        );
    }

    group.finish();
}

fn bench_service_find_symbols(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let temp = tempdir().unwrap();
    let project_root = temp.path();

    // Create test files with symbols
    fs::create_dir(project_root.join("src")).unwrap();
    for i in 0..20 {
        fs::write(project_root.join(format!("src/file_{}.ts", i)), SAMPLE_TS).unwrap();
    }

    let service = rt.block_on(async {
        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();
        service.build(false).await.unwrap();
        service
    });

    c.bench_function("service_find_symbols", |b| {
        b.iter(|| {
            rt.block_on(async {
                let results = service.find_symbols(black_box("Greeter"), None).await.unwrap();
                black_box(results)
            })
        })
    });
}

fn bench_service_get_stats(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let temp = tempdir().unwrap();
    let project_root = temp.path();

    fs::write(project_root.join("test.ts"), SAMPLE_TS).unwrap();

    let service = rt.block_on(async {
        let service = SymbolIndexService::new(project_root.to_str().unwrap())
            .await
            .unwrap();
        service.build(false).await.unwrap();
        service
    });

    c.bench_function("service_get_stats", |b| {
        b.iter(|| {
            rt.block_on(async {
                let stats = service.get_stats().await.unwrap();
                black_box(stats)
            })
        })
    });
}

// Helper functions

fn generate_ts_file(function_count: usize) -> String {
    let mut content = String::new();
    content.push_str("import { Config } from './config';\n\n");

    for i in 0..function_count {
        content.push_str(&format!(
            r#"
export function func{}(arg: string): string {{
    return arg.toUpperCase();
}}
"#,
            i
        ));
    }

    for i in 0..function_count / 4 {
        content.push_str(&format!(
            r#"
export class Class{} {{
    private value: number;

    constructor() {{
        this.value = {};
    }}

    getValue(): number {{
        return this.value;
    }}
}}
"#,
            i, i
        ));
    }

    content
}

fn generate_symbols(count: usize) -> Vec<CodeSymbol> {
    (0..count)
        .map(|i| CodeSymbol {
            name: format!("Symbol{}", i),
            kind: if i % 3 == 0 {
                SymbolKind::Function
            } else if i % 3 == 1 {
                SymbolKind::Class
            } else {
                SymbolKind::Interface
            },
            line: (i + 1) as u32,
            end_line: Some((i + 10) as u32),
            column: 0,
            visibility: SymbolVisibility::Public,
            signature: Some(format!("function Symbol{}(): void", i)),
            doc_summary: Some(format!("Documentation for Symbol{}", i)),
            metadata: None,
        })
        .collect()
}

criterion_group!(
    benches,
    bench_parser_new,
    bench_parse_typescript,
    bench_parse_rust,
    bench_parse_python,
    bench_parse_various_sizes,
    bench_database_open,
    bench_database_upsert_file,
    bench_database_insert_symbols,
    bench_database_find_symbols,
    bench_database_get_stats,
    bench_service_build,
    bench_service_find_symbols,
    bench_service_get_stats,
);

criterion_main!(benches);
