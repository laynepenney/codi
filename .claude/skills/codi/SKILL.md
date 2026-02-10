---
name: codi
description: Codi AI coding wingman (TypeScript CLI). Use when working on the codi TypeScript codebase - the agent loop, tools, commands, providers, or any TypeScript source.
allowed-tools: Bash(pnpm *), Bash(npx *)
---

# Codi TypeScript CLI

Codi is an AI coding wingman for the terminal - a TypeScript CLI supporting multiple AI providers (Claude, OpenAI, Ollama).

## Build / Dev / Test

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript to JavaScript
pnpm dev              # Run with ts-node (dev mode)
pnpm test             # Run Vitest tests
pnpm test:watch       # Watch mode
```

## Architecture

```
src/
├── index.ts          # CLI entry, REPL loop
├── agent.ts          # Core agent loop (model + tools orchestration)
├── config.ts         # Workspace configuration (.codi.json)
├── context.ts        # Project detection (Node, Python, Rust, Go)
├── session.ts        # Session persistence
├── types.ts          # TypeScript interfaces
├── logger.ts         # Level-aware logging (NORMAL/VERBOSE/DEBUG/TRACE)
├── spinner.ts        # Ora spinner manager
├── compression.ts    # Entity-based context compression
├── commands/         # Slash command system (/git, /save, /config, etc.)
├── providers/        # AI model backends (Anthropic, OpenAI, Ollama)
├── tools/            # Filesystem interaction tools (read, write, edit, grep, etc.)
├── orchestrate/      # Multi-agent orchestration (parallel workers via IPC)
├── rag/              # Semantic code search (embeddings + vectra)
├── model-map/        # Multi-model orchestration (docker-compose style)
└── symbol-index/     # SQLite-based code navigation
```

## Key Patterns

- **Provider Abstraction**: `BaseProvider` + factory pattern. Add backends in `src/providers/`.
- **Tool Registry**: Self-describing tools with JSON schema definitions in `src/tools/`.
- **Slash Commands**: `src/commands/` with `registerCommand()`.
- **Streaming-First**: Provider `streamChat()` for incremental text display.
- **Context Compaction**: Auto-summarization when approaching token limits.

## Coding Conventions

- **ES Modules** with `.js` extension in imports (even for `.ts` files)
- **Async/Await** over callbacks
- **TypeScript interfaces**, avoid `any`
- **Vitest** for testing (`tests/` directory)
- Error handling: tools catch errors and return descriptive messages

## Adding a Tool

```typescript
// 1. Create src/tools/my-tool.ts
export class MyTool extends BaseTool {
  getDefinition(): ToolDefinition { /* JSON schema */ }
  async execute(input: Record<string, unknown>): Promise<string> { /* logic */ }
}
// 2. Register in src/tools/index.ts
registry.register(new MyTool());
```

## Adding a Command

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

## Adding a Provider

```typescript
// 1. Create src/providers/my-provider.ts extending BaseProvider
// 2. Implement: chat(), streamChat(), getName(), getModel(), supportsToolUse()
// 3. Add to createProvider() in src/providers/index.ts
```
