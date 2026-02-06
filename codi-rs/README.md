# codi-rs

Rust implementation of Codi - Your AI coding wingman.

## Status

Core feature parity with the TypeScript CLI is in place, and ongoing work is tracked in `docs/ROADMAP.md`.

### What's Now Complete:

✅ **Foundation & Core Infrastructure** - Complete Rust foundation with proper error handling, configuration, and CLI interface

✅ **Tool System** - Full file operations, shell commands, grep, glob, image analysis, and more

✅ **Multi-Provider Support** - Anthropic, OpenAI, Ollama, and OpenAI-compatible APIs with streaming and tool use

✅ **Agent Loop** - Complete agentic orchestration with tool execution, context management, and streaming responses

✅ **Symbol Index** - Tree-sitter based multi-language symbol extraction with fuzzy search and incremental indexing

✅ **RAG System** - Vector search using embeddings for semantic code search with SQLite storage  

✅ **Terminal UI** - Full ratatui-based interactive interface with sessions, streaming, and rich command support

✅ **Multi-Agent Orchestration** - Git worktree-based parallel workers with IPC permission bubbling

✅ **Test Suite** - Comprehensive 500+ test suite ensuring reliability across all components

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| **0** | Foundation - types, errors, config, CLI shell | ✅ Complete |
| **1** | Tool layer - file tools, grep, glob, bash | ✅ Complete |
| **2** | Provider layer - Anthropic, OpenAI, Ollama | ✅ Complete |
| **3** | Agent loop - core agentic orchestration | ✅ Complete |
| **4** | Symbol index - tree-sitter based code navigation | ✅ Complete |
| **5** | RAG system - vector search with embeddings | ✅ Complete |
| **6** | Terminal UI - ratatui based interface | ✅ Complete |
| **7** | Multi-agent - IPC-based worker orchestration | ✅ Complete |

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

### Agent Loop

```rust
use codi::agent::{Agent, AgentConfig, AgentOptions, AgentCallbacks};
use codi::tools::ToolRegistry;
use std::sync::Arc;

// Create provider and tool registry
let provider = anthropic("claude-sonnet-4-20250514")?;
let registry = Arc::new(ToolRegistry::with_defaults());

// Create agent
let mut agent = Agent::new(AgentOptions {
    provider,
    tool_registry: registry,
    system_prompt: Some("You are a helpful assistant.".to_string()),
    config: AgentConfig::default(),
    callbacks: AgentCallbacks::default(),
});

// Chat - handles the full agentic loop (message -> model -> tools -> repeat)
let response = agent.chat("Read the README and summarize it").await?;
```

**Agent Features:**
- Iterative tool calling loop
- Tool confirmation for destructive operations
- Auto-approval configuration
- Consecutive error tracking
- Turn statistics (tokens, costs, duration)

### Tools

All core file and shell tools are implemented:
- `read_file`, `write_file`, `edit_file` - File operations
- `glob`, `grep` - File search (globset, ripgrep-based)
- `bash` - Shell execution with timeout
- `list_directory` - Directory listing

### Advanced Code Navigation Tools (Completed!)

Newly implemented advanced tools that are now available:

**Symbol Index Tools:**
- `find_symbol` - Search for symbols across the codebase with fuzzy matching
- `manage_symbols` - Manage symbol index (rebuild, stats, incremental updates)

**RAG Semantic Search:**
- `rag_search` - Search using natural language queries with vector embeddings  
- `manage_rag` - Manage RAG vector index (build, stats, incremental updates)

These tools enable:
- Finding functions, classes, and methods by name across large codebases
- Semantic code search using natural language queries
- Advanced code navigation for refactoring and understanding

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
├── agent/            # Core agentic orchestration
│   ├── mod.rs        # Agent struct and chat loop
│   └── types.rs      # AgentConfig, callbacks, stats
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
