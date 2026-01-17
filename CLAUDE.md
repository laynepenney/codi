# CLAUDE.md - AI Assistant Context

This file provides context for AI assistants working on the Codi codebase.

## Project Overview

### Open files state
The codebase includes an experimental “open files” working-set concept:
- `src/open-files.ts`: `OpenFilesManager` + serializable `OpenFilesState`
- `src/session.ts`: `Session.openFilesState?: OpenFilesState` and persistence via `saveSession()`

When changing this area:
- keep `OpenFilesState` backwards-compatible (old sessions may not have it)
- update tests that assert on session serialization/deserialization


**Codi** is an interactive AI coding assistant CLI tool that supports multiple AI providers (Claude, OpenAI, Ollama, RunPod). It enables developers to work with AI models through a conversational interface while giving the AI access to filesystem tools.

## Quick Reference

```bash
# Development
pnpm dev              # Run with TypeScript directly
pnpm build            # Compile to JavaScript
pnpm test             # Run tests
pnpm test:watch       # Watch mode

# Testing with different providers
ANTHROPIC_API_KEY=... pnpm dev
OPENAI_API_KEY=... pnpm dev -- --provider openai
pnpm dev -- --provider ollama --model llama3.2
```

## Git Workflow

**IMPORTANT: Never push directly to main.** Always use feature/bugfix branches and pull requests.

```bash
# Start new work (from main or dev if using worktrees)
git checkout -b feat/my-feature    # or fix/my-bugfix
# ... make changes ...
git add -A && git commit -m "feat: description"
git push -u origin feat/my-feature

# Create PR (always targets main)
gh pr create --title "feat: description" --body "Summary of changes"

# After PR is approved and merged
git checkout main                  # or dev if using worktrees
git pull origin main               # or: git fetch origin && git merge origin/main
```

### Branch Naming
- `feat/` - New features
- `fix/` - Bug fixes
- `chore/` - Maintenance, refactoring, docs

### Releases
After merging PRs, tag and release from main:
```bash
# Update version in package.json and src/version.ts
git add -A && git commit -m "chore: bump version to X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: Brief description"
git push origin main && git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z: Title" --notes "Release notes"
```

### PR Review Process

**Always review your own PRs before requesting merge.** This creates a traceable review history.

1. **Create the PR** with clear title and description
2. **Review the diff** thoroughly using `gh pr diff <number>`
3. **Add comments on issues found** - use `gh` CLI to comment:
   ```bash
   # Add a review comment on specific issues
   gh pr review <number> --comment --body "Found issue: description of problem"

   # Or add a general comment
   gh pr comment <number> --body "Review notes: ..."
   ```
