# Test Coverage Improvement Plan

This document outlines a prioritized plan for improving test coverage in the Codi codebase.

## Current State

| Metric | Current | Target |
|--------|---------|--------|
| Statements | 43.07% | 60% |
| Branches | 80.30% | 85% |
| Functions | 58.97% | 75% |
| Lines | 43.07% | 60% |

---

## Phase 1: High-Impact, Low-Effort (Mock-Friendly)

These files can be tested with straightforward mocking and don't require database setup.

### 1.1 Tools with Low Coverage

| File | Coverage | Tests Needed | Effort |
|------|----------|--------------|--------|
| `generate-docs.ts` | 12% | JSDoc/docstring parsing, format output | Medium |
| `refactor.ts` | 31% | Search/replace logic, dry-run, regex mode | Medium |

**Implementation:**
```typescript
// generate-docs.test.ts
- Test JSDoc parsing for functions, classes, interfaces
- Test Python docstring parsing
- Test markdown vs JSON output formats
- Test include_private option
- Test symbol filtering

// refactor.test.ts (expand existing)
- Test regex mode with capture groups
- Test dry_run mode output
- Test max_files limit
- Test file pattern filtering
- Test scope directory limiting
```

### 1.2 Utility Functions

| File | Coverage | Tests Needed | Effort |
|------|----------|--------------|--------|
| `bash-utils.ts` | 23% | Output parsing, truncation | Low |
| `result-utils.ts` | 5% | Result formatting helpers | Low |
| `json-parser.ts` | 5% | JSON5 parsing, error handling | Low |
| `image-parser.ts` | 8% | Image format detection, base64 | Low |

**Implementation:**
- Pure functions with no external dependencies
- Easy to unit test with various inputs
- Focus on edge cases and error conditions

---

## Phase 2: Provider & Agent Testing

These require more setup but are critical for reliability.

### 2.1 Provider Layer

| File | Coverage | Tests Needed | Effort |
|------|----------|--------------|--------|
| `anthropic.ts` | 19% | API calls, streaming, error handling | Medium |
| `openai-compatible.ts` | 18% | API calls, model listing, retries | Medium |
| `ollama-native.ts` | 1% | Local model calls, connection handling | Medium |

**Implementation:**
```typescript
// Mock the HTTP client/SDK
vi.mock('@anthropic-ai/sdk');
vi.mock('openai');

// Test scenarios:
- Successful chat completion
- Streaming responses
- Tool use handling
- Rate limiting/retries
- Error responses (4xx, 5xx)
- Token counting
```

### 2.2 Agent Core

| File | Coverage | Tests Needed | Effort |
|------|----------|--------------|--------|
| `agent.ts` | 15% | Tool execution, context management | High |
| `approvals.ts` | 4% | Approval flow, dangerous patterns | Medium |
| `context.ts` | 2% | Project detection, context building | Medium |

**Implementation:**
- Mock providers and tools
- Test conversation flow
- Test context compaction triggers
- Test approval prompts and bypasses

---

## Phase 3: Command Testing

Commands return prompts for the AI, so focus on input parsing and prompt generation.

### 3.1 High-Priority Commands

| File | Coverage | Tests Needed | Effort |
|------|----------|--------------|--------|
| `git-commands.ts` | 23% | Git status parsing, commit generation | Medium |
| `workflow-commands.ts` | 36% | Multi-step workflow prompts | Low |
| `session-commands.ts` | 11% | Save/load/list sessions | Medium |
| `model-commands.ts` | 10% | Model listing, switching | Low |

### 3.2 Lower-Priority Commands

| File | Coverage | Tests Needed | Effort |
|------|----------|--------------|--------|
| `memory-commands.ts` | 29% | Remember/forget/profile | Low |
| `history-commands.ts` | 25% | Undo/redo file operations | Medium |
| `plugin-commands.ts` | 15% | Plugin loading/listing | Low |

---

## Phase 4: Symbol Index Tools (Requires better-sqlite3)

These tests are currently skipped on Node 25 due to native module issues.

### Strategy Options:

**Option A: Skip on incompatible Node versions**
```typescript
describe.skipIf(process.version.startsWith('v25'))('Symbol Index', () => {
  // Tests that require better-sqlite3
});
```

**Option B: Mock the database layer**
```typescript
vi.mock('../src/symbol-index/database.js', () => ({
  SymbolDatabase: vi.fn().mockImplementation(() => ({
    findSymbols: vi.fn(),
    insertSymbol: vi.fn(),
    // ... mock all methods
  })),
}));
```

**Option C: Use in-memory SQLite (sql.js)**
- Replace better-sqlite3 with sql.js for tests
- sql.js is pure JavaScript, works on any Node version

### Files to Cover

| File | Coverage | Notes |
|------|----------|-------|
| `find-symbol.ts` | 2% | Symbol search |
| `find-references.ts` | 2% | Reference finding |
| `goto-definition.ts` | 3% | Definition lookup |
| `get-dependency-graph.ts` | 1% | Dependency traversal |
| `get-inheritance.ts` | 3% | Class hierarchy |
| `get-call-graph.ts` | 2% | Function calls |
| `show-impact.ts` | 1% | Change impact analysis |
| `get-index-status.ts` | 1% | Index freshness |

---

## Phase 5: RAG System

| File | Coverage | Tests Needed | Effort |
|------|----------|--------------|--------|
| `retriever.ts` | ~10%* | Query execution, result formatting | Medium |
| `indexer.ts` | 0% | File processing, chunking | High |
| `vector-store.ts` | 0% | Vector storage, similarity search | High |

*Improved with recent format method tests

**Implementation:**
- Mock embedding providers
- Mock vector store for retriever tests
- Use temporary directories for indexer tests
- Focus on chunking logic, not actual embeddings

---

## Implementation Order

### Sprint 1: Quick Wins (Target: +5% coverage)
1. ✅ Complete - pipeline.ts, shell-info.ts, rebuild-index.ts
2. [ ] Utility functions (bash-utils, result-utils, json-parser)
3. [ ] generate-docs.ts
4. [ ] refactor.ts (expand existing tests)

### Sprint 2: Commands (Target: +8% coverage)
1. [ ] git-commands.ts
2. [ ] session-commands.ts
3. [ ] model-commands.ts
4. [ ] workflow-commands.ts

### Sprint 3: Core (Target: +10% coverage)
1. [ ] Provider mocking infrastructure
2. [ ] anthropic.ts, openai-compatible.ts
3. [ ] agent.ts core flows
4. [ ] context.ts, approvals.ts

### Sprint 4: Symbol Index (Target: +5% coverage)
1. [ ] Decide on mocking strategy
2. [ ] Implement database mocks or sql.js
3. [ ] Cover all symbol-index tools

### Sprint 5: RAG System (Target: +5% coverage)
1. [ ] indexer.ts with temp directories
2. [ ] vector-store.ts with mocked storage
3. [ ] retriever.ts query tests

---

## Testing Patterns

### Mocking External Dependencies
```typescript
// Mock file system
vi.mock('fs/promises');
vi.mock('fs');

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, cb) => cb(null, { stdout: '', stderr: '' })),
}));

// Mock API clients
vi.mock('@anthropic-ai/sdk');
vi.mock('openai');
```

### Testing Commands
```typescript
describe('MyCommand', () => {
  it('generates correct prompt', async () => {
    const result = await myCommand.execute('args', mockContext);
    expect(result).toContain('expected prompt content');
  });
});
```

### Testing Tools
```typescript
describe('MyTool', () => {
  it('returns structured output', async () => {
    const result = await tool.execute({ input: 'value' });
    expect(result).toContain('expected output');
  });

  it('handles errors gracefully', async () => {
    await expect(tool.execute({ bad: 'input' }))
      .rejects.toThrow('Expected error');
  });
});
```

---

## Success Metrics

| Phase | Target Coverage | Tests Added |
|-------|-----------------|-------------|
| Phase 1 | 48% | ~50 |
| Phase 2 | 55% | ~80 |
| Phase 3 | 63% | ~60 |
| Phase 4 | 68% | ~50 |
| Phase 5 | 73% | ~40 |

**Final Target: 70%+ overall coverage**
