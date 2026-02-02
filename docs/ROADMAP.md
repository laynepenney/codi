# Codi Tool Improvements Roadmap

This roadmap outlines planned improvements to Codi's tool suite based on real-world usage feedback. The goal is to make Codi more effective at navigating large codebases, making targeted edits, and automating workflows.

---

## Changelog

### v0.7.0 (2026-02-02)

**Phase 8 - Rust Model Map (Initial Implementation):**
- `model_map` module added to codi-rs for multi-model orchestration
- YAML-based configuration loading from global (`~/.codi/models.yaml`) and project (`codi-models.yaml`)
- Provider pooling with lazy instantiation (needs fix - see Phase 8 roadmap items)
- Task/command routing with role-based model resolution
- Pipeline execution with variable substitution
- 36 unit tests covering core functionality

### v0.6.0 (2026-01-14)

**Quick Wins Completed:**
- `search_codebase`: Added `dir`, `file_pattern`, and `min_score` parameters
- `run_tests`: Structured output with parsed pass/fail/skip counts, duration, and failure details
- `bash`: Structured output with exit code, duration, and separate stdout/stderr sections
- `find_references`: Added summary counts by type and "files with most references" section

**Phases 1-5 Implemented:**
- `goto_definition`: Added `kind` and `from_line` parameters for symbol disambiguation
- `show_impact`: New tool for analyzing change impact on dependent files
- `patch_file`: Multi-patch support via `patches` array parameter
- `refactor`: New atomic search-and-replace tool with regex support and dry-run mode
- `run_tests`: Added `changed_files` param for git-aware test filtering
- `shell_info`: New tool for capturing environment information
- `get_index_status`: New tool for checking index freshness and listing stale files

**Phases 6-7 Implemented:**
- `StructuredResult<T>`: Unified result interface with `ok`, `data`, `error`, `warnings`
- `pipeline`: New tool for chaining multiple tool calls with stop-on-failure
- `generate_docs`: New tool for extracting JSDoc/docstrings to markdown
- Per-tool configuration via `tools.disabled` and `tools.defaults` in `.codi.json`

---

## Phase 1: Search & Navigation Enhancements

### 1.1 Richer Code Search (`search_codebase`)

**Status: Complete**

| Feature | Description | Status |
|---------|-------------|--------|
| Semantic ranking | Scores already returned in output | Done |
| Result filtering | `max_results` and `min_score` parameters | Done |
| File/directory scope | `file_pattern` (glob) and `dir` parameters | Done |
| Symbol context | Return symbolName, symbolKind with results | Done |

**Current API:**
```typescript
search_codebase({
  query: "paste detection",
  file_pattern: "*.ts",    // glob pattern
  dir: "src/",             // directory filter
  max_results: 10,         // default: 5, max: 20
  min_score: 0.7           // default: 0.7
})
```

### 1.2 Navigation Tool Improvements

| Tool | Improvement | Status |
|------|-------------|--------|
| `goto_definition` | Added `kind` filter and `from_line` parameters | Done |
| `find_references` | Group by type with per-file counts | Done |
| `show_impact` | New tool: analyze change impact and dependent files | Done |

---

## Phase 2: Batch Operations & Refactoring

**Status: Complete**

### 2.1 Multi-Patch Support

**Status: Done**

`patch_file` now accepts either a single `patch` or a `patches` array:

```typescript
patch_file({
  path: "src/index.ts",
  patches: [
    { diff: "...", description: "Add CLI option" },
    { diff: "...", description: "Update help text" }
  ]
})
```

### 2.2 Atomic Refactor Tool

**Status: Done**

New `refactor` tool for search-and-replace across the codebase:

```typescript
refactor({
  search: "PASTE_DEBOUNCE_MS",
  replace: "DEFAULT_PASTE_DEBOUNCE_MS",
  scope: "src/",        // optional directory scope
  file_pattern: "*.ts", // optional glob filter
  is_regex: false,      // enable regex mode
  dry_run: true,        // preview changes without applying
  max_files: 50         // safety limit
})
// Returns: summary of files changed with diff preview
```

---

## Phase 3: Testing Integration

**Status: Complete**

### 3.1 Smart Test Filtering

| Feature | Status |
|---------|--------|
| Filter by pattern | Done (existing `filter` param) |
| Auto-detect from git status (`changed_files`) | Done |

The `changed_files` parameter auto-detects modified files from git status and runs only related tests:

```typescript
run_tests({
  changed_files: true  // auto-detect and filter tests
})
```

