# Codi Tool Improvements Roadmap

This roadmap outlines planned improvements to Codi's tool suite based on real-world usage feedback. The goal is to make Codi more effective at navigating large codebases, making targeted edits, and automating workflows.

---

## Phase 1: Search & Navigation Enhancements

### 1.1 Richer Code Search (`search_codebase`)

**Current limitations:**
- Returns raw snippets without ranking or relevance scores
- No file type or directory filtering
- Results lack symbol context (function name, line numbers)

**Proposed improvements:**

| Feature | Description | Priority |
|---------|-------------|----------|
| Semantic ranking | Add BM25 + vector similarity scoring, return `score` field | High |
| Result filtering | Add `max_results` and `min_score` parameters | High |
| File/directory scope | Add `file_glob` and `dir` parameters to narrow search | Medium |
| Symbol context | Return `{file, startLine, endLine, snippet, symbolName?, symbolKind?}` | Medium |

**Example enhanced API:**
```typescript
search_codebase({
  query: "paste detection",
  file_glob: "*.ts",
  dir: "src/",
  max_results: 10,
  min_score: 0.7
})
// Returns: { results: [{ file, startLine, endLine, snippet, symbolName, score }] }
```

### 1.2 Navigation Tool Improvements

| Tool | Current Issue | Improvement |
|------|---------------|-------------|
| `goto_definition` | Ambiguous when same name appears in multiple modules | Add optional `line`/`column` parameters to resolve exact reference |
| `find_references` | Returns flat list, no grouping | Group by type: `{type: "import" \| "call", file, line, snippet}` with per-file counts |
| NEW: `show_impact` | No way to preview change impact | Show dependent files (via dependency graph) and diff preview |

---

## Phase 2: Batch Operations & Refactoring

### 2.1 Multi-Patch Support

**Current limitation:** `patch_file` only accepts one patch at a time, requiring multiple round-trips for multi-location changes.

**Proposed:**
```typescript
patch_file({
  path: "src/index.ts",
  patches: [
    { diff: "..." },  // Add CLI option
    { diff: "..." }   // Update help text
  ]
})
```

### 2.2 Atomic Refactor Tool

New tool for search-and-replace across the codebase:

```typescript
refactor({
  searchQuery: "PASTE_DEBOUNCE_MS",
  replaceWith: "DEFAULT_PASTE_DEBOUNCE_MS",
  scope?: "src/"  // optional directory scope
})
// Returns: { filesChanged: 3, conflicts: [], summary: "..." }
```

Internally uses semantic search + `edit_file`, applies all changes atomically.

---

## Phase 3: Testing Integration

### 3.1 Smart Test Filtering

**Current:** `run_tests` runs all tests or requires manual filter specification.

**Proposed:**
```typescript
run_tests({
  filter: "paste-debounce",  // pattern match
  changedFiles: true,        // auto-detect from git status
  timeout: 60
})
```

### 3.2 Structured Test Output

**Current:** Returns raw stdout as string.

**Proposed:**
```typescript
interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  coverage?: { lines: number; branches: number };
  failures: Array<{ test: string; error: string; file: string; line: number }>;
  duration: number;
  output: string;  // raw output preserved
}
```

---

## Phase 4: Shell & Environment

### 4.1 Enhanced Bash Output

**Current:** Returns combined stdout/stderr as string.

**Proposed:**
```typescript
interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}
```

### 4.2 Environment Snapshot Tool

New tool to capture runtime environment:

```typescript
shell_info({
  commands: ["node -v", "pnpm -v", "git --version"]
})
// Returns: { "node -v": "v22.0.0", "pnpm -v": "9.0.0", ... }
```

Useful for debugging environment-specific issues.

---

## Phase 5: Indexing & Performance

### 5.1 Persistent Project Index

**Current:** RAG indexing runs on startup, symbol index requires manual rebuild.

**Proposed:**
- Background indexer that maintains `.codi/index.json`
- Incremental updates on file changes (file watcher)
- Expose `rebuild_index()` tool and `index_version` metadata
- Turn O(N) scans into O(log N) lookups

### 5.2 Index Freshness Detection

```typescript
get_index_status()
// Returns: {
//   version: "abc123",
//   lastUpdated: "2024-01-14T10:00:00Z",
//   filesIndexed: 150,
//   stale: false,
//   stalePaths: []  // files modified since last index
// }
```

---

## Phase 6: Standardization & Error Handling

### 6.1 Unified Result Object

All tools should return a standardized result:

```typescript
interface ToolResult<T> {
  ok: boolean;
  data?: T;           // present when ok === true
  error?: string;     // error message when ok === false
  warnings?: string[];
}
```

Benefits:
- Consistent error handling across all tools
- AI can reliably branch on `result.ok`
- Warnings don't block execution but are surfaced

### 6.2 Tool Execution Pipeline

New meta-tool for chained operations:

```typescript
pipeline({
  steps: [
    { tool: "edit_file", args: { path: "...", old_string: "...", new_string: "..." } },
    { tool: "run_tests", args: { filter: "paste" } },
    { tool: "bash", args: { command: "git add -A" } }
  ],
  stopOnFailure: true
})
// Returns combined log, short-circuits on failure
```

---

## Phase 7: Documentation & Configuration

### 7.1 Auto-Documentation Tool

```typescript
generate_docs({
  file: "src/paste-debounce.ts",
  symbol?: "createPasteDebounceHandler",
  format: "markdown"
})
```

Extracts JSDoc/TSDoc comments, infers descriptions, updates README or creates docs files.

### 7.2 Tool Configuration

User-configurable toolset via `.codi-tools.json`:

```json
{
  "disabled": ["web_search"],
  "search_codebase": {
    "default_max_results": 20,
    "default_min_score": 0.6
  },
  "run_tests": {
    "default_timeout": 120
  }
}
```

---

## Implementation Priority

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Phase 1: Search & Navigation | Medium | High | **P0** |
| Phase 2: Batch Operations | Medium | High | **P0** |
| Phase 3: Testing Integration | Low | Medium | **P1** |
| Phase 4: Shell & Environment | Low | Medium | **P1** |
| Phase 5: Indexing & Performance | High | High | **P1** |
| Phase 6: Standardization | Medium | Medium | **P2** |
| Phase 7: Documentation & Config | Low | Low | **P2** |

---

## Quick Wins (Can implement immediately)

1. **Add `dir` parameter to `search_codebase`** - Simple filter, high value
2. **Add `min_score` to RAG search** - Already have scores internally
3. **Structured test output** - Parse existing output into JSON
4. **Separate stdout/stderr in bash** - Node.js supports this natively
5. **Group `find_references` by type** - Post-process existing results

---

## Feedback Source

This roadmap is based on feedback from GPT-OSS (120B) after using Codi's tools for a bracketed paste mode implementation task. The model identified specific friction points when:
- Searching large TypeScript codebases
- Making targeted edits across multiple locations
- Understanding code structure and dependencies
- Validating changes with tests

The suggestions prioritize making the AI assistant operate more like an IDE-level automation layer: finding the right code fast, making reliable changes, validating automatically, and keeping documentation in sync.
