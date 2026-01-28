# Codi Codebase Refactoring Plan

## Executive Summary

Analysis identified **13 major refactoring opportunities** with potential for:
- ~4,500 lines of code reduction (20-25%)
- Significant maintainability improvements
- Better testability and separation of concerns

---

## Phase 1: High Impact, Quick Wins

### 1.1 Consolidate Output Handlers ✅ COMPLETED
**Files**: `src/index.ts:893-2352`

**Problem**: 16 nearly identical output handler functions with same pattern:
- `handleSessionOutput()`, `handleConfigOutput()`, `handleHistoryOutput()`, etc.
- Each follows: `split(':')` → `switch(type)` → handle event

**Solution**: Created generic handler registry in `src/cli/output-handlers.ts`:
```typescript
type OutputHandler = (output: string) => boolean;
const handlers = new Map<string, OutputHandler>();

export function registerHandler(prefix: string, handler: OutputHandler): void;
export function dispatch(output: string): boolean;
```

**Result**:
- Created `src/cli/output-handlers.ts` (1,221 lines)
- Removed 1,454 lines from `src/index.ts`
- `src/index.ts` reduced from ~4,936 to 3,380 lines

---

### 1.2 Create Centralized Paths Module ✅ COMPLETED
**Files**: `src/audit.ts`, `src/completions.ts`, `src/debug-bridge.ts`, `src/history.ts`, `src/plugins.ts`, `src/session.ts`, `src/usage.ts`

**Problem**: Directory paths hardcoded in 8+ files:
```typescript
join(homedir(), '.codi', 'audit')
join(homedir(), '.codi', 'sessions')
// ... repeated everywhere
```

**Solution**: Created `src/paths.ts`:
```typescript
export const CodiPaths = {
  home: () => join(homedir(), '.codi'),
  audit: () => join(CodiPaths.home(), 'audit'),
  sessions: () => join(CodiPaths.home(), 'sessions'),
  history: () => join(CodiPaths.home(), 'history'),
  plugins: () => join(CodiPaths.home(), 'plugins'),
  debug: () => join(CodiPaths.home(), 'debug'),
  commands: () => join(CodiPaths.home(), 'commands'),
  // ... etc
};
```

**Result**: Single source of truth for all Codi directory paths

---

### 1.3 Replace console.* with Logger ✅ COMPLETED
**Files**: Multiple files across codebase

**Problem**: Direct console.error/warn calls bypass log levels (--debug, --verbose, --trace)

**Solution**:
- Added `logger.log()` and `logger.logError()` methods for raw output
- Replaced `console.error` → `logger.error`
- Replaced `console.warn` → `logger.warn`

**Note**: `console.log` calls retained for user-facing output (adding "Info:" prefix would be disruptive)

**Result**: Consistent error/warning logging that respects verbosity settings

---

## Phase 2: Major Refactors

### 2.1 Split index.ts (4,936 lines → 3,380 lines → 2,746 lines) ✅ PARTIAL
**File**: `src/index.ts`

**Current concerns mixed**:
- CLI setup and argument parsing
- REPL loop logic
- ~~16 output handlers~~ (moved to output-handlers.ts)
- ~~Confirmation formatting~~ (moved to confirmation.ts)
- ~~System prompt generation~~ (moved to system-prompt.ts)
- ~~Provider/tool registration~~ (moved to initialization.ts)
- UI initialization

**Completed structure**:
```
src/
├── index.ts                 (2,746 lines - down from 3,380)
├── cli/
│   ├── repl.ts              (PENDING: REPL loop logic)
│   ├── initialization.ts    ✅ DONE (332 lines - providers, tools, MCP, RAG, symbol index)
│   ├── output-handlers.ts   ✅ DONE (consolidated handlers)
│   ├── confirmation.ts      ✅ DONE (234 lines - formatting utilities)
│   ├── system-prompt.ts     ✅ DONE (172 lines - prompt generation)
│   └── help.ts              ✅ DONE (120 lines - help display)
```

**Extracted modules in Phase 2.1**:
- `cli/system-prompt.ts`: `generateSystemPrompt()` function
- `cli/help.ts`: `showHelp()` function
- `cli/confirmation.ts`: `formatConfirmation()`, `formatConfirmationDetail()`, `stripAnsi()`, `promptConfirmation()`, `promptConfirmationWithSuggestions()`
- `cli/initialization.ts`: `registerToolsAndCommands()`, `createPrimaryProvider()`, `createSummarizeProvider()`, `initializeMCP()`, `initializeRAG()`, `initializeSymbolIndex()`, `logToolSummary()`

**Remaining for 2.1**: Extract REPL loop to `cli/repl.ts`

**Impact**: index.ts reduced by ~634 lines (19% reduction from 3,380)

---

### 2.2 Modularize agent.ts (2,671 lines → 2,349 lines) ✅ PARTIAL
**File**: `src/agent.ts`

**Current issues**:
- 50+ private fields
- Mixed: tool execution, context management, security, debugging
- Hard to test individual components

**Completed structure**:
```
src/agent/
├── index.ts           ✅ DONE (30 lines - module exports)
├── debugger.ts        ✅ DONE (672 lines - breakpoints, checkpoints, time travel)
├── context.ts         (PENDING: windowing, compression)
├── execution.ts       (PENDING: tool execution, batching)
└── security.ts        (PENDING: approvals, validation)
```

