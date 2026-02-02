# Plan: Migrate Codi from TypeScript to Rust

## Executive Summary

Migrate Codi CLI (~58,000 lines TypeScript, 188 files) to Rust using an **incremental hybrid approach**. A Rust core is developed alongside TypeScript with JSON-RPC interoperability, enabling gradual migration while maintaining a working product.

**Estimated Timeline**: 12-14 months (with 2 developers)
**Effort**: ~90 person-weeks

---

## Architectural Review (Updated 2026-02-02)

### Current Rust Implementation Status

```
codi-rs: ~24,000 lines | 61 files | Phases 0-6.6 complete
```

### Reference Implementation Comparison

| Feature | Codi-RS | Codex-RS | Crush | OpenCode | Codi-TS |
|---------|---------|----------|-------|----------|---------|
| Agent Loop | ✅ | ✅ | ✅ | ✅ | ✅ |
| Providers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tools | ✅ | ✅ | ✅ | ✅ | ✅ |
| Symbol Index | ✅ | ❌ | ❌ | ❌ | ✅ |
| RAG System | ✅ | ❌ | ❌ | ❌ | ✅ |
| Session Mgmt | ✅ | ✅ | ✅ | ✅ | ✅ |
| Context Windowing | ✅ | ✅ | ✅ | ✅ | ✅ |
| Terminal UI | ✅ | ✅ | ✅ | ❌ | ✅ |
| MCP Protocol | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-Agent | ❌ | ❌ | ❌ | ❌ | ✅ |
| Sandboxing | ❌ | ✅ | ❌ | ✅ | ❌ |
| Keyring/OAuth | ❌ | ✅ | ✅ | ✅ | ❌ |
| Worktrees | ❌ | ❌ | ❌ | ✅ | ✅ |
| LSP Integration | ✅ | ❌ | ✅ | ✅ | ❌ |
| Exec Policy Engine | ❌ | ✅ | ❌ | ❌ | ❌ |
| Session Snapshots | ❌ | ❌ | ❌ | ✅ | ❌ |
| Session Sharing | ❌ | ❌ | ❌ | ✅ | ❌ |
| Diff Tracker | ❌ | ✅ | ❌ | ❌ | ❌ |
| Todo/Task Tool | ❌ | ❌ | ✅ | ❌ | ❌ |
| Desktop App | ❌ | ❌ | ❌ | ✅ | ❌ |
| VSCode Extension | ❌ | ❌ | ❌ | ✅ | ❌ |

**Legend**: ✅ Complete | 🔄 In Progress | ❌ Not Started

### Key Insights from Reference Implementations

**Codex-RS (OpenAI)** - ~30 crates, very modular:
- Separate crates for `mcp-types`, `mcp-server`, `rmcp-client`
- Strong security focus: `linux-sandbox`, `windows-sandbox`, `network-proxy`, `execpolicy`
- **Execution Policy Engine**: Rule-based bash approval with learning/amendment
- **Diff Tracker**: Git blob SHA tracking for accurate file change monitoring
- `keyring-store` for credential management
- Massive TUI (~240KB `chatwidget.rs`, streaming markdown)
- OpenTelemetry via `otel` crate

**Crush (Charm)** - Go with bubbletea:
- Uses `fantasy` library for provider abstraction (like our `Provider` trait)
- Auto-summarization when context window fills (largeContextWindowThreshold = 200K)
- Message queuing for busy sessions
- Title generation using small model
- **Todo/Task Tracking**: Built-in task tool with visual progress
- **LSP Integration**: Full LSP client with diagnostic caching
- Provider-specific workarounds (media in tool results for non-Anthropic)

**OpenCode** - Go/TypeScript hybrid:
- **LSP Integration**: Language server features
- PTY handling for proper terminal emulation
- Scheduler for background tasks
- Skill system (extensible commands)
- **Session Snapshots**: Git-based checkpoint/restore
- **Session Sharing**: Collaborative session features
- **Desktop App**: Tauri-based application
- **VSCode Extension**: IDE integration (`sdks/vscode`)

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
| `vectra` | SQLite + cosine similarity |
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

| Provider | Status | Notes |
|----------|--------|-------|
| Anthropic | ✅ Done | Full streaming SSE, tool use, vision, extended thinking |
| OpenAI | ✅ Done | OpenAI-compatible (supports OpenAI, Ollama, Azure, any compatible API) |
| Ollama | ✅ Done | Via OpenAI-compatible provider, no API key required |
| Smart defaults | ✅ Done | Auto-detect from env vars, local-first fallback |
| Telemetry | ✅ Done | Operation timing, token tracking |
| Benchmarks | ✅ Done | Provider creation, serialization, parsing |

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

**Deliverable**: PR #230 merged ✅

### Phase 5.5: Session & Context (Weeks 43-46) ✅ COMPLETE
**Goal**: Add session persistence and context management

| Component | Status | Notes |
|-----------|--------|-------|
| Session types | ✅ Done | Session, SessionMessage, SessionInfo, Todo |
| Session storage | ✅ Done | SQLite persistence with WAL mode |
| Session service | ✅ Done | Create, get, save, delete, list, search |
| Context windowing | ✅ Done | Token estimation, working set, selection |
| Context config | ✅ Done | Model-specific thresholds, message limits |
| Telemetry | ✅ Done | Feature-gated Instant::now() |
| Benchmarks | ✅ Done | 17 benchmarks for session operations |
| Tests | ✅ Done | 29 tests passing |

**Deliverable**: PR #237, #238 merged ✅

### Phase 6: Terminal UI (Weeks 47-52) ✅ COMPLETE
**Goal**: Production-grade terminal UI with streaming and session support

| Component | Status | Notes |
|-----------|--------|-------|
| Core TUI framework | ✅ Done | Terminal init/restore, event loop |
| Application state | ✅ Done | Mode enum, message history, input buffer |
| Basic layout | ✅ Done | 3-pane: messages, input, status |
| Streaming output | ✅ Done | MarkdownStreamCollector with incremental parsing |
| Slash commands | ✅ Done | /help, /clear, /exit, /model, /session, /compact, /status, /debug |
| Session integration | ✅ Done | Load/save sessions from TUI via SQLite |
| History navigation | ✅ Done | Up/Down arrow key navigation |
| Session status bar | ✅ Done | Session info displayed in status bar |
| Async command system | ✅ Done | AsyncCommand enum for database operations |
| Tool confirmation UI | ✅ Done | Confirmation dialog with Y/N/A keys |
| Snapshot tests | 🔜 Future | Test UI rendering with insta (out of scope) |

**Files Created** (~2,200 lines):
- `src/tui/mod.rs` - Terminal lifecycle
- `src/tui/app.rs` - Application state, event loop, session methods
- `src/tui/ui.rs` - Ratatui rendering with session status
- `src/tui/events.rs` - Event polling
- `src/tui/commands.rs` - Slash command routing with async support
- `src/tui/streaming/` - Markdown stream collector
- `benches/tui.rs` - Benchmarks

**Deliverables**:
- PR #239 merged ✅ (streaming TUI)
- PR #244 merged ✅ (session integration)

### Phase 6.5: MCP Protocol (Weeks 53-56) ✅ COMPLETE
**Goal**: Model Context Protocol for tool extensibility

| Component | Status | Notes |
|-----------|--------|-------|
| MCP types | ✅ Done | McpToolInfo, McpToolResult, McpContent, etc. |
| MCP config | ✅ Done | ServerConfig with stdio/http/sse transports |
| MCP client | ✅ Done | JSON-RPC over stdio, ConnectionManager |
| Tool wrapper | ✅ Done | McpToolWrapper implements ToolHandler |
| Error handling | ✅ Done | Comprehensive McpError enum |
| Telemetry | ✅ Done | Feature-gated operation timing |
| Benchmarks | ✅ Done | 12 benchmarks for config, serialization |
| Tests | ✅ Done | 29 tests passing |

**Files Created** (~2,200 lines):
- `src/mcp/mod.rs` - Module exports
- `src/mcp/types.rs` - Core MCP types
- `src/mcp/config.rs` - Server configuration
- `src/mcp/client.rs` - Client and ConnectionManager
- `src/mcp/tools.rs` - ToolHandler wrapper
- `src/mcp/error.rs` - Error types
- `benches/mcp.rs` - Benchmarks

