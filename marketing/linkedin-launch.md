# LinkedIn Launch Post

## Post Copy

```
Meet Codi — an open-source AI coding assistant inspired by Claude Code and Codex.

I've been using Claude Code and OpenAI Codex for weeks, and they've completely changed how I write software.

But I wanted to understand how these tools actually work. So I built my own.

Building it taught me:
• How agentic AI loops work (tool calls, context management, streaming)
• The importance of safety features (diff previews, approval prompts)
• Why multi-provider support matters (not everyone wants to pay for API calls)

What makes Codi different:
🔌 Works with ANY provider — Claude, GPT, Ollama, or local models
🔒 Safety first — see diffs before changes, approve dangerous operations
💰 Run it FREE with Ollama (no API key needed)
🛠️ Full toolkit — read/write files, search code, run tests, generate commits

The best part? You can run it completely locally:
ollama pull llama3.2
codi --provider ollama

Open source under Apache 2.0. Built with Claude's help, of course.

GitHub: https://github.com/laynepenney/codi

If you're curious about AI tooling or want to learn by building, I'd love to hear what you're working on.

#OpenSource #AI #DeveloperTools #Claude #Codex #LearningInPublic
```

## Image Strategy

### Option 1: Demo GIF (Recommended for engagement)
Use `assets/demo.gif` - shows Codi in action with /help, /status, AI chat, and ?git search.

### Option 2: Feature Cards
Create a carousel of 3-4 images:
1. Multi-provider support (logos: Claude, GPT, Ollama)
2. Safety features (diff preview screenshot)
3. Built-in commands (/commit, /test, /refactor)
4. Local & free with Ollama

### Option 3: Social Preview Banner
Use `assets/social-preview.png` for link preview when sharing GitHub URL.

## Hashtags
Primary: #OpenSource #AI #DeveloperTools
Secondary: #CLI #Coding #Programming #Claude #GPT #Ollama

## Best Practices
- Post on Tuesday-Thursday, 8-10am or 12-1pm
- Engage with comments in first hour
- Share in relevant groups after posting

---

# Reddit Post

## Title Options
1. `I built an open-source Claude Code / Codex alternative that works with any AI provider (including local models)`
2. `Codi: Open-source AI coding assistant for the terminal - works with Claude, GPT, Ollama, or local models`
3. `[Show HN style] I built my own Claude Code to learn how agentic AI works`

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
