# Symbol Index Multi-Language Extension

**Status**: 🚀 PROPOSED  
**Proposal Date**: 2026-01-26  
**Assigned To**: @laynepenney  
**Estimated Effort**: 4-6 weeks (phased)  
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
3. **Import Resolution**: Language-specific path resolution strategies
4. **Extension Handling**: File resolution with language-aware extensions
5. **Tree-sitter Integration** (optional): More accurate parsing for complex features
6. **Completion Integration** (optional): Use LSP for autocomplete only

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

### Import Resolution

The existing symbol index has import resolution for TypeScript and Kotlin, but needs extension for Python, Rust, and Go:

```typescript
// Current state (service.ts lines 138-145):
// - TypeScript: Resolved via tsconfig paths
// - Kotlin: Resolved via package-to-file path conversion
// - Python/Rust/Go: Currently returns undefined (needs implementation)

function resolvePythonImport(importPath: string, projectRoot: string): string | undefined {
  // Handle: from module import X → module.py
  // Handle: import module → module.py  
  // Handle: import package.subpackage → package/subpackage/__init__.py
  
  // Convert Python dot notation to file paths
  const parts = importPath.split('.');
  const modulePath = parts.join('/');
  
  // Try: module.py, package/subpackage/__init__.py
  const candidates = [
    path.join(projectRoot, `${modulePath}.py`),
    path.join(projectRoot, modulePath, '__init__.py'),
  ];
  
  return candidates.find(t => fs.existsSync(t));
}

function resolveRustImport(modulePath: string, projectRoot: string): string | undefined {
  // Handle: use foo::bar::Item;
  // Convert Rust's :: notation to / notation
  const filePath = modulePath.replace(/::/g, '/');
  
  // Try: foo/bar.rs, foo/bar/mod.rs
  const candidates = [
    path.join(projectRoot, `${filePath}.rs`),
    path.join(projectRoot, filePath, 'mod.rs'),
  ];
  
  return candidates.find(t => fs.existsSync(t));
}

function resolveGoImport(importPath: string, projectRoot: string): string | undefined {
  // Handle: import "package/subpackage" or import alias "package/subpackage"
  // Go uses absolute paths based on module structure
  const cleanPath = importPath.replace(/"/g, '').replace(/'/g, '');
  return path.join(projectRoot, cleanPath + '.go');
}
```

### Extension Resolution

Update the file extension resolution to handle multiple languages:

```typescript
// Update tryResolveWithExtensions() (currently service.ts lines 161-176)

const LANGUAGE_EXTENSIONS = {
  typescript: ['.ts', '.tsx', '/index.ts', '/index.tsx'],
  kotlin: ['.kt', '.kts', '/index.kt', '/index.kts'],
  python: ['.py', '.pyi', '/__init__.py'],
  rust: ['.rs', '/mod.rs'],
  go: ['.go'],
};

function resolveFileExtension(basePath: string, language: string): string | undefined {
  const extensions = LANGUAGE_EXTENSIONS[language] || LANGUAGE_EXTENSIONS.typescript;
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }
  return undefined;
}
```

### Language Detection

Add language detection based on file extension:

```typescript
function getLanguageByExtension(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.kt') || filePath.endsWith('.kts')) return 'kotlin';
  if (filePath.endsWith('.py') || filePath.endsWith('.pyi')) return 'python';
  if (filePath.endsWith('.rs')) return 'rust';
  if (filePath.endsWith('.go')) return 'go';
  return 'typescript';  // default
}
```

### Symbol Kinds by Language

Define consistent symbol kinds for each language:

```typescript
const SYMBOL_KINDS = {
  // TypeScript already supports: function, class, interface, type, enum, constant, variable, method
  typescript: ['function', 'class', 'interface', 'type', 'enum', 'constant', 'variable', 'method'],
  
  // Kotlin already supports: function, class, interface, type, constant, variable, exception
  kotlin: ['function', 'class', 'interface', 'type', 'constant', 'variable', 'exception', 'object'],
  
  // Python-specific kinds
  python: [
    'module',      // import X or from X import
    'class',       // class Foo:
    'function',    // def foo():
    'method',      // def foo(self):
    'variable',    // x = value (module-level)
    'constant',    # MAX_SIZE = 100
    'exception',   # class MyError(Exception):
  ],
  
  // Rust-specific kinds
  rust: [
    'function',    // fn foo()
    'method',      // fn foo(&self)
    'struct',      // struct Foo { ... }
    'trait',       // trait Foo { ... }
    'enum',        // enum Foo { ... }
    'impl',        // impl Foo { ... }
    'const',       // const FOO: Type = value;
    'macro',       // macro_rules! foo { ... }
    'module',      // mod foo { ... }
  ],
  
  // Go-specific kinds
  go: [
    'function',    // func foo()
    'method',      // func (r Receiver) foo()
    'struct',      // type Foo struct { ... }
    'interface',   // type Foo interface { ... }
    'type',        // type Foo = Bar
    'const',       // const Foo = value
    'variable',    // var foo Type
  ],
};
```

