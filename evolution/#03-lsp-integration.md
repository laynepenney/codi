# LSP Integration for Codi

**Status**: 🚀 PROPOSED  
**Proposal Date**: 2026-01-26  
**Assigned To**: @laynepenney  
**Estimated Effort**: 4 weeks (phased)  
**Priority**: HIGH

---

## Overview

### What is this feature?

Integration of Language Server Protocol (LSP) capabilities into Codi, enabling deep code understanding, navigation, and intelligent analysis similar to what IDEs provide through LSP servers.

### Problem Statement

The current code search and navigation capabilities in Codi have limitations:

1. **Basic Search**: Limited to text/grep-based search, lacks semantic understanding
2. **No Symbol Navigation**: Cannot jump to definitions, find references, or understand code structure
3. **Limited Context**: Searches don't understand code semantics, imports, or dependencies
4. **Manual Navigation**: Users must manually find related files and functions
5. **No Type Awareness**: Limited understanding of types, interfaces, and inheritance

### Solution

Integrate LSP client capabilities with multiple language servers to provide:
- Symbol definitions and references
- Code completion and IntelliSense
- Syntax and semantic understanding
- Cross-file navigation
- Automatic dependency mapping
- Intelligent refactoring support

---

## Goals

- [ ] Symbol navigation definitions
- [ ] Find all references across codebase
- [ ] Smart code completion and suggestions
- [ ] Semantic code understanding
- [ ] Import and dependency resolution
- [ ] Language-specific code analysis
- [ ] IDE-like navigation experience
- [ ] Multi-language server support

## Non-Goals

- Full LSP server implementation (focus on client-side integration)
- Real-time collaboration features
- Advanced debugging integration
- Heavy IDE features (focus on AI-enhanced workflow)

---

## Background & Context

### Current State

Codi currently uses basic text search (`grep`, `glob`, `find_symbol`) for code navigation. This approach:
- Works but lacks semantic understanding
- Cannot navigate through imports or dependencies
- Limited to pattern matching rather than code structure
- No understanding of type systems or language semantics

### Prior Art: LSP Systems

Language Server Protocol (LSP) provides:
- Standardized protocol for code intelligence
- Language-specific analysis through dedicated servers
- Definition/implementation navigation
- Code completion and refactoring support
- Semantic code understanding

**Reference Implementations:**
- **VSCode LSP Client**: Industry standard implementation
- **OpenCode**: AI-enhanced LSP integration
- **Cursor**: AI-powered IDE with semantic search

### User Stories

As a developer using Codi, I want:
- To quickly jump to function definitions across files
- To find all usages of a function or variable
- To get intelligent code completions based on context
- To understand imports and dependencies
- To refactor code with automated dependency updates

---

## Proposed Design

### Technical Approach

1. **LSP Client**: Implement LSP client following protocol spec
2. **Server Management**: Manage language server processes
3. **Protocol Adapter**: Convert between Codi's tool system and LSP protocol
4. **Language Support**: Configurable for multiple languages
5. **Integration Layer**: Bridge LSP capabilities with AI conversations

### Architecture

```typescript
┌─────────────────────────────────────────┐
│           Codi LSP Integration          │
├─────────────────────────────────────────┤
│  ┌──── LSP Client Manager               │
│  │   ├─ TypeScript LSP Server          │
│  │   ├─ Python LSP Server              │
│  │   ├─ Rust LSP Server                │
│  │   └─ Multi-language coordination     │
│  │                                        │
│  ├──── Protocol Adapter                  │
│  │   ├─ Message translation             │
│  │   ├─ Request/response handling        │
│  │   ├─ Error handling                   │
│  │   └─ Async operation management       │
│  │                                        │
│  ├──── Tool Integration Layer            │
│  │   ├─ LSP-enhanced tools               │
│  │   ├─ Symbol navigation commands        │
│  │   ├─ Code completion integration       │
│  │   └─ Refactoring workflows            │
│  │                                        │
│  ├──── AI Integration                     │
│  │   ├─ Semantic context injection        │
│  │   ├─ Intelligent code analysis        │
│  │   ├─ Automated refactoring             │
│  │   └─ Code understanding assistance     │
│  │                                        │
│  └──── Configuration Manager             │
│      ├─ Language server setup             │
│      ├─ Server lifecycle management       │
│      ├─ Performance monitoring            │
│      └─ Health checking                   │
└─────────────────────────────────────────┘
```