4. **Fix the issues** in a new commit (don't amend if already pushed)
5. **Resolve comments** after fixing by pushing the fix commit
6. **For issues to address later**, create a GitHub issue:
   ```bash
   gh issue create --title "Title" --body "Description of future work"
   ```

This ensures:
- All review feedback is tracked in the PR history
- Future contributors can understand why changes were made
- Deferred work is captured as issues, not forgotten

### Git Worktrees

If you're working in a directory on the `dev` branch instead of `main`, it's likely because multiple worktrees are in use. Git doesn't allow the same branch to be checked out in multiple worktrees simultaneously.

**When on `dev` branch:**
- Keep `dev` synced with `main`: `git fetch origin && git merge origin/main`
- Create feature branches from `dev` (which should mirror `main`)
- PRs still target `main` as the base branch
- After PR merges, sync `dev` again: `git fetch origin && git merge origin/main && git push origin dev`

**Check worktree setup:**
```bash
git worktree list    # Shows all worktrees and their branches
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
├── logger.ts         # Level-aware logging (NORMAL/VERBOSE/DEBUG/TRACE)
├── spinner.ts        # Ora spinner manager for visual feedback
├── compression.ts    # Entity-based context compression
├── commands/         # Slash command system
│   ├── index.ts      # Command registry
│   ├── code-commands.ts
│   ├── workflow-commands.ts
│   ├── git-commands.ts
│   ├── session-commands.ts
│   └── config-commands.ts
├── providers/        # AI model backends
├── tools/            # Filesystem interaction tools
└── rag/              # RAG system for semantic code search
    ├── indexer.ts    # File indexing and chunking
    ├── search.ts     # Semantic search
    └── embeddings.ts # Embedding generation
```

## Key Files

| File | Purpose |
|------|---------|
| `src/agent.ts` | The agentic loop - sends messages, handles tool calls, manages conversation |
| `src/index.ts` | CLI setup, REPL, command parsing, user interaction |
| `src/config.ts` | Workspace configuration loading, validation, and merging |
| `src/session.ts` | Session persistence - save/load conversation history |
| `src/logger.ts` | Level-aware logging with NORMAL/VERBOSE/DEBUG/TRACE levels |
| `src/spinner.ts` | Ora spinner manager with TTY detection |
| `src/compression.ts` | Entity-based context compression for token savings |
| `src/providers/base.ts` | Abstract provider interface all backends implement |
| `src/tools/registry.ts` | Tool registration and execution |
| `src/tools/run-tests.ts` | Automatic test runner detection and execution |
| `src/rag/indexer.ts` | RAG file indexing and chunking |
| `src/rag/search.ts` | Semantic code search using embeddings |
| `src/types.ts` | All TypeScript interfaces |

## Code Flow

### Startup Sequence
1. `src/index.ts` runs `main()`
2. Detects project with `detectProject()`
3. Registers tools + commands
4. Determines provider (`detectProvider()` or `createProvider()`)
5. Builds system prompt with project context
6. Instantiates `Agent` with provider, registry, callbacks
7. Starts readline prompt loop

### User Input Processing
- Built-in commands: `/exit`, `/clear`, `/compact`, `/status`, `/context`
- Slash commands: Parse `/command args`, execute → returns prompt string, send to agent
- Normal chat: Send raw input to `agent.chat()`

### Agent Loop (`Agent.chat()`)
1. Append user message to `this.messages`
2. Compact context if token estimate exceeds threshold
3. Repeat up to `MAX_ITERATIONS`:
   - Compute tool definitions if tools enabled
   - Build system context with optional conversation summary
   - Call provider `streamChat()`
   - Extract tool calls (native or from text)
   - If no tool calls → finish
   - Otherwise: execute tools, add results to conversation, continue

## Notable Patterns

- **Provider Abstraction**: `BaseProvider` + factory pattern for easy backend additions
- **Tool Registry**: Decoupled tools with self-describing schemas
- **Safety Limits**: `MAX_ITERATIONS` prevents infinite loops, `MAX_CONSECUTIVE_ERRORS` stops on repeated failures
- **Context Compaction**: Token estimation + model-based summarization of older messages
- **Cross-Provider Normalization**: Internal format supports both string and structured tool blocks
- **Fallback Tool Extraction**: Parses JSON from text for models without native tool calling
- **Streaming-First**: Provider `streamChat` for incremental text display

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

Tests use **Vitest** and are located in `tests/`. Run with `pnpm test`.

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

#### 4. Model Commands - IMPLEMENTED

**Status**: Complete

**Implemented Commands** (in `src/commands/model-commands.ts`):

| Command | Aliases | Description |
|---------|---------|-------------|
| `/models [provider] [--local]` | `/model`, `/list-models` | List available models with pricing and capabilities |
| `/switch <provider> [model]` | `/use`, `/model-switch` | Switch to a different model during a session |

**Key Features**:
- Live API fetching with static fallback for model lists
- Shows model capabilities (vision, tool use)
- Shows context window sizes
- Shows pricing per million tokens (input/output)
- Supports filtering by provider: `/models anthropic`, `/models openai`, `/models ollama`
- Local-only mode: `/models --local` shows only Ollama models
- Switch models mid-session without restarting
- Switch providers mid-session: `/switch openai gpt-4o`
- Switch models within current provider: `/switch claude-3-5-haiku-latest`

**Files**:
- `src/commands/model-commands.ts` - Command implementations
- `src/models.ts` - Static model registry with pricing data
- `src/providers/base.ts` - `ModelInfo` interface, `listModels()` method
- `src/providers/anthropic.ts` - Live model listing from API
- `src/providers/openai-compatible.ts` - Live model listing from API + Ollama
- `src/index.ts` - Output formatting for model tables

#### 5. Memory System - IMPLEMENTED

**Status**: Complete

**Implemented Commands** (in `src/commands/memory-commands.ts`):

| Command | Aliases | Description |
|---------|---------|-------------|
| `/remember [category:] <fact>` | `/mem`, `/note` | Remember a fact for future sessions |
| `/forget <pattern>` | `/unmem` | Remove memories matching pattern |
| `/memories [query]` | `/mems` | List or search stored memories |
| `/profile [set key value]` | `/me` | View or update user profile |

**Key Features**:
- Implements context personalization pattern from OpenAI Agents SDK
- Structured user profile (name, preferences, expertise, avoid lists)
- Categorized memory notes with timestamps
- Automatic memory injection into system prompt
- Session notes with consolidation (`/memories consolidate`)
- Duplicate detection prevents redundant memories

**Storage**:
- `~/.codi/profile.yaml` - User profile in YAML format
- `~/.codi/memories.md` - Persistent memories in Markdown format
- `~/.codi/session-notes.md` - Temporary session notes

**Profile Keys**:
- `name` - User's name
- `preferences.language` - Preferred programming language
- `preferences.style` - Coding style (functional, oop, etc.)
- `preferences.verbosity` - Response verbosity (concise, normal, detailed)
- `expertise` - Add an area of expertise
- `avoid` - Add something to avoid

**Files**:
- `src/memory.ts` - Memory and profile management
- `src/commands/memory-commands.ts` - Command implementations
- `src/index.ts` - Memory context injection into system prompt

#### 6. ChatGPT Import - IMPLEMENTED

**Status**: Complete

**Implemented Commands** (in `src/commands/import-commands.ts`):

| Command | Aliases | Description |
|---------|---------|-------------|
| `/import <file> list` | `/import-chatgpt` | List conversations in export |
| `/import <file> search <query>` | - | Search conversations by title/content |
| `/import <file> all [--summary]` | - | Import all conversations |
| `/import <file> <indices>` | - | Import specific conversations by index |

**Key Features**:
- Parses ChatGPT's tree-based message format
- Converts to Codi session format
- Generates conversation summaries for context
- Optional `--summary` flag imports only summaries (saves tokens)
- Search and filter conversations before importing

**Files**:
- `src/import-chatgpt.ts` - ChatGPT export parser and converter
- `src/commands/import-commands.ts` - Command implementations

#### 7. Diff Preview Mode - IMPLEMENTED

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

#### 8. Undo/Redo System - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/history.ts`):
- Automatic tracking of all file modifications (write, edit, insert, patch)
- Original file content backed up before each change
- History stored in `~/.codi/history/` with timestamps
- Maximum 50 entries kept (oldest pruned automatically)
- Full undo/redo support

**Implemented Commands** (in `src/commands/history-commands.ts`):

| Command | Alias | Description |
|---------|-------|-------------|
| `/fileundo` | `/fu` | Undo the last file change |
| `/redo` | - | Redo an undone change |
| `/filehistory` | `/fh` | Show file change history |
| `/filehistory clear` | - | Clear all history |
| `/filehistory <file>` | - | Show history for specific file |

**How it works**:
- Every `write_file`, `edit_file`, `insert_line`, and `patch_file` operation is recorded
- Original content is saved as backup before modification
- Undo restores the original content (or deletes file if it was created)
- Redo reapplies the change
- History is persistent across sessions

**Files**:
- `src/history.ts` - History tracking and undo/redo logic
- `src/commands/history-commands.ts` - User-facing commands
- All file tools modified: `write-file.ts`, `edit-file.ts`, `insert-line.ts`, `patch-file.ts`

#### 9. Plugin System - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/plugins.ts`):
- Plugin interface for third-party extensions
- Automatic loading from `~/.codi/plugins/` directory
- Support for tools, commands, and providers
- Lifecycle hooks (onLoad, onUnload)
- Dynamic ESM imports

**Plugin Interface**:
```typescript
interface CodiPlugin {
  name: string;
  version: string;
  description?: string;
  tools?: BaseTool[];
  commands?: Command[];
  providers?: {
    type: string;
    factory: (options: ProviderConfig) => BaseProvider;
  }[];
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}
```

**Implemented Commands** (in `src/commands/plugin-commands.ts`):

| Command | Description |
|---------|-------------|
| `/plugins` | List all loaded plugins |
| `/plugins info <name>` | Show details about a plugin |
| `/plugins dir` | Show plugins directory path |

**Plugin Structure**:
```
~/.codi/plugins/my-plugin/
├── package.json          # Must include "main" entry point
├── index.js              # Exports CodiPlugin object
└── ...                   # Additional files
```

**Example Plugin** (`~/.codi/plugins/my-plugin/index.js`):
```javascript
export default {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom plugin',
  commands: [{
    name: 'my-command',
    description: 'My custom command',
    execute: async (args) => `Received: ${args}`,
  }],
  onLoad: async () => console.log('Plugin loaded!'),
};
```

**Files**:
- `src/plugins.ts` - Plugin loader and registry
- `src/commands/plugin-commands.ts` - Plugin management commands
- `src/providers/index.ts` - Map-based provider factory (for plugin providers)

#### 10. Cost Tracking - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/usage.ts`):
- Automatic token counting for each API request/response
- Cost estimation based on model pricing (Claude, GPT models)
- Session-level tracking (current session stats)
- Historical tracking stored in `~/.codi/usage.json`
- Aggregated statistics by provider and model

**Implemented Commands** (in `src/commands/usage-commands.ts`):

| Command | Aliases | Description |
|---------|---------|-------------|
| `/usage` | `/cost`, `/tokens` | Show current session usage |
| `/usage session` | - | Show current session usage (default) |
| `/usage today` | - | Show today's usage |
| `/usage week` | - | Show last 7 days usage |
| `/usage month` | - | Show last 30 days usage |
| `/usage all` | - | Show all-time usage |
| `/usage recent` | - | Show recent usage records |
| `/usage reset` | - | Reset session usage |
| `/usage clear` | - | Clear all usage history |

**Files**:
- `src/usage.ts` - Core usage tracking and cost calculation
- `src/commands/usage-commands.ts` - User-facing commands
- `src/agent.ts` - Records usage after each API call
- `src/providers/anthropic.ts` - Returns usage info
- `src/providers/openai-compatible.ts` - Returns usage info

#### 11. Vision Support - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/tools/analyze-image.ts`):
- `analyze_image` tool for analyzing images using vision-capable models
- Supports JPEG, PNG, GIF, and WebP formats
- Base64 encoding of image data
- Size warnings for large images (>5MB)
- Works with Claude 3+ and GPT-4V/4O models

**How It Works**:
1. User asks to analyze an image
2. AI calls `analyze_image` tool with the image path
3. Tool reads image, converts to base64, returns special format
4. Agent parses the image data and adds it as an image content block
5. Model receives the image and provides analysis

**Provider Support**:
- **Anthropic**: Claude 3 family (Haiku, Sonnet, Opus), Claude 4 (Sonnet, Opus)
- **OpenAI**: GPT-4V, GPT-4O, GPT-5, and models with "vision" in name
- **Ollama**: Most models don't support vision (graceful error)

**Files**:
- `src/tools/analyze-image.ts` - Image analysis tool
- `src/types.ts` - ImageMediaType, ImageSource, ContentBlock with image support
- `src/providers/base.ts` - `supportsVision()` method
- `src/providers/anthropic.ts` - Image block handling
- `src/providers/openai-compatible.ts` - Image URL format handling
- `src/agent.ts` - Image result parsing and message formatting

### Lower Priority / Nice to Have

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

#### 16. Web Search Tool - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/tools/web-search.ts`):
- `web_search` tool for searching the web via DuckDuckGo
- No API key required - uses DuckDuckGo's public lite interface
- Returns titles, URLs, and snippets from search results
- Configurable number of results (1-10, default: 5)

**How It Works**:
1. AI calls `web_search` tool with a query
2. Tool fetches results from DuckDuckGo lite
3. Parses HTML to extract titles, URLs, and snippets
4. Returns formatted text results

**Example Output**:
```
Search results for: "TypeScript 5.0 features"

1. TypeScript 5.0 Release Notes
   https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html
   TypeScript 5.0 introduces decorators, const type parameters, and more...

2. What's New in TypeScript 5.0
   https://blog.example.com/typescript-5
   A comprehensive guide to the latest TypeScript features...
```

**Files**:
- `src/tools/web-search.ts` - Web search tool implementation
- `tests/web-search.test.ts` - Unit tests

#### 17. Multi-Model Orchestration - IMPLEMENTED

**Status**: Complete

**Key Features**:
- Use a separate (cheaper) model for summarization during context compaction
- CLI options: `--summarize-model` and `--summarize-provider`
- Config file support via `models.summarize` section
- Graceful fallback to primary model if secondary unavailable
- Provider agnostic - secondary can use different provider than primary

**CLI Usage**:
```bash
# Use Ollama llama3.2 for summarization (free!)
codi --summarize-provider ollama --summarize-model llama3.2

# Use Claude Haiku for summarization (cheap)
codi --summarize-provider anthropic --summarize-model claude-3-5-haiku-latest
```

**Config File** (`.codi.json`):
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "models": {
    "summarize": {
      "provider": "ollama",
      "model": "llama3.2"
    }
  }
}
```

**Recommended Combinations**:
| Use Case | Primary | Summarize |
|----------|---------|-----------|
| Cost-conscious | Claude Haiku | Ollama llama3.2 (free) |
| Balanced | Claude Sonnet | Claude Haiku |
| Local-first | Ollama deepseek-coder | Ollama llama3.2 |
| Quality-first | Claude Opus | Claude Sonnet |

**Files**:
- `src/index.ts` - CLI options
- `src/config.ts` - Config schema
- `src/providers/index.ts` - `createSecondaryProvider()` function
- `src/agent.ts` - `getSummaryProvider()` method
- `tests/multi-model.test.ts` - Unit tests

#### 18. Model Map (Multi-Model Orchestration) - COMPLETE

**Status**: Complete (Phases 1-3 + Model Roles)

**Key Features** (in `src/model-map/`):
- Docker-compose style configuration for multi-model orchestration
- Named model definitions with provider, model, and settings
- Task categories (fast, code, complex, summarize) with model assignments
- Per-command model overrides
- Fallback chains for reliability
- Pipeline definitions for multi-step workflows
- **Model Roles**: Provider-agnostic role mappings for portable pipelines
- Lazy provider instantiation with connection pooling

**Config File** (`codi-models.yaml`):
```yaml
version: "1"
models:
  haiku:
    provider: anthropic
    model: claude-3-5-haiku-latest
    description: "Fast, cheap model for quick tasks"
  sonnet:
    provider: anthropic
    model: claude-sonnet-4-20250514
  gpt-5-nano:
    provider: openai
    model: gpt-5-nano
  gpt-5:
    provider: openai
    model: gpt-5.2
  local:
    provider: ollama
    model: llama3.2

