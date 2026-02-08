# Codi-RS Production Readiness Plan

**Objective:** Bring codi/codi-rs from 88% to 100% production readiness  
**Timeline:** 2-3 weeks  
**Current Branch:** `feat/production-readiness-phase-2`  
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

## Phase 2: Code Quality (Week 1-2) - IN PROGRESS

### 2.1 Clean Up Warnings

**Issues:**
- ~~Unused import `Stylize` in `src/tui/terminal_ui.rs:18`~~ ✅ Fixed via cargo fix
- ~~Unused function `load_session` in `src/main.rs:505`~~ ✅ Removed

**Status:** Clean build with zero warnings ✅

### 2.2 Address TODOs by Priority

**HIGH (Complete in Phase 2):**

1. **`src/symbol_index/indexer.rs:561` - File cleanup for deleted/renamed files**
   - **Status:** ✅ IMPLEMENTED
   - **Changes:**
     - Added `get_all_files()` method to `SymbolDatabase`
     - Implemented `cleanup_deleted()` to remove stale entries
     - Files are checked against disk and deleted from DB if missing
   
2. **`src/symbol_index/service.rs:206` - Usage detection**
   - **Status:** 🔄 IN PROGRESS
   - **Description:** Find where symbols are used across the codebase
   
3. **`src/symbol_index/service.rs:229` - Dependency graph**
   - **Status:** 🔄 IN PROGRESS
   - **Description:** Build file dependency graph from imports

**LOW (Defer to Phase 4):**
- `src/tui/app.rs:1355` - Worktree listing exposure
- `src/cli/models.rs:84` - Error collection
- `src/rag/embeddings/mod.rs:47` - Model map integration

**Strategy:** Create GitHub issues for low-priority TODOs

---

## Phase 3: Testing & Validation (Week 2)

### 3.1 Error Path Tests

**Missing Coverage:**
- IPC failure scenarios (bind, accept, read, write failures)
- Provider API failures (timeouts, auth errors)
- Tool execution errors (file not found, permissions)
- Cancellation mid-operation

**Implementation:**
```rust
#[tokio::test]
async fn test_ipc_bind_failure() {
    let result = server.bind("/invalid/path").await;
    assert!(matches!(result, Err(IpcError::BindFailed(_))));
}
```

**Target:** Error path coverage >80%

### 3.2 Performance Benchmarking

**Benchmarks:**
- Cold start time (target: < 2 seconds)
- Tool execution latency
- TUI responsiveness (target: < 16ms)
- Memory usage under load
- Context compaction performance

**Implementation:**
- Use existing `criterion` benchmarks
- Add CI performance regression detection
- Document baseline metrics

---

## Phase 4: Documentation & Polish (Week 2-3)

### 4.1 Production Deployment Guide

**Create:** `docs/DEPLOYMENT.md`
- Environment variables reference
- Configuration file examples
- Security best practices
- Performance tuning
- Monitoring setup

### 4.2 Security Audit

**Actions:**
- Review bash dangerous patterns
- Audit file path validation
- Check for directory traversal
- Verify tool auto-approval logic
- Document security model

**Output:** `docs/SECURITY.md`

---

## Phase 5: Monitoring & Observability (Week 3)

### 5.1 Health Check

**Command:** `codi --health` or `/health` in TUI
- Provider connectivity
- Tool availability
- System status

### 5.2 Telemetry Enhancements

**Metrics to Add:**
- Per-tool execution metrics (count, latency, errors)
- Error rate tracking by category
- Performance histograms
- Export formats (Prometheus, StatsD)

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Panic fixes introduce regressions | High | Comprehensive testing, gradual rollout, feature flags |
| IPC error handling changes behavior | Medium | Extensive testing, backward compatibility checks |
| Performance degradation | Medium | Benchmarks, performance budgets, A/B testing |
| Documentation outdated | Low | Regular reviews, user feedback loop |

---

## Success Criteria

### Phase 1 (Critical) ✅ COMPLETE
- [x] Zero `panic!` in production code
- [x] Zero `expect()` in production code
- [x] Zero `unwrap()` in production code paths
- [x] All IPC errors handled gracefully
- [x] Comprehensive error types implemented

### Phase 2 (Quality) 🔄 IN PROGRESS
- [x] Clean build with zero warnings
- [ ] High-priority TODOs resolved
- [ ] Remaining TODOs documented in GitHub issues

### Phase 3 (Testing) ⏳ PENDING
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

### Phase 2: Code Quality (IN PROGRESS)
- **Date:** 2026-02-07
- **Branch:** feat/production-readiness-phase-2
- **Completed:**
  - ✅ Fixed unused function warning in main.rs
  - ✅ Implemented file cleanup in symbol_index
  - 🔄 Implementing usage detection
  - 🔄 Implementing dependency graph

---

## Notes

- **Rust Edition:** 2024
- **MSRV:** 1.85
- **Test Command:** `cargo test`
- **Lint Command:** `cargo clippy -- -D warnings`
- **Format Command:** `cargo fmt --check`

---

**Last Updated:** 2026-02-07  
**Author:** Codi AI Assistant  
**Current Branch:** feat/production-readiness-phase-2
