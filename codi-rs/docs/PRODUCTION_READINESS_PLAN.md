# Codi-RS Production Readiness Plan

**Objective:** Bring codi/codi-rs from 88% to 100% production readiness  
**Timeline:** 2-3 weeks  
**Branch:** `feat/production-readiness-phase-1`  
**Priority:** Fix critical panics first, then polish

---

## Executive Summary

This plan addresses all production readiness issues identified in the assessment:
- **Critical:** 100+ panic/unwrap/expect calls in production code
- **Medium:** 7 outstanding TODOs, minor warnings
- **Low:** Documentation, monitoring, performance validation

---

## Phase 1: Critical Issues (Week 1) - ELIMINATE PRODUCTION PANICS

### 1.1 Priority Files (Fix First)

**File 1: `src/tui/app.rs:1683-1687`**
- **Issue:** Two `panic!` calls in production app logic
- **Fix:** Replace with proper error handling and user notification
- **Lines:** 1683, 1687

**File 2: `src/orchestrate/ipc/transport.rs:133-152`**
- **Issue:** 9 `.expect()` calls in IPC transport layer
- **Fix:** Convert to `Result` with descriptive errors
- **Impact:** IPC failures crash the entire application

**File 3: `src/orchestrate/ipc/client.rs:347, 488`**
- **Issue:** `.unwrap()` and `.expect()` in message handling
- **Fix:** Graceful degradation on malformed messages
- **Impact:** Worker communication failures

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
1. Identify all panics/unwraps/expects (100 total)
2. Replace with proper error types
3. Add context with `tracing::error!`
4. Ensure graceful degradation
5. Test error paths

### 1.3 Error Type Design

Add comprehensive error types to affected modules:

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
}
```

### 1.4 Acceptance Criteria

- [ ] Zero `panic!` calls in production code (tests OK)
- [ ] Zero `expect()` calls in production code
- [ ] Zero `unwrap()` calls in production code paths
- [ ] All errors properly propagated with context
- [ ] No behavioral regressions

---

## Phase 2: Code Quality (Week 1-2)

### 2.1 Clean Up Warnings

**Issues:**
- Unused import `Stylize` in `src/tui/terminal_ui.rs:18`
- Unused function `load_session` in `src/main.rs:505`

**Action:** Remove or implement

### 2.2 Address TODOs by Priority

**HIGH (Complete in Phase 2):**
1. `src/symbol_index/indexer.rs:561` - File cleanup for deleted/renamed files
2. `src/symbol_index/service.rs:206, 229` - Usage detection & dependency graph
3. `src/tui/syntax/highlighter.rs:49` - Tree-sitter-markdown compatibility

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

### Phase 1 (Critical) ✅
- [ ] Zero `panic!` in production code
- [ ] Zero `expect()` in production code
- [ ] Zero `unwrap()` in production code paths
- [ ] All IPC errors handled gracefully
- [ ] Comprehensive error types implemented

### Phase 2 (Quality) ✅
- [ ] Clean build with zero warnings
- [ ] High-priority TODOs resolved
- [ ] Remaining TODOs documented in GitHub issues

### Phase 3 (Testing) ✅
- [ ] Error path coverage >80%
- [ ] Performance benchmarks established
- [ ] Performance budgets defined

### Phase 4 (Docs) ✅
- [ ] Deployment guide complete
- [ ] Security audit passed
- [ ] Configuration reference complete

### Phase 5 (Monitoring) ✅
- [ ] Health check implemented
- [ ] Metrics collection comprehensive
- [ ] Production-ready telemetry

---

## Implementation Log

### Day 1: Setup & Priority Files
- [ ] Create error types for IPC layer
- [ ] Fix `src/orchestrate/ipc/transport.rs`
- [ ] Fix `src/orchestrate/ipc/client.rs`

### Day 2: TUI & App Layer
- [ ] Fix `src/tui/app.rs` panics
- [ ] Fix remaining IPC unwraps
- [ ] Add error context with tracing

### Day 3: Remaining Unwraps
- [ ] Audit all 100 unwrap/panic locations
- [ ] Fix remaining production code issues
- [ ] Verify tests still pass

### Day 4: Testing & Validation
- [ ] Add error path tests
- [ ] Run full test suite
- [ ] Performance sanity check

### Day 5: Documentation & Cleanup
- [ ] Update docs
- [ ] Create GitHub issues for TODOs
- [ ] Final review

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
**Branch:** feat/production-readiness-phase-1
