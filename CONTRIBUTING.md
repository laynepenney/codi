# Contributing to Codi

We welcome contributions! Whether you're fixing bugs, adding features, or improving documentation, your help is appreciated.

## Getting Started

### Prerequisites

- Node.js `>=22 <23`
- pnpm (via Corepack)

### Setup

```bash
# Clone and enter the repo
git clone https://github.com/yourusername/codi.git
cd codi

# Enable pnpm via Corepack
corepack enable

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test
```

## Development Workflow

```bash
# Run in development mode (with hot reload)
pnpm dev

# Run tests in watch mode
pnpm test:watch

# Build for production
pnpm build
```

## Making Changes

> **IMPORTANT**: Never push directly to main. Always use feature/bugfix branches and pull requests.

1. **Fork the repository** and clone your fork
2. **Create a feature branch**: `git checkout -b feat/amazing-feature` (or `fix/`, `chore/`)
3. **Make your changes** following the coding guidelines below
4. **Run tests**: `pnpm test`
5. **Commit your changes**: `git commit -m 'feat: add amazing feature'`
6. **Push to your fork**: `git push -u origin feat/amazing-feature`
7. **Open a Pull Request**: `gh pr create` or via GitHub UI

### Branch Naming Convention

- `feat/` - New features
- `fix/` - Bug fixes
- `chore/` - Maintenance, refactoring, documentation updates

## Coding Guidelines

### Code Style

- **TypeScript**: Use strict typing, avoid `any`
- **ES Modules**: Use `.js` extension in imports (even for `.ts` files)
- **Async/Await**: Prefer async/await over callbacks
- **Error Handling**: Tools should catch errors and return descriptive messages

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

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
// In src/commands/my-commands.ts
export const myCommand: Command = {
  name: 'mycommand',
  aliases: ['mc'],
  description: 'Description for /help',
  usage: '/mycommand <args>',
  execute: async (args, context) => `Prompt for AI: ${args}`,
};
registerCommand(myCommand);
```

## Testing

- Tests are in `tests/` using Vitest
- Run all tests: `pnpm test`
- Run specific test: `pnpm test -- tests/my-test.test.ts`
- Watch mode: `pnpm test:watch`

### PTY Tests

Some CLI integration tests require a real TTY and are skipped by default:

```bash
CODI_RUN_PTY_TESTS=1 pnpm test
```

## Documentation

- Update `README.md` for user-facing changes
- Update `CLAUDE.md` for AI assistant context and architecture
- See `docs/TOOLS.md` for tool reference
- See `docs/ROADMAP.md` for feature roadmap
- Add inline JSDoc comments for complex functions

## Questions?

Feel free to open an issue for any questions or suggestions!