### LSP Tools Ecosystem

New tools powered by LSP integration:

```typescript
interface LSPToolDefinitions {
  goto_definition: {
    file: string;
    line: number;
    column: number;
  };
  
  find_references: {
    symbol: string;
    usages: Array<{
      file: string;
      line: number;
      column: number;
      context: string;
    }>;
  };
  
  get_completions: {
    file: string;
    line: number;
    column: number;
    prefix?: string;
    suggestions: Array<{
      label: string;
      kind: string;
      detail?: string;
    }>;
  };
  
  analyze_code: {
    file: string;
    diagnostics: Array<{
      severity: string;
      message: string;
      range: { start: number; end: number };
    }>;
  };
}
```

### API/UI Changes

**New Tool Definitions**:
- `goto_definition`: Navigate to symbol definition
- `find_references`: Find all symbol usages
- `get_completions`: Language-aware code completion
- `symbol_info`: Get detailed symbol information
- `analyze_code`: Semantic code analysis

**New Commands**:
- `/definition <symbol>`: Jump to definition
- `/references <symbol>`: Find all references
- `/completions`: Get code suggestions
- `/analyze <file>`: Semantic code analysis
- `/lsp-status`: Check language server status

---

## Implementation Plan

### Phase 1: Foundation (1.5 weeks)
- [ ] LSP client implementation
- [ ] Language server process management
- [ ] Basic protocol communication
- [ ] TypeScript server integration
- [ ] Error handling and recovery

### Phase 2: Core Tools (1.5 weeks)
- [ ] `goto_definition` tool implementation
- [ ] `find_references` tool
- [ ] Symbol navigation commands
- [ ] Multi-language support framework
- [ ] Performance optimization

### Phase 3: Advanced Features (1 week)
- [ ] Code completion integration
- [ ] Semantic code analysis
- [ ] Refactoring support
- [ ] AI-enhanced suggestions
- [ ] Configuration management

**Timeline**: 4 weeks total

---

## Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Direct LSP Integration** | Full IDE capabilities, standardized protocol | Complex implementation, resource intensive | ✅ Preferred approach |
| **Tree-sitter Integration** | Simpler parsing, language agnostic | Limited semantic understanding | ❌ Not sufficient for requirements |
| **External LSP Proxy** | Leverage existing LSP clients | Additional dependency, complexity | ⚠️ Backup option |
| **Enhanced Regex Search** | Simpler to implement | Lacks semantic understanding | ❌ Doesn't solve core problem |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance overhead | High | Optimize startup, process pooling |
| Language server stability | High | Health monitoring, fallback to basic search |
| Complexity | Medium | Phased implementation, thorough testing |
| Resource usage | Medium | Lazy loading, process optimization |
| Cross-platform issues | Medium | Standard LSP protocol, platform-specific adaptations |

---

## Success Criteria

### Must Have (MVP)
- [ ] TypeScript language server working
- [ ] `goto_definition` functionality
- [ ] `find_references` across codebase
- [ ] Multi-language server framework
- [ ] Stable communication protocol

### Should Have
- [ ] Code completion integration
- [ ] Semantic code analysis
- [ ] Python and Rust support
- [ ] Performance optimizations
- [ ] Configuration system

### Nice to Have
- [ ] Advanced refactoring support
- [ ] AI-enhanced code understanding
- [ ] Multiple language servers simultaneously
- [ ] Real-time diagnostics

---

## Testing Strategy

- **Unit tests**: Protocol messages, server management
- **Integration tests**: End-to-end LSP communication
- **Performance tests**: Startup time, memory usage
- **Cross-language tests**: Multiple language server compatibility
- **Error handling**: Server crashes, network issues

---

## Open Questions

1. Which LSP server implementations should we prioritize?
2. How to handle language server installation/configuration?
3. What performance overhead is acceptable?
4. How to gracefully fallback to basic search when LSP unavailable?
5. Should LSP integration be opt-in or enabled by default?

---

## References

- [Language Server Protocol Specification](https://microsoft.github.io/language-server-protocol/)
- [VSCode LSP Implementation](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)
- [TypeScript Language Server](https://github.com/typescript-language-server/typescript-language-server)
- [Python Language Server](https://github.com/python-lsp/python-lsp-server)
- [Rust Language Server](https://github.com/rust-lang/rls)

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-26 | Initial proposal |

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-26  
**Owner**: @laynepenney