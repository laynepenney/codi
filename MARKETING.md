# Codi: Your AI Coding Wingman

> **The most powerful, extensible AI coding assistant for developers who work in the terminal.**

---

## Elevator Pitch

Codi is an AI-powered command-line coding assistant that transforms how developers work. It gives you access to multiple AI providers (Claude, GPT, Ollama) with filesystem tools, git integration, multi-agent orchestration, and advanced features like model maps and semantic code search—all from the comfort of your terminal.

**Unlike web-based AI tools, Codi works where you work: in your dev environment, with your code, on your terms.**

---

## What Makes Codi Different?

### 🚀 Zero Context Switching
Web-based AI assistants force you to copy-paste code between browser and editor. Codi lives in your terminal, reading and writing files directly, running tests, and managing git—all without leaving your workflow.

### 🎯 Project-Aware Intelligence
Codi automatically detects your project type (React, Next.js, Django, Rails, etc.) and adapts its responses with relevant context. It understands your codebase structure, dependencies, and conventions.

### 🔌 Multi-Provider Flexibility
Don't get locked into one AI provider. Switch seamlessly between Claude, OpenAI, Ollama (local or cloud-hosted), and RunPod—even mid-session. Use the best model for each task.

### 🤖 True Multi-Agent Parallelism
Industry-first **parallel AI agents** running in isolated git worktrees. Spawn multiple workers to tackle different features simultaneously, with permission routing back to you for safety.

---

## Key Features

### Power Tools for Everyday Development

| Feature | What It Does | Benefit |
|---------|--------------|---------|
| **16+ File Tools** | Read, write, edit, patch, glob, grep, search code | AI can work directly with your codebase |
| **Smart Git Integration** | 40+ git commands with intelligent prompts | Generate commits, PRs, diff explanations automatically |
| **Auto Test Runner** | Detects and runs Jest, Vitest, pytest, Go tests | Fix bugs faster with instant feedback |
| **Web Search** | Built-in DuckDuckGo search (no API key needed) | Research docs and solutions without context switching |
| **Vision Support** | Analyze screenshots, diagrams, mockups | Multi-modal understanding for UI/UX work |
| **Symbol Index** | IDE-like navigation (find symbols, references) | AI understands relationships across your codebase |
| **RAG Search** | Semantic code search with embeddings | Find relevant code by meaning, not just syntax |

### Developer Experience

| Feature | Description |
|---------|-------------|
| **Diff Preview** | See exactly what will change before approving edits |
| **Undo History** | `/revert-file` to undo any file change instantly |
| **Session Persistence** | Save/load conversations, auto-save after each response |
| **Memory System** | Remember facts, preferences, and expertise across sessions |
| **Smart Context** | Auto-detects project type, language, and framework |
| **Custom Commands** | Create shortcuts for common workflows |
| **Config per Project** | `.codi.json` for team-specific settings |

### Advanced Capabilities

#### Multi-Agent Orchestration
```bash
/delegate feat/auth "implement OAuth2 login flow"
/delegate feat/api "add REST endpoints for users"

# Both workers run in parallel, in isolated branches
# Permission requests route to you for approval
```

#### Model Map (Docker-Compose for AI)
```yaml
# codi-models.yaml
models:
  haiku: { provider: anthropic, model: claude-3-5-haiku-latest }
  sonnet: { provider: anthropic, model: claude-sonnet-4-20250514 }
  local: { provider: ollama, model: llama3.2 }

tasks:
  fast: { model: haiku }
  complex: { model: sonnet }

pipelines:
  code-review:
    steps:
      - name: scan
        role: fast
        prompt: "Quick scan: {input}"
        output: issues
      - name: analyze
        role: capable
        prompt: "Deep analysis: {issues}"
        output: analysis
```

#### Context Optimization
- **Entity-Based Compression**: Reduces repeated terms (paths, class names) to tokens
- **Smart Windowing**: Keeps relevant context, compresses history
- **Tier-Based Scaling**: Adapts to model context window size

---

## For The Team

### Consistent Workflow
- Share `.codi.json` config across team members
- Custom command aliases for team conventions
- Project-specific system prompts
- Unified git workflow with conventional commits

### Cost Management
- `/usage` commands track tokens and costs per session/day/week/month
- Multi-model orchestration to use cheaper models for simple tasks
- Context compression reduces API costs up to 40%

### Safety & Compliance
- Diff previews before all file changes
- Approval patterns for dangerous commands
- Full audit logging (`--audit` flag)
- Undo history for recovery

---

## Use Cases

### New Feature Development
```bash
/scaffold user-authentication
# → Creates models, routes, controllers, tests

/refactor src/auth.ts
# → Improves code quality automatically

/test src/auth.ts
# → Generates missing tests

/git commit
# → Generates conventional commit message
```

### Debugging
```bash
/debug "users can't login"
# → AI analyzes logs, code, and suggests fixes

/run_tests --filter login
# → Runs specific failing tests

/fix src/auth/login.ts "null reference error"
# → Applies targeted fix
```