tasks:
  fast:
    model: haiku
  code:
    model: sonnet
  complex:
    model: sonnet
  summarize:
    model: local

commands:
  commit:
    task: fast
  fix:
    task: complex

fallbacks:
  primary: [sonnet, haiku, local]

# Model roles map abstract roles to concrete models per provider
model-roles:
  fast:
    anthropic: haiku
    openai: gpt-5-nano
    ollama: local
    ollama-cloud: cloud-fast
  capable:
    anthropic: sonnet
    openai: gpt-5
    ollama: local
    ollama-cloud: cloud-coder

pipelines:
  # Direct model references
  smart-refactor:
    steps:
      - name: analyze
        model: haiku
        prompt: "Analyze: {input}"
        output: analysis
      - name: implement
        model: sonnet
        prompt: "Implement based on: {analysis}"
        output: result
    result: "{result}"

  # Provider-agnostic pipeline using roles
  code-review:
    description: "Multi-step code review"
    provider: openai  # default provider
    steps:
      - name: scan
        role: fast        # resolves based on --provider
        prompt: "Quick scan: {input}"
        output: issues
      - name: analyze
        role: capable     # resolves based on --provider
        prompt: "Deep analysis: {issues}"
        output: analysis
    result: "{analysis}"
```

**Model Roles Usage**:
```bash
# Uses default provider (openai) - gpt-5-nano and gpt-5
/pipeline code-review src/file.ts

