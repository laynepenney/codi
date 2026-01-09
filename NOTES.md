## 1) Brief overview

This `src/**` codebase implements **Codi**, an interactive CLI “AI coding wingman”. It:

- Starts a REPL-style chat in your terminal.
- Detects basic **project context** (language/framework/entry points).
- Connects to an LLM via a **provider** (Anthropic or OpenAI-compatible backends like OpenAI/Ollama/RunPod).
- Runs an **agent loop** that can repeatedly:
  1) send conversation to the model,
  2) receive tool calls,
  3) execute local tools (read/edit/write files, grep, glob, bash, etc.),
  4) send tool results back to the model,
  until the model is done.

It also supports **slash commands** (`/explain`, `/fix`, `/test`, etc.) that generate structured prompts for the agent.

---

## 2) Key components and their purposes

### Entry / CLI: `src/index.ts`
- Uses `commander` to parse CLI flags (provider/model/base URL/runpod endpoint, `--no-tools`, `--debug`).
- Maintains a history file `~/.codi_history` and loads it into readline history.
- Detects project context (`detectProject`) and prints a short summary.
- Registers tools (`registerDefaultTools`) and registers slash commands (`registerCodeCommands`, `registerWorkflowCommands`).
- Creates a provider:
  - `detectProvider()` if `--provider auto`
  - otherwise `createProvider(...)` based on CLI flags
- Constructs an `Agent` with a generated system prompt (tool-enabled vs tool-disabled mode + project context) and callbacks for:
  - streaming output
  - tool call/result logging
  - optional “reasoning” traces
- Runs a `readline` loop that routes input into:
  - built-in commands (`/help`, `/clear`, `/compact`, `/status`, `/context`, `/exit`)
  - registered slash commands (via command registry)
  - or plain chat to the agent

### Agent / orchestration: `src/agent.ts`
The heart of the system: an “agentic” tool-using loop.

Key responsibilities:
- Stores conversation history as `Message[]` plus an optional rolling `conversationSummary`.
- Calls provider streaming chat, optionally with tool definitions if enabled and supported.
- Detects tool calls in two ways:
  1) **Native tool calling** (provider returns tool calls)
  2) **Text extraction fallback** (`extractToolCallsFromText`) for models that just print JSON in text (common in some local models)
- Executes tools via `ToolRegistry.execute(...)`
- Feeds tool results back to the model, then repeats until no more tool calls or safety stop conditions.

Also includes:
- Context compaction/summarization when token estimate exceeds a threshold (`MAX_CONTEXT_TOKENS`), keeping recent messages verbatim and summarizing older messages via the model.

### Types: `src/types.ts`
Defines shared structures:
- `Message` (role + content, where content can be string or `ContentBlock[]`)
- `ContentBlock` (`text`, `tool_use`, `tool_result`) to support providers that represent tool calls as structured content
- `ToolDefinition`, `ToolCall`, `ToolResult`
- `ProviderResponse` (text, toolCalls, stopReason, optional reasoning)
- `ProviderConfig`

### Project context detection: `src/context.ts`
- `detectProject()` looks for:
  - Node (`package.json`)
  - Python (`pyproject.toml` / `requirements.txt` / `setup.py`)
  - Rust (`Cargo.toml`)
  - Go (`go.mod`)
- Extracts:
  - name, language, optional framework (Node and Python basic detection)
  - “main/entry” files guess list
- `formatProjectContext()` returns a short string inserted into the system prompt.

### Slash command system: `src/commands/*`

`src/commands/index.ts`
- Minimal command registry (`Map<string, Command>`)
- Aliases supported by mapping alias → same command
- Parsing:
  - `isCommand()` checks it begins with `/` but not `//`
  - `parseCommand()` splits `/name args...`
- `Command.execute(...)` returns a **prompt string** (or null) that will be sent to the agent.

`src/commands/code-commands.ts`
- Registers “code assistance” commands:
  - `/explain`, `/refactor`, `/fix`, `/test`, `/review`, `/doc`, `/optimize`
- These primarily **generate instructions** telling the agent to use tools (read_file/edit_file/write_file/etc.).

`src/commands/workflow-commands.ts`
- Registers “workflow” commands:
  - `/new`, `/scaffold`, `/migrate`, `/debug`, `/setup`
- These also generate structured prompts, often referencing project context (React/Next vs backend guidance, etc.).

### Provider abstraction: `src/providers/*`

`src/providers/base.ts`
- `BaseProvider` abstract class:
  - `chat(...)`, `streamChat(...)`
  - `supportsToolUse()`
  - `getName()`, `getModel()`

`src/providers/index.ts`
- Provider factory:
  - `createProvider({type,...})` supports: `anthropic`, `openai`, `ollama`, `runpod`
- Environment-based detection:
  - `ANTHROPIC_API_KEY` → Anthropic
  - `OPENAI_API_KEY` → OpenAI-compatible (OpenAI)
  - `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID` → RunPod
  - otherwise defaults to Ollama

`src/providers/anthropic.ts`
- Uses `@anthropic-ai/sdk`
- Uses Anthropic’s native system prompt support (`system:` field)
- Streaming:
  - listens for `'text'` events for incremental output
  - inspects final message blocks for `tool_use` blocks to build toolCalls

`src/providers/openai-compatible.ts`
- Uses `openai` SDK with configurable `baseURL` for OpenAI-compatible servers.
- Supports:
  - OpenAI API
  - Ollama via `http://localhost:11434/v1`
  - RunPod serverless OpenAI-compatible endpoint
