# Implementation Plan: OpenCode Feature Parity

## Overview
Add key features from OpenCode that are missing in Codi, prioritized by usefulness.

---

## Phase 1: Non-Interactive Mode (High Priority)

**Goal:** Allow single-prompt execution for CI/CD and scripting.

### Usage
```bash
codi -p "explain this codebase"
codi --prompt "fix the bug in src/index.ts" --output-format json
codi -p "run tests" --quiet --auto-approve
```

### Implementation
1. **CLI flags** in `src/index.ts`:
   - `-p, --prompt <text>` - Run single prompt and exit
   - `-f, --output-format <text|json>` - Output format (default: text)
   - `-q, --quiet` - Suppress spinners and progress for scripting
   - `--auto-approve` - Auto-approve all tool executions

2. **Non-interactive flow**:
   - Skip readline setup when `-p` is provided
   - Run agent.chat() with the prompt
   - Output result to stdout
   - Exit with code 0 (success) or 1 (error)

3. **JSON output format**:
   ```json
   {
     "success": true,
     "response": "...",
     "toolCalls": [...],
     "usage": { "input": 1000, "output": 500 }
   }
   ```

### Files to modify
- `src/index.ts` - Add CLI flags and non-interactive mode
- `src/agent.ts` - Add quiet mode support

---

## Phase 2: Custom Commands (Medium Priority)

**Goal:** Allow users to define reusable prompt templates.

### Usage
```bash
# Create ~/.codi/commands/review-pr.md
# Use: /review-pr 123
```

### Template format
```markdown
---
name: review-pr
description: Review a GitHub PR
args:
  - name: pr_number
    required: true
---
Review PR #$PR_NUMBER. Focus on:
- Code quality
- Security issues
- Test coverage
```

### Implementation
1. **Command loader** in `src/commands/custom-commands.ts`:
   - Scan `~/.codi/commands/*.md` on startup
   - Parse frontmatter for metadata
   - Register as dynamic commands

2. **Argument substitution**:
   - Replace `$ARG_NAME` with provided values
   - Validate required args

### Files to create/modify
- `src/commands/custom-commands.ts` - New file
- `src/commands/index.ts` - Load custom commands

---

## Phase 3: Sub-Agent Tool (Medium Priority)

**Goal:** Allow the main agent to delegate complex tasks to child agents.

### Usage (by the AI)
```json
{
  "name": "delegate",
  "input": {
    "task": "Research the authentication patterns in this codebase",
    "context": ["src/auth/", "src/middleware/"]
  }
}
```

### Implementation
1. **Delegate tool** in `src/tools/delegate.ts`:
   - Spawns a new Agent instance
   - Provides focused context (specific files/dirs)
   - Returns summarized result to parent agent
   - Limits: max depth, max tokens, timeout

2. **Context isolation**:
   - Child agent gets subset of tools
   - Read-only by default (no write/edit unless specified)
   - Separate token tracking

### Files to create
- `src/tools/delegate.ts` - New tool

---

## Phase 4: LSP Integration (High Priority, Complex)

**Goal:** Provide code diagnostics and intelligence via Language Server Protocol.

### Features
- Show compiler errors/warnings
- Type information
- Go to definition (internal)
- Find references (enhanced)

### Implementation
1. **LSP Manager** in `src/lsp/manager.ts`:
   - Start/stop language servers
   - Configuration per language in `.codi.json`
   - Connection pooling

2. **Diagnostics tool** in `src/tools/diagnostics.ts`:
   - Get errors/warnings for a file
   - Returns structured diagnostic info

3. **Configuration**:
   ```json
   {
     "lsp": {
       "typescript": {
         "command": "typescript-language-server",
         "args": ["--stdio"]
       },
       "python": {
         "command": "pylsp"
       }
     }
   }
   ```

### Files to create
- `src/lsp/manager.ts` - LSP connection management
- `src/lsp/client.ts` - LSP client implementation
- `src/tools/diagnostics.ts` - Diagnostics tool
- `src/config.ts` - Add LSP config schema

---

## Phase 5: TUI Mode (Lower Priority, Large Scope)

**Goal:** Optional Bubble Tea-style terminal UI.

This is a larger undertaking - consider as future enhancement or separate project.

---

## Implementation Order

1. **Phase 1: Non-Interactive Mode** - Most immediately useful, relatively simple
2. **Phase 2: Custom Commands** - Good developer experience improvement
3. **Phase 3: Sub-Agent Tool** - Enables more complex workflows
4. **Phase 4: LSP Integration** - High value but complex

---

## Delegation Strategy

Each phase can be implemented independently by a separate agent:

- **Agent 1**: Non-interactive mode (Phase 1)
- **Agent 2**: Custom commands (Phase 2)
- **Agent 3**: Sub-agent/delegate tool (Phase 3)
- **Agent 4**: LSP integration (Phase 4) - May need to be broken down further

Each agent should:
1. Read existing code patterns in Codi
2. Implement the feature following existing conventions
3. Add tests
4. Update CLAUDE.md documentation