### 3.2 Structured Test Output

**Status: Done**

Output now includes:
- Summary: passed/failed/skipped/total counts
- Duration in seconds
- List of failures with name, file, line, error message
- Raw output preserved

Parsers implemented for: **vitest**, **jest**, **pytest**, **go test**, **cargo test**

Example output:
```
## Test Results

**Status:** PASSED
**Command:** `pnpm test`
**Exit Code:** 0

### Summary
- **Passed:** 747
- **Failed:** 0
- **Skipped:** 32
- **Total:** 779
- **Duration:** 2.48s

### Raw Output
...
```

---

## Phase 4: Shell & Environment

**Status: Partially Complete**

### 4.1 Enhanced Bash Output

**Status: Done**

Output format:
```
[Exit Code: 0] [Status: SUCCESS] [Duration: 1.23s]

<stdout content>

[STDERR]
<stderr content if any>
```

Features:
- Exit code clearly shown
- Duration tracking
- Separate `[STDERR]` section when stderr present
- Truncation with middle-cut for very long output

### 4.2 Environment Snapshot Tool

**Status: Done**

New `shell_info` tool to capture runtime environment:

```typescript
shell_info({
  commands: ["node -v", "pnpm -v", "git --version"],
  include_defaults: true,  // include common version checks
  cwd: "/path/to/project"  // optional working directory
})
```

Returns formatted environment info with available/unavailable sections. Default commands check: node, npm, pnpm, yarn, git, python, go, rustc, java.

---

## Phase 5: Indexing & Performance

**Status: Complete**

### 5.1 Persistent Project Index

**Status: Done**

**Implementation:**
- `BackgroundIndexer` class manages automatic index maintenance
- File watcher (chokidar) detects changes and triggers incremental updates
- `rebuild_index` tool allows AI to trigger full or incremental rebuilds
- Index stored in `~/.codi/symbol-index/<project>-<hash>/symbols.db`
- `index_version` exposed via `get_index_status` tool

**Usage:**
```typescript
rebuild_index({
  mode: 'incremental',  // or 'full', 'deep'
  clear: false          // clear existing index first
})
```

**Features:**
- Auto-initialization on startup
- Debounced file watching (1 second default)
- Incremental updates for efficiency
- Deep indexing option for usage-based dependencies

### 5.2 Index Freshness Detection

**Status: Done**

New `get_index_status` tool:

```typescript
get_index_status({
  check_freshness: true,  // check for stale files
  max_stale_files: 20     // limit listed stale files
})
```

Returns:
- Statistics: files indexed, total symbols, imports, dependencies, index size
- Timing: last full rebuild, last update (relative times)
- Freshness: lists files modified since last index update

---

## Phase 6: Standardization & Error Handling

**Status: Complete**

### 6.1 Unified Result Object

**Status: Done**

`StructuredResult<T>` interface with helper functions:

```typescript
interface StructuredResult<T> {
  ok: boolean;
  data?: T;           // present when ok === true
  error?: string;     // error message when ok === false
  warnings?: string[];
}

// Helper functions
success<T>(data: T, warnings?: string[]): StructuredResult<T>
failure(error: string, warnings?: string[]): StructuredResult<never>
formatResult<T>(result: StructuredResult<T>): string
```

### 6.2 Tool Execution Pipeline

**Status: Done**

New `pipeline` tool for chained operations:

```typescript
pipeline({
  steps: [
    { tool: "edit_file", args: { path: "...", old_string: "...", new_string: "..." }, name: "Update config" },
    { tool: "run_tests", args: { filter: "config" }, name: "Run tests" },
    { tool: "bash", args: { command: "git add -A" }, name: "Stage changes" }
  ],
  stop_on_failure: true,  // default: true
  dry_run: false          // validate without executing
})
```

Features:
- Named steps for clear logging
- Stop-on-failure or continue-through-errors modes
- Dry-run validation
- Structured output with per-step results and timing

---

## Phase 7: Documentation & Configuration

**Status: Complete**

### 7.1 Auto-Documentation Tool

**Status: Done**

New `generate_docs` tool:

```typescript
generate_docs({
  file: "src/paste-debounce.ts",
  symbol: "createPasteDebounceHandler",  // optional, document specific symbol
  format: "markdown",                     // or "json"
  include_private: false                  // include _prefixed symbols
})
```

Features:
- Parses JSDoc/TSDoc from TypeScript/JavaScript
- Parses docstrings from Python
- Extracts @param, @returns, @example tags
- Groups output by symbol kind (classes, functions, types)
- JSON output for programmatic use

### 7.2 Tool Configuration

**Status: Done**

Per-tool configuration in `.codi.json`:

```json
{
  "tools": {
    "disabled": ["web_search"],
    "defaults": {
      "search_codebase": {
        "max_results": 20,
        "min_score": 0.6
      },
      "run_tests": {
        "timeout": 120
      }
    }
  }
}
```

Helper functions:
- `isToolDisabled(toolName, config)` - check if tool is disabled
- `getToolDefaults(toolName, config)` - get default settings
- `mergeToolInput(toolName, input, config)` - merge input with defaults

---

## Implementation Priority

| Phase | Effort | Impact | Priority | Status |
|-------|--------|--------|----------|--------|
| Phase 1: Search & Navigation | Medium | High | **P0** | **Complete** |
| Phase 2: Batch Operations | Medium | High | **P0** | **Complete** |
| Phase 3: Testing Integration | Low | Medium | **P1** | **Complete** |
| Phase 4: Shell & Environment | Low | Medium | **P1** | **Complete** |
| Phase 5: Indexing & Performance | High | High | **P1** | **Complete** |
| Phase 6: Standardization | Medium | Medium | **P2** | **Complete** |
| Phase 7: Documentation & Config | Low | Low | **P2** | **Complete** |
| Phase 8: Rust Model Map | Medium | High | **P1** | **In Progress** |

---

## Quick Wins

| Item | Description | Status |
|------|-------------|--------|
| `search_codebase` filtering | Add `dir`, `file_pattern`, `min_score` params | Done |
| Structured test output | Parse output into pass/fail/skip counts | Done |
| Separate stdout/stderr | Enhanced bash output format | Done |
| Group `find_references` | By type with per-file counts | Done |

---

## Phase 8: Rust Model Map Improvements

**Status: In Progress**

The Rust implementation of model_map (multi-model orchestration) was completed in PR #249. Code review identified the following improvements needed:

### 8.1 Registry Provider Pooling Fix

**Priority: High**

| Issue | Description | Status |
|-------|-------------|--------|
| Pool is non-functional | Providers are recreated on every `get_provider()` call instead of being reused from the pool | TODO |
| Deadlock risk | Nested lock acquisition (write lock on pool, then read lock on config) | TODO |
| Race condition | No lock held between pool check and add operation | TODO |

**Files:** `codi-rs/src/model_map/registry.rs`

### 8.2 Executor Streaming & Variable Handling

**Priority: High**

| Issue | Description | Status |
|-------|-------------|--------|
| Streaming callbacks disconnected | `PipelineCallbacks::on_step_text` is never invoked during streaming | TODO |
| Regex compiled per-call | Should use `lazy_static` or `once_cell` for performance | TODO |
| Undefined variables silent | Returns success with literal `{varname}` instead of error | TODO |

**Files:** `codi-rs/src/model_map/executor.rs`

### 8.3 Config Validation Improvements

**Priority: Medium**

| Issue | Description | Status |
|-------|-------------|--------|
| Regex unwrap can panic | Line 539 uses `.unwrap()` on regex compilation | TODO |
| Silent parse failures | Invalid YAML files are silently ignored | TODO |
| No cycle detection | Circular pipeline references could cause infinite loops | TODO |
| Cascading validation errors | No early exit on critical validation failures | TODO |

**Files:** `codi-rs/src/model_map/config.rs`

### 8.4 Type System Improvements

**Priority: Medium**

| Issue | Description | Status |
|-------|-------------|--------|
| Missing `PartialEq` derives | Config types lack `PartialEq` for easier testing | TODO |
| Temperature range inconsistency | Documentation says 0.0-1.0 but validation allows 0.0-2.0 | TODO |
| Empty string validation | `provider` and `model` fields accept empty strings | TODO |

**Files:** `codi-rs/src/model_map/types.rs`, `codi-rs/src/model_map/config.rs`

### 8.5 Test Coverage Expansion

**Priority: Low**

| Issue | Description | Status |
|-------|-------------|--------|
| Missing error path tests | Error handling paths largely untested | TODO |
| No concurrent access tests | Pool/registry concurrency not tested | TODO |
| No integration tests with callbacks | Callback invocation flow not tested | TODO |
| No timeout tests | Streaming timeout behavior not tested | TODO |

**Files:** All `codi-rs/src/model_map/*.rs` test modules

---

## Phase 9: Skills System (from Codex)

**Status: Planned**
**Priority: P0 - Key Differentiator**

Based on analysis of OpenAI Codex reference implementation, skills are modular, self-contained capabilities that transform Codi from a general-purpose agent into a specialized agent with procedural knowledge.

### 9.1 Skill Architecture

| Component | Description | Status |
|-----------|-------------|--------|
| `SKILL.md` format | YAML frontmatter + markdown instructions | TODO |
| Skill metadata | name, description, interface, dependencies, scope | TODO |
| Progressive loading | 3-level: metadata → body → resources | TODO |
| Skill scopes | Repo → User → System (priority order) | TODO |

**Skill File Structure:**
```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description ~100 words)
│   └── Markdown instructions (<5k words)
├── agents/
│   └── config.yaml (UI metadata)
└── resources/
    ├── scripts/ (Python, Bash)
    ├── references/ (docs loaded as needed)
    └── assets/ (templates, icons)
```

### 9.2 Skill Loading & Injection

| Feature | Description | Status |
|---------|-------------|--------|
| Multi-root loading | Scan repo/.codi → ~/.codi/skills → system | TODO |
| Explicit mentions | `$skill-name` syntax triggers injection | TODO |
| Auto-selection | Detect when skill should trigger from description | TODO |
| Dependency checking | Validate tool/connector requirements | TODO |

### 9.3 Built-in Skills

| Skill | Purpose | Status |
|-------|---------|--------|
| `skill-creator` | Create new skills from description | TODO |
| `commit` | Git commit with conventional commits | TODO |
| `review` | Code review workflow | TODO |
| `test` | Test generation and running | TODO |

---

## Phase 10: Plan/Act Mode (from Cline)

**Status: Planned**
**Priority: P1 - UX Improvement**

Based on Cline reference implementation, Plan/Act mode provides flexible execution with user approval workflows.

### 10.1 Mode Architecture

| Mode | Behavior | Status |
|------|----------|--------|
| **Plan Mode** | Gather context, create plan, present for approval | TODO |
| **Act Mode** | Execute approved plan, non-blocking progress updates | TODO |
| Mode switching | Manual toggle + auto-switch on approval | TODO |

### 10.2 Plan Mode Features

| Feature | Description | Status |
|---------|-------------|--------|
| `plan_mode_respond` tool | Present plans with predefined options | TODO |
| Blocking approval | Wait for user to approve/modify plan | TODO |
| Exploration flag | Request more context before planning | TODO |
| Option tracking | Track selected vs ignored options | TODO |

### 10.3 Act Mode Features

| Feature | Description | Status |
|---------|-------------|--------|
| `act_mode_respond` tool | Non-blocking progress updates | TODO |
| Task progress | Update focus chain/todo list | TODO |
| Consecutive call prevention | Avoid infinite narration loops | TODO |

---

## Phase 11: Full MCP Integration (from Cline)

**Status: Planned**
**Priority: P0 - Industry Standard**

Based on Cline reference implementation, full MCP (Model Context Protocol) support for extensibility.

### 11.1 MCP Server Support

| Feature | Description | Status |
|---------|-------------|--------|
| Transport types | Stdio, SSE, Streamable HTTP | TODO |
| Server management | Start, stop, restart MCP servers | TODO |
| File watching | Auto-reload on settings changes | TODO |
| Unique server keys | Avoid tool name conflicts | TODO |

### 11.2 MCP Tool Execution

| Feature | Description | Status |
|---------|-------------|--------|
| `use_mcp_tool` handler | Execute tools from MCP servers | TODO |
| Per-tool auto-approve | Configure auto-approval per tool | TODO |
| Partial streaming | Show in-progress tool invocation | TODO |
| Resource access | MCP resources and templates | TODO |

---

## Phase 12: Enhanced Multi-Agent (from OpenHands)

**Status: Planned**
**Priority: P1 - Architecture**

Based on OpenHands reference implementation, event-driven multi-agent patterns.

### 12.1 Event-Driven Architecture

| Feature | Description | Status |
|---------|-------------|--------|
| EventStream backbone | Central pub-sub for agent coordination | TODO |
| State isolation | Per-agent state with shared metrics | TODO |
| Delegate pattern | Parent-child agent spawning | TODO |
| Event filtering | Parent forwards to active delegate | TODO |

### 12.2 Agent Roles (from Codex)

| Role | Description | Status |
|------|-------------|--------|
| Orchestrator | Coordination-only, delegates to workers | Exists (Commander) |
| Worker | Task-executing with model override | Exists |
| Explorer | Fast codebase search (cheap model) | TODO |
| Planner | Read-only analysis and planning | TODO |

### 12.3 Security Analyzer Framework

| Feature | Description | Status |
|---------|-------------|--------|
| Pluggable analyzers | Abstract security analysis interface | Partial |
| LLM-based risk | Use LLM to assess action risk | TODO |
| Invariant analyzer | Rule-based security policies | TODO |
| Confirmation modes | Auto/manual based on risk level | Exists |

---

## Phase 13: Terminal UX Improvements (from Aider)

**Status: Planned**
**Priority: P2 - Polish**

Based on Aider reference implementation, terminal AI coding patterns.

### 13.1 Edit Format Strategies

| Format | Description | Status |
|--------|-------------|--------|
| `whole` | Replace entire file | Exists |
| `diff` | Search/replace blocks | Exists |
| `patch` | Unified diff format | TODO |
| `architect` | Two-stage planning + execution | TODO |

### 13.2 Context Management

| Feature | Description | Status |
|---------|-------------|--------|
| Chat chunks | Organize messages into logical sections | Partial |
| Prompt caching | Mark cacheable sections for efficiency | TODO |
| Chat summarization | Compress old messages when context fills | Exists |
| RepoMap | Tree-sitter based code map | TODO |

### 13.3 Auto-Everything

| Feature | Description | Status |
|---------|-------------|--------|
| Auto-lint | Lint after edits | TODO |
| Auto-test | Run tests after edits | TODO |
| Auto-commit | Commit changes to git | Exists |

---

## Implementation Priority (Updated)

| Phase | Feature | Effort | Impact | Priority | Status |
|-------|---------|--------|--------|----------|--------|
| 1-7 | Tool Improvements | - | - | - | **Complete** |
| 8 | Rust Model Map | Medium | High | P1 | **In Progress** |
| **9** | **Skills System** | High | **Critical** | **P0** | Planned |
| **11** | **Full MCP** | Medium | **Critical** | **P0** | Planned |
| **10** | **Plan/Act Mode** | Medium | High | **P1** | Planned |
| **12** | **Enhanced Multi-Agent** | High | High | **P1** | Planned |
| **13** | **Terminal UX** | Low | Medium | **P2** | Planned |

### Recommended Implementation Order

**Immediate (Next 4 weeks):**
1. Fix Model Map issues (Phase 8.1-8.2)
2. Skills System foundation (Phase 9.1-9.2)
3. MCP Server support (Phase 11.1)

**Short-term (Q1):**
4. Plan/Act Mode (Phase 10)
5. Built-in skills (Phase 9.3)
6. MCP Tool execution (Phase 11.2)

**Medium-term (Q2):**
7. Enhanced Multi-Agent (Phase 12)
8. Terminal UX (Phase 13)

---

## Architecture Insights from Reference Implementations

### From Codex (OpenAI)
- **Skills as progressive disclosure**: 3-level loading optimizes token usage
- **Agent roles**: Orchestrator, Worker, Explorer with model overrides
- **Sandbox-aware tools**: All execution considers sandbox constraints
- **Config layer stack**: Project → User → System precedence

### From OpenHands (65K★)
- **Event-first design**: Everything is an event for replay/undo
- **State separation**: Isolated state per agent, shared metrics
- **Delegation pattern**: Opaque to parent, communicates via events
- **Security as pluggable service**: LLM-based, invariant-based, or external

### From Cline (35K★)
- **Plan/Act duality**: Flexible execution with approval workflows
- **MCP production-ready**: Auth flows, auto-approval, streaming
- **Modular system prompts**: Model-specific optimizations
- **Task state + mutex**: Prevent race conditions

### From Aider (25K★)
- **Edit format switching**: Multiple strategies for different use cases
- **Context chunks**: Organized message sections for management
- **RepoMap**: Tree-sitter AST for intelligent code maps
- **Prompt caching**: Reduces costs and improves latency

---

## Feedback Source

This roadmap is based on:
1. GPT-OSS (120B) feedback on tool friction points
2. Code review of Phase 8 Model Map implementation
3. **Reference implementation analysis** (Feb 2026):
   - OpenAI Codex: Skills system, agent roles, sandboxing
   - OpenHands: Event-driven multi-agent, Docker sandboxing
   - Cline: Plan/Act mode, MCP integration, VS Code patterns
   - Aider: Terminal AI patterns, edit formats, context management

The suggestions prioritize making Codi competitive with industry-leading open source agents while maintaining its unique differentiators (UDS IPC, human-in-the-loop, local-first).
