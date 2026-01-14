# Codi

Your AI coding wingman - a hybrid assistant supporting Claude, OpenAI, and local models via Ollama.

## Features

- **Multi-Provider Support**: Switch between Claude API, OpenAI API, local models via Ollama, or RunPod serverless endpoints
- **Powerful Tool System**: AI can read/write files, search code, execute commands, and apply patches
- **Code Assistance Commands**: Built-in slash commands for explaining, refactoring, testing, reviewing, and documenting code
- **Smart Project Context**: Auto-detects project type, language, framework, and adapts responses accordingly
- **Real-time Streaming**: Live response streaming with reasoning support for compatible models
- **Safety Confirmations**: Dangerous operations require user approval before execution
- **Context Management**: Automatic conversation compaction to stay within token limits
- **Extensible Architecture**: Easy to add new tools, commands, and providers

## Installation

## Requirements
- Node `>=22 <23`
- pnpm (via Corepack)

```bash
# Clone the repository
git clone https://github.com/yourusername/codi.git
cd codi

# Install dependencies
corepack enable
pnpm install

# Build the project
pnpm run build

### PTY integration tests
Some CLI integration tests require a real TTY (powered by `node-pty`) and are skipped by default. Enable them locally with:

```bash
CODI_RUN_PTY_TESTS=1 pnpm test
```

# Optional: Link globally
npm link
```

## Quick Start

### With Claude API (Recommended)
```bash
export ANTHROPIC_API_KEY="your-key-here"
npm run dev
```

### With OpenAI API
```bash
export OPENAI_API_KEY="your-key-here"
npm run dev -- --provider openai
```

### With Ollama (Local/Free)
```bash
# Install Ollama from https://ollama.ai
ollama pull llama3.2
npm run dev -- --provider ollama --model llama3.2
```

### With RunPod Serverless
```bash
export RUNPOD_API_KEY="your-key-here"
npm run dev -- --provider runpod --endpoint-id your-endpoint-id
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --provider <type>` | Provider: `anthropic`, `openai`, `ollama`, `ollama-native`, `runpod`, or `auto` | `auto` |
| `-m, --model <name>` | Model name to use | Provider default |
| `--base-url <url>` | Custom API base URL | Provider default |
| `--endpoint-id <id>` | Endpoint ID for RunPod serverless | - |
| `--no-tools` | Disable tool use (chat-only mode) | Tools enabled |
| `-y, --yes` | Auto-approve all tool operations | Prompt for approval |
| `-s, --session <name>` | Load a saved session on startup | - |
| `-c, --compress` | Enable context compression | Disabled |
| `--summarize-model <name>` | Model for summarization (cheaper model) | Primary model |
| `--summarize-provider <type>` | Provider for summarization model | Primary provider |
| `--verbose` | Show tool inputs/outputs with timing | Disabled |
| `--debug` | Show API details and context info | Disabled |
| `--trace` | Show full request/response payloads | Disabled |

## Commands

### Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/clear` | Clear conversation history |
| `/context` | Show detected project context |
| `/compact` | Manually compact conversation to save tokens |
| `/status` | Show current token usage statistics |
| `/exit`, `/quit` | Exit the assistant |

### Code Assistance Commands

| Command | Description |
|---------|-------------|
| `/explain <file> [function]` | Explain code in a file or specific function |
| `/refactor <file> [focus]` | Suggest refactoring improvements |
| `/fix <file> <issue>` | Fix a specific bug or issue |
| `/test <file> [function]` | Generate tests for code |
| `/review <file>` | Perform a comprehensive code review |
| `/doc <file>` | Generate documentation |
| `/optimize <file>` | Optimize code for performance |

### Workflow Commands

| Command | Description |
|---------|-------------|
| `/new <type> <name>` | Create new component, hook, service, etc. |
| `/scaffold <feature>` | Scaffold a complete feature with multiple files |
| `/debug <issue>` | Help debug an issue with guided investigation |
| `/setup <tool>` | Set up tooling (typescript, eslint, prettier, testing, ci, docker) |
| `/migrate <from> <to> [path]` | Migrate code patterns (e.g., callbacks to promises) |

### Git Commands

| Command | Description |
|---------|-------------|
| `/commit [type]` | Generate a commit message and create a commit |
| `/branch [action] [name]` | Create, switch, list, or delete branches |
| `/diff [target]` | Show and explain git differences |
| `/pr [base]` | Generate a pull request description |
| `/stash [action]` | Manage git stash (save, list, pop, apply, drop) |
| `/log [target]` | Show and explain git history |
| `/gitstatus` | Show detailed git status with explanations |
| `/undo [what]` | Safely undo git changes (commits, staged, etc.) |
| `/merge <branch>` | Help merge branches with conflict guidance |
| `/rebase <branch>` | Help rebase with safety warnings |

