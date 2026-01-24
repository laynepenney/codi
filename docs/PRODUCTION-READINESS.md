# Plan: Making Codi Production Ready

**Goal:** Prepare the codi CLI tool for public release with enterprise-grade reliability, security, and documentation.

---

## Executive Summary

Based on comprehensive codebase analysis, codi is **85-90% production ready**. The core architecture is solid with excellent rate limiting, retry logic, and user approval systems. However, critical gaps exist in:

1. **Testing** - Core modules (agent.ts, MCP server, orchestration) lack unit tests
2. **Security** - Path traversal vulnerabilities, dependency vulnerabilities (7 moderate)
3. **Memory** - Unbounded message accumulation and working set growth
4. **Deployment** - No npm publish workflow (Windows not supported - use WSL2)

---

## Priority Tiers

### Tier 1: Critical (Blocking Release)

#### 1.1 Fix Security Vulnerabilities
**Files:** `package.json`, `pnpm-lock.yaml`

- [ ] Fix `diff@8.0.2` DoS vulnerability (GHSA-73rr-hh4g-fpgx)
- [ ] Fix `esbuild` CSRF vulnerability via vitest/vite update
- [ ] Run `pnpm audit fix` and verify all 7 vulnerabilities resolved

#### 1.2 Add Path Traversal Protection
**Files:** `src/tools/write-file.ts`, `src/tools/read-file.ts`, `src/tools/edit-file.ts`

```typescript
// Add to all file tools after path resolution
const resolvedPath = resolve(process.cwd(), path);
const projectRoot = process.cwd();
if (!resolvedPath.startsWith(projectRoot + '/') && resolvedPath !== projectRoot) {
  return 'Error: Path is outside project directory';
}
```

#### 1.3 Fix Database Cleanup on Exit
**File:** `src/symbol-index/database.ts`

- [ ] Add `process.on('exit')` handler to close SQLite database
- [ ] Prevent database corruption on SIGTERM/SIGINT

#### 1.4 Implement Memory Bounds
**File:** `src/agent.ts`

- [ ] Add hard cap on `messages` array (max 500 messages)
- [ ] Implement automatic pruning when limit reached
- [ ] Add wall-clock timeout for agent loop (1 hour default)

**File:** `src/context-windowing.ts`

- [ ] Implement LRU eviction for `recentFiles` Set (max 100 files)

---

### Tier 2: High Priority (Before Public Beta)

#### 2.1 Core Module Unit Tests
**New files to create:**

| File | Target | Coverage |
|------|--------|----------|
| `tests/agent.test.ts` | Agent loop, context windowing, compression | 80%+ |
| `tests/mcp-server.test.ts` | MCP protocol, tool listing, execution | 85%+ |
| `tests/commander.test.ts` | Worker spawning, IPC, permission routing | 75%+ |
| `tests/symbol-index-service.test.ts` | AST parsing, symbol resolution | 75%+ |

#### 2.2 CI/CD Enhancements
**File:** `.github/workflows/ci.yml`

- [x] Add macOS runner for cross-platform testing
- [ ] ~~Add Windows runner~~ - Not supported; use WSL2 (see #134)
- [ ] Add npm publish workflow triggered by tags

**New file:** `.github/workflows/release.yml`
```yaml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

#### 2.3 NPM Publishing Setup
**File:** `package.json`

Add:
```json
{
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "registry": "https://registry.npmjs.org/",
    "access": "public"
  }
}
```

#### 2.4 Environment Documentation
**New file:** `.env.example`

```bash
# Required: At least one provider API key
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional: Ollama (local or cloud)
OLLAMA_HOST=http://localhost:11434
OLLAMA_API_KEY=...
OLLAMA_CLOUD=true

