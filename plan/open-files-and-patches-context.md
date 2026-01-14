# Plan: Persistent Open Files + Patch Context + Gated Git Diff

## Goals
- Maintain a **persistent “open files” set** (pinned + recent) across sessions.
- Maintain a **persistent patch ledger** of tool-based edits (diffs + summaries).
- **Inject** open files and patch context into the model prompt **selectively**, within budgets.
- Provide **git diff fallback** (working tree + staged) when tool-based patches don’t explain current state.
- Support **both explicit commands** and **implicit auto-open** behavior.

---

## Phase 0 — Foundations: state + persistence

### 0.1 Add Open Files state + manager
- Create `src/open-files.ts` (or reuse existing if present) with:
  - Types: `OpenFileMeta`, `OpenFilesState`
  - Class: `OpenFilesManager`
    - `open(path, { pinned? })`, `close(path)`, `pin(path)`, `unpin(path)`, `touch(path)`
    - `list(): Array<{ path, pinned, lastViewedAt, ... }>`
    - `toJSON()/fromJSON()` for persistence
    - Enforce limits: max recent files, eviction policy (LRU for non-pinned)

### 0.2 Add Patch Ledger state
- Create `src/patch-ledger.ts` with:
  - Type: `PatchEntry { filePath, ts, toolName, summary, unifiedDiff }`
  - Class: `PatchLedger`
    - `add(entry)`, `listRecent()`, `summarize()`, `clear()`
    - Trimming policy: max entries and/or max total diff size

### 0.3 Persist both in sessions
- Extend session save/load (in `src/commands/session-commands.ts` and any session serialization module) to include:
  - `openFilesState`
  - `patchLedgerState`
- Backward compatibility:
  - Missing keys => defaults

**Deliverable:** saving/loading a session restores open files + patch history.

---

## Phase 1 — UX: explicit commands + implicit tracking

### 1.1 Add slash commands to manage open files
Add a new command module (or extend existing code commands) implementing:
- `/open <path|glob>` (supports globs; optional `--pin`)
- `/open:list`
- `/close <path>`
- `/pin <path>`
- `/unpin <path>`
- `/open:clear`

### 1.2 Add patch inspection commands (optional but recommended)
- `/patches:list` (shows recent patch summaries)
- `/patches:show <n|path>` (shows unified diff)
- `/patches:clear`

### 1.3 Implicit auto-open (and “touch”) on file tool usage
In the agent tool execution path:
- When tool is `read_file`, `write_file`, `edit_file`, `insert_line`, `patch_file`:
  - call `openFiles.open(path)` and `openFiles.touch(path)`
- When tool is `glob`/`grep`:
  - optionally open/touch the *matched* files if available (or just track patterns)

**Deliverable:** files the agent interacts with automatically appear as “open” and are persisted.

---

## Phase 2 — Patch capture: record diffs for file modifications

### 2.1 Capture diffs for mutating file tools
Hook into the tool execution pathway for:
- `write_file` → call `generateWriteDiff(path, newContent)`
- `edit_file` → call `generateEditDiff(path, old_string, new_string, replace_all)`
- `insert_line` / `patch_file` → generate diff by reading file before/after (or enhance diff utilities)

Add to `PatchLedger`:
- `summary` from diff result summary
- `unifiedDiff` from diff result unified diff

### 2.2 Trim patch ledger
- Keep last K entries (e.g. 20) and/or enforce size cap (e.g. 200KB total unified diff text).

**Deliverable:** every tool-based edit results in a stored diff entry, visible via `/patches:list`.

---

## Phase 3 — Context injection: open files + patch summaries/diffs

### 3.1 Add a context augmentation step in the Agent
Before each provider call, build synthetic context blocks:
- `OpenFilesContextBlock` (file contents, truncated)
- `PatchContextBlock` (summary always; diffs sometimes)

### 3.2 Open files injection policy (selective)
Inject if any of:
- User mentions an open file path/basename
- User asks for code understanding/debugging
- Recent tool activity touched files
- User explicitly requests “use open files/current context”

Content selection:
- Include pinned first, then most-recent touched
- Apply per-file cap + total cap

### 3.3 Patch injection policy
- Always inject a tiny “patch summary” block.
- Include full diffs only if:
  - User asks about changes
  - Model is about to perform more edits and needs context
  - Budget allows

### 3.4 Budgeting
Configure budgets (constants/config):
- max tokens/bytes for open files
- max tokens/bytes for diffs

Truncation strategy:
- File: head + tail or head + `...truncated...`
- Diff: use `truncateDiff(...)`

**Deliverable:** model sees open file contents and patch context when appropriate.

---

## Phase 4 — Git diff fallback (gated)

### 4.1 Add git diff collector
Implement helper `getGitDiff({ staged?: boolean })`.
- Only run when gated to avoid cost.

### 4.2 Git diff gating
Trigger when:
- Patch ledger is empty but user references “my changes”
- Build/test failures occur after external edits
- User explicitly requests git diff context

Inject:
- summary first
- full diff only if budget allows or user asks

**Deliverable:** changes made outside tool system can still be supplied as patch context.

---

## Phase 5 — Retrieval gating integration (optional follow-up)

### 5.1 Use open files + patches as primary context
Run RAG/symbol search only when open files + patch context don’t contain needed info.
- Respect remaining budget after open files/patch injection.

**Deliverable:** fewer unnecessary retrieval calls; more reliable local-context answers.

---

## Acceptance Criteria (definition of done)
- Open files persist across `/session save` and reload.
- File tool usage automatically updates open files and patch ledger.
- Model receives open file contents + patch summary under defined gating rules.
- Patch summaries persist and are queryable.
- Git diff fallback works and is gated.

---

## Rollout Recommendation
- **PR 1:** Phase 0 + Phase 1 (state + persistence + commands + implicit tracking)
- **PR 2:** Phase 2 (patch ledger diffs)
- **PR 3:** Phase 3 (context injection + budgets)
- **PR 4:** Phase 4 (git diff fallback)
- **PR 5:** Phase 5 (retrieval gating refinements)
