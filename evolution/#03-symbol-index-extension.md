# Symbol Index Multi-Language Extension

**Status**: 🚀 PROPOSED  
**Proposal Date**: 2026-01-26  
**Assigned To**: @laynepenney  
**Estimated Effort**: 4 weeks (phased)  
**Priority**: HIGH

---

## Overview

### What is this feature?

Extension of Codi's existing Symbol Index to support Python, Rust, Go, and other languages, building upon the robust infrastructure already in place for TypeScript and Kotlin codebases.

### Problem Statement

Codi has a sophisticated Symbol Index module that provides deep code navigation and analysis, but it supports only TypeScript/JavaScript and Kotlin:

1. **Limited Language Support**: Current implementation handles TS/JS and Kotlin only
2. **No Code Completion**: Symbol index provides navigation but not IntelliSense
3. **Gaps in Multi-Language Projects**: Mixed-language projects can't get full codebase understanding
4. **Missing Language-Specific Features**: No language-specific analysis for Python/Rust/Go

### Solution

Extend the existing Symbol Index infrastructure to support additional languages, and optionally integrate LSP servers for code completion features only.

---

## Current State

### Existing Symbol Index Capabilities

Codi already has a comprehensive Symbol Index (`src/symbol-index/`) that provides:

| Feature | Implementation | Status |
|---------|---------------|--------|
| `goto_definition` | `src/symbol-index/tools/goto-definition.ts` | ✅ Fully implemented |
| `find_references` | `src/symbol-index/tools/find-references.ts` | ✅ Fully implemented |
| `find_symbol` | `src/symbol-index/tools/find-symbol.ts` | ✅ Fully implemented |
| `get_dependency_graph` | `src/symbol-index/tools/get-dependency-graph.ts` | ✅ Fully implemented |
| `get_inheritance` | `src/symbol-index/tools/get-inheritance.ts` | ✅ Fully implemented |
| `get_call_graph` | `src/symbol-index/tools/get-call-graph.ts` | ✅ Fully implemented |
| `show_impact` | `src/symbol-index/tools/show-impact.ts` | ✅ Fully implemented |
| `get_index_status` | `src/symbol-index/tools/get-index-status.ts` | ✅ Fully implemented |
| `rebuild_index` | `src/symbol-index/tools/rebuild-index.ts` | ✅ Fully implemented |

**Infrastructure:**
- SQLite database (`src/symbol-index/database.ts`) - Fast, efficient storage
- Background indexer (`src/symbol-index/background-indexer.ts`) - Automatic updates
- Regex symbol extraction (`src/model-map/symbols/regex-extractor.ts`) - Pattern-based parsing
- TypeScript path resolution - Handles tsconfig.json aliases
- Import/dependency tracking - Cross-file relationships
- 9+ MCP tools - Rich navigation capabilities

### Technical Details

**Database Schema:**
- `indexed_files` - File metadata and hashes
- `indexed_symbols` - Symbol definitions with type, visibility, signature
- `indexed_imports` - Import statements with relationship tracking
- `indexed_dependencies` - Dependency graph edges

**Supported Languages:**
- ✅ TypeScript (.ts, .tsx)
- ✅ JavaScript (.js, .jsx)
- ✅ Kotlin (.kt, .kts)

**Extraction Methods:**
- Regex-based symbol extraction
- AST parsing (planned for Type8)
- Content-based pattern matching

---

## Goals

- [ ] Python symbol extraction (functions, classes, modules)
- [ ] Rust symbol extraction (functions, structs, traits, impls)
- [ ] Go symbol extraction (functions, interfaces, structs)
- [ ] Code completion integration (optionally via LSP)
- [ ] Language-specific analysis tools
- [ ] Enhanced regex patterns for new languages
- [ ] Performance optimizations for multi-language projects
- [ ] Unified symbol resolution across languages

## Non-Goals

- Full LSP server implementation (consider LSP only for completion)
- Real-time collaboration features
- Advanced debugging integration
- Replacing existing symbol index infrastructure