### File Patterns

Updated include/exclude patterns:

```typescript
const DEFAULT_INCLUDE_PATTERNS = [
  // Existing
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
  '**/*.kt', '**/*.kts',
  // Phase 1: Python
  '**/*.py', '**/*.pyi',
  // Phase 2: Rust
  '**/*.rs',
  // Phase 2: Go
  '**/*.go',
];

const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**', '**/build/**', '**/.git/**',
  '**/coverage/**', '**/*.d.ts', '**/*.min.js',
  '**/venv/**', '**/.venv/**', '**/__pycache__/**',  // Python
  '**/target/**',  // Rust
];
```

### Doc Comment Extraction

Add doc comment patterns for each language:

```typescript
const DOC_COMMENT_PATTERNS = {
  typescript: {
    jsdoc: /\/\*\*[\s\S]*?\*\//g,  // /** ... */
  },
  kotlin: {
    kdoc: /\/\*\*[\s\S]*?\*\//g,  // /** ... */
  },
  python: {
    docstring: /"""([\s\S]*?)"""/g,  // """..."""
    docstring2: /'''([\s\S]*)'''/g,   // '''...'''
  },
  rust: {
    lineDoc: /\/\/[\/!]\s*(.*)/g,     // /// or //!
    blockDoc: /\/\*[\*!]([\s\S]*?)\*\//g,  // /** ... */
  },
  go: {
    lineDoc: /\/\/\s+(.*)/g,         // // ...
    blockDoc: /\/\*([\s\S]*?)\*\//g, // /* ... */
  },
};
```

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

### Phase 1: Python Support (1.5 weeks)
- [ ] Add Python regex symbol extractor patterns
  - Functions: `def <name>(...):`
  - Classes: `class <name>(...):`
  - Methods: `def <name>(self, ...):` (indented)
  - Import statements: `from X import Y`, `import X.Y`
  - Module-level variables and constants
  - Decorators: `@decorator`
- [ ] Python import statement resolution
  - Handle `from module import X`, `import module`
  - Resolve to `.py` and `__init__.py` files
  - Handle package/subpackage structure
- [ ] Python file extension resolution
  - Add `.py`, `.pyi`, `/__init__.py` patterns to resolution
- [ ] Python docstring extraction (`"""..."""`, `'''...'''`)
- [ ] Python symbol kinds (module, class, function, method, variable, constant, exception)
- [ ] Update `DEFAULT_INCLUDE_PATTERNS` with Python files
- [ ] Update `tryResolveWithExtensions()` for Python
- [ ] Tests for Python symbol extraction
- [ ] Tests for Python import resolution

### Phase 2: Rust Support (1 week)
- [ ] Add Rust regex symbol extractor patterns
  - Functions: `fn <name>(...) -> ... {`
  - Methods: `fn <name>(&self, ...) ...`
  - Structs: `struct <name> { ... }`
  - Traits: `trait <name> { ... }`
  - Impl blocks: `impl <trait?> for <name> { ... }`
  - Enums: `enum <name> { ... }`
  - Use statements: `use <path>::<Item>;`
  - Modules: `mod <name>;`
  - Const definitions: `const <name>: Type = ...;`
  - Macros: `macro_rules! <name> { ... }`
- [ ] Rust import resolution (`use E3::bar::Item`)
  - Convert `::` to `/` notation
  - Resolve to `.rs` files
  - Handle `mod.rs` patterns
- [ ] Rust doc comment extraction (`///`, `/** */`)
- [ ] Rust symbol kinds (function, method, struct, trait, impl, enum, const, macro, module)
- [ ] Update `DEFAULT_INCLUDE_PATTERNS` with Rust files
- [ ] Update `tryResolveWithExtensions()` for Rust
- [ ] Tests for Rust symbol extraction
- [ ] Tests for Rust import resolution

