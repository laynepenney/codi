# AGENTS.md - AI Agent Instructions

This file provides instructions for AI agents working on the Codi codebase.

## Project Overview

**Codi** is an interactive AI coding assistant CLI built with TypeScript. It supports multiple AI providers (Claude, OpenAI, Ollama, RunPod) and gives AI models access to filesystem tools for code assistance.

## Quick Commands

```bash
pnpm install      # Install dependencies
pnpm build        # Compile TypeScript
pnpm test         # Run tests
pnpm dev          # Run in development mode
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | TypeScript source code |
| `src/tools/` | Filesystem tools (read, write, edit, bash, etc.) |
| `src/commands/` | Slash command implementations |
| `src/providers/` | AI provider integrations |
| `src/rag/` | RAG/embedding system |
| `src/symbol-index/` | AST-based code indexing |
| `tests/` | Vitest test suite |
| `docs/` | Additional documentation |

## Important Files

| File | Description |
|------|-------------|
| `src/index.ts` | CLI entry point, REPL loop |
| `src/agent.ts` | Core agent loop - orchestrates model + tools |
| `src/types.ts` | TypeScript interfaces |
| `src/config.ts` | Workspace configuration |
| `CLAUDE.md` | Detailed AI assistant context |
| `docs/ROADMAP.md` | Feature roadmap and status |

## Coding Conventions

1. **ES Modules**: Use `.js` extension in imports (even for `.ts` files)
2. **Async/Await**: Prefer async/await over callbacks
3. **Type Safety**: Use TypeScript interfaces, avoid `any`
4. **Error Handling**: Tools catch errors and return descriptive messages
5. **Testing**: Add tests for new functionality in `tests/`

## Common Tasks

### Adding a Tool

1. Create `src/tools/my-tool.ts` extending `BaseTool`
2. Implement `getDefinition()` and `execute()`
3. Register in `src/tools/index.ts`
4. Add tests in `tests/my-tool.test.ts`

### Adding a Command

1. Create command in `src/commands/my-commands.ts`
2. Define name, aliases, description, usage, execute function
3. Call `registerCommand(myCommand)`
4. Commands return prompts that are sent to the AI

### Running Tests

```bash
pnpm test                              # All tests
pnpm test -- tests/specific.test.ts   # Specific test
pnpm test:watch                        # Watch mode
```

## Architecture Notes

- **Provider Abstraction**: All AI backends implement `BaseProvider`
- **Tool System**: Tools extend `BaseTool` with JSON schema definitions
- **Agent Loop**: Sends messages, handles tool calls, manages conversation (max 20 iterations)
- **Commands**: Transform user input into specialized prompts

## Before Committing

1. Run `pnpm build` to check for TypeScript errors
2. Run `pnpm test` to ensure tests pass
3. Follow conventional commit format (feat:, fix:, docs:, etc.)

## Additional Context

For detailed feature documentation, implementation notes, and architecture details, see:
- `CLAUDE.md` - Comprehensive AI assistant context
- `README.md` - User documentation
- `docs/ROADMAP.md` - Feature roadmap
