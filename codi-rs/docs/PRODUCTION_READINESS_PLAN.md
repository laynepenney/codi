# Codi-RS Production Readiness Plan

**Objective:** Bring codi/codi-rs from 88% to 100% production readiness  
**Timeline:** 2-3 weeks  
**Current Branch:** `feat/production-readiness-phase-3`  
**Priority:** Fix critical panics first, then polish

---

## Executive Summary

This plan addresses all production readiness issues identified in the assessment:
- **Critical:** 100+ panic/unwrap/expect calls in production code
- **Medium:** 7 outstanding TODOs, minor warnings
- **Low:** Documentation, monitoring, performance validation

---

## Phase 1: Critical Issues (Week 1) - ELIMINATE PRODUCTION PANICS ✅ COMPLETE

### 1.1 Priority Files (Fixed)

**File 1: `src/tui/app.rs:1683-1687`**
- **Issue:** Two `panic!` calls in production app logic
- **Fix:** Replaced with proper error handling and user notification
- **Status:** ✅ Complete

**File 2: `src/orchestrate/ipc/transport.rs:133-152`**
- **Issue:** 9 `.expect()` calls in IPC transport layer
- **Fix:** Converted to `Result` with descriptive errors
- **Status:** ✅ Complete

**File 3: `src/orchestrate/ipc/client.rs:347, 488`**
- **Issue:** `.unwrap()` and `.expect()` in message handling
- **Fix:** Graceful degradation on malformed messages
- **Status:** ✅ Complete

### 1.2 Implementation Strategy

```rust
// BEFORE (BAD):
.expect("bind failed");

// AFTER (GOOD):
.map_err(|e| {
    tracing::error!("IPC bind failed: {}", e);
    IpcError::Transport(format!("Failed to bind: {}", e))
})?;
```

**Pattern:**
1. ✅ Identify all panics/unwraps/expects (100 total)
2. ✅ Replace with proper error types
3. ✅ Add context with `tracing::error!`
4. ✅ Ensure graceful degradation
5. ✅ Test error paths

### 1.3 Error Type Design

Added comprehensive error types to affected modules:

```rust
// src/orchestrate/ipc/error.rs
#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("Transport error: {0}")]
    Transport(String),
    #[error("Bind failed: {0}")]
    BindFailed(String),
    #[error("Accept failed: {0}")]
    AcceptFailed(String),
    #[error("Read failed: {0}")]
    ReadFailed(String),
    #[error("Write failed: {0}")]
    WriteFailed(String),
    #[error("Connection failed: {0}")]
    ConnectFailed(String),
    #[error("Handshake failed: {0}")]
    HandshakeFailed(String),
    #[error("Permission request failed: {0}")]
    PermissionFailed(String),
    #[error("Worker not connected: {0}")]
    WorkerNotConnected(String),
    #[error("Invalid handshake")]
    InvalidHandshake,
    #[error("Channel closed")]
    ChannelClosed,
    #[error("Server not started")]
    NotStarted,
    #[error("Invalid message: {0}")]
    InvalidMessage(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
}
```

### 1.4 Files Modified in Phase 1

- `src/orchestrate/ipc/error.rs` (NEW - comprehensive error type)
- `src/orchestrate/ipc/mod.rs` (exports)
- `src/orchestrate/ipc/client.rs` (fixed unwraps, added InvalidMessage)
- `src/orchestrate/ipc/server.rs` (uses unified IpcError)
- `src/orchestrate/commander.rs` (fixed socket path handling)
- `src/orchestrate/worktree.rs` (fixed 3 unwraps)
- `src/orchestrate/griptree.rs` (fixed 4 unwraps)
- `src/tui/terminal_ui.rs` (removed unused import)

### 1.5 Acceptance Criteria

- [x] Zero `panic!` calls in production code (tests OK)
- [x] Zero `expect()` calls in production code
- [x] Zero `unwrap()` calls in production code paths
- [x] All errors properly propagated with context
- [x] No behavioral regressions
- [x] All 516 tests pass

---

## Phase 2: Code Quality (Week 1-2) - ✅ COMPLETE

### 2.1 Clean Up Warnings

