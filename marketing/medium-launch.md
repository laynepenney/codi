# Medium Launch Post

## Title
`I Built My Own Claude Code to Learn How Agentic AI Actually Works`

## Subtitle
An open-source journey into tool-calling LLMs, context management, and building AI coding assistants

---

## Article

I've been using Claude Code and OpenAI Codex for weeks now, and they've completely changed how I write software. Watching an AI read my codebase, make targeted edits, run tests, and commit changes felt like magic.

But I wanted to understand how that magic actually works. So I built my own.

Meet **Codi** — an open-source AI coding assistant for the terminal, inspired by Claude Code and Codex.

### Why Build Your Own?

There's a difference between *using* AI tools and *understanding* them. I could prompt Claude Code all day, but I didn't really grasp:

- How does the AI decide when to use tools vs. just respond?
- How do you manage context when conversations get long?
- What makes file editing safe (and what makes it dangerous)?
- How do you stream responses while handling tool calls?

The only way to truly learn was to build it myself.

### The Agentic Loop

The core of any coding assistant is what I call the "agentic loop." It's surprisingly simple:

1. Send the user's message to the LLM
2. If the LLM wants to use a tool, execute it
3. Send the tool result back to the LLM
4. Repeat until the LLM responds without tool calls

```
User → LLM → Tool Call → Tool Result → LLM → Tool Call → ... → Response
```

The tricky part isn't the loop itself — it's everything around it: parsing tool calls from different providers, handling streaming, managing errors, and knowing when to stop.

### What I Learned Building Codi

**1. Tool definitions are everything**

The AI only knows what tools exist based on how you describe them. A vague description means the AI won't use the tool correctly. I spent more time refining tool schemas than writing the actual tool implementations.

**2. Context management is hard**

LLMs have finite context windows. When you're reading files, searching code, and having conversations, you hit limits fast. I implemented:
- Token counting to track usage
- Automatic summarization of older messages
- Entity-based compression (replacing repeated code blocks with references)

**3. Safety requires intentional friction**

It's tempting to auto-approve everything for convenience. But one wrong `rm -rf` and you've lost work. Codi shows diff previews before file changes and requires approval for dangerous operations. The small friction is worth it.

**4. Multi-provider support matters**

Not everyone wants to pay for API calls. By supporting Ollama, anyone can run Codi completely free with local models. The abstraction layer also taught me how different providers handle tool calling (spoiler: they're all slightly different).

### What Codi Can Do

After weeks of building, Codi has feature parity with the basics of Claude Code:

- **File operations**: Read, write, edit with search/replace, insert lines, apply patches
- **Code search**: Regex grep, glob patterns, directory listing
- **Shell commands**: Run bash with safety checks for dangerous operations
- **Git integration**: Generate commits, PRs, diffs, branch management
- **Slash commands**: `/commit`, `/test`, `/refactor`, `/explain`, and more
- **Session persistence**: Save and resume conversations
- **Memory system**: Remember facts across sessions

And the killer feature: **run it free with Ollama**.

```bash
ollama pull llama3.2
codi --provider ollama --model llama3.2
```

### The Architecture

For those interested in the technical details:

```
codi/
├── src/
│   ├── index.ts        # CLI entry, REPL loop
│   ├── agent.ts        # The agentic loop
│   ├── providers/      # Claude, OpenAI, Ollama adapters
│   ├── tools/          # File ops, search, bash, etc.
│   └── commands/       # Slash command system
```

The provider abstraction was key. Each provider (Anthropic, OpenAI, Ollama) has slightly different APIs for tool calling. The abstraction normalizes them into a common interface.

### Try It Yourself

Codi is open source under Apache 2.0. If you want to learn how agentic AI works, I'd encourage you to:

1. **Use it**: `git clone https://github.com/laynepenney/codi.git`
2. **Read the code**: Start with `agent.ts` — it's the heart of the system
3. **Add a tool**: The tool system is designed to be extensible
4. **Break things**: That's how you learn

### What's Next

I'm continuing to build features:
- RAG-based semantic code search
- Multi-model pipelines (use cheap models for summarization)
- Better context compression

But honestly, the goal was never to replace Claude Code. It was to understand it. And now I do.

---

**GitHub**: https://github.com/laynepenney/codi

*If you're building AI tools or learning about agentic systems, I'd love to hear what you're working on.*

---

## Tags
- Artificial Intelligence
- Programming
- Open Source
- Software Development
- Machine Learning

## Publication Targets
- Towards Data Science
- Better Programming
- The Startup
- Level Up Coding
- Personal blog / self-publish

## Medium Tips
- Add 3-5 relevant images (demo GIF, architecture diagram, code snippets)
- Include code blocks for technical credibility
- End with a call to action
- Publish Tuesday-Thursday morning for best engagement
- Cross-post to DEV.to and Hashnode for wider reach
