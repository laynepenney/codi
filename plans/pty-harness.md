# Plan: Pseudo-terminal (PTY) harness for `codi` CLI testing

## Goal
Add an automated way to run `codi` as a real interactive CLI in dev/CI, send keystrokes/commands, and assert on output + side effects (e.g., session persistence for `openFilesState`).

This enables end-to-end-ish integration tests for interactive features like “open files”, pinning, eviction, save/load sessions.

---

## Approach (recommended): Node PTY runner + integration tests

### 1) Add a PTY runner utility
Create a small harness that spawns `codi` inside a pseudo-terminal and provides a controlled API for tests.

**File:** `tests/utils/pty-runner.ts` (or `src/test-utils/pty-runner.ts`)

**Responsibilities:**
- Spawn a process with PTY semantics
- Capture output transcript (stdout/stderr combined in PTY)
- Provide helper methods:
  - `send(text: string)`
  - `sendLine(text: string)` (append `\r`)
  - `sendKey(key: "enter" | "up" | "down" | "esc" | ... )`
  - `waitForOutput(pattern: RegExp | string, timeoutMs?: number)`
  - `dispose()` / `kill()`

**Dependency:** `node-pty` (devDependency)
- Pros: behaves like a real terminal; common approach for CLI E2E
- Cons: native module; requires build tooling in CI

**Runner configuration for determinism:**
- Fixed terminal size: cols/rows
- Environment:
  - `NO_COLOR=1`, `FORCE_COLOR=0` (stabilize output)
  - `HOME` / `XDG_CONFIG_HOME` / `XDG_DATA_HOME` pointed to temp dirs (avoid touching real user config)
  - `CI=1`
  - Optional: `CODI_TEST_MODE=1` for reduced animations/spinners

---

### 2) Add an integration test file that uses the PTY runner
**File:** `tests/cli/pty-open-files.test.ts`

Test outline:
1. Create a temp workspace with known files (e.g., `a.ts`, `b.ts`, `c.ts`).
2. Spawn `codi` in dev mode.
3. Drive the UI via keystrokes/commands to:
   - open file A and B
   - pin file A
   - save session to a known path
   - quit
4. Restart `codi`, load that session.
5. Assert:
   - output indicates restored open files
   - persisted session JSON contains `openFilesState` with pinned + ordering

Notes:
- Assertions should primarily be on persisted artifacts (session file) and a small number of stable output lines.
- Prefer explicit “save session to path” flag/env to avoid hunting for default locations.

---

### 3) Make `codi` scriptable / test-friendly (minimal CLI changes)
PTY tests are fragile if the CLI has animations or non-deterministic prompts. Add small, gated hooks.

**Minimal additions (env-gated preferred):**
- `CODI_TEST_MODE=1`
  - disable spinners/animations
  - reduce debounce delays
  - ensure prompts are flushed predictably
- `CODI_SESSION_DIR=/tmp/...` or `--session-path <path>`
  - ensures tests can read session output reliably

Optional (nice-to-have):
- `--script <file>`: run a deterministic command script (still valuable even with PTY)
- `--json-events`: emit machine-readable event lines for key state changes

---

## Alternative approach (lower native dependency risk)
If adding `node-pty` is undesirable:
- Refactor the interactive layer so core commands can be invoked programmatically.
- Write integration tests calling internal APIs rather than simulating a terminal.

Pros:
- Faster, more stable tests
- No native module builds

Cons:
- Less confidence in real TTY behavior

---

## CI plan
Because PTY libraries are typically native:
- Use Node 20/22 LTS in CI (avoid experimental Node versions).
- Ensure build toolchain exists:
  - Ubuntu: `build-essential`, `python3`, etc.
  - macOS usually OK with Xcode tools.
- If using pnpm, ensure build scripts are allowed (pnpm may restrict postinstall scripts depending on config).

---

## Implementation steps (checklist)
1. Add `node-pty` devDependency.
2. Implement `tests/utils/pty-runner.ts`.
3. Add test helpers for temp dirs and stable env setup.
4. Add `tests/cli/pty-open-files.test.ts`.
5. Add (or gate) CLI hooks for stable behavior in test mode.
6. Run locally: `pnpm test` (or a separate `pnpm test:cli`).
7. Wire into CI (or keep separate until stable).

---

## Inputs needed to finalize the test script
To write the first real PTY test, we need:
- Exact user-visible commands/keystrokes for:
  - open file
  - pin/unpin
  - save session
  - load session
  - exit
- Where sessions are stored today (or willingness to add an override flag/env).