---

## Proposed Design

### Technical Approach

#### **Option A: Extend Symbol Index (Recommended)** ⭐

Build upon existing SQLite-based symbol index:

1. **Language-Specific Extractors**: Add extractors for Python, Rust, Go
2. **Regex Pattern Libraries**: Comprehensive patterns for each language
3. **Tree-sitter Integration** (optional): More accurate parsing for complex features
4. **Completion Integration** (optional): Use LSP for autocomplete only

**Benefits:**
- ✅ Builds on proven, fast infrastructure
- ✅ Consistent with current architecture
- ✅ Minimal additional complexity
- ✅ Fast navigation via SQLite queries
- ✅ Easy to maintain and test

#### **Option B: Hybrid Approach**

Use LSP servers **only** for:
- Code completion and IntelliSense
- Real-time diagnostics
- Hover information

Keep symbol index for:
- `goto_definition`, `find_references` (faster)
- Dependency graph, inheritance analysis
- Cross-file impact analysis

**Benefits:**
- ✅ Gets LSP benefits without full IPC overhead
- ✅ Keeps fast navigation via symbol index
- ✅ Clear separation of concerns
- ⚠️ More complex to manage

### Architecture

```typescript
┌─────────────────────────────────────────┐
│      Extended Symbol Index System        │
├─────────────────────────────────────────┤
│  ┌──── Symbol Database (SQLite)         │
│  │   ├─ Indexed files                   │
│  │   ├─ Symbols (all languages)         │
│  │   ├─ Imports/exports                 │
│  │   └─ Dependencies                    │
│  │                                        │
│  ├──── Language Extractors               │
│  │   ├─ TypeScript (regex + AST)        │
│  │   ├─ Kotlin (regex + AST)            │
│  │   ├─ Python (regex)                  │
│  │   ├─ Rust (regex)                    │
│  │   ├─ Go (regex)                      │
│  │   └─ Tree-sitter (optional)          │
│  │                                        │
│  ├──── Completion System (Optional)      │
│  │   ├─ LSP Client (completion only)    │
│  │   ├─ Python LSP Server                │
│  │   ├─ Rust LSP Server                  │
│  │   └─ Go LSP Server                    │
│  │                                        │
│  ├──── Analysis Tools                    │
│  │   ├─ goto_definition                 │
│  │   ├─ find_references                 │
│  │   ├─ get_dependency_graph            │
│  │   ├─ get_inheritance                  │
│  │   ├─ get_call_graph                  │
│  │   └─ show_impact                     │
│  │                                        │
│  └──── Index Management                  │
│      ├─ Background indexer               │
│      ├─ Incremental updates             │
│      ├─ Hash-based change detection      │
│      └─ Language-specific filtering      │
└─────────────────────────────────────────┘
```

### Symbol Index vs LSP Integration Comparison

| Feature | Symbol Index | LSP Integration | Hybrid | Winner |
|---------|-------------|-----------------|--------|--------|
| **Definition navigation** | ✅ Fast (SQLite) | ⚠️ Slower (IPC) | ✅ Fast (symbol index) | Symbol Index |
| **Find references** | ✅ Fast (SQLite) | ⚠️ Slower (IPC) | ✅ Fast (symbol index) | Symbol Index |
| **Code completion** | ❌ No | ✅ Yes | ✅ Yes (LSP) | LSP/Hybrid |
| **Dependency graph** | ✅ Yes | ❌ Limited | ✅ Yes (symbol index) | Symbol Index |
| **Inheritance analysis** | ✅ Yes | ⚠️ Limited | ✅ Yes (symbol index) | Symbol Index |
| **Resource usage** | ✅ Low (~50MB) | ❌ High (200-500MB) | ⚠️ Medium | Symbol Index |
| **Memory footprint** | ✅ Single process | ❌ Multiple processes | ⚠️ Multiple processes | Symbol Index |
| **Startup time** | ✅ <1s | ❌ 5-10s per server | ⚠️ 2-5s | Symbol Index |
| **Maintenance** | ✅ Self-contained | ❌ External dependencies | ⚠️ Mixed | Symbol Index |
| **Language support** | ⚠️ Configurable | ✅ Many servers | ✅ Extendable | Tie |
| **Complexity** | ✅ Low | ❌ High (IPC, process mgmt) | ⚠️ Medium | Symbol Index |
| **Cross-file impact** | ✅ Tracked | ⚠️ Limited | ✅ Tracked | Symbol Index |
| **Real-time diagnostics** | ❌ No | ✅ Yes | ✅ Yes (LSP) | LSP/Hybrid |
| **Performance** | ✅ <10ms queries | ⚠️ 50-200ms IPC | ✅ <10ms nav, 50ms complete | Symbol Index |

