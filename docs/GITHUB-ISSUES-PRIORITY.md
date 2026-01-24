# GitHub Issues - Priority Sorted

**Last Updated:** January 24, 2026  
**Total Open Issues:** 11

---

## 🔴 HIGH PRIORITY (Critical Issues)

| # | Title | Status | Reason |
|---|-------|--------|--------|
| #134 | Windows CI: Tests timeout and need platform-specific fixes | OPEN | Blocks Windows users from using Codi |
| #123 | Critical: Add path traversal protection to pipeline input resolution | OPEN | Security vulnerability - must fix |

---

## 🟡 MEDIUM PRIORITY (Enhancements & Performance)

| # | Title | Status | Labels | Reason |
|---|-------|--------|--------|--------|
| #40 | feat: Add Voyage AI as embedding provider option | OPEN | - | Enhances embedding options |
| #17 | Plugin system needs further investigation | OPEN | enhancement | Extensibility feature |
| #124 | Convert synchronous file operations to async to improve performance | OPEN | - | Performance improvement |
| #125 | Filter sensitive patterns from CLI history before saving | OPEN | - | Security enhancement |
| #126 | Fix silenced error handling to improve debugging | OPEN | - | Developer experience |
| #127 | Replace custom YAML parser with js-yaml library | OPEN | - | Code quality |
| #129 | Consolidate duplicate MODEL_PRICING constants | OPEN | - | Code quality |

---

## 🔵 PLANNED (From Evolution)

| # | Title | Status | Evolution Doc | Effort |
|---|-------|--------|--------------|--------|
| #146 | Feature: Interactive Workflow System (Evolution #1) | OPEN | evolution/#1-interactive-workflow-system.md | 6 weeks |

---

## Priority Assignment Reasoning

### HIGH PRIORITY
- **#134 Windows CI**: Critical blocker - Windows users completely blocked
- **#123 Path Traversal**: Security vulnerability - could allow file system access outside workspace

### MEDIUM PRIORITY
- **#40 Voyage AI**: Enables more embedding choices, not blocking
- **#17 Plugin System**: Enhancement, currently disabled but not critical
- **#124 Async File Ops**: Performance improvement, not blocking  
- **#125 CLI History Filtering**: Security nice-to-have but not vulnerable
- **#126 Silence Errors**: Debugging improvement
- **#127 js-yaml**: Code quality, existing parser works
- **#129 MODEL_PRICING**: De-duplication, not breaking

### PLANNED
- **#146 Workflow System**: Major new feature, needs dedicated planning time

---

## Summary Statistics

- **Total Issues:** 11
- **High Priority:** 2 (18%)
- **Medium Priority:** 7 (64%)  
- **Planned:** 1 (9%)
- **New Issues:** 1 (9%)

**Focus Areas:**
- Security: 2 issues (#123, #125)
- Performance: 1 issue (#124)
- Features: 2 issues (#17, #40)
- Code Quality: 2 issues (#126, #127, #129)
- Platform Support: 1 issue (#134)
- Documentation: 1 new integration doc

**Immediate Actions Needed:**
1. 🔴 Fix #123 (path traversal) - Security critical
2. 🔴 Fix #134 (Windows CI) - Broadens user base
3. 🟡 Add Voyage AI provider (#40) - User requested