# CLAUDE.md - AI Assistant Context

This file provides context for AI assistants working on the Codi codebase.

## Project Overview

**Codi** is an interactive AI coding assistant CLI tool that supports multiple AI providers (Claude, OpenAI, Ollama, RunPod). It enables developers to work with AI models through a conversational interface while giving the AI access to filesystem tools.

## Quick Reference

```bash
# Development
npm run dev              # Run with TypeScript directly
npm run build            # Compile to JavaScript
npm test                 # Run tests
npm run test:watch       # Watch mode

# Testing with different providers
ANTHROPIC_API_KEY=... npm run dev
OPENAI_API_KEY=... npm run dev -- --provider openai
npm run dev -- --provider ollama --model llama3.2
```

## Architecture Overview

```
src/
├── index.ts          # CLI entry, REPL loop, readline interface
├── agent.ts          # Core agent loop - orchestrates model + tools
├── config.ts         # Workspace configuration loading and merging
├── context.ts        # Project detection (Node, Python, Rust, Go)
├── session.ts        # Session persistence management
├── types.ts          # TypeScript interfaces
├── commands/         # Slash command system
│   ├── index.ts      # Command registry
│   ├── code-commands.ts
│   ├── workflow-commands.ts
│   ├── git-commands.ts
│   ├── session-commands.ts
│   └── config-commands.ts
├── providers/        # AI model backends
└── tools/            # Filesystem interaction tools
```

## Key Files

| File | Purpose |
|------|---------|
| `src/agent.ts` | The agentic loop - sends messages, handles tool calls, manages conversation |
| `src/index.ts` | CLI setup, REPL, command parsing, user interaction |
| `src/config.ts` | Workspace configuration loading, validation, and merging |
| `src/session.ts` | Session persistence - save/load conversation history |
| `src/providers/base.ts` | Abstract provider interface all backends implement |
| `src/tools/registry.ts` | Tool registration and execution |
| `src/types.ts` | All TypeScript interfaces |

## Coding Conventions

- **ES Modules**: Use `.js` extension in imports (even for `.ts` files)
- **Async/Await**: Prefer async/await over callbacks
- **Type Safety**: Use TypeScript interfaces, avoid `any`
- **Error Handling**: Tools should catch errors and return descriptive messages
- **Streaming**: Use callbacks for real-time output (`onText`, `onToolCall`, etc.)

## Common Patterns

### Adding a Tool
```typescript
// 1. Create src/tools/my-tool.ts
export class MyTool extends BaseTool {
  getDefinition(): ToolDefinition { /* JSON schema */ }
  async execute(input: Record<string, unknown>): Promise<string> { /* logic */ }
}

// 2. Register in src/tools/index.ts
registry.register(new MyTool());
```

### Adding a Command
```typescript
// In src/commands/*.ts
export const myCommand: Command = {
  name: 'mycommand',
  aliases: ['mc'],
  description: 'Description',
  usage: '/mycommand <args>',
  execute: async (args, context) => `Prompt for AI: ${args}`,
};
registerCommand(myCommand);
```

### Adding a Provider
```typescript
// 1. Create src/providers/my-provider.ts extending BaseProvider
// 2. Implement: chat(), streamChat(), getName(), getModel(), supportsToolUse()
// 3. Add to createProvider() in src/providers/index.ts
```

## Testing

Tests use **Vitest** and are located in `tests/`. Run with `npm test`.

Key test areas:
- Tool execution and error handling
- Provider instantiation
- Agent initialization
- File system operations (uses temp directories)

---

## Feature Ideas for Enhancement

Below are feature ideas organized by complexity and impact. Each includes implementation guidance.

### High Priority / High Impact

#### 1. Git Integration Commands - IMPLEMENTED

**Status**: Complete

**Implemented Commands** (in `src/commands/git-commands.ts`):

