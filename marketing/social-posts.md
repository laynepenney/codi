# Codi Social Media Posts

## Twitter/X

### Launch Tweet (Thread)

**Tweet 1:**
```
Introducing Codi - your AI coding wingman for the terminal 🚀

One CLI. Multiple AI providers. Full codebase access.

Works with Claude, GPT, Ollama (local/free), or RunPod serverless.

Open source (Apache 2.0) 👇

github.com/laynepenney/codi
```

**Tweet 2:**
```
What makes Codi different?

🔌 Switch providers with a flag (--provider ollama)
🛠️ AI reads/writes files, runs commands, searches code
🔒 Safety first - diff previews, approval prompts, full undo
⚡ Auto-detects your project type and adapts
```

**Tweet 3:**
```
Built-in slash commands:

/explain - understand any code
/refactor - get improvement suggestions
/fix - squash bugs
/test - generate tests
/commit - AI-written commit messages
/pr - generate PR descriptions

Plus git integration, sessions, and memory.
```

**Tweet 4:**
```
Run locally with Ollama for free:

ollama pull llama3.2
codi --provider ollama --model llama3.2

No API costs. Full privacy. Same powerful features.
```

---

### Standalone Tweets

**Feature highlight - Safety:**
```
AI coding assistants that can write files are scary.

That's why Codi shows you a diff preview before every change, requires approval for dangerous commands, and keeps a full undo history.

Safety first, then speed.

github.com/laynepenney/codi
```

**Feature highlight - Multi-provider:**
```
Why lock yourself into one AI provider?

Codi lets you switch between Claude, GPT, Ollama, and RunPod with a single flag.

Use Claude for complex reasoning.
GPT for broad knowledge.
Ollama for privacy + free.

Same interface. Same tools.

github.com/laynepenney/codi
```

**Feature highlight - Local/Free:**
```
AI coding assistants don't have to cost money.

Codi + Ollama = free, local, private AI coding in your terminal.

ollama pull llama3.2
codi --provider ollama

github.com/laynepenney/codi
```

---

## LinkedIn

### Launch Post

```
I'm excited to share Codi - your open-source AI coding wingman for the terminal.

As developers, we spend countless hours in the terminal. What if your AI assistant lived there too - with full access to read files, write code, run tests, and help you ship faster?

🔌 Multi-Provider Support
Switch between Claude, OpenAI, local Ollama models, or RunPod serverless endpoints. Not locked into any single vendor.

🛠️ Powerful Tool System
The AI can read and write files, search your codebase, execute shell commands, apply patches, analyze images, and even search the web.

🔒 Safety First
Every file change shows a diff preview. Dangerous operations require explicit approval. Full undo history for mistakes.

⚡ Smart Context
Auto-detects your project type (Node, Python, Rust, Go), framework, and language to adapt its responses.

🎯 Built-in Commands
/explain, /refactor, /fix, /test, /review, /doc, /commit, /pr - all the workflows you need, built in.

The best part? You can run it completely locally and free with Ollama. No API costs, full privacy.

Open source under Apache 2.0.

Check it out: github.com/laynepenney/codi

#OpenSource #AI #DeveloperTools #CLI #Coding
```

### Feature Deep-Dive Post

```
Why I built multi-provider support into Codi:

Different AI models have different strengths.

Claude excels at complex reasoning and following nuanced instructions.
GPT has broad knowledge and solid code generation.
Ollama models give you privacy and zero API costs.

Why choose just one?

With Codi, switching is a single flag:

codi --provider anthropic  # Claude
codi --provider openai     # GPT
codi --provider ollama     # Local models

Same powerful tools. Same slash commands. Same workflow.

You can even use different models for different tasks using model maps - cheap fast models for quick operations, powerful models for complex reasoning.

The future of AI tools isn't vendor lock-in. It's flexibility.

github.com/laynepenney/codi

#AI #DeveloperProductivity #OpenSource
```

---

## Reddit

### r/programming or r/coding

**Title:** `Codi - Your AI coding wingman for the terminal (Claude/GPT/Ollama)`