### Session Commands

| Command | Description |
|---------|-------------|
| `/save [name]` | Save current conversation to a session file |
| `/load <name>` | Load a previously saved session |
| `/sessions` | List all saved sessions |
| `/sessions info [name]` | Show details about a session |
| `/sessions delete <name>` | Delete a saved session |
| `/sessions clear` | Delete all saved sessions |

Sessions are stored in `~/.codi/sessions/` and include the full conversation history, any compaction summaries, and metadata about the project and model used.

### Model Commands

| Command | Description |
|---------|-------------|
| `/models [provider]` | List available models with pricing and capabilities |
| `/models --local` | Show only local Ollama models |
| `/switch <provider> [model]` | Switch to a different provider/model mid-session |
| `/switch <model>` | Switch to a different model on the current provider |

Examples:
- `/models` - Show all models from all providers
- `/models anthropic` - Show only Anthropic models
- `/switch openai gpt-4o` - Switch to OpenAI's GPT-4o
- `/switch claude-3-5-haiku-latest` - Switch to Haiku on current provider

### Memory Commands

| Command | Description |
|---------|-------------|
| `/remember [category:] <fact>` | Remember a fact for future sessions |
| `/forget <pattern>` | Remove memories matching pattern |
| `/memories [query]` | List or search stored memories |
| `/profile` | View your user profile |
| `/profile set <key> <value>` | Update profile (name, preferences, expertise) |

Memories and profile are automatically injected into the system prompt, personalizing responses based on your preferences.

Examples:
- `/remember Prefers TypeScript over JavaScript`
- `/remember project: Uses pnpm instead of npm`
- `/profile set name Layne`
- `/profile set preferences.language TypeScript`
- `/memories react` - Search for memories about React

### Model Map Commands

| Command | Description |
|---------|-------------|
| `/modelmap` | Show current model map configuration |
| `/modelmap init` | Create a new `codi-models.yaml` file |
| `/modelmap example` | Show example configuration |
| `/pipeline` | List available pipelines |
| `/pipeline <name> <input>` | Execute a pipeline |
| `/pipeline --provider <ctx> <name> <input>` | Execute pipeline with specific provider |