| Command | Aliases | Description |
|---------|---------|-------------|
| `/commit [type]` | `/ci` | Generate commit message with conventional commits format |
| `/branch [action] [name]` | `/br` | Create, switch, list, delete, rename branches |
| `/diff [target]` | - | Show and explain git differences |
| `/pr [base]` | `/pull-request` | Generate PR description with title, summary, changes |
| `/stash [action]` | - | Manage stash (save, list, pop, apply, drop, clear) |
| `/log [target]` | `/history` | Show and explain git history |
| `/gitstatus` | `/gs` | Detailed git status with explanations |
| `/undo [what]` | `/revert` | Safely undo commits, staged changes, file changes |
| `/merge <branch>` | - | Merge branches with conflict guidance |
| `/rebase <branch>` | - | Rebase with safety warnings |

**Key Features**:
- Conventional commits support for `/commit` (feat, fix, docs, etc.)
- Branch actions: list, create, switch, delete, rename
- Stash management with all common operations
- Safe undo operations with appropriate warnings
- PR description generation with structured template

#### 2. Session Persistence - IMPLEMENTED

**Status**: Complete

**Implemented Commands** (in `src/commands/session-commands.ts`):

| Command | Description |
|---------|-------------|
| `/save [name]` | Save current conversation to a session file |
| `/load <name>` | Load a previously saved session |
| `/sessions` | List all saved sessions |
| `/sessions info [name]` | Show details about a session |
| `/sessions delete <name>` | Delete a saved session |
| `/sessions clear` | Delete all saved sessions |

**Key Features**:
- Sessions stored in `~/.codi/sessions/` as JSON
- Includes full message history, compaction summaries, project context
- Metadata: provider, model, timestamps, project name/path
- Fuzzy search for session names
- Load session on startup with `-s/--session <name>` CLI option
- Auto-saves to current session name if one is loaded

#### 3. Workspace Configuration - IMPLEMENTED

**Status**: Complete

**Config File Locations** (searched in order):
- `.codi.json`
- `.codi/config.json`
- `codi.config.json`

**Configuration Options** (in `src/config.ts`):
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "baseUrl": "https://api.example.com",
  "endpointId": "runpod-endpoint-id",
  "autoApprove": ["read_file", "glob", "grep", "list_directory"],
  "dangerousPatterns": ["custom-pattern-.*"],
  "systemPromptAdditions": "Always use TypeScript strict mode.",
  "noTools": false,
  "defaultSession": "my-project-session",
  "commandAliases": {
    "t": "/test src/",
    "b": "/build"
  },
  "projectContext": "This is a React app using Next.js 14."
}
```

**Implemented Commands** (in `src/commands/config-commands.ts`):

| Command | Description |
|---------|-------------|
| `/config` | Show current workspace configuration |
| `/config init` | Create a new .codi.json file |
| `/config example` | Show example configuration |

**Key Features**:
- Per-tool auto-approval (e.g., auto-approve `read_file` but confirm `bash`)
- Custom dangerous patterns (regex) for bash command warnings
- System prompt additions for project-specific instructions
- Project context for AI awareness
- Command aliases for shortcuts
- Default session to load on startup
- CLI options override config settings

### Medium Priority

#### 4. Diff Preview Mode - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/diff.ts`):
- Unified diff preview for `write_file` and `edit_file` operations
- Color-coded diff display in terminal (green for additions, red for removals)
- Automatic truncation for large diffs (shows first/last portions)
- Statistics: lines added, lines removed, new file detection
- Integrated into confirmation flow - shows diff before user approves

**How it works**:
- When you use `write_file` or `edit_file`, the confirmation prompt now shows a unified diff
- Green lines (`+`) show what will be added
- Red lines (`-`) show what will be removed
- The diff is automatically truncated if it's too long

**Files**:
- `src/diff.ts` - Diff generation and formatting utilities
- `src/agent.ts` - Generates diffs during confirmation
- `src/index.ts` - Displays formatted diffs in confirmation prompt
- Dependency: `diff` package

#### 5. Undo/Redo System
**What**: Track file changes with ability to undo.

**Implementation**:
- Create backup before each file modification
- Store in `~/.codi/history/` with timestamps
- Add `/undo` and `/history` commands
- Limit history size (e.g., last 50 operations)

**Files to modify**:
- Create: `src/history.ts`
- Modify: All file-modifying tools to call history.record()
- Add: `/undo`, `/redo`, `/history` commands