**Issues:**
- ~~Unused import `Stylize` in `src/tui/terminal_ui.rs:18`~~ ✅ Fixed via cargo fix
- ~~Unused function `load_session` in `src/main.rs:505`~~ ✅ Removed

**Status:** Clean build with zero warnings ✅

### 2.2 Address TODOs by Priority

**HIGH Priority (Completed):**

1. ✅ **`src/symbol_index/indexer.rs:561` - File cleanup**
   - Added `get_all_files()` method to `SymbolDatabase`
   - Implemented `cleanup_deleted()` to remove stale entries
   - Files checked against disk and deleted from DB if missing

2. ✅ **`src/symbol_index/service.rs:206` - Usage detection**
   - Added `find_imports_with_symbol()` method
   - `find_references()` finds all imports referencing a symbol

3. ✅ **`src/symbol_index/service.rs:229` - Dependency graph**
   - Added BFS traversal in `get_dependencies()`
   - Supports both `Imports` and `ImportedBy` directions

**LOW Priority (Deferred to Phase 4):**
- `src/tui/app.rs:1355` - Worktree listing exposure
- `src/tui/syntax/highlighter.rs:49` - Tree-sitter-markdown compatibility  
- `src/cli/models.rs:84` - Error collection
- `src/rag/embeddings/mod.rs:47` - Model map integration

### 2.3 Phase 2 Completion

- **Date:** 2026-02-08
- **Branch:** feat/production-readiness-phase-2
- **PR:** #285
- **Files Changed:** 5 (+554/-232 lines)
- **Tests:** All 516 passing
- **Build:** Zero warnings

---

## Phase 3: Testing & Validation (Week 2) - 🔄 IN PROGRESS

### 3.1 Error Path Tests

**Target:** Error path coverage >80%

**IPC Error Tests (IN PROGRESS):**

| Scenario | Status | File |
|----------|--------|------|
| Server not started | ✅ Added | `server.rs` |
| Bind to invalid path | ✅ Added | `server.rs` |
| Send to nonexistent worker | ✅ Added | `server.rs` |
| Stop without start | ✅ Added | `server.rs` |
| Broadcast with no workers | ✅ Added | `server.rs` |
| Connect to nonexistent socket | ✅ Added | `client.rs` |
| Send status not connected | ✅ Added | `client.rs` |
| Send task complete not connected | ✅ Added | `client.rs` |
| Send task error not connected | ✅ Added | `client.rs` |
| Send log not connected | ✅ Added | `client.rs` |
| Send pong not connected | ✅ Added | `client.rs` |
| Request permission not connected | ✅ Added | `client.rs` |
| Request permission cancelled | ✅ Added | `client.rs` |

**Remaining IPC Tests:**
- Read/write failures
- Connection timeout
- Handshake failure
- Permission timeout
- Channel closed

**Provider API Failure Tests (PENDING):**
- Timeouts
- Auth errors
- Rate limiting
- Invalid responses

**Tool Execution Error Tests (PENDING):**
- File not found
- Permission denied
- Invalid arguments
- Execution timeout

**Cancellation Tests (PENDING):**
- Mid-operation cancellation
- Graceful shutdown

### 3.2 Performance Benchmarking

**Benchmarks to Create:**

| Benchmark | Target | Status |
|-----------|--------|--------|
| Cold start time | < 2 seconds | ⏳ PENDING |
| Tool execution latency | Baseline | ⏳ PENDING |
| TUI responsiveness | < 16ms | ⏳ PENDING |
| Memory usage under load | Baseline | ⏳ PENDING |
| Context compaction | Baseline | ⏳ PENDING |

**Implementation:**
- Use `criterion` crate for benchmarks
- Store baselines in `benches/` directory
- CI regression detection (future)

### 3.3 Acceptance Criteria

- [ ] IPC error path coverage >80%
- [ ] Provider error path coverage >80%
- [ ] Tool error path coverage >80%
- [ ] Cancellation tests complete
- [ ] Performance benchmarks established
- [ ] Baseline metrics documented

---

## Phase 4: Documentation & Polish (Week 2-3) - ⏳ PENDING

### 4.1 Production Deployment Guide