# Uses anthropic models - haiku and sonnet
/pipeline --provider anthropic code-review src/file.ts

# Uses local ollama models
/pipeline --provider ollama code-review src/file.ts

# Uses cloud ollama models
/pipeline --provider ollama-cloud code-review src/file.ts
```

**Implemented Commands**:

| Command | Aliases | Description |
|---------|---------|-------------|
| `/modelmap` | `/mm` | Show current model map configuration |
| `/modelmap init` | - | Create a new codi-models.yaml file |
| `/modelmap example` | - | Show example configuration |
| `/pipeline [name] [input]` | `/pipe` | Execute or list multi-model pipelines |
| `/pipeline --provider <ctx> [name] [input]` | - | Execute pipeline with specific provider context |

**Architecture**:
- `ModelMapLoader` - Load/validate YAML config
- `ModelRegistry` - Lazy provider instantiation with pooling (max 5, 5-min idle)
- `TaskRouter` - Route tasks/commands to models or pipelines, resolve roles
- `PipelineExecutor` - Execute multi-step pipelines with variable substitution and role resolution

**Files**:
- `src/model-map/types.ts` - Type definitions (including ProviderContext, RoleMapping, ModelRoles)
- `src/model-map/loader.ts` - YAML loading and validation
- `src/model-map/registry.ts` - Provider pool management
- `src/model-map/router.ts` - Task/command routing and role resolution
- `src/model-map/executor.ts` - Pipeline execution with role support
- `src/model-map/index.ts` - Module exports
- `tests/model-map.test.ts` - 38 unit tests

**Completed Features**:
- [x] `taskType` on Command interface for automatic routing
- [x] `/pipeline` command for manual pipeline execution
- [x] Pipeline execution via command routing (commands with `pipeline` config)
- [x] Task-based model routing (fast, code, complex, summarize)
- [x] Model roles for provider-agnostic pipelines
- [x] `--provider` flag for pipeline execution

**Remaining Work (Phase 4)**:
- [ ] Config hot-reload support (watch file changes)
- [ ] Cost tracking per model/pipeline

#### 19. Symbol Index - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/symbol-index/`):
- SQLite-based symbol index using better-sqlite3
- Regex-based symbol extraction for TypeScript/JavaScript and Kotlin
- TypeScript path alias resolution via tsconfig.json parsing
- IDE-style usage-based dependency detection (optional deep mode)
- Parallel processing for deep indexing with configurable jobs

