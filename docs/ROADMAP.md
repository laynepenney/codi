# Codi Tool Improvements Roadmap

This roadmap outlines planned improvements to Codi's tool suite based on real-world usage feedback. The goal is to make Codi more effective at navigating large codebases, making targeted edits, and automating workflows.

---

## Changelog

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

---

## Quick Wins

| Item | Description | Status |
|------|-------------|--------|
| `search_codebase` filtering | Add `dir`, `file_pattern`, `min_score` params | Done |
| Structured test output | Parse output into pass/fail/skip counts | Done |
| Separate stdout/stderr | Enhanced bash output format | Done |
| Group `find_references` | By type with per-file counts | Done |

---

## Feedback Source

This roadmap is based on feedback from GPT-OSS (120B) after using Codi's tools for a bracketed paste mode implementation task. The model identified specific friction points when:
- Searching large TypeScript codebases
- Making targeted edits across multiple locations
- Understanding code structure and dependencies
- Validating changes with tests

The suggestions prioritize making the AI assistant operate more like an IDE-level automation layer: finding the right code fast, making reliable changes, validating automatically, and keeping documentation in sync.
