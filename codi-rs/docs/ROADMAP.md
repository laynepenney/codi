# Codi-RS Roadmap

This roadmap focuses on the Rust CLI (`codi-rs`) and its TUI/orchestration stack. It complements the broader Codi roadmap in `docs/ROADMAP.md`.

## Status (2026-02-06)

- Core parity with the TypeScript CLI is in place (agent loop, tools, providers, symbol index, RAG, TUI, multi-agent).
- Remaining work clusters around cross-platform support, orchestration robustness, and TUI workflow polish.

## P0: Stability and Cross-Platform Foundations

1) Cross-platform IPC for multi-agent (complete)
- Transport abstraction with Windows named pipes.
- Deterministic commander/worker handshake with explicit timeouts.
- Windows IPC tests for roundtrip + handshake/permission flows.

2) Cancellation and lifecycle correctness
- Wire the TUI cancel flow to actual worker cancellation.
- Track tool_count and token usage for child agents.
- Add tests for cancellation and reconnection scenarios.

3) Windows support parity
- Audit file/path handling and shell execution behavior.
- Add Windows-specific tests for tool execution and config loading.
- Ensure multi-agent mode degrades gracefully when unsupported.

## P1: Workflow and Model UX

1) TUI workflow improvements
- Context summarization for long sessions.
- Model listing and switching from the TUI.
- Display active provider/model in session header.
- Worktree list/explorer surfaced in the TUI.

2) Model map integration
- Connect embeddings selection to model_map configuration.
- Expose errors and misconfigurations in `codi models` output.

## P2: Indexing and Retrieval Quality

1) Symbol index maintenance
- Cleanup of deleted/renamed files in the index.
- Usage detection and dependency graph traversal.

2) RAG reliability and performance
- Safer incremental index updates.
- Caching and pooling of embedding providers.

3) Syntax highlighting polish
- Upgrade tree-sitter-markdown when dependency compatibility allows.

## P3: Security and Observability

1) Execution policy improvements
- Extend dangerous pattern handling to a configurable policy engine.
- Safer defaults in multi-agent auto-approve scenarios.

2) Telemetry and diagnostics
- Surface per-worker metrics and error summaries in the TUI.

## Notes

- This roadmap prioritizes correctness and portability; features should not regress Windows support.
- Items are grouped by priority, not by release version.
