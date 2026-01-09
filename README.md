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

```bash
# Clone the repository
git clone https://github.com/yourusername/codi.git
cd codi

# Install dependencies
npm install

# Build the project
npm run build

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
| `-p, --provider <type>` | Provider: `anthropic`, `openai`, `ollama`, `runpod`, or `auto` | `auto` |
| `-m, --model <name>` | Model name to use | Provider default |
| `--base-url <url>` | Custom API base URL | Provider default |
| `--endpoint-id <id>` | Endpoint ID for RunPod serverless | - |
| `--no-tools` | Disable tool use (chat-only mode) | Tools enabled |
| `-y, --yes` | Auto-approve all tool operations | Prompt for approval |
| `--debug` | Show messages sent to the model | Disabled |

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

Key areas for expansion:
- ~~**Git Integration**: `/commit`, `/branch`, `/pr` commands~~ (Implemented!)
- **Session Persistence**: Save/load conversations
- **Workspace Config**: Per-project `.codi.json` configuration
- **Plugin System**: Third-party extensions
- **Vision Support**: Screenshot/image analysis for compatible models
- **Memory System**: Cross-session context with embeddings

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
