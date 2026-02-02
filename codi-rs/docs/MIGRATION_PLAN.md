# Plan: Migrate Codi from TypeScript to Rust

## Executive Summary

Migrate Codi CLI (~58,000 lines TypeScript, 188 files) to Rust using an **incremental hybrid approach**. A Rust core is developed alongside TypeScript with JSON-RPC interoperability, enabling gradual migration while maintaining a working product.

**Estimated Timeline**: 12-14 months (with 2 developers)
**Effort**: ~70 person-weeks

---

## Architectural Review (2026-02-01)

### Current Rust Implementation Status

```
codi-rs: ~18,300 lines | 45 files | Phases 0-5 complete
```

### Reference Implementation Comparison

| Feature | Codi-RS | Codex-RS | Crush | OpenCode | Codi-TS |
|---------|---------|----------|-------|----------|---------|
| Agent Loop | ✅ | ✅ | ✅ | ✅ | ✅ |
| Providers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tools | ✅ | ✅ | ✅ | ✅ | ✅ |
| Symbol Index | ✅ | ❌ | ❌ | ❌ | ✅ |
| RAG System | ✅ | ❌ | ❌ | ❌ | ✅ |
| MCP Protocol | ❌ | ✅ | ✅ | ✅ | ✅ |
| Sandboxing | ❌ | ✅ | ❌ | ✅ | ❌ |
| Terminal UI | ❌ | ✅ | ✅ | ❌ | ✅ |
| Session Mgmt | ❌ | ✅ | ✅ | ✅ | ✅ |
| Context Windowing | ❌ | ✅ | ✅ | ✅ | ✅ |
| LSP Integration | ❌ | ❌ | ✅ | ✅ | ❌ |
| OAuth/Auth | ❌ | ✅ | ✅ | ✅ | ❌ |
| Worktrees | ❌ | ❌ | ❌ | ✅ | ✅ |

### Key Insights from Reference Implementations

**Codex-RS (OpenAI)** - ~30 crates, very modular:
- Separate crates for `mcp-types`, `mcp-server`, `rmcp-client`
- Strong security focus: `linux-sandbox`, `windows-sandbox`, `network-proxy`, `execpolicy`
- `keyring-store` for credential management
- Massive TUI (~240KB `chatwidget.rs`, streaming markdown)
- OpenTelemetry via `otel` crate

**Crush (Charm)** - Go with bubbletea:
- Uses `fantasy` library for provider abstraction (like our `Provider` trait)
- Auto-summarization when context window fills (largeContextWindowThreshold = 200K)
- Message queuing for busy sessions
- Title generation using small model
- Todo tracking built into agent
- LSP integration for diagnostics
- Provider-specific workarounds (media in tool results for non-Anthropic)

**OpenCode** - Go/TypeScript hybrid:
- LSP integration for language features
- PTY handling for proper terminal emulation
- Scheduler for background tasks
- Skill system (extensible commands)
- Session sharing capabilities
- Snapshot/restore for checkpoints
- VSCode extension (`sdks/vscode`)

### Missing Features (Priority Order)

**Critical (Phase 6-7 blockers):**
1. **Session Management** - Persistence, resume, history listing
2. **Context Windowing** - Token counting, auto-summarization
3. **Streaming Output** - Real-time callbacks for TUI integration

**High Priority (Feature parity):**
4. **MCP Protocol** - Client/server for extensibility
5. **Slash Commands** - User command system
6. **File Watching** - notify crate for incremental updates

**Medium Priority (Polish):**
7. **OAuth/Auth** - Keyring integration, provider auth
8. **Title Generation** - Session naming from first message
9. **Message Queuing** - Handle concurrent requests

**Low Priority (Advanced):**
10. **Sandboxing** - Process isolation (complex, OS-specific)
11. **LSP Integration** - Language server features
12. **Worktrees** - Git worktree management

### Recommended Changes

1. **Add Session Module (Phase 5.1)** - Before TUI, we need session persistence
2. **Add Context Windowing (Phase 5.2)** - Critical for long conversations
3. **Split MCP into Phase 6.5** - Between TUI and Multi-Agent
4. **Consider Modular Crates** - Follow Codex-RS pattern for large modules

---

## Current State Analysis

### Codi TypeScript Architecture
```
~58,000 lines | 188 files | Node.js 22+
```

| Component | Files | Lines | Complexity |
|-----------|-------|-------|------------|
| Agent Loop | 3 | ~2,600 | Very High |
| CLI/REPL | 9 | ~3,000 | Medium |
| Providers | 10 | ~2,000 | Medium |
| Tools | 25 | ~4,000 | Medium |
| Commands | 24 | ~3,500 | Medium |
| Symbol Index | 15 | ~3,000 | High |
| RAG System | 10 | ~2,000 | High |
| Multi-Agent | 10 | ~2,500 | High |
| Model Map | 17 | ~3,000 | Medium |
| Other | ~65 | ~34,000 | Various |

### Key Dependencies to Replace

| TypeScript | Rust Replacement |
|------------|------------------|
| `@anthropic-ai/sdk` | Custom reqwest client |
| `openai` | `async-openai` |
| `commander` | `clap` (derive) |
| `ink` + `react` | `ratatui` + `crossterm` |
| `ts-morph` | `tree-sitter` |
| `vectra` | `lance` (embedded vector DB) |
| `better-sqlite3` | `rusqlite` |
| `chalk` | `colored` |
| `ora` | `indicatif` |

---

## Migration Strategy: Incremental Hybrid

### Why Not Full Rewrite?
- 58K LOC rewrite is 12-18 months with high failure risk
- No releases during migration period
- Team can't build Rust expertise gradually

### Hybrid Approach
1. Rust and TypeScript coexist via JSON-RPC
2. Components migrate individually
3. Each phase delivers working improvements
4. TypeScript remains fallback during transition

---

## Phased Migration Plan

### Phase 0: Foundation (Weeks 1-4) ✅ COMPLETE
**Goal**: Establish Rust project structure

| Task | Status |
|------|--------|
| Cargo workspace setup | ✅ Done |
| Core types (Message, ToolDefinition, etc.) | ✅ Done |
| Error handling (thiserror + anyhow) | ✅ Done |
| Config loading (YAML/JSON with serde) | ✅ Done |
| Basic CLI shell (clap) | ✅ Done |

**Deliverable**: `codi-rs` with `codi --version` working ✅

### Phase 1: Tool Layer (Weeks 5-12) ✅ COMPLETE
**Goal**: Migrate file/shell tools for performance

| Tool | Status | Notes |
|------|--------|-------|
| read-file, write-file, edit-file | ✅ Done | Core operations |
| glob, grep | ✅ Done | Using `globset`, `grep` crate |
| bash | ✅ Done | Process execution with timeout |
| list-directory | ✅ Done | With hidden files support |
| Telemetry infrastructure | ✅ Done | Metrics, tracing, spans |
| Tool benchmarks | ✅ Done | Criterion-based |

**Deliverable**: Tools callable from TypeScript via JSON-RPC ✅

### Phase 2: Provider Layer (Weeks 13-20) ✅ COMPLETE
**Goal**: Migrate AI provider integrations

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    async fn chat(&self, request: ChatRequest) -> Result<ProviderResponse, ProviderError>;
    async fn stream_chat(&self, request: ChatRequest) -> Result<StreamHandle, ProviderError>;
    fn supports_tool_use(&self) -> bool;
    fn supports_vision(&self) -> bool;
    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError>;
}
```

| Provider | Status | Notes |
|----------|--------|-------|
| Anthropic | ✅ Done | Full streaming SSE, tool use, vision, extended thinking |
| OpenAI | ✅ Done | OpenAI-compatible (supports OpenAI, Ollama, Azure, any compatible API) |
| Ollama | ✅ Done | Via OpenAI-compatible provider, no API key required |
| Smart defaults | ✅ Done | Auto-detect from env vars, local-first fallback |
| Telemetry | ✅ Done | Operation timing, token tracking |
| Benchmarks | ✅ Done | Provider creation, serialization, parsing |

**Key Features Implemented**:
- `create_provider_from_env()` - Auto-detects provider from environment
- Convenience functions: `anthropic()`, `openai()`, `ollama()`, `ollama_at()`
- Provider auto-detection from base URL
- Feature-gated telemetry integration

**Deliverable**: Rust providers with streaming, callable from TypeScript ✅

### Phase 3: Agent Loop (Weeks 21-28) ✅ COMPLETE
**Goal**: Migrate core agentic orchestration

| Component | Status | Notes |
|-----------|--------|-------|
| Agent core | ✅ Done | Central orchestration loop |
| Tool execution | ✅ Done | Sequential execution with callbacks |
| Confirmations | ✅ Done | Destructive tool approval flow |
| Turn stats | ✅ Done | Token/cost/duration tracking |
| Telemetry | ✅ Done | GLOBAL_METRICS integration |
| Benchmarks | ✅ Done | Criterion-based agent benchmarks |
| Context windowing | 🔜 Planned | Token management |
| Compression | 🔜 Planned | Entity normalization |
| Parallel execution | 🔜 Planned | Batch tool calls |
| Streaming | 🔜 Planned | Real-time output via callbacks |

**Implemented Features**:
- `Agent.chat()` - Main agentic loop
- `AgentConfig` - Iteration limits, timeouts, auto-approval
- `AgentCallbacks` - Event hooks for UI integration
- `TurnStats` - Usage tracking per turn
- Tool confirmation for destructive operations

**Deliverable**: Rust agent loop for full conversations ✅

### Phase 4: Symbol Index (Weeks 29-36) ✅ COMPLETE
**Goal**: Replace ts-morph with tree-sitter

| Component | Status | Notes |
|-----------|--------|-------|
| Type definitions | ✅ Done | SymbolKind, CodeSymbol, ImportStatement, etc. |
| SQLite database | ✅ Done | Schema, CRUD operations, fuzzy search |
| Tree-sitter parser | ✅ Done | TS, JS, Rust, Python, Go support |
| Background indexer | ✅ Done | Parallel file processing with tokio |
| High-level service | ✅ Done | SymbolIndexService API |
| Telemetry | ✅ Done | All operations record metrics |
| Benchmarks | ✅ Done | Parser, database, service benchmarks |

**Tracked for Phase 4.1** (Issue #229):
- File watcher with `notify` crate
- Deep indexing with usage detection
- Additional language support

**Implemented Features**:
- `SymbolParser` - Tree-sitter based multi-language parsing
- `SymbolDatabase` - SQLite storage with fuzzy search
- `Indexer` - Parallel file indexing with progress tracking
- `SymbolIndexService` - High-level API for build, search, stats
- Incremental updates (only re-index changed files)
- 35 unit tests passing

**Deliverable**: PR #228 merged ✅

### Phase 5: RAG System (Weeks 37-42) ✅ COMPLETE
**Goal**: Replace vectra with Rust vector search

| Component | Status | Notes |
|-----------|--------|-------|
| Types | ✅ Done | CodeChunk, RAGConfig, RetrievalResult, etc. |
| Embedding providers | ✅ Done | OpenAI and Ollama support |
| Embedding cache | ✅ Done | LRU cache with TTL |
| Code chunker | ✅ Done | Semantic chunking for TS, JS, Rust, Python, Go |
| Vector store | ✅ Done | SQLite-based with cosine similarity |
| Background indexer | ✅ Done | Parallel file processing, incremental updates |
| Retriever | ✅ Done | Query interface with formatted output |
| RAGService | ✅ Done | High-level unified API |
| Telemetry | ✅ Done | All operations record metrics |
| Benchmarks | ✅ Done | Criterion-based |

**Files Created** (~3,100 lines):
- `src/rag/types.rs` - Type definitions
- `src/rag/embeddings/` - Embedding providers (OpenAI, Ollama, cache)
- `src/rag/chunker.rs` - Semantic code chunking
- `src/rag/vector_store.rs` - SQLite-based vector storage
- `src/rag/indexer.rs` - Background file indexer
- `src/rag/retriever.rs` - Query interface
- `src/rag/mod.rs` - Module exports + RAGService
- `benches/rag.rs` - Benchmarks

**Deliverable**: PR #230 (pending review)

### Phase 5.5: Session & Context (NEW - Weeks 43-46)
**Goal**: Add session persistence and context management (required before TUI)

| Component | Status | Notes |
|-----------|--------|-------|
| Session types | 🔜 Planned | Session, Message, history types |
| Session storage | 🔜 Planned | SQLite persistence |
| Session service | 🔜 Planned | Create, resume, list, delete |
| Context windowing | 🔜 Planned | Token counting, truncation |
| Auto-summarization | 🔜 Planned | Compress context when full (see Crush) |
| Title generation | 🔜 Planned | Generate titles from first message |
| Message queuing | 🔜 Planned | Queue requests for busy sessions |

**Reference**: Crush `internal/session/`, `internal/agent/agent.go` (lines 560-671)

### Phase 6: Terminal UI (Weeks 47-52)
**Goal**: Replace ink/React with ratatui

| Component | Status | Notes |
|-----------|--------|-------|
| Core TUI framework | 🔜 Planned | ratatui + crossterm |
| Input handling | 🔜 Planned | rustyline for readline |
| Streaming markdown | 🔜 Planned | Real-time rendering (see Codex chatwidget.rs) |
| Diff rendering | 🔜 Planned | Syntax-highlighted diffs |
| Spinners/progress | 🔜 Planned | indicatif |
| Session picker | 🔜 Planned | Resume previous sessions |
| Slash commands | 🔜 Planned | /help, /clear, /model, etc. |

**Reference**: Codex `tui/src/` (~1MB of TUI code)

### Phase 6.5: MCP Protocol (NEW - Weeks 53-56)
**Goal**: Model Context Protocol for extensibility

| Component | Status | Notes |
|-----------|--------|-------|
| MCP types | 🔜 Planned | Separate crate like Codex |
| MCP client | 🔜 Planned | Connect to MCP servers |
| MCP server | 🔜 Planned | Expose tools as MCP |
| Tool wrapping | 🔜 Planned | Wrap external tools |

**Reference**: Codex `mcp-types/`, `mcp-server/`, `rmcp-client/`

### Phase 7: Multi-Agent (Weeks 57-60)
**Goal**: Port IPC-based worker orchestration

| Component | Status | Notes |
|-----------|--------|-------|
| Child agent | 🔜 Planned | Spawn sub-agents |
| IPC protocol | 🔜 Planned | Unix sockets with tokio |
| Commander | 🔜 Planned | Orchestrate multiple agents |
| Worktrees | 🔜 Planned | Git worktree management |

**Reference**: Codi-TS `orchestrate/`

### Phase 8: Security & Polish (NEW - Weeks 61-64)
**Goal**: Production hardening

| Component | Status | Notes |
|-----------|--------|-------|
| Command safety | 🔜 Planned | Dangerous command detection |
| Process sandboxing | 🔜 Planned | Optional isolation (OS-specific) |
| Credential storage | 🔜 Planned | Keyring integration |
| OAuth flows | 🔜 Planned | Provider authentication |
| Error recovery | 🔜 Planned | Graceful degradation |

**Reference**: Codex `execpolicy/`, `linux-sandbox/`, `keyring-store/`

---

## Rust Crate Mapping (Current)

```toml
[dependencies]
# Async
tokio = { version = "1", features = ["full"] }
async-trait = "0.1"

# CLI
clap = { version = "4", features = ["derive"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"

# HTTP
reqwest = { version = "0.12", features = ["json", "stream", "rustls-tls"] }

# Database
rusqlite = { version = "0.32", features = ["bundled"] }

# AST
tree-sitter = "0.24"
tree-sitter-typescript = "0.23"
tree-sitter-javascript = "0.23"
tree-sitter-rust = "0.23"
tree-sitter-python = "0.23"
tree-sitter-go = "0.23"

# Utilities
globset = "0.4"
grep = "0.3"
walkdir = "2"
sha2 = "0.10"
chrono = "0.4"
lru = "0.12"
anyhow = "1"
thiserror = "1"
tracing = "0.1"

# Benchmarks
[dev-dependencies]
criterion = "0.5"
```

## Planned Dependencies (Phase 5.5+)

```toml
# Terminal UI (Phase 6)
ratatui = "0.29"
crossterm = "0.28"
rustyline = "14"
indicatif = "0.17"

# Token counting (Phase 5.5)
tiktoken-rs = "0.6"

# File watching (Phase 4.1/5.5)
notify = "7"

# MCP (Phase 6.5)
jsonrpsee = "0.24"

# Git (Phase 7)
git2 = "0.19"

# Keyring (Phase 8)
keyring = "3"
```

---

## Lessons from Reference Implementations

### From Codex-RS (OpenAI)
1. **Modular crate structure** - Large modules (MCP, sandbox) as separate crates
2. **Snapshot testing** - TUI has extensive snapshot tests (`tui/src/snapshots/`)
3. **Protocol separation** - `codex-protocol` crate for wire types
4. **Deny stdout/stderr** - Library code must use proper abstractions

### From Crush (Charm)
1. **Auto-summarization** - Trigger at 20% remaining context or 20K tokens for large windows
2. **Message queuing** - Queue prompts when session is busy, process after completion
3. **Title generation** - Use small model for efficiency, fall back to large model
4. **Provider workarounds** - Handle provider-specific limitations (e.g., media in tool results)
5. **Cache control** - Add Anthropic cache control to last messages for efficiency

### From OpenCode
1. **Event bus** - Central event system for component communication
2. **Scheduler** - Background task management
3. **Skill system** - Extensible command/behavior plugins

### Patterns to Adopt
1. **Session-first design** - All operations should be session-aware
2. **Streaming callbacks** - TUI integration requires streaming from day 1
3. **Graceful degradation** - Handle missing providers, network issues
4. **Token awareness** - Track tokens throughout for context management

---

## Risk Assessment (Updated)

### High Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| ~~tree-sitter TS parsing~~ | ~~Grammar accuracy~~ | ✅ Resolved - tests passing |
| Terminal UI | UX parity with ink | Reference Codex TUI patterns |
| Context windowing | Token counting accuracy | Use tiktoken-rs, test with API |
| MCP protocol | Spec compliance | Integration tests with real servers |

### Medium Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| ~~RAG embeddings~~ | ~~Format compatibility~~ | ✅ Resolved - tested |
| Session migration | Data format changes | Version schema, migration scripts |
| Multi-agent IPC | Cross-platform sockets | Abstract transport layer |

### Low Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| Sandboxing | OS-specific complexity | Feature-gate, optional |
| OAuth | Provider API changes | Abstraction layer |

---

## Effort Summary (Updated)

| Phase | Duration | Person-Weeks | Status |
|-------|----------|--------------|--------|
| 0: Foundation | 4 weeks | 4 | ✅ Done |
| 1: Tools | 8 weeks | 10 | ✅ Done |
| 2: Providers | 8 weeks | 10 | ✅ Done |
| 3: Agent Loop | 8 weeks | 12 | ✅ Done |
| 4: Symbol Index | 8 weeks | 12 | ✅ Done |
| 5: RAG | 6 weeks | 8 | ✅ Done |
| 5.5: Session & Context | 4 weeks | 6 | 🔜 Next |
| 6: Terminal UI | 6 weeks | 10 | 🔜 Planned |
| 6.5: MCP Protocol | 4 weeks | 6 | 🔜 Planned |
| 7: Multi-Agent | 4 weeks | 6 | 🔜 Planned |
| 8: Security & Polish | 4 weeks | 6 | 🔜 Planned |
| **Total** | **64 weeks** | **90** | |

**Progress**: Phases 0-5 complete (~18,300 lines, 45 files, 219 tests)
**Remaining**: ~26 weeks (~35% done by lines, ~55% done by phases)

---

## Verification Strategy

1. **Per-phase**: Unit tests, golden file tests vs TypeScript
2. **Integration**: Nightly runs against live APIs
3. **Performance**: Criterion benchmarks
4. **Compatibility**: Same prompts through TS and Rust, compare outputs

---

## Quick Wins (Week 1)

1. Create `codi-rs` Cargo workspace
2. Copy gitgrip patterns (error handling, CLI, config)
3. Implement core types (Message, ToolDefinition, etc.)
4. Implement grep tool with `ripgrep` - immediate 10x speedup
5. Set up GitHub Actions CI

---

## Files to Reference

### Codi TypeScript
| File | Purpose |
|------|---------|
| `codi/src/agent.ts` | Core loop (76KB) |
| `codi/src/session.ts` | Session management |
| `codi/src/context-windowing.ts` | Token management |
| `codi/src/compression.ts` | Context compression |
| `codi/src/mcp/` | MCP client/server |
| `codi/src/orchestrate/` | Multi-agent |

### Reference: Codex-RS
| File | Purpose |
|------|---------|
| `ref/codex/codex-rs/core/src/lib.rs` | Core module structure |
| `ref/codex/codex-rs/tui/src/chatwidget.rs` | Chat UI (240KB) |
| `ref/codex/codex-rs/tui/src/markdown_stream.rs` | Streaming markdown |
| `ref/codex/codex-rs/mcp-types/src/lib.rs` | MCP types (62KB) |
| `ref/codex/codex-rs/execpolicy/` | Command safety |

### Reference: Crush
| File | Purpose |
|------|---------|
| `ref/crush/internal/agent/agent.go` | Agent with auto-summarize |
| `ref/crush/internal/session/` | Session persistence |
| `ref/crush/internal/ui/chat/` | Chat UI components |
| `ref/crush/internal/lsp/` | LSP integration |

### Reference: OpenCode
| File | Purpose |
|------|---------|
| `ref/opencode/packages/opencode/src/` | Main CLI |
| `ref/opencode/packages/opencode/src/session/` | Session management |
| `ref/opencode/packages/opencode/src/mcp/` | MCP implementation |

---

## Next Steps

### Immediate (This Week)
1. ✅ Review and merge PR #230 (Phase 5 RAG)
2. Create tracking issue for Phase 5.5 Session & Context
3. Begin session types and storage design

### Short Term (Next 2 Weeks)
1. Implement session persistence
2. Add token counting with tiktoken-rs
3. Implement context windowing

### Medium Term (Next Month)
1. Phase 6 TUI scaffolding
2. Streaming markdown rendering
3. Basic slash commands

---

## PR Status

| PR | Phase | Status |
|----|-------|--------|
| #228 | Phase 4 Symbol Index | ✅ Merged |
| #229 | Phase 4.1 Tracking Issue | ✅ Created |
| #230 | Phase 5 RAG System | 🔄 Pending Review |
