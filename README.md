# AI Assistant

A hybrid AI coding assistant CLI that supports both cloud APIs (Claude, OpenAI) and local models (Ollama).

## Features

- **Multiple Providers**: Switch between Claude API, OpenAI API, or local models via Ollama
- **Tool Use**: AI can read/write files and execute bash commands
- **Streaming**: Real-time response streaming
- **Extensible**: Easy to add new tools and providers

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

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear conversation history |
| `/exit` | Exit the assistant |

## Architecture

```
src/
├── index.ts              # CLI entry point
├── agent.ts              # Agent loop orchestration
├── types.ts              # TypeScript types
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
    ├── bash.ts           # Bash command tool
    └── index.ts          # Tool exports
```

## How It Works

1. **Provider Abstraction**: All model backends implement a common interface (`BaseProvider`) with `chat()` and `streamChat()` methods

2. **Tool System**: Tools are defined with JSON schemas and registered with the `ToolRegistry`. The AI model can call these tools to interact with the filesystem

3. **Agent Loop**: The `Agent` class orchestrates the conversation:
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

## Adding a New Provider

Extend `BaseProvider` and implement the required methods:

```typescript
import { BaseProvider } from './providers/base.js';

export class MyProvider extends BaseProvider {
  async chat(messages, tools?) { /* ... */ }
  async streamChat(messages, tools?, onChunk?) { /* ... */ }
  supportsToolUse() { return true; }
  getName() { return 'MyProvider'; }
  getModel() { return 'model-name'; }
}
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