**Commands**:
| Command | Description |
|---------|-------------|
| `/symbols rebuild [--deep] [--jobs N]` | Rebuild the symbol index |
| `/symbols update` | Incremental update |
| `/symbols stats` | Show index statistics |
| `/symbols search <name>` | Search for symbols |
| `/symbols clear` | Clear the index |

**MCP Tools**:
- `find_symbol` - Find symbols by name (fuzzy search)
- `find_references` - Find where a symbol is used
- `get_dependency_graph` - Show file dependencies

**Potential Future Enhancements**:
- [ ] Custom include/exclude patterns in `.codi.json` config
- [ ] Optional node_modules indexing for specific packages (power users)
- [ ] Symbol rename/refactor support
- [ ] Call graph tracking

#### 15. Code Snippets Library
**What**: Save and reuse code snippets.

**Implementation**:
- Store snippets in `~/.codi/snippets/`
- Add `/snippet save <name>` and `/snippet use <name>` commands
- Support tags and search

#### 16. Multi-file Refactoring
**What**: Coordinated changes across multiple files.

**Implementation**:
- Add `/refactor-all <pattern> <description>` command
- Collect all matching files
- Generate coordinated edit plan
- Apply changes atomically (all or nothing)

#### 12. Test Runner Integration - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/tools/run-tests.ts`):
- `run_tests` tool for automatic test runner detection and execution
- Supports npm, yarn, pnpm package managers
- Auto-detects test frameworks: Jest, Vitest, Mocha, pytest, go test, cargo test
- Custom command and filter support
- Timeout handling and output truncation

**How It Works**:
1. AI calls `run_tests` tool (optionally with filter or custom command)
2. Tool detects project type and test runner from config files
3. Executes tests and captures output
4. Returns structured results with pass/fail status

**Files**:
- `src/tools/run-tests.ts` - Test runner tool implementation
- `tests/run-tests.test.ts` - Comprehensive test coverage

#### 13. Context Optimization - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/agent.ts`):
- **Smart Windowing**: Automatically compacts context when token limit approached
- **Semantic Deduplication**: Removes duplicate/similar messages
- **Summarization**: Creates summaries of older messages to preserve context
- Token counting with model-specific limits
- Configurable token threshold (default 8000)

**How It Works**:
1. Before each API call, checks if token count exceeds threshold
2. If over limit, applies smart windowing algorithm
3. Keeps recent messages intact, summarizes older ones
4. Preserves system prompt and critical context

**CLI Options**:
- `-c, --compress` - Enable context compression (entity normalization)
- Automatic compaction happens regardless of flag when needed

#### 14. RAG System (Embeddings) - IMPLEMENTED

**Status**: Complete

**Key Features** (in `src/rag/`):
- Local vector database using `vectra` for embeddings storage
- Automatic project indexing on startup
- Semantic code search based on query similarity
- Chunked file processing for large files
- Background indexing with progress feedback