- Streaming:
  - accumulates `delta.content`
  - accumulates streamed tool call arguments across chunks, then JSON.parse at end
  - also captures optional `reasoning_content` (for reasoning-style models)
- Message conversion is careful about OpenAI’s tool-call ordering rules:
  - tool calls must be in an assistant message with `tool_calls`
  - tool results must immediately follow as `role: 'tool'` messages

### Tools system: `src/tools/*`

`src/tools/base.ts`
- `BaseTool` abstract:
  - `getDefinition()` returns a JSON-schema-ish input schema for the model
  - `execute(input)` returns string output
  - `run(toolUseId,input)` wraps execution into a `ToolResult` with error handling

`src/tools/registry.ts`
- `ToolRegistry` stores tools by name, provides:
  - `getDefinitions()` for the model
  - `execute(toolCall)` to run a single tool
- `globalRegistry` singleton is used by CLI.

`src/tools/index.ts`
- Exports tools and provides `registerDefaultTools()` which registers:
  - file ops: read/write/edit/insert/patch
  - exploration: glob/grep/list_directory
  - shell: bash

Individual tools implement filesystem and shell actions:
- `read-file.ts`: reads a file, returns content **with line numbers**; supports `max_lines`.
- `write-file.ts`: writes content, creates directories.
- `edit-file.ts`: replaces exact `old_string` with `new_string` (optionally all), validates existence, returns summary.
- `patch-file.ts`: applies unified diff hunks (simple parser/applier).
- `insert-line.ts`: inserts content before a given line number.
- `glob.ts`: uses node’s `fs/promises.glob` to list matches, truncates huge output.
- `grep.ts`: regex search across files via glob, returns matches with file:line.
- `list-directory.ts`: lists directory entries and sizes.
- `bash.ts`: executes a shell command with timeout, truncates output, blocks a few very destructive patterns.

---

## 3) How the code flows / executes

### Startup
1. `src/index.ts` runs `main()`.
2. Detects project with `detectProject()`.
3. Registers tools + commands.
4. Determines provider (`detectProvider()` or `createProvider()`).
5. Builds system prompt (`generateSystemPrompt(projectInfo, useTools)`).
6. Instantiates `Agent` with provider, registry, callbacks.
7. Starts readline prompt loop.

### Each user turn (in the CLI loop)
- If built-in command:
  - `/exit` ends process
  - `/clear` clears agent history
  - `/compact` calls `agent.forceCompact()` to summarize history
  - `/status` shows token estimate + message count
  - `/context` prints detected project context
- Else if slash command:
  1) parse `/command args`
  2) lookup command in registry
  3) execute command → returns a *prompt string*
  4) clear agent history (so slash commands “start fresh”)
  5) send that prompt to `agent.chat(...)`
- Else normal chat:
  - sends raw input to `agent.chat(...)`

### Inside `Agent.chat(...)` (agentic loop)
1. Append user message to `this.messages`.
2. Potentially compact context if token estimate exceeds threshold.
3. Repeat up to `MAX_ITERATIONS`:
   - Compute tool definitions if tools enabled and provider supports tool use.
   - Build `systemContext` = system prompt + optional conversation summary.
   - Call provider `streamChat(messages, tools, onText, systemContext)`.
   - If provider didn’t return toolCalls but tools enabled, try to extract JSON tool calls from the returned text.
   - Store assistant output into history (either as plain text or structured blocks depending on whether tool calls are “native” or “extracted”).
   - If no tool calls → finish.
   - Else:
     - Execute each tool via `toolRegistry.execute(toolCall)` and emit callbacks.
     - Track consecutive tool errors; stop after too many failures.
     - Add tool results back into conversation:
       - For native tool calls: as `tool_result` blocks + an extra “continue” text block
       - For extracted tool calls: append a user message containing formatted tool results text + “continue…” instruction
4. Return final assistant text.

---

## 4) Notable patterns / techniques used

- **Provider abstraction + factory pattern**: `BaseProvider` + `createProvider()`/`detectProvider()` makes it easy to add new backends.
- **Tool registry pattern**: decouples tools from agent/provider; tools are self-describing (schema) and runnable.
- **Agentic tool loop with safety limits**:
  - `MAX_ITERATIONS` to prevent infinite loops
  - `MAX_CONSECUTIVE_ERRORS` to stop on repeated tool failures
- **Context compaction via summarization**:
  - estimates tokens (cheap heuristic) and asks the model to summarize older conversation
  - preserves recent messages verbatim
- **Cross-provider message normalization**:
  - The internal message format supports both string content and structured tool blocks
  - Each provider translates to/from its API shape (Anthropic block-based vs OpenAI tool_calls + tool role messages)
- **Fallback tool-call extraction from text**:
  - Useful for models that don’t implement native tool calling and instead emit JSON blobs
  - Includes a small JSON “repair” helper for common quoting issues
- **Streaming-first UX**:
  - Provider `streamChat` is used so text appears incrementally in CLI
  - Optional “reasoning trace” callback supported for models exposing it
- **CLI UX touches**:
  - readline history persisted to `~/.codi_history`
  - colored output, tool call previews, per-response timing
- **Safety guardrails in `bash` tool**:
  - blocks a small set of extremely destructive patterns
  - uses timeout + output truncation to avoid hanging or flooding the terminal