### Phase 3: Go Support (1 week)
- [ ] Add Go regex symbol extractor patterns
  - Functions: `func <name>(...) ... {`
  - Methods: `func (<recv>) <name>(...) ... {`
  - Structs: `type <name> struct { ... }`
  - Interfaces: `type <name> interface { ... }`
  - Type aliases: `type <name> = ...`
  - Constants: `const <name> = ...`
  - Variables: `var <name> Type`
  - Import statements: `import "E3"` or `import alias "E3"`
- [ ] Go import resolution
  - Handle absolute import paths
  - Resolve to `.go` files
  - Handle package structures
- [ ] Go doc comment extraction (`// E3`, `/* ... */`)
- [ ] Go symbol kinds (function, method, struct, interface, type, const, var)
- [ ] Update `DEFAULT_INCLUDE_PATTERNS` with Go files
- [ ] Update `tryResolveWithExtensions()` for Go
- [ ] Tests for Go symbol extraction
- [ ] Tests for Go import resolution

### Phase 4: Language Detection & Infrastructure (0.5 weeks)
- [ ] Add `getLanguageByExtension()` function
- [ ] Update `isKotlinFile()` → general `getFileLanguage()`
- [ ] Language-aware file processing in background indexer
- [ ] Language filtering in search tools (`/symbols --lang python`)
- [ ] `/symbols languages` command to list supported languages
- [ ] `/symbols stats --lang <language>` command

### Phase 5: LSP Completion & Diagnostics (2 weeks) - Optional
- [ ] LSP client implementation (completion only)
- [ ] Python LSP server integration (jedi-languageserver)
- [ ] Rust LSP server integration (rust-analyzer)
- [ ] Go LSP server integration (gopls)
- [ ] `/complete <file> <line> <col>` command implementation
- [ ] `/diagnose <file>` command implementation
- [ ] LSP health monitoring and lazy loading
- [ ] Fallback to basic completion when LSP unavailable
- [ ] Completion performance testing

**Total Timeline**: 4-6 weeks (increased from 2-4 weeks)
- Phase 1: 1.5 weeks (Python)
- Phase 2: 1 week (Rust)
- Phase 3: 1 week (Go)
- Phase 4: 0.5 weeks (Infrastructure)
- Phase 5: 2 weeks (LSP Completion - Optional)

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

### Phase 1: Python Support (Must Have)
- [ ] Python symbol extraction working (functions, classes, methods, imports)
- [ ] Python import resolution working (`from X import Y`, `import X.Y`)
- [ ] Python file extension resolution (`.py`, `.pyi`, `__init__.py`)
- [ ] Python docstring extraction (`"""..."""`)
- [ ] All existing tools work with Python files
- [ ] Performance within 20% of current implementation

### Phase 2: Rust Support (Must Have)
- [ ] Rust symbol extraction working (functions, structs, traits, impls, enums)
- [ ] Rust import resolution working (`use E3::bar::Item`)
- [ ] Rust file extension resolution (`.rs`, `mod.rs`)
- [ ] Rust doc comment extraction (`///`, `/** */`)
- [ ] All existing tools work with Rust files
- [ ] Performance within 20% of current implementation

### Phase 3: Go Support (Must Have)
- [ ] Go symbol extraction working (functions, structs, interfaces, types)
- [ ] Go import resolution working (`import "E3"`)
- [ ] Go file extension resolution (`.go`)
- [ ] Go doc comment extraction (`// E3`)
- [ ] All existing tools work with Go files
- [ ] Performance within 20% of current implementation

### Phase 4: Infrastructure (Must Have)
- [ ] Language detection working (`getLanguageByExtension()`)
- [ ] Language filtering in tools (`/symbols --lang python`)
- [ ] `/symbols languages` command returns ['typescript', 'kotlin', 'python', 'rust', 'go']
- [ ] `/symbols stats --lang <language>` works correctly

### Phase 5: LSP Completion (Should Have - Optional)
- [ ] Code completion integration (LSP-based)
- [ ] Real-time diagnostics (LSP-based)
- [ ] Performance: Completion within 500ms
- [ ] Graceful fallback when LSP unavailable

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
| 1.1 | 2026-01-26 | Added detailed implementation specifications:<br>- Import resolution strategies for Python/Rust/Go<br>- Extension resolution with language-aware patterns<br>- Language detection function<br>- Symbol kinds per language<br>- Doc comment extraction patterns<br>- Expanded implementation plan (5 phases)<br>- Updated timeline: 4-6 weeks<br>- Phase-based success criteria |

---

**Document Version**: 1.1  
**Last Updated**: 2026-01-26  
**Owner**: @laynepenney