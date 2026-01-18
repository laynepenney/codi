# Reddit Launch Post

## Title
`I built my own Claude Code to learn how agentic AI works`

## Post Body (for r/programming, r/opensource, r/commandline)

```
Hey everyone,

I've been using Claude Code and OpenAI Codex and wanted to understand how they actually work under the hood. So I built my own.

**Codi** is an open-source AI coding assistant for the terminal, inspired by Claude Code and Codex.

### What it does:
- Read/write/edit files with diff previews
- Search code with regex, run shell commands
- Generate commits, PRs, tests
- Built-in slash commands (/commit, /test, /refactor, etc.)
- Session persistence and memory across conversations

### What makes it different:
- **Multi-provider**: Works with Claude, GPT, Ollama, or any OpenAI-compatible API
- **Run it free**: Use Ollama with local models (no API key needed)
- **Safety first**: Diff preview before every file change, approval prompts for dangerous ops, full undo history

### Quick start with Ollama (free):
```bash
ollama pull llama3.2
git clone https://github.com/laynepenney/codi.git
cd codi && pnpm install && pnpm build
codi --provider ollama --model llama3.2
```

GitHub: https://github.com/laynepenney/codi

Built with TypeScript, Apache 2.0 licensed. Would love feedback from the community - what features would you want?
```

## Post Body (for r/LocalLLaMA)

```
Built an open-source Claude Code alternative that works with Ollama and local models.

**Codi** - AI coding assistant for the terminal

I wanted something like Claude Code but that works with local models. Codi lets you:
- Use any Ollama model (llama3.2, deepseek-coder, codellama, etc.)
- Read/write files, search code, run commands
- Get diff previews before changes
- Full slash command system (/commit, /test, /refactor)

```bash
ollama pull llama3.2
codi --provider ollama --model llama3.2
```

Also works with Claude/GPT if you have API keys, but the local-first approach was the main goal.

GitHub: https://github.com/laynepenney/codi

What local models are you all using for coding tasks? I've been getting decent results with llama3.2 and deepseek-coder.
```

## Suggested Subreddits
- r/programming (general, large audience)
- r/opensource (community appreciates new projects)
- r/commandline (CLI tool focused)
- r/LocalLLaMA (local model enthusiasts)
- r/ChatGPTCoding (AI coding tools)
- r/ClaudeAI (Claude users)

## Reddit Tips
- Be genuine, not salesy
- Engage with every comment
- Post during US morning/afternoon (9am-2pm EST)
- Cross-post to relevant subs, but space them out
- Flair appropriately (Show & Tell, Project, etc.)
