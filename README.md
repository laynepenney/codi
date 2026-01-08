# AI Assistant

A hybrid AI coding assistant CLI that supports both cloud APIs (Claude, OpenAI) and local models (Ollama).

## Features

- **Multiple Providers**: Switch between Claude API, OpenAI API, or local models via Ollama
- **Tool Use**: AI can read/write files, search code, and execute commands
- **Code Assistance**: Built-in commands for explaining, refactoring, testing, and reviewing code
- **Project Context**: Auto-detects project type, language, and framework
- **Streaming**: Real-time response streaming
- **Extensible**: Easy to add new tools, commands, and providers

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude API
```bash
export ANTHROPIC_API_KEY="your-key-here"
npm run dev
```

### With OpenAI API
```bash
export OPENAI_API_KEY="your-key-here"
npm run dev -- --provider openai
```

### With Ollama (Local)
```bash
# Install Ollama from https://ollama.ai
ollama pull llama3.2
npm run dev -- --provider ollama --model llama3.2
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-p, --provider <type>` | Provider: `anthropic`, `openai`, `ollama`, or `auto` (default) |
| `-m, --model <name>` | Model name to use |
| `--base-url <url>` | Custom API base URL |

## Commands

### Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/clear` | Clear conversation history |
| `/context` | Show detected project context |
| `/exit` | Exit the assistant |

### Code Assistance

| Command | Description |
|---------|-------------|
| `/explain <file> [function]` | Explain code in a file |
| `/refactor <file> [focus]` | Suggest refactoring improvements |
| `/fix <file> <issue>` | Fix a bug or issue |
| `/test <file> [function]` | Generate tests |
| `/review <file>` | Perform a code review |
| `/doc <file>` | Generate documentation |
| `/optimize <file>` | Optimize for performance |

### Workflow Commands

| Command | Description |
|---------|-------------|
| `/new <type> <name>` | Create new component, hook, service, etc. |
| `/scaffold <feature>` | Scaffold a complete feature with multiple files |
| `/debug <issue>` | Help debug an issue |
| `/setup <tool>` | Set up tooling (typescript, eslint, prettier, testing, ci, docker) |
| `/migrate <from> <to> [path]` | Migrate code patterns (e.g., callbacks to promises) |

## Tools

The AI has access to these tools for interacting with your codebase:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Make targeted search/replace edits |
| `patch_file` | Apply unified diff patches |
| `glob` | Find files by pattern |
| `grep` | Search file contents with regex |
| `list_directory` | List directory contents |
| `bash` | Execute shell commands |

## Project Detection

The assistant automatically detects your project type and adapts its responses:

| Project Type | Detection | Frameworks |
|--------------|-----------|------------|
| Node.js | `package.json` | React, Next.js, Vue, Angular, Express, Fastify, NestJS |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py` | Django, Flask, FastAPI |
| Rust | `Cargo.toml` | - |
| Go | `go.mod` | - |

## Architecture

```
src/
├── index.ts              # CLI entry point
├── agent.ts              # Agent loop orchestration
├── context.ts            # Project detection
├── types.ts              # TypeScript types
├── commands/
│   ├── index.ts          # Command registry
│   ├── code-commands.ts  # /explain, /refactor, /fix, etc.
│   └── workflow-commands.ts  # /new, /scaffold, /setup, etc.
├── providers/
│   ├── base.ts           # Abstract provider interface
│   ├── anthropic.ts      # Claude API provider
│   ├── openai-compatible.ts  # OpenAI/Ollama provider
│   └── index.ts          # Provider factory
└── tools/
    ├── base.ts           # Abstract tool interface
    ├── registry.ts       # Tool registry
    ├── read-file.ts      # Read file tool
    ├── write-file.ts     # Write file tool
    ├── edit-file.ts      # Edit file tool
    ├── patch-file.ts     # Patch file tool
    ├── glob.ts           # Glob tool
    ├── grep.ts           # Grep tool
    ├── list-directory.ts # List directory tool
    ├── bash.ts           # Bash command tool
    └── index.ts          # Tool exports
```

## How It Works

1. **Provider Abstraction**: All model backends implement a common interface (`BaseProvider`) with `chat()` and `streamChat()` methods

2. **Tool System**: Tools are defined with JSON schemas and registered with the `ToolRegistry`. The AI model can call these tools to interact with the filesystem

3. **Command System**: Slash commands transform user input into specialized prompts that guide the AI for specific tasks

4. **Agent Loop**: The `Agent` class orchestrates the conversation:
   - Send user message + tool definitions to the model
   - Receive response (text and/or tool calls)
   - Execute any tool calls
   - Send results back to model
   - Repeat until model stops calling tools

## Adding a New Tool

```typescript
import { BaseTool } from './tools/base.js';
import type { ToolDefinition } from './types.js';

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
    // Do something
    return 'Result';
  }
}
```

Then register it in `src/tools/index.ts`.

## Adding a New Command

```typescript
import { registerCommand, type Command } from './commands/index.js';

export const myCommand: Command = {
  name: 'mycommand',
  aliases: ['mc'],
  description: 'Description of the command',
  usage: '/mycommand <arg>',
  execute: async (args, context) => {
    // Return a prompt string to send to the AI
    return `Do something with: ${args}`;
  },
};

registerCommand(myCommand);
```

## Recommended Local Models

| Model | Size | Notes |
|-------|------|-------|
| `llama3.2` | 3B | Fast, good for testing |
| `llama3.1:8b` | 8B | Better quality |
| `qwen2.5-coder:7b` | 7B | Optimized for coding |
| `deepseek-coder-v2` | 16B | Excellent coding performance |

## License

MIT