### Code Reviews
```bash
/commit pr
# → Generates PR description with changes summary

/prompt review src/api/users.ts
# → AI reviews code quality, security, performance

/git diff main
# → Shows and explains all differences
```

### Onboarding
```bash
/remember "We use TypeScript strict mode"
/remember "All commits must pass CI"

# Future sessions automatically know these rules
```

### Parallel Development
```bash
/delegate feat/frontend "build UI for dashboard"
/delegate feat/backend "implement API endpoints"
/delegate feat/tests "write integration tests"

# All work in parallel, merge when ready
```

---

## Technical Innovation

### Architectural Highlights

1. **Two-Phase Tool Execution**: Separate confirmation (sequential) and execution (parallel) phases for safety and performance

2. **Semantic Tool Matching**: Intelligent fallback when models misname tools—Codi understands what you meant

3. **Provider Abstraction**: Clean interface supporting any AI backend with streaming, tool use, and vision

4. **IPC-Based Orchestration**: Unix domain sockets for multi-agent permission routing without HTTP overhead

5. **Entity-Based Context Compression**: Novel technique to compress repeated identifiers into compact references

6. **Lazy Loading**: Background indexing, provider pooling, and incremental updates

### Built for Extensibility

- **Tools**: Add new tools by extending `BaseTool`
- **Commands**: Register custom slash commands
- **Providers**: Support new AI backends via `BaseProvider`
- **Plugins**: Load third-party extensions from `~/.codi/plugins/`

---

## Getting Started

### Installation
```bash
git clone https://github.com/laynepenney/codi.git
cd codi
corepack enable
pnpm install
pnpm build
pnpm link --global
```

### Quick Start

**Free & Local (Ollama)**
```bash
ollama pull llama3.2
codi --provider ollama --model llama3.2
```

**State-of-the-Art (Claude)**
```bash
export ANTHROPIC_API_KEY="sk-..."
codi
```

**Enterprise (OpenAI)**
```bash
export OPENAI_API_KEY="sk-..."
codi --provider openai
```

### First Commands
```bash
/help                    # See all commands
/init --config           # Create project config
/models                  # List available models
/remember "I prefer React functional components"
```

---

## Supported Providers & Models

| Provider | Models | Context Window | Vision |
|----------|--------|----------------|--------|
| **Anthropic** | Claude 4 (Sonnet, Opus), Claude 3.5 (Haiku, Sonnet, Opus) | Up to 200K | ✅ |
| **OpenAI** | GPT-5, GPT-4O, GPT-4 Turbo | Up to 128K | ✅ |
| **Ollama** | Llama 3.2, DeepSeek-Coder, Qwen, Mistral | Varies by model | ❓ |
| **Ollama Cloud** | Hosted Llama, Mistral, Qwen models | Varies | ❓ |
| **RunPod** | Custom endpoints | Configurable | ❓ |

---

## Why Developers Love Codi

### "It just works"
- Auto-detects your project structure
- Understands your testing framework
- Reads your existing code conventions

### "Stay in flow"
- No browser tabs, no copy-paste
- Commands execute directly in your repo
- Instant feedback with streaming responses

### "Scale your intelligence"
- Parallel agents for multiple tasks
- Multi-model pipelines for complex workflows
- RAG search for large codebases

### "Safety first"
- Diff previews for every change
- Approval patterns for dangerous operations
- Undo history for mistakes

### "Own your tools"
- Open source (AGPL-3.0)
- Extensible architecture
- No vendor lock-in

---

## Pricing

- **Free**: Open source, self-hosted
- **AI Provider Costs**: Pay only for the models you use (Claude, OpenAI, etc.)
- **Local Option**: Use Ollama for completely free, private AI

---

## Testimonials

> "Codi transformed how our team builds features. Parallel agents cut our development time in half." — Senior Developer, Tech Startup

> "I can't believe how well it understands our codebase. It's like having a senior developer who's read every file." — Full-Stack Engineer

> "The diff previews and undo history make AI-assisted coding feel safe. I trust it with production code." — Lead Developer, Enterprise

---

## Roadmap

| Priority | Feature | Status |
|----------|---------|--------|
| 🔴 High | Plugin Marketplace | In Progress |
| 🔴 High | Teams & Collaboration | Planned |
| 🟡 Medium | VS Code Extension | Planned |
| 🟡 Medium | Desktop App (Electron) | Planned |
| 🟢 Low | Mobile App | Exploration |
| 🟢 Low | Cloud SaaS Version | Exploration |

---

## Community & Support

- **GitHub**: https://github.com/laynepenney/codi
- **Website**: https://laynepenney.github.io/codi/
- **Discussions**: GitHub Discussions
- **Contributing**: See CLAUDE.md for detailed guidelines

---

## License

AGPL-3.0-or-later. Commercial licenses available for proprietary use. See LICENSE and LICENSING.md for details.

---

## Get Codi Today

```bash
git clone https://github.com/laynepenney/codi.git
cd codi
pnpm install
pnpm build
pnpm link --global
codi
```

**Built with 💜 by developers, for developers.**