**Verdict**: Symbol Index wins for navigation and analysis. LSP/Hybrid wins for completion and diagnostics.

### LSP Justification (For Completion Only)

If implementing LSP, **only use it for**:
- Code completion (main feature gap)
-Real-time diagnostics
- Hover information

**Do NOT use LSP for**:
- `goto_definition` (symbol index is faster)
- `find_references` (symbol index is faster)
- Dependency analysis (not provided by LSP)
- Cross-file impact (not provided by LSP)

### New Language Extractors

#### **Python Support**

```typescript
interface PythonSymbolPatterns {
  functionDefinition: RegExp;  // def <name>(...):
  classDefinition: RegExp;     // class <name>:
  methodDefinition: RegExp;    //   def <name>(self, ...):
  assignment: RegExp;          // <name> = ...
  import: RegExp;              // from <module> import <name>
  moduleDocstring: RegExp;     // """<doc>"""
}
```

**Extract Symbols:**
- Functions (with decorators)
- Classes and inheritance
- Methods with self/cls parameters
- Module-level variables
- Import statements

#### **Rust Support**

```typescript
interface RustSymbolPatterns {
  functionDefinition: RegExp;  // fn <name>(...) -> ...
  structDefinition: RegExp;    // struct <name> { ... }
  implBlock: RegExp;           // impl <trait?> for <name> { ... }
  traitDefinition: RegExp;     // trait <name> { ... }
  enumDefinition: RegExp;      // enum <name> { ... }
  moduleDeclaration: RegExp;   // mod <name>;
  useStatement: RegExp;        // use <path>::<item>;
}
```

**Extract Symbols:**
- Functions and methods
- Structs and fields
- Traits and implementations
- Enums and variants
- Modules and use statements

#### **Go Support**

```typescript
interface GoSymbolPatterns {
  functionDefinition: RegExp;  // func <name>(...) ...
  methodDefinition: RegExp;    // func (<recv>) <name>(...) ...
  structDefinition: RegExp;    // type <name> struct { ... }
  interfaceDefinition: RegExp; // type <name> interface { ... }
  constDeclaration: RegExp;    // const <name> = ...
  importStatement: RegExp;     // import <path>
}
```

**Extract Symbols:**
- Functions and methods
- Structs and interfaces
- Constants and variables
- Package imports
- Type definitions

### API/UI Changes

**New File Patterns:**
```typescript
const INCLUDE_PATTERNS = [
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
  '**/*.kt', '**/*.kts',
  '**/*.py',      // Python
  '**/*.rs',      // Rust
  '**/*.go',      // Go
];
```

**New Commands:**
- `/symbols rebuild --lang <language>`: Rebuild index for specific language
- `/symbols stats --lang <language>`: Stats by language
- `/symbols languages`: List supported languages
- `/complete <file> <line> <col>`: Get code completions (LSP-based)
- `/diagnose <file>`: Get real-time diagnostics (LSP-based)

---

## Implementation Plan

### Phase 1: Python Support (1 week)
- [ ] Python regex symbol extractor
- [ ] Python import statement parsing
- [ ] Python database schema extensions
- [ ] Update background indexer for Python files
- [ ] Tests for Python symbol extraction

