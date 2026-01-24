# Ink UI Review Fixes Plan

## Context
Two review findings need fixes:
- Ink UI command outputs bypass the Ink renderer and corrupt the UI.
- Worker/reader stdout/stderr line buffering can drop the final line on exit.

## Goals
- Ensure all command outputs render through Ink when Ink UI is active.
- Preserve final buffered log fragments on child process exit.

## Plan
1. Ink command output routing
   - Add a single output sink for command handlers that routes to Ink when active.
   - Ensure `__SESSION_`, `__CONFIG_`, `__USAGE_`, `__MODELS__`, `__PLUGIN__`, `__UNDO_`, and history outputs are handled through the sink.
   - Keep classic UI behavior unchanged.
2. Flush worker/reader buffers on exit
   - On child process `exit`, emit any remaining `stdoutBuffer`/`stderrBuffer` as log lines.
   - Reuse existing log handling so UI/log buffers are updated consistently.

## Risks
- Ink output routing could miss some command paths if not centralized.
- Buffer flush must avoid duplicating already-emitted lines.

## Tests
- Manual: run `pnpm dev -- --ui ink`, run `/sessions`, `/config`, `/usage`, `/models`, `/load`.
- Manual: spawn a worker that prints without trailing newline; verify final line appears in logs.