Model Map provides Docker-compose style multi-model orchestration via `codi-models.yaml`. See [Model Map](#model-map-multi-model-orchestration) for details.

### Import Commands

| Command | Description |
|---------|-------------|
| `/import <file> list` | List conversations in ChatGPT export |
| `/import <file> search <query>` | Search conversations |
| `/import <file> all [--summary]` | Import all conversations |
| `/import <file> <indices>` | Import specific conversations by index |

Import your ChatGPT conversation history to use as context in Codi.

### Context Commands

| Command | Description |
|---------|-------------|
| `/compress` | Show compression status |
| `/compress on` | Enable context compression |
| `/compress off` | Disable context compression |
| `/compress --preview` | Show compression analysis with entity legend |

Context compression extracts repeated entities (file paths, class names, function names, URLs) and replaces them with short references (E1, E2, etc.) to reduce token usage. Enable with `-c` flag or `/compress on`.

Example savings: A conversation with repeated file paths and class names can see 15-30% reduction in context size.

### Debug/Verbose Modes

Codi supports graduated verbosity for debugging and development:

| Flag | Description |
|------|-------------|
| `--verbose` | Show tool inputs/outputs with timing |
| `--debug` | Show API details, context info, token counts |
| `--trace` | Show full request/response payloads |

Example usage:
```bash
# See tool execution details
codi --verbose

# Debug API calls and context management
codi --debug

# Full trace for debugging issues
codi --trace
```

## Tools

The AI has access to these tools for interacting with your codebase:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with optional line range |
| `write_file` | Create or overwrite files |
| `edit_file` | Make targeted search/replace edits |
| `patch_file` | Apply unified diff patches |
| `insert_line` | Insert content at specific line numbers |
| `glob` | Find files by pattern (e.g., `src/**/*.ts`) |
| `grep` | Search file contents with regex patterns |
| `list_directory` | List directory contents with details |
| `bash` | Execute shell commands (with safety checks) |
| `analyze_image` | Analyze images using vision-capable models |
| `run_tests` | Auto-detect and run project tests |
| `web_search` | Search the web via DuckDuckGo (no API key needed) |

### Safety Features

Dangerous operations trigger confirmation prompts:
- Destructive bash commands (`rm -rf`, `sudo`, etc.)
- Force git operations (`--force`, `-f`)
- System modifications (`chmod 777`, disk operations)
- Remote script execution (piped curl/wget)

Use `--yes` flag to auto-approve (use with caution).

## Project Detection

The assistant automatically detects your project type and adapts its responses:

| Project Type | Detection | Frameworks Detected |
|--------------|-----------|---------------------|
| **Node.js** | `package.json` | React, Next.js, Vue, Angular, Express, Fastify, NestJS |
| **Python** | `pyproject.toml`, `requirements.txt`, `setup.py` | Django, Flask, FastAPI |
| **Rust** | `Cargo.toml` | - |
| **Go** | `go.mod` | - |

## Architecture

```
codi/
├── src/
│   ├── index.ts              # CLI entry point & REPL
│   ├── agent.ts              # Agent loop orchestration
│   ├── context.ts            # Project detection & context
│   ├── types.ts              # TypeScript type definitions
│   ├── commands/
│   │   ├── index.ts          # Command registry & interfaces
│   │   ├── code-commands.ts  # Code assistance commands
│   │   └── workflow-commands.ts  # Workflow commands
│   ├── providers/
│   │   ├── base.ts           # Abstract provider interface
│   │   ├── anthropic.ts      # Claude API provider
│   │   ├── openai-compatible.ts  # OpenAI/Ollama provider
│   │   └── index.ts          # Provider factory & auto-detection
│   └── tools/
│       ├── base.ts           # Abstract tool interface
│       ├── registry.ts       # Tool registry & execution
│       ├── read-file.ts      # File reading
│       ├── write-file.ts     # File creation/writing
│       ├── edit-file.ts      # Search/replace editing
│       ├── patch-file.ts     # Unified diff patching
│       ├── insert-line.ts    # Line insertion
│       ├── glob.ts           # File pattern matching
│       ├── grep.ts           # Content searching
│       ├── list-directory.ts # Directory listing
│       ├── bash.ts           # Shell command execution
│       └── index.ts          # Tool exports & registration
├── tests/                    # Vitest test suite
├── docs/                     # Additional documentation
├── dist/                     # Compiled JavaScript
└── package.json
```

## How It Works

### Provider Abstraction
All model backends implement a common interface (`BaseProvider`) with:
- `chat()` - Non-streaming completions
- `streamChat()` - Streaming with callbacks for text, reasoning, and tool calls
- `supportsToolUse()` - Capability detection

### Tool System
1. Tools extend `BaseTool` with `getDefinition()` (JSON schema) and `execute()` methods
2. `ToolRegistry` manages registration and execution
3. AI receives tool definitions and can make structured tool calls
4. Results are fed back for continued conversation

### Agent Loop
1. Send user message + tool definitions to model
2. Receive response (text, reasoning, and/or tool calls)
3. Run safety checks on dangerous operations
4. Prompt for confirmation if needed
5. Execute approved tool calls
6. Send results back to model
7. Repeat until model stops calling tools (max 20 iterations)

### Command System
Slash commands transform user input into specialized prompts that guide the AI for specific tasks, providing context and structure for better results.

## Extending Codi

### Adding a New Tool

```typescript
// src/tools/my-tool.ts
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

export class MyTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'my_tool',
      description: 'Description for the AI model',
      input_schema: {
        type: 'object',
        properties: {
          param: { type: 'string', description: 'Parameter description' }
        },
        required: ['param']
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const param = input.param as string;
    // Implementation
    return 'Result';
  }
}
```

Then register in `src/tools/index.ts`:
```typescript
import { MyTool } from './my-tool.js';
registry.register(new MyTool());
```

### Adding a New Command

```typescript
// In src/commands/my-commands.ts
import { registerCommand, type Command } from './index.js';

export const myCommand: Command = {
  name: 'mycommand',
  aliases: ['mc'],
  description: 'Description shown in /help',
  usage: '/mycommand <arg>',
  execute: async (args, context) => {
    // Return a prompt string to send to the AI
    return `Perform task with: ${args}`;
  },
};

registerCommand(myCommand);
```

### Adding a New Provider

1. Create a new class extending `BaseProvider` in `src/providers/`
2. Implement required methods: `chat()`, `streamChat()`, `getName()`, `getModel()`, `supportsToolUse()`
3. Add to provider factory in `src/providers/index.ts`

## Recommended Local Models

| Model | Size | Best For |
|-------|------|----------|
| `llama3.2` | 3B | Quick testing, simple tasks |
| `llama3.1:8b` | 8B | Balanced quality and speed |
| `qwen2.5-coder:7b` | 7B | Code-focused tasks |
| `deepseek-coder-v2` | 16B | Complex coding, best quality |
| `codellama:13b` | 13B | Code generation and completion |

## Development

### Open files (experimental)
Codi can track a working set of “open files” for a session. This is intended to power workflows like:
- remembering which files you were working on between runs
- pinning important files so they don’t get evicted
- keeping the working set bounded via LRU eviction

Implementation notes:
- The in-memory manager lives in `src/open-files.ts` (`OpenFilesManager`).
- Session persistence uses `openFilesState` on `Session` (see `src/session.ts`).
- Some commands may currently pass `openFilesState: undefined` until the CLI wiring is completed.


```bash
# Run in development mode (with TypeScript)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build

# Start production build
npm start
```

## Roadmap / Planned Features

See [CLAUDE.md](./CLAUDE.md) for detailed feature ideas and contribution guidelines.

### Completed Features
- ~~**Git Integration**: `/commit`, `/branch`, `/pr` commands~~ (Implemented!)
- ~~**Session Persistence**: Save/load conversations~~ (Implemented!)
- ~~**Workspace Config**: Per-project `.codi.json` configuration~~ (Implemented!)
- ~~**Model Commands**: `/models` and `/switch` for model management~~ (Implemented!)
- ~~**Plugin System**: Third-party extensions~~ (Implemented!)
- ~~**Vision Support**: Screenshot/image analysis for compatible models~~ (Implemented!)
- ~~**Cost Tracking**: Token usage and cost monitoring~~ (Implemented!)
- ~~**Undo/Redo System**: File change history with `/fileundo`~~ (Implemented!)
- ~~**Memory System**: Persistent user context with `/remember` and `/profile`~~ (Implemented!)
- ~~**ChatGPT Import**: Import conversation history with `/import`~~ (Implemented!)
- ~~**Test Runner**: Auto-detect and run project tests~~ (Implemented!)
- ~~**Context Optimization**: Smart compaction and semantic deduplication~~ (Implemented!)
- ~~**RAG System**: Semantic code search using embeddings~~ (Implemented!)
- ~~**Debug UI**: Spinners and graduated verbosity (--verbose/--debug/--trace)~~ (Implemented!)
- ~~**Web Search Tool**: Search web via DuckDuckGo~~ (Implemented!)
- ~~**Multi-Model Orchestration**: Use cheaper models for summarization~~ (Implemented!)
- ~~**Model Map**: Docker-compose style multi-model config with pipelines and model roles~~ (Implemented!)

### Planned Features
- **Interactive File Selection**: Fuzzy file finder for commands
- **Parallel Tool Execution**: Run independent tools concurrently
- **Code Snippets Library**: Save and reuse code snippets
- **Multi-file Refactoring**: Coordinated changes across files

## Model Map (Multi-Model Orchestration)

Model Map provides Docker-compose style configuration for multi-model workflows. Create a `codi-models.yaml` file in your project root:

```yaml
version: "1"

# Named model definitions
models:
  haiku:
    provider: anthropic
    model: claude-3-5-haiku-latest
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

# Task categories with model assignments
tasks:
  fast:
    model: haiku
  code:
    model: sonnet
  complex:
    model: sonnet

# Per-command model overrides
commands:
  commit:
    task: fast
  fix:
    task: complex

# Fallback chains
fallbacks:
  primary: [sonnet, haiku, local]

# Model roles for provider-agnostic pipelines
model-roles:
  fast:
    anthropic: haiku
    openai: gpt-5-nano
    ollama-local: local
  capable:
    anthropic: sonnet
    openai: gpt-5
    ollama-local: local

# Multi-model pipelines
pipelines:
  code-review:
    description: "Multi-step code review"
    provider: openai  # default provider
    steps:
      - name: scan
        role: fast        # uses role, resolved per provider
        prompt: "Quick scan for issues: {input}"
        output: issues
      - name: analyze
        role: capable     # uses role, resolved per provider
        prompt: "Deep analysis based on: {issues}"
        output: analysis
    result: "{analysis}"
```

### Using Model Roles

Model roles allow you to create provider-agnostic pipelines. The same pipeline works with any provider:

```bash
# Uses openai models (gpt-5-nano for 'fast', gpt-5 for 'capable')
/pipeline code-review src/file.ts

# Uses anthropic models (haiku for 'fast', sonnet for 'capable')
/pipeline --provider anthropic code-review src/file.ts

# Uses local ollama models
/pipeline --provider ollama-local code-review src/file.ts
```

### Pipeline Commands

```bash
# List available pipelines
/pipeline

# Show pipeline details
/pipeline code-review

# Execute a pipeline
/pipeline code-review src/agent.ts

# Execute with specific provider
/pipeline --provider anthropic code-review src/agent.ts
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT
