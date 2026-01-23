# Codi Roadmap

**Current Version:** 0.16.0
**Last Updated:** 2026-01-23

---

## Overview

Codi is a feature-rich AI coding assistant CLI. This document tracks completed work and remaining tasks for production readiness.

---

## Recently Completed (v0.15.0 - v0.16.0)

### Tier 1: Critical Security & Stability

| Item | Status | PR |
|------|--------|-----|
| Fix dependency vulnerabilities (diff, esbuild) | ✅ Complete | #86 |
| Add path traversal protection to file tools | ✅ Complete | #87 |
| Fix database cleanup on exit (SQLite) | ✅ Complete | #88 |
| Implement memory bounds (message cap, LRU eviction) | ✅ Complete | #89 |

### Tier 2: Testing & CI/CD

| Item | Status | PR |
|------|--------|-----|
| Core module unit tests (agent, MCP, orchestration) | ✅ Complete | #90 |
| CI enhancements (macOS runner) | ✅ Complete | #91 |
| NPM publishing setup | ✅ Complete | #92 |
| Environment documentation (.env.example) | ✅ Complete | #93 |

### Tier 3: Polish

| Item | Status | PR |
|------|--------|-----|
| Concurrency safety (tool execution semaphore) | ✅ Complete | #94 |
| Rate limiter queue bounds | ✅ Complete | #94 |
| Graceful shutdown handlers | ✅ Complete | #94 |
| README improvements | ✅ Complete | #94 |

### Tier 4: Performance & Security

| Item | Status | PR |
|------|--------|-----|
| Token count caching | ✅ Complete | #95 |
| Gzip compression for tool result cache | ✅ Complete | #95 |
| Parallel Ollama embeddings | ✅ Complete | #95 |
| SQLite VACUUM scheduling | ✅ Complete | #95 |
| SECURITY.md with threat model | ✅ Complete | #96 |

### New Features (v0.16.0)

| Feature | Description | PR |
|---------|-------------|-----|
| Global Model Maps | `~/.codi/models.yaml` for cross-project model aliases | #99 |
| Interactive Model Addition | `/modelmap add [--global] name provider model` | #100 |
| Debug Bridge | `--debug-bridge` flag streams events to JSONL for live debugging | #101 |
| Debug Bridge Session Isolation | Unique directories per session, current symlink, session index | #109 |
| Debug Bridge Command Injection | External control via commands.jsonl (pause, resume, step, inspect) | #110 |
| Debug CLI | `codi-debug` companion tool for watching events and sending commands | #115 |
| Debug Bridge Phase 4 | Breakpoints, auto-checkpoints, session replay | #118 |

---

## Current Status

**Tests:** 1907 passing
**Test Coverage:** ~65% overall

| Module | Coverage |
|--------|----------|
| Tools | ~95% |
| Providers | ~75% |
| Commands | ~60% |
| Orchestration | ~70% |

---

## Remaining Work

### High Priority

- [ ] **Windows CI runner** - Test native module compilation on Windows
- [ ] **npm publish workflow** - Automated releases on tag push (`.github/workflows/release.yml`)
- [ ] **Command unit tests** - memory-commands, orchestrate-commands, rag-commands, compact-commands

### Medium Priority

- [ ] **Enhanced bash security** - Use array-based `execFile()` instead of `exec()`
- [ ] **Structured logging** - Implement log levels beyond current debug flags
- [ ] **Health check endpoint** - For long-running processes

### Nice to Have

- [x] **Debug Bridge Phase 2** - Command injection (pause, resume, step, inspect) - PR #110
- [x] **Debug Bridge Phase 3** - Debug CLI (`codi-debug`) - PR #116
- [x] **Debug Bridge Phase 4** - Breakpoints, auto-checkpoints, session replay - PR #118
- [ ] **Debug Bridge Phase 5** - Time travel debugging (rewind, branching, timeline)
- [ ] **Optional telemetry** - Opt-in error tracking
- [ ] **Plugin system re-enable** - Currently disabled pending investigation (#17)

---

## Planned Features

### Semantic Fallback for Tool Calls

When a model attempts to call a tool that doesn't exist or uses incorrect parameter names, implement a semantic fallback system that:

1. **Tool Name Matching**: Find closest matching tool by name similarity (e.g., `print_tree` -> `list_directory`)
2. **Parameter Mapping**: Map unrecognized parameters to correct names based on aliases and semantic similarity
3. **Graceful Degradation**: Provide helpful feedback instead of failing on invalid tool calls

**Current Mitigations**:
- Added parameter aliases to `grep` tool (`query` -> `pattern`, `max_results` -> `head_limit`)
- Added `print_tree` tool (commonly expected by models)

### Test Sandbox Compatibility

Update tests that write to `~/.codi` or bind to `127.0.0.1` to use local temporary directories and ephemeral ports by default.

---

## Feature Overview

### Core Features
- Multi-provider support (Anthropic, OpenAI, Ollama, RunPod)
- 27 tools for file operations, search, and code intelligence
- 48 slash commands for workflows
- Session persistence and restoration
- Context compaction with summarization

### Advanced Features
- Multi-agent orchestration with git worktrees
- Symbol index with SQLite backend (1146 symbols)
- RAG system for semantic code search
- Model map for multi-model pipelines
- Debug bridge for live session debugging

### Security Features
- User approval system for tool execution
- Dangerous pattern detection for bash commands
- Path traversal protection
- Audit logging (`--audit` flag)

---

## Release History

| Version | Date | Highlights |
|---------|------|------------|
| 0.16.0 | 2026-01-23 | Debug bridge, global model maps, interactive model addition |
| 0.15.0 | 2026-01-22 | Production readiness (Tiers 1-4 complete) |
| 0.14.0 | 2026-01-20 | Symbol index, performance optimizations |
| 0.13.0 | 2026-01-18 | Multi-agent orchestration |
| 0.12.0 | 2026-01-15 | Model map pipelines |

---

## Architecture

```
src/
├── index.ts          # CLI entry, REPL loop
├── agent.ts          # Core agent loop
├── debug-bridge.ts   # Live debugging event stream
├── commands/         # 48 slash commands
├── providers/        # AI model backends
├── tools/            # 27 filesystem tools
├── orchestrate/      # Multi-agent with IPC
├── model-map/        # Multi-model orchestration
├── symbol-index/     # Code intelligence
└── rag/              # Semantic search
```

---

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development guidelines and [SECURITY.md](./SECURITY.md) for security practices.