#### 6. Plugin System
**What**: Allow third-party extensions.

**Implementation**:
- Define plugin interface (tools, commands, providers)
- Load plugins from `~/.codi/plugins/` or `node_modules`
- Plugins export: `{ tools: [], commands: [], providers: [] }`

```typescript
// Plugin interface
interface CodiPlugin {
  name: string;
  version: string;
  tools?: BaseTool[];
  commands?: Command[];
  providers?: typeof BaseProvider[];
}
```

**Files to modify**:
- Create: `src/plugins.ts`
- Modify: `src/index.ts` (load plugins on startup)

#### 7. Cost Tracking
**What**: Track API usage and estimated costs.

**Implementation**:
- Count tokens for each request/response
- Store usage in `~/.codi/usage.json`
- Add `/usage` command to display stats
- Show cost estimates based on provider pricing

**Files to modify**:
- Create: `src/usage.ts`
- Modify: `src/agent.ts` (track tokens)
- Add: `/usage` command

### Lower Priority / Nice to Have

#### 8. Vision Support
**What**: Allow image/screenshot analysis for providers that support it.

**Implementation**:
- Add `analyze_image` tool
- Convert images to base64
- Only enable for providers with vision capability
- Use for UI debugging, diagram understanding

**Files to modify**:
- Create: `src/tools/analyze-image.ts`
- Modify: `src/providers/anthropic.ts` (vision message format)
- Modify: `src/providers/openai-compatible.ts` (vision support)

#### 9. Interactive File Selection
**What**: Fuzzy file finder for commands.

**Implementation**:
- Add `fzf`-like interface for file selection
- Use when file argument is omitted
- Integrate with readline for better UX

**Dependencies**: `inquirer` or `prompts` package

#### 10. Parallel Tool Execution
**What**: Execute independent tools concurrently.

**Implementation**:
- Detect independent tool calls (no shared files)
- Execute with `Promise.all()`
- Merge results for model response

**Files to modify**:
- Modify: `src/agent.ts` (parallel execution logic)

#### 11. Memory/RAG System
**What**: Remember context across sessions using embeddings.

**Implementation**:
- Index project files with embeddings
- Store in local vector DB (e.g., `vectra` or `sqlite-vss`)
- Retrieve relevant context for each query
- Add `/remember` and `/forget` commands

**This is complex** - consider as a separate major feature.

#### 12. Web Search Tool
**What**: Allow AI to search the web for documentation/answers.

**Implementation**:
- Add `web_search` tool
- Use DuckDuckGo API or similar
- Return summarized results

**Files to modify**:
- Create: `src/tools/web-search.ts`

#### 13. Code Snippets Library
**What**: Save and reuse code snippets.

**Implementation**:
- Store snippets in `~/.codi/snippets/`
- Add `/snippet save <name>` and `/snippet use <name>` commands
- Support tags and search

#### 14. Multi-file Refactoring
**What**: Coordinated changes across multiple files.

**Implementation**:
- Add `/refactor-all <pattern> <description>` command
- Collect all matching files
- Generate coordinated edit plan
- Apply changes atomically (all or nothing)

#### 15. Test Runner Integration
**What**: Run tests and report results to AI for debugging.

**Implementation**:
- Add `run_tests` tool
- Parse test output (Jest, Vitest, pytest, etc.)
- Return structured results
- AI can then suggest fixes for failures

---

## Implementation Priority Recommendation

For maximum impact with reasonable effort:

1. ~~**Git Integration** - Most requested workflow improvement~~ DONE
2. ~~**Session Persistence** - Essential for longer projects~~ DONE
3. ~~**Workspace Config** - Professional/team use~~ DONE
4. ~~**Diff Preview** - Safety improvement~~ DONE
5. **Undo System** - Safety net for file changes

## Notes for Contributors

- Keep tools focused and single-purpose
- Commands should return prompts, not execute logic directly
- Test with multiple providers (at least Anthropic + Ollama)
- Consider token usage - avoid verbose tool outputs
- Maintain backwards compatibility with existing configs