**Remaining Work**:
- HTTP/SSE transport implementations (stubs only)
- MCP Server mode (`codi --mcp-server`)

**Deliverable**: PR #240 merged ✅

### Phase 6.6: LSP Integration (Weeks 57-58) ✅ COMPLETE
**Goal**: Language server integration for code intelligence

| Component | Status | Notes |
|-----------|--------|-------|
| LSP types | ✅ Done | Position, Range, Location, Diagnostic, DiagnosticSeverity |
| LSP client | ✅ Done | JSON-RPC over stdio, initialize, document sync, hover, definition, references |
| Language configs | ✅ Done | Per-language configs with defaults for 9 languages |
| Diagnostic cache | ✅ Done | Version-tracked storage with counts caching |
| File scoping | ✅ Done | LSP by file extension and root markers |
| Error handling | ✅ Done | LspError enum with error codes |
| Benchmarks | ✅ Done | 17 benchmarks for cache, config, types, serialization |
| Tests | ✅ Done | 41 tests passing |

**Files Created** (~1,500 lines):
- `src/lsp/mod.rs` - Module exports
- `src/lsp/types.rs` - Core LSP types
- `src/lsp/config.rs` - Server configuration
- `src/lsp/client.rs` - LSP client implementation
- `src/lsp/diagnostics.rs` - Diagnostic cache
- `src/lsp/error.rs` - Error types
- `benches/lsp.rs` - Benchmarks

**Reference**: Crush `internal/lsp/client.go`

**Remaining Work** (Future):
- LSP server auto-start on project open
- Integration with symbol index for enriched data
- Language server installation detection

### Phase 7: Multi-Agent (Weeks 59-62) 📋 PLANNED
**Goal**: Parallel agent execution with IPC-based permission bubbling

| Component | Status | Notes |
|-----------|--------|-------|
| IPC protocol | 📋 Planned | Newline-delimited JSON over Unix sockets |
| IPC server | 📋 Planned | Tokio UnixListener, client tracking |
| IPC client | 📋 Planned | Permission requests, status reporting |
| Git worktrees | 📋 Planned | Create isolated workspaces |
| Commander | 📋 Planned | Spawn/manage workers, aggregate results |
| Child agent | 📋 Planned | Agent wrapper with IPC onConfirm |
| Commands | 📋 Planned | /delegate, /workers, /worktrees |

**Reference**: Codi-TS `orchestrate/`

### Phase 8: Security & Polish (Weeks 63-68) 📋 PLANNED
**Goal**: Production hardening, credential management, and sandboxing

#### 8.1 Execution Policy Engine (Week 63)
| Task | Notes |
|------|-------|
| Dangerous command detection | Pattern-based with risk scoring |
| Rule learning | Learn from user approvals |
| Prefix rules | Safe command patterns |
| Rule persistence | ~/.codi/exec-rules.json |
| Amendment workflow | Add new patterns dynamically |

**Reference**: Codex-RS `execpolicy/`

#### 8.2 Credential Storage (Week 64)
| Task | Notes |
|------|-------|
| Keyring abstraction | Cross-platform secret storage |
| Provider credentials | API keys for providers |
| Token management | OAuth token storage |
| Fallback storage | Encrypted file fallback |

**Dependencies**:
```toml
keyring = "3"           # System keyring (Windows, macOS, Linux)
chacha20poly1305 = "0.10"  # Fallback encryption
argon2 = "0.5"          # Key derivation
```

#### 8.3 OAuth Flows (Week 65)
| Task | Notes |
|------|-------|
| OAuth client | PKCE flow implementation |
| Token refresh | Auto-refresh expired tokens |
| Provider configs | GitHub, Google, etc. |
| Callback server | Local HTTP for redirect |

#### 8.4 Process Sandboxing (Week 66) [Optional/Feature-Gated]
| Task | Notes |
|------|-------|
| Sandbox trait | Abstract sandbox interface |
| Linux sandbox | Landlock + seccomp |
| macOS sandbox | Seatbelt (sandbox-exec) |
| Windows sandbox | Job objects + restricted tokens |

**Reference**: Codex-RS `linux-sandbox/`, `seatbelt.rs`