**Create:** `docs/DEPLOYMENT.md`

**Sections:**
- Environment variables reference
- Configuration file examples
- Security best practices
- Performance tuning
- Monitoring setup
- Troubleshooting guide

### 4.2 Security Audit

**Actions:**
- Review bash dangerous patterns
- Audit file path validation
- Check for directory traversal
- Verify tool auto-approval logic
- Document security model

**Output:** `docs/SECURITY.md`

### 4.3 Address Low-Priority TODOs

Create GitHub issues for:
- Worktree listing exposure
- Tree-sitter-markdown compatibility
- CLI error collection
- Model map integration in RAG

### 4.4 Acceptance Criteria

- [ ] Deployment guide complete
- [ ] Security audit passed
- [ ] Security documentation complete
- [ ] Configuration reference updated
- [ ] GitHub issues created for TODOs

---

## Phase 5: Monitoring & Observability (Week 3) - ⏳ PENDING

### 5.1 Health Check

**Command:** `codi --health` or `/health` in TUI

**Checks:**
- Provider connectivity
- Tool availability
- System status
- Index status

### 5.2 Telemetry Enhancements

**Metrics to Add:**
- Per-tool execution metrics (count, latency, errors)
- Error rate tracking by category
- Performance histograms
- Export formats (Prometheus, StatsD)

### 5.3 Acceptance Criteria

- [ ] Health check command implemented
- [ ] Health check API endpoint (optional)
- [ ] Comprehensive metrics collection
- [ ] Export format support
- [ ] Documentation for monitoring

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Test coverage gaps | Medium | Comprehensive error path testing, property-based tests |
| Performance regression | Medium | Benchmarks, performance budgets, CI detection |
| Documentation outdated | Low | Regular reviews, user feedback loop |
| Security vulnerabilities | High | Security audit, penetration testing |

---

## Success Criteria

### Phase 1 (Critical) ✅ COMPLETE
- [x] Zero `panic!` in production code
- [x] Zero `expect()` in production code
- [x] Zero `unwrap()` in production code paths
- [x] All IPC errors handled gracefully
- [x] Comprehensive error types implemented

### Phase 2 (Quality) ✅ COMPLETE
- [x] Clean build with zero warnings
- [x] All HIGH priority TODOs resolved
- [x] Remaining TODOs documented

### Phase 3 (Testing) 🔄 IN PROGRESS
- [ ] Error path coverage >80%
- [ ] Performance benchmarks established
- [ ] Performance budgets defined

### Phase 4 (Docs) ⏳ PENDING
- [ ] Deployment guide complete
- [ ] Security audit passed
- [ ] Configuration reference complete

### Phase 5 (Monitoring) ⏳ PENDING
- [ ] Health check implemented
- [ ] Metrics collection comprehensive
- [ ] Production-ready telemetry

---

## Implementation Log

### Phase 1: Production Panics (COMPLETE)
- **Date:** 2026-02-07
- **Branch:** feat/production-readiness-phase-1
- **PR:** #284
- **Commits:** 5
- **Files Changed:** 9 (+473/-43 lines)
- **Tests:** All 516 passing

### Phase 2: Code Quality (COMPLETE)
- **Date:** 2026-02-08
- **Branch:** feat/production-readiness-phase-2
- **PR:** #285
- **Commits:** 2
- **Files Changed:** 5 (+554/-232 lines)
- **Tests:** All 516 passing
- **Status:** Zero warnings, 3 HIGH TODOs resolved

### Phase 3: Testing (IN PROGRESS)
- **Date:** 2026-02-08
- **Branch:** feat/production-readiness-phase-3
- **PR:** Pending
- **Progress:** 12 IPC error tests added
- **Tests:** 516 passing (plus new error path tests)

---

## Notes

- **Rust Edition:** 2024
- **MSRV:** 1.85
- **Test Command:** `cargo test`
- **Lint Command:** `cargo clippy -- -D warnings`
- **Format Command:** `cargo fmt --check`
- **Benchmark Command:** `cargo bench` (using criterion)

---

**Last Updated:** 2026-02-08  
**Author:** Codi AI Assistant  
**Current Branch:** feat/production-readiness-phase-3