### Phase 2: Rust & Go Support (1 week)
- [ ] Rust regex symbol extractor
- [ ] Go regex symbol extractor
- [ ] Language-specific import resolution
- [ ] Multi-language dependency tracking
- [ ] Tests for Rust and Go extraction

### Phase 3: Code Completion & Diagnostics (2 weeks) - Optional
- [ ] LSP client implementation (completion only)
- [ ] Python LSP server integration (jedi-languageserver)
- [ ] Rust LSP server integration (rust-analyzer)
- [ ] Go LSP server integration (gopls)
- [ ] `/complete` command implementation
- [ ] `/diagnose` command implementation
- [ ] Fallback to basic completion when LSP unavailable

**Timeline**: 2-4 weeks (depends on Phase 3 scope)

---

## Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Extend Symbol Index** | ✅ Builds on existing infrastructure<br>✅ Fast navigation<br>✅ Low complexity<br>✅ Easy to maintain | ⚠️ No completion initially<br>⚠️ Regex less accurate than AST | ✅ **Recommended** |
| **Hybrid (Symbol Index + LSP completion)** | ✅ Best of both worlds<br>✅ Fast navigation<br>✅ Rich completion | ⚠️ More complexity<br>⚠️ External dependencies | ⚠️ **Viable Option** |
| **Full LSP Integration** | ✅ Standard protocol<br>✅ Rich features | ❌ Replaces fast SQLite navigation<br>❌ High resource overhead<br>❌ Complex IPC<br>❌ Unnecessary complexity | ❌ **Not Recommended** |
| **Tree-sitter Only** | ✅ Language-agnostic<br>✅ Accurate parsing | ⚠️ New dependency<br>⚠️ More complex than regex | ⚠️ **Optional Enhancement** |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Regex accuracy issues | Medium | Comprehensive pattern libraries, fallback to tree-sitter |
| Language-specific edge cases | Medium | Thorough testing, user feedback, pattern refinement |
| Performance degradation | Low | SQLite indexing, query optimization |
| LSP server management (optional) | Medium | Lazy loading, health monitoring, graceful fallback |
| Cross-language project complexity | Low | Unified database schema, language filtering |

---

## Success Criteria

### Must Have (MVP)
- [ ] Python symbol extraction working
- [ ] Rust symbol extraction working
- [ ] Go symbol extraction working
- [ ] All existing tools work with new languages
- [ ] Performance comparable to current implementation

### Should Have
- [ ] Language-specific import resolution
- [ ] Enhanced regex patterns for complex features
- [ ] Code completion integration (LSP-based)
- [ ] Real-time diagnostics (LSP-based)
- [ ] Language filtering in tools

### Nice to Have
- [ ] Tree-sitter integration for better accuracy
- [ ] Advanced completion with context
- [ ] Language-specific refactoring suggestions
- [ ] Multi-language dependency visualization

---

## Testing Strategy

- **Unit tests**: Language-specific pattern extraction
- **Integration tests**: Multi-language symbol resolution
- **Performance tests**: Query speed vs current implementation
- **Cross-language tests**: Projects with multiple languages
- **LSP tests** (optional): Completion quality, diagnostics accuracy

---

## Open Questions

1. Should completion be in the initial release or deferred?
2. Which LSP servers should we prioritize for completion?
3. Should we use tree-sitter for improved accuracy?
4. What is acceptable regex pattern accuracy threshold?
5. Should LSP integration be opt-in or enabled by default if we add it?

---

## References

- [Symbol Index Documentation](../src/symbol-index/)
- [Regex Symbol Extractor](../src/model-map/symbols/regex-extractor.ts)
- [TypeScript Language Server](https://github.com/typescript-language-server/typescript-language-server)
- [Jedi Language Server (Python)](https://github.com/pappasam/jedi-language-server)
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer)
- [gopls](https://github.com/golang/tools/tree/master/gopls)

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-26 | Initial proposal (reoriented from LSP integration) |

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-26  
**Owner**: @laynepenney