#### 8.5 Session Enhancements (Week 67)
| Task | Notes |
|------|-------|
| Session snapshots | Git-based checkpoint system |
| Snapshot restore | Restore session state |
| Session sharing | Collaborative sessions (future) |
| Advanced compaction | Protected message pruning |

**Reference**: OpenCode `snapshot/index.ts`

#### 8.6 Error Recovery & Polish (Week 68)
| Task | Notes |
|------|-------|
| Graceful degradation | Handle missing features |
| Retry logic | Exponential backoff |
| Circuit breaker | Prevent cascade failures |
| Recovery hints | User-actionable suggestions |

### Phase 9: Platform Expansion (Future) 📋 OPTIONAL
**Goal**: Broader accessibility beyond CLI

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Server mode | 📋 Planned | Expose Codi tools via MCP |
| Desktop App | 📋 Future | Tauri-based application |
| VSCode Extension | 📋 Future | IDE integration |
| Todo/Task Tool | 📋 Future | Built-in task tracking |
| Diff Tracker | 📋 Future | Git blob-based change tracking |

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

# TUI
ratatui = "0.29"
crossterm = "0.28"

# MCP
rmcp = { version = "0.14", features = ["client", "transport-child-process"] }

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

## Planned Dependencies (Phase 7+)

```toml
# LSP (Phase 6.6)
tower-lsp = "0.20"      # LSP client/server

# Git (Phase 7)
git2 = "0.19"

# Security (Phase 8)
keyring = "3"
chacha20poly1305 = "0.10"
argon2 = "0.5"
oauth2 = "4"

# Sandbox (Phase 8, optional)
libseccomp = { version = "0.3", optional = true }  # Linux only
```

---

## Lessons from Reference Implementations

### From Codex-RS (OpenAI)
1. **Modular crate structure** - Large modules (MCP, sandbox) as separate crates
2. **Snapshot testing** - TUI has extensive snapshot tests (`tui/src/snapshots/`)
3. **Protocol separation** - `codex-protocol` crate for wire types
4. **Execution policy learning** - Rules learn from user approvals
5. **Diff tracking** - Git blob SHAs for accurate file change monitoring

### From Crush (Charm)
1. **Auto-summarization** - Trigger at 20% remaining context or 20K tokens for large windows
2. **Message queuing** - Queue prompts when session is busy, process after completion
3. **Title generation** - Use small model for efficiency, fall back to large model
4. **LSP integration** - Real-time diagnostics with version tracking
5. **Todo tracking** - Built-in task tool with visual progress

### From OpenCode
1. **Event bus** - Central event system for component communication
2. **Scheduler** - Background task management
3. **Skill system** - Extensible command/behavior plugins
4. **Session snapshots** - Git-based checkpoint/restore
5. **Session sharing** - Collaborative session infrastructure

### Patterns to Adopt
1. **Session-first design** - All operations should be session-aware
2. **Streaming callbacks** - TUI integration requires streaming from day 1
3. **Graceful degradation** - Handle missing providers, network issues
4. **Token awareness** - Track tokens throughout for context management
5. **Rule learning** - Security policies that adapt to user behavior

---

## Risk Assessment

### High Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| ~~tree-sitter TS parsing~~ | ~~Grammar accuracy~~ | ✅ Resolved - tests passing |
| ~~Context windowing~~ | ~~Token counting accuracy~~ | ✅ Resolved - implemented |
| ~~MCP protocol~~ | ~~Spec compliance~~ | ✅ Resolved - tests passing |
| Terminal UI | UX parity with ink | Reference Codex TUI patterns |
| LSP integration | Cross-platform complexity | Use tower-lsp crate |

### Medium Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| ~~RAG embeddings~~ | ~~Format compatibility~~ | ✅ Resolved - tested |
| ~~Session migration~~ | ~~Data format changes~~ | ✅ Resolved - versioned schema |
| Multi-agent IPC | Cross-platform sockets | Abstract transport layer |
| Sandboxing | OS-specific complexity | Feature-gate, optional |

### Low Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| OAuth | Provider API changes | Abstraction layer |
| Desktop app | Tauri complexity | Follow OpenCode patterns |

---

## Effort Summary (Updated 2026-02-02)