**Files**:
- `src/rag/indexer.ts` - File indexing and chunking
- `src/rag/search.ts` - Semantic search implementation
- `src/rag/embeddings.ts` - Embedding generation (OpenAI API)
- Index stored in `.codi/rag-index/`

**How It Works**:
1. On startup, indexes project files (respects .gitignore)
2. Creates embeddings for code chunks
3. When AI needs context, searches for relevant code snippets
4. Injects relevant context into system prompt

**Requirements**:
- OpenAI API key (for embeddings)
- Automatic fallback if unavailable

#### 15. Debug UI - IMPLEMENTED

**Status**: Complete

**Key Features**:
- **Ora Spinners** (`src/spinner.ts`): Visual feedback during long operations
- **Graduated Verbosity** (`src/logger.ts`): Four log levels for debugging

**CLI Options**:
| Option | Description |
|--------|-------------|
| `--verbose` | Show tool inputs/outputs with timing |
| `--debug` | Show API details, context info |
| `--trace` | Show full request/response payloads |

**Log Levels**:
- `NORMAL` (default): Clean output, spinners for progress
- `VERBOSE`: Tool calls with parameters and duration
- `DEBUG`: API request/response metadata, context stats
- `TRACE`: Full payloads for debugging

**Example Output** (--verbose):
```
📎 read_file
   path: "src/index.ts"
✓ read_file (523 lines, 0.12s)
```

**Example Output** (--debug):
```
[Context] 15,234 tokens, 12 messages
[API] Sending to claude-3-5-sonnet...
[API] Response: 234 tokens, tool_use, 1.2s
```

**Files**:
- `src/spinner.ts` - Ora spinner manager with TTY detection
- `src/logger.ts` - Level-aware logging utilities
- `tests/spinner.test.ts` - Spinner tests
- `tests/logger.test.ts` - Logger tests

---

## Implementation Priority Recommendation

For maximum impact with reasonable effort:

1. ~~**Git Integration** - Most requested workflow improvement~~ DONE
2. ~~**Session Persistence** - Essential for longer projects~~ DONE
3. ~~**Workspace Config** - Professional/team use~~ DONE
4. ~~**Diff Preview** - Safety improvement~~ DONE
5. ~~**Undo System** - Safety net for file changes~~ DONE
6. ~~**Cost Tracking** - API usage and cost monitoring~~ DONE
7. ~~**Test Runner** - Automated test execution~~ DONE
8. ~~**Context Optimization** - Smart compaction and deduplication~~ DONE
9. ~~**RAG System** - Semantic code search~~ DONE
10. ~~**Debug UI** - Spinners and graduated verbosity~~ DONE
11. ~~**Web Search** - Search web via DuckDuckGo~~ DONE
12. ~~**Multi-Model Orchestration** - Use cheaper models for summarization~~ DONE
13. **Model Map** - Docker-compose style multi-model config (Phase 1 DONE, Phase 2-4 pending)

## Notes for Contributors

- Keep tools focused and single-purpose
- Commands should return prompts, not execute logic directly
- Test with multiple providers (at least Anthropic + Ollama)
- Consider token usage - avoid verbose tool outputs
- Maintain backwards compatibility with existing configs