# Optional: RunPod
RUNPOD_API_KEY=...
```

---

### Tier 3: Medium Priority (Polish)

#### 3.1 Concurrency Safety
**File:** `src/agent.ts` (line 1118)

- [ ] Add semaphore for parallel tool execution (max 8 concurrent)
- [ ] Prevent file descriptor exhaustion under heavy load

**File:** `src/providers/rate-limiter.ts` (line 61)

- [ ] Add max queue size (100 requests) with backpressure errors

#### 3.2 Graceful Shutdown
**File:** `src/index.ts`

- [ ] Register cleanup handlers for all timers (rate limiter, model registry, symbol indexer)
- [ ] Add SIGTERM handler with timeout fallback to SIGKILL for child processes
- [ ] Ensure MCP connections, RAG indexer, and orchestrator all cleanup

#### 3.3 Command Unit Tests
**New files:**

- [ ] `tests/memory-commands.test.ts`
- [ ] `tests/orchestrate-commands.test.ts`
- [ ] `tests/rag-commands.test.ts`
- [ ] `tests/compact-commands.test.ts`

#### 3.4 Documentation Improvements
**File:** `README.md`

- [ ] Add npm installation method: `npm install -g codi`
- [ ] Add troubleshooting section
- [ ] Add provider setup guides

---

### Tier 4: Nice to Have

#### 4.1 Performance Optimizations

- [ ] Cache token counts to avoid O(N²) message processing (agent.ts:642)
- [ ] Implement gzip compression for tool result cache
- [ ] Add batch embedding requests for RAG indexing
- [ ] Schedule periodic SQLite VACUUM

#### 4.2 Enhanced Security

- [ ] Add file permission checks for sensitive operations
- [ ] Use array-based `execFile()` instead of `exec()` in bash tool
- [ ] Implement audit logging for file modifications
- [ ] Create SECURITY.md with threat model documentation

#### 4.3 Monitoring & Observability

- [ ] Add optional telemetry for error tracking (opt-in)
- [ ] Implement structured logging with log levels
- [ ] Add health check endpoint for long-running processes

---

## Test Coverage Targets

| Module | Current | Target |
|--------|---------|--------|
| Overall | 45% | 65% |
| Core (agent.ts) | ~0% | 80% |
| Tools | ~95% | 95% |
| Providers | ~60% | 75% |
| Commands | ~20% | 60% |
| Orchestration | ~30% | 70% |

---

## Files to Modify

### Critical (Tier 1)
| File | Change |
|------|--------|
| `package.json` | Update vulnerable dependencies |
| `pnpm-lock.yaml` | Regenerate after updates |
| `src/tools/write-file.ts` | Add path boundary validation |
| `src/tools/read-file.ts` | Add path boundary validation |
| `src/tools/edit-file.ts` | Add path boundary validation |
| `src/symbol-index/database.ts` | Add exit handler for DB close |
| `src/agent.ts` | Add message cap, wall-clock timeout |
| `src/context-windowing.ts` | Add LRU eviction |

### High (Tier 2)
| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Add macOS runner (Windows not supported) |
| `.github/workflows/release.yml` | New publish workflow |
| `package.json` | Add files, publishConfig |
| `.env.example` | New file |
| `tests/agent.test.ts` | New file (50+ tests) |
| `tests/mcp-server.test.ts` | New file |

### Medium (Tier 3)
| File | Change |
|------|--------|
| `src/agent.ts` | Add tool execution semaphore |
| `src/providers/rate-limiter.ts` | Add queue bounds |
| `src/index.ts` | Enhanced cleanup handlers |
| `README.md` | Improve installation docs |

---

## Verification Checklist

### Before Beta Release
- [ ] All 7 dependency vulnerabilities resolved (`pnpm audit` shows 0)
- [ ] Path traversal tests pass (attempt to read `/etc/passwd` fails)
- [ ] Memory stays bounded in 2-hour stress test
- [ ] CI passes on Ubuntu and macOS (Windows not supported - use WSL2)
- [ ] npm publish workflow tested with dry-run

### Before GA Release
- [ ] 65%+ overall test coverage
- [ ] Agent loop tests achieve 80%+ coverage
- [ ] All Tier 1 and Tier 2 items complete
- [ ] No known critical/high security issues
- [ ] Documentation reviewed and complete

---

## Estimated Effort

| Tier | Items | Estimated Time |
|------|-------|----------------|
| Tier 1 (Critical) | 4 | 2-3 days |
| Tier 2 (High) | 4 | 4-5 days |
| Tier 3 (Medium) | 4 | 3-4 days |
| Tier 4 (Nice to Have) | 3 | 2-3 days |
| **Total** | **15** | **11-15 days** |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Path traversal exploit | Medium | Critical | Tier 1.2 path validation |
| Memory exhaustion in long sessions | High | High | Tier 1.4 bounds |
| Database corruption on crash | Medium | High | Tier 1.3 exit handlers |
| Windows compatibility issues | N/A | N/A | Not supported - use WSL2 (#134) |
| npm publish failures | Low | Medium | Tier 2.3 workflow |

---

## Notes

- The codebase demonstrates excellent architectural patterns (provider abstraction, tool registry, rate limiting)
- Security practices are generally good (no hardcoded credentials, approval system, dangerous pattern detection)
- Main gaps are in testing coverage for core modules and memory management
- Dual licensing (AGPL + Commercial) is properly documented