| Phase | Duration | Person-Weeks | Status |
|-------|----------|--------------|--------|
| 0: Foundation | 4 weeks | 4 | ✅ Done |
| 1: Tools | 8 weeks | 10 | ✅ Done |
| 2: Providers | 8 weeks | 10 | ✅ Done |
| 3: Agent Loop | 8 weeks | 12 | ✅ Done |
| 4: Symbol Index | 8 weeks | 12 | ✅ Done |
| 5: RAG | 6 weeks | 8 | ✅ Done |
| 5.5: Session & Context | 4 weeks | 6 | ✅ Done |
| 6: Terminal UI | 6 weeks | 10 | ✅ Done |
| 6.5: MCP Protocol | 4 weeks | 6 | ✅ Done |
| 6.6: LSP Integration | 2 weeks | 4 | ✅ Done |
| 7: Multi-Agent | 4 weeks | 6 | 📋 Planned |
| 8: Security & Polish | 6 weeks | 10 | 📋 Planned |
| 9: Platform Expansion | TBD | TBD | 📋 Future |
| **Total** | **68 weeks** | **98** | |

**Progress**: Phases 0-6.6 complete (~24,000 lines, ~61 files, 355 tests)
**Remaining**: ~10 weeks (~80% done by lines, ~85% done by phases)

---

## Verification Strategy

1. **Per-phase**: Unit tests, golden file tests vs TypeScript
2. **Integration**: Nightly runs against live APIs
3. **Performance**: Criterion benchmarks
4. **Compatibility**: Same prompts through TS and Rust, compare outputs

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
| `ref/codex/codex-rs/execpolicy/` | Execution policy engine |
| `ref/codex/codex-rs/core/src/seatbelt.rs` | macOS sandbox |
| `ref/codex/codex-rs/keyring-store/` | Credential storage |

### Reference: Crush
| File | Purpose |
|------|---------|
| `ref/crush/internal/agent/agent.go` | Agent with auto-summarize |
| `ref/crush/internal/session/` | Session persistence |
| `ref/crush/internal/ui/chat/` | Chat UI components |
| `ref/crush/internal/lsp/client.go` | LSP client |
| `ref/crush/internal/ui/chat/todos.go` | Task tracking |

### Reference: OpenCode
| File | Purpose |
|------|---------|
| `ref/opencode/packages/opencode/src/` | Main CLI |
| `ref/opencode/packages/opencode/src/session/` | Session management |
| `ref/opencode/packages/opencode/src/mcp/` | MCP implementation |
| `ref/opencode/packages/opencode/src/snapshot/` | Session snapshots |
| `ref/opencode/sdks/vscode/` | VSCode extension |

---

## Next Steps

### Immediate (This Week)
1. ~~Complete Phase 6 TUI polish (session integration, tests)~~ ✅ Done
2. ~~Phase 6.6 LSP integration~~ ✅ Done

### Short Term (Next 2 Weeks)
1. Phase 7 Multi-agent IPC protocol design
2. Phase 7 Git worktree management

### Medium Term (Next Month)
1. Complete Phase 7 Multi-agent orchestration
2. Begin Phase 8 Security features

### Long Term (Next 2 Months)
1. Complete Phase 8 Security & Polish
2. Evaluate Phase 9 Platform Expansion priorities

---

## PR Status

| PR | Phase | Status |
|----|-------|--------|
| #228 | Phase 4 Symbol Index | ✅ Merged |
| #229 | Phase 4.1 Tracking Issue | ✅ Created |
| #230 | Phase 5 RAG System | ✅ Merged |
| #237 | Phase 5.5 Session & Context | ✅ Merged |
| #238 | Fix: Session telemetry cfg | ✅ Merged |
| #239 | Phase 6 TUI Streaming | ✅ Merged |
| #240 | Phase 6.5 MCP Protocol | ✅ Merged |
| #244 | Phase 6 TUI Session Integration | ✅ Merged |

---

## Tracking Issues

| Issue | Phase | Description |
|-------|-------|-------------|
| #229 | Phase 4.1 | File watcher, deep indexing, more languages |
| TBD | Phase 6.6 | LSP Integration |
| TBD | Phase 8.1 | Execution Policy Engine |
| TBD | Phase 9 | Platform Expansion priorities |