**Extracted modules in Phase 2.2**:
- `agent/debugger.ts`: `AgentDebugger` class with breakpoints, checkpoints, time-travel debugging
  - Breakpoint management (add, remove, clear, list, check)
  - Checkpoint management (create, save, load, list)
  - Time travel (rewind, branches, timeline)
  - State snapshots for debugging

**Result**:
- agent.ts reduced from 2,671 to 2,349 lines (-322 lines, 12% reduction)
- Created modular AgentDebugger class with clean interface
- Agent delegates to debugger via composition pattern

**Remaining for 2.2**: Extract context, execution, security modules

**Impact**: Better testability, clearer responsibilities

---

### 2.3 Extract Config Module (855 lines)
**File**: `src/config.ts`

**Mixed responsibilities**:
- Loading from workspace/local/global
- Validation
- Merging configs
- Tool-specific defaults

**Proposed structure**:
```
src/config/
├── loader.ts      (load from disk)
├── validator.ts   (validate structure)
├── merger.ts      (merge configs)
├── resolver.ts    (get resolved values)
└── types.ts       (config interfaces)
```

---

## Phase 3: Code Quality

### 3.1 Fix Type Safety Issues
**Locations with unsafe `any` casts**:

| File | Issue |
|------|-------|
| `src/tools/bash.ts` | `(error as any).stdout = ...` |
| `src/providers/anthropic.ts` | `(tool as any).cache_control = ...` |
| `src/providers/openai-compatible.ts` | `(delta as any)?.reasoning_content` |
| `src/session-selection.ts` | `key: any` in keypress handler |

**Solution**: Create proper type extensions in `src/types/`

---

### 3.2 Unify Caching Abstraction
**Files**: `src/utils/file-content-cache.ts`, `src/utils/tool-result-cache.ts`, `src/agent.ts`

**Problem**: Multiple independent cache implementations

**Solution**: Create generic `src/utils/cache.ts`:
```typescript
export class Cache<T> {
  constructor(private maxSize: number, private ttlMs?: number) {}
  get(key: string): T | null;
  set(key: string, value: T): void;
  invalidate(key: string): void;
}
```

---

### 3.3 Standardize Error Handling
**Problem**: Mix of throwing errors, returning strings, silent failures

**Solution**:
- Create `src/errors/` with typed errors
- Use `StructuredResult<T>` consistently in tools
- Define error categories (validation, runtime, user, system)

---

### 3.4 Simplify Command Registration
**Files**: All `src/commands/*-commands.ts`

**Problem**: Each file repeats similar registration pattern

**Solution**: Create command loader:
```typescript
// src/commands/loader.ts
export async function loadAllCommands(): Promise<void> {
  for (const module of ['code', 'git', 'session', ...]) {
    const { default: register } = await import(`./${module}-commands.js`);
    register();
  }
}
```

---

## Key Files to Modify

| File | Action | Status |
|------|--------|--------|
| `src/paths.ts` | Create new (centralized paths) | ✅ Done |
| `src/cli/output-handlers.ts` | Create new (consolidated handlers) | ✅ Done |
| `src/cli/system-prompt.ts` | Extract system prompt generation | ✅ Done |
| `src/cli/help.ts` | Extract help display | ✅ Done |
| `src/cli/confirmation.ts` | Extract confirmation utilities | ✅ Done |
| `src/cli/initialization.ts` | Extract initialization logic | ✅ Done |
| `src/index.ts` | Split into `src/cli/` modules | Partial (REPL pending) |
| `src/agent.ts` | Split into `src/agent/` modules | Partial (debugger done) |
| `src/agent/debugger.ts` | Extract debug/checkpoint functionality | ✅ Done |
| `src/config.ts` | Split into `src/config/` modules | Pending |
| `src/utils/cache.ts` | Create new (generic cache) | Pending |
| Multiple files | Replace `console.*` with `logger.*` | ✅ Done |

---

## Verification Plan

```bash
# After each phase:
pnpm build          # Type checking
pnpm test           # Unit tests

# Manual verification:
# 1. Start Codi, run /help - verify all commands work
# 2. Test output formatting (sessions, config, etc.)
# 3. Check log levels with --debug, --verbose
# 4. Run a multi-turn conversation
```

---

## Progress Summary

| Refactoring | Lines Impact | Status |
|-------------|--------------|--------|
| Output handlers consolidation | -1,454 lines from index.ts | ✅ Complete |
| Paths module | +centralized paths | ✅ Complete |
| Console → logger | console.error/warn converted | ✅ Complete |
| Index.ts Phase 2.1 extraction | -634 lines (3,380 → 2,746) | ✅ Complete |
| Index.ts REPL extraction | ~1,500 lines pending | Partial |
| Agent.ts debugger extraction | -322 lines (2,671 → 2,349) | ✅ Complete |
| Agent.ts remaining modules | context, execution, security | Pending |
| Config extraction | ~855 lines | Pending |

---

## Implementation Order

1. ~~**Phase 1.2**: Create `src/paths.ts`~~ ✅ Done
2. ~~**Phase 1.3**: Replace console.* calls~~ ✅ Done
3. ~~**Phase 1.1**: Consolidate output handlers~~ ✅ Done
4. ~~**Phase 2.1**: Split index.ts~~ ✅ Partial (extracted system-prompt, help, confirmation, initialization)
   - Remaining: Extract REPL loop to `cli/repl.ts`
5. ~~**Phase 2.2**: Modularize agent.ts~~ ✅ Partial (extracted debugger)
   - Remaining: Extract context, execution, security modules
6. **Phase 2.3**: Extract config module
7. **Phase 3**: Code quality improvements
