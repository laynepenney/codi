---
name: codi-rs
description: Codi AI coding wingman (Rust implementation). Use when working on the Rust port in codi-rs/ - the agent, TUI, providers, tools, MCP, or any Rust source.
allowed-tools: Bash(cargo *)
---

# Codi Rust Implementation

Rust port of Codi, located in `codi-rs/` within the codi repo.

## Build / Test / Bench

```bash
cd codi-rs
cargo build                # Debug build
cargo build --release      # Release build
cargo test                 # Run tests
cargo test -- --nocapture  # Show output
cargo clippy               # Lint
cargo fmt                  # Format
cargo bench                # Run benchmarks
```

## Architecture

```
src/
├── main.rs           # CLI entry (clap)
├── lib.rs            # Library exports
├── agent/            # Core agent loop
├── cli/              # CLI command implementations
├── config/           # Configuration
├── providers/        # AI model backends
├── tools/            # Filesystem interaction tools
├── tui/              # Terminal UI (ratatui + crossterm)
├── mcp/              # Model Context Protocol (rmcp)
├── orchestrate/      # Multi-agent orchestration
├── rag/              # RAG system (embeddings)
├── symbol_index/     # SQLite code navigation (tree-sitter)
├── model_map/        # Multi-model orchestration
├── session/          # Session persistence
├── lsp/              # Language Server Protocol
├── completion/       # Shell completions
├── telemetry/        # Tracing and metrics
├── error.rs          # Error types
└── types.rs          # Core types
```

## Key Dependencies

- **tokio** - Async runtime
- **clap** - CLI argument parsing
- **ratatui + crossterm** - Terminal UI
- **reqwest** - HTTP client
- **serde + serde_json + serde_yaml** - Serialization
- **tree-sitter** - Code parsing for symbol index
- **rmcp** - MCP protocol
- **rusqlite** - SQLite for symbol index
- **indicatif** - Progress bars

## Coding Conventions

- **anyhow** for application errors, **thiserror** for library errors
- **async-trait** for async trait methods
- Use `colored` for terminal output
- Follow standard Rust idioms (clippy clean)
- Tests alongside modules or in `tests/`

## Feature Flags

```toml
[features]
default = ["telemetry"]
telemetry = []                              # Tracing spans and metrics
release-logs = ["tracing/release_max_level_info"]  # Strip debug logs in release
max-perf = ["tracing/max_level_off"]        # Disable all tracing
```
