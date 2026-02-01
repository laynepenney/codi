# codi-rs

Rust implementation of Codi - Your AI coding wingman.

## Status: Phase 0 (Foundation)

This is the Rust implementation of Codi, being developed incrementally alongside the TypeScript version. The migration is structured in phases:

| Phase | Description | Status |
|-------|-------------|--------|
| **0** | Foundation - types, errors, config, CLI shell | Complete |
| 1 | Tool layer - file tools, grep, glob, bash | Planned |
| 2 | Provider layer - Anthropic, OpenAI, Ollama | Planned |
| 3 | Agent loop - core agentic orchestration | Planned |
| 4 | Symbol index - tree-sitter based code navigation | Planned |
| 5 | RAG system - vector search with lance | Planned |
| 6 | Terminal UI - ratatui based interface | Planned |
| 7 | Multi-agent - IPC-based worker orchestration | Planned |

## Building

```bash
cargo build            # Debug build
cargo build --release  # Optimized release build
cargo test             # Run tests
```

## Usage

```bash
# Show version
codi --version

# Show help
codi --help

# Show configuration
codi config show

# Show example configuration
codi config example

# Initialize config file
codi init

# Run a prompt (stub - not yet implemented)
codi -P "explain this code" src/main.rs
```

## Architecture

```
src/
├── main.rs           # CLI entry point (clap)
├── lib.rs            # Library exports
├── types.rs          # Core types (Message, ToolDefinition, etc.)
├── error.rs          # Error types (thiserror)
└── config/           # Configuration module
    ├── mod.rs        # Module exports and load_config()
    ├── types.rs      # Config type definitions
    ├── loader.rs     # File loading
    └── merger.rs     # Config merging with precedence
```

## Configuration

Configuration files are searched in this order:
1. `.codi.json`
2. `.codi/config.json`
3. `codi.config.json`

Additionally:
- Global config: `~/.codi/config.json`
- Local overrides: `.codi.local.json`

Precedence (highest to lowest):
1. CLI options
2. Local config
3. Workspace config
4. Global config
5. Default values

## License

AGPL-3.0-or-later