**Body:**
```
Hey everyone,

I've been working on Codi, your AI coding wingman - an open-source CLI tool that brings AI assistance directly into your terminal workflow.

**What it does:**
- Chat with AI that can actually read/write your files, run commands, and search your codebase
- Works with Claude, OpenAI, Ollama (free/local), or RunPod serverless
- Built-in slash commands: /explain, /refactor, /fix, /test, /commit, /pr
- Auto-detects project type and adapts (Node, Python, Rust, Go)
- Session management - save and load conversations
- Memory system - remembers preferences across sessions

**Safety features:**
- Diff preview before any file change
- Approval prompts for dangerous operations
- Full undo history
- Configurable auto-approve for safe operations

**Why another AI assistant?**

Most AI coding tools are either:
1. IDE plugins (locked to one editor)
2. Web interfaces (context switching)
3. Single-provider (locked to one AI)

I wanted something that lives in the terminal, works with any provider, and gives the AI real access to my codebase - not just copy-paste.

**Run locally for free:**
```
ollama pull llama3.2
codi --provider ollama --model llama3.2
```

Apache 2.0 licensed.

GitHub: https://github.com/laynepenney/codi

Would love feedback from the community. What features would make this more useful for your workflow?
```

### r/LocalLLaMA

**Title:** `Codi - AI coding wingman with Ollama support (free/local LLM coding)`

**Body:**
```
Built an open-source CLI tool that works great with Ollama for local AI-assisted coding.

**Quick start:**
```bash
ollama pull llama3.2
codi --provider ollama --model llama3.2
```

**What the AI can do:**
- Read and write files in your project
- Search code with glob/grep
- Execute shell commands (with safety prompts)
- Apply patches and diffs
- Run your test suite

**Works with any Ollama model:**
- llama3.2 (general purpose)
- deepseek-coder (code-focused)
- codellama (code-focused)
- qwen2.5-coder (code-focused)

**Also supports:**
- Ollama Cloud for remote Ollama instances
- Model map configs to use different models for different tasks (e.g., small model for quick ops, large model for complex reasoning)

The tool also works with Claude/OpenAI if you want to compare, but the Ollama integration is first-class.

GitHub: https://github.com/laynepenney/codi

What local models are you using for coding tasks? Always looking to test with more.
```

---

## Hacker News

### Show HN Post

**Title:** `Show HN: Codi – Your AI coding wingman for the terminal (Claude/GPT/Ollama)`

**Body:**
```
Hi HN,

I built Codi because I wanted an AI coding wingman that:
1. Lives in the terminal (where I already work)
2. Isn't locked to one AI provider
3. Can actually read and modify my codebase
4. Doesn't require me to trust it blindly

Key design decisions:

**Multi-provider**: Switch between Claude, GPT, Ollama, or RunPod with `--provider`. Same tools, same commands, different models.

**Real codebase access**: The AI can read files, write files, search code, and execute commands. Not just chat about code - actually work with it.

**Safety by default**: Every file write shows a diff. Dangerous bash commands (rm -rf, sudo, etc.) require explicit approval. Full undo history.

**Local-first option**: Works fully offline with Ollama. No API costs, no data leaving your machine.

**Extensible**: Plugin system for custom tools and commands. Model maps for multi-model orchestration.

Tech: TypeScript, Node.js 22, uses official SDKs for each provider.

Free (Apache 2.0): https://github.com/laynepenney/codi

I'm the sole developer. Would appreciate feedback on the approach, missing features, or things that seem wrong.
```

---

## Hashtag Reference

**Twitter/X:**
- #OpenSource #AI #CLI #DevTools #Coding #Programming #Claude #GPT #Ollama

**LinkedIn:**
- #OpenSource #AI #DeveloperTools #CLI #Coding #Programming #ArtificialIntelligence #SoftwareDevelopment #DevProductivity

---

## Image Suggestions

For posts that benefit from images:

1. **Terminal screenshot** - Show Codi in action with syntax-highlighted code
2. **Feature comparison table** - Codi vs other AI assistants
3. **Architecture diagram** - Simple visual of multi-provider support
4. **Diff preview screenshot** - Show the safety feature in action

Use `assets/social-preview.svg` (convert to PNG) for link previews.
