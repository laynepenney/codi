# codi-rs

Rust implementation of Codi - Your AI coding wingman.

## Status: Phase 2 Complete (Provider Layer)

This is the Rust implementation of Codi, being developed incrementally alongside the TypeScript version. The migration is structured in phases:

| Phase | Description | Status |
|-------|-------------|--------|
| **0** | Foundation - types, errors, config, CLI shell | ✅ Complete |
| **1** | Tool layer - file tools, grep, glob, bash | ✅ Complete |
| **2** | Provider layer - Anthropic, OpenAI, Ollama | ✅ Complete |
| 3 | Agent loop - core agentic orchestration | Planned |
| 4 | Symbol index - tree-sitter based code navigation | Planned |
| 5 | RAG system - vector search with lance | Planned |
| 6 | Terminal UI - ratatui based interface | Planned |
| 7 | Multi-agent - IPC-based worker orchestration | Planned |

## Features

### Providers

```rust
use codi::{anthropic, openai, ollama, create_provider_from_env};

// Auto-detect from environment (checks ANTHROPIC_API_KEY, OPENAI_API_KEY)
let provider = create_provider_from_env()?;

// Or use convenience functions
let claude = anthropic("claude-sonnet-4-20250514")?;
let gpt = openai("gpt-4o")?;
let local = ollama("llama3.2");
```

**Supported Providers:**
- **Anthropic** - Full Claude API with streaming, tool use, vision, extended thinking
- **OpenAI** - GPT models with streaming and tool use
- **Ollama** - Local models, no API key required
- **Any OpenAI-compatible API** - Azure, Together, Groq, etc.

### Tools

All core file and shell tools are implemented:
- `read_file`, `write_file`, `edit_file` - File operations
- `glob`, `grep` - File search (globset, ripgrep-based)
- `bash` - Shell execution with timeout
- `list_directory` - Directory listing

### Telemetry

Built-in observability infrastructure:
- Operation timing metrics
- Token usage tracking
- Tracing with correlation IDs
- Feature-gated (`--features telemetry`)

## Building

```bash
cargo build            # Debug build
cargo build --release  # Optimized release build
cargo test             # Run tests (142 tests)
cargo bench            # Run benchmarks
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

# Run a prompt (requires agent loop - Phase 3)
codi -P "explain this code" src/main.rs
```

## Architecture

```
src/
├── main.rs           # CLI entry point (clap)
├── lib.rs            # Library exports
├── types.rs          # Core types (Message, ToolDefinition, Provider, etc.)
├── error.rs          # Error types (thiserror)
├── config/           # Configuration module
│   ├── mod.rs        # Module exports and load_config()
│   ├── types.rs      # Config type definitions
│   ├── loader.rs     # File loading
│   └── merger.rs     # Config merging with precedence
├── providers/        # AI provider implementations
│   ├── mod.rs        # Factory functions, ProviderType
│   ├── anthropic.rs  # Anthropic Claude provider
│   └── openai.rs     # OpenAI-compatible provider
├── tools/            # Tool implementations
│   ├── mod.rs        # Tool traits and utilities
│   ├── registry.rs   # Tool registration and dispatch
│   └── handlers/     # Individual tool handlers
└── telemetry/        # Observability infrastructure
    ├── mod.rs        # Module exports
    ├── metrics.rs    # Global metrics collection
    ├── spans.rs      # Span utilities
    └── init.rs       # Telemetry initialization
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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (auto-selects Anthropic provider) |
| `OPENAI_API_KEY` | OpenAI API key (auto-selects OpenAI provider) |
| `CODI_PROVIDER` | Override provider selection (anthropic, openai, ollama) |
| `CODI_MODEL` | Override default model |

## Benchmarks

Run benchmarks with:

```bash
cargo bench --bench providers  # Provider operations
cargo bench --bench tools      # Tool operations
cargo bench --bench config     # Config loading
```

## License

AGPL-3.0-or-later
