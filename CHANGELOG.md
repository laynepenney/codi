# Changelog

All notable changes to Codi are documented in this file.

## [0.17.0] - 2026-01-26

### Breaking Changes

- **Ollama Cloud Provider Removed**: The `ollama-cloud` provider has been removed. Use `--provider ollama` with `OLLAMA_HOST=https://ollama.com` instead. The regular `ollama` provider uses the OpenAI-compatible API which works correctly with Ollama Cloud.

- **Web Search Tool Migration**: Replaced `WebSearchTool` with `EnhancedWebSearchTool`
  - Tool name remains `web_search` for backward compatibility
  - Supports Brave API (primary), Google Custom Search, Bing API, and DuckDuckGo fallback

### Features

- **Workflow System Phase 8 - Production Ready** (#173):
  - AI-assisted workflow building with natural language
  - Multi-step pipelines with variable substitution
  - Git and PR action steps (commit, push, create-pr, review-pr)
  - Comprehensive test coverage (E2E and unit tests)
  - Template system for common workflow patterns

- **Context Debug Command** (#179):
  - New `/compact debug` subcommand for inspecting context window state
  - View message counts and token estimates
  - Analyze working set and indexed files
  - Debug context compaction behavior

- **Enhanced Web Search - Phase 2** (#165, #170):
  - Multi-engine support with automatic fallback
  - Search templates for docs, pricing, and error queries
  - Relevance scoring algorithm (domain, content match, quality)
  - Per-engine rate limiting with graceful degradation
  - Template-aware caching TTLs

- **Memory Monitoring** (#167):
  - Proactive context compaction based on memory pressure
  - Automatic cleanup when approaching limits

- **Symbol Index Multi-Language Extension** (#172):
  - Improved symbol extraction across languages
  - Better TypeScript/JavaScript support

### Improvements

- **Technical Debt Cleanup** (#181):
  - Extracted ~400 lines from `index.ts` into `src/cli/` modules
  - Added discriminated union types for workflow steps
  - Added 9 type guards for type-safe step handling
  - Reduced `as any` usage from 30+ to 10 instances

- **Debug Logging for Error Handlers** (#185):
  - Added `logger.debug()` calls to 20 previously silent catch blocks
  - Enables troubleshooting with `--debug` flag
  - Files: memory.ts, session.ts, history.ts, usage.ts, agent.ts, diff.ts, spinner.ts

- **Plugin System Investigation** (#181):
  - Created comprehensive `docs/PLUGIN-INVESTIGATION.md`
  - Security analysis and recommendations
  - Phased re-enablement roadmap

### Bug Fixes

- **UI Freeze During Compaction** (#174): Fixed UI becoming unresponsive during context compaction
- **Workflow E2E Tests** (#180): Resolved flaky PR review tests with improved mock agent
- **Model Display Updates** (#175): Fixed model display not updating when provider changes during workflow
- **IPC Disconnect Race** (#164): Graceful IPC disconnect prevents race condition in orchestration
- **Ink UI Stability** (#163): Added tool call display and improved visual stability

### Tests

- 2151 tests passing
- Added workflow E2E tests for PR review workflow
- Added rate limiting tests for enhanced web search
- Improved test stability with buffer flush helpers

## [0.13.0] - 2026-01-18

### Features

- **GitHub Pages Enhancement**: Complete redesign of documentation site
  - Added demo GIF with terminal window styling and animated gradient border
  - Added badges for version, license, Node requirement, and default model
  - Added Tools section showing all 12 built-in tools
  - Added Usage & Models command section
  - Visual improvements: animations, glow effects, smooth scrolling
  - Open Graph meta tags for better social sharing
  - Improved mobile responsiveness

- **Default Ollama Model**: Changed default from `llama3.2` to `glm-4.7:cloud`
  - Applies to both local Ollama and Ollama Cloud providers

### Configuration

- **Updated codi-models.yaml** with current defaults:
  - Opus updated to `claude-opus-4-5-20251101`
  - Added `gpt-5` and `gpt-5-nano` for OpenAI
  - Renamed `llama3` to `glm` using `glm-4.7:cloud`
  - Fallback chain now prioritizes opus → sonnet → haiku → gpt-5 → glm

## [0.12.0] - 2026-01-18

### Features

- **Claude Opus 4.5 as Default**: Changed default Anthropic model from Claude Sonnet 4 to Claude Opus 4.5 (`claude-opus-4-5-20251101`)
  - Added Opus 4.5 pricing to usage tracking ($15/$75 per 1M tokens)
  - Added Opus 4.5 to static model registry

## [0.11.0] - 2026-01-18

### Documentation

- **Development Process**: Updated CODI.md to require tests before merging PRs
  - AI agents must run `pnpm build && pnpm test` before merging
  - Added self-review template with build/test status
  - Ensures code quality and prevents regressions

### Bug Fixes

- Fixed `getAllCommands()` function call in index.ts
- Fixed `IndexErrorCallback` to expect Error objects instead of strings

## [0.10.0] - 2026-01-18

### Features

- **Dynamic Context Configuration**: Tier-based context settings
- **README Accuracy Update**: Comprehensive documentation review
  - Added 8 missing CLI options
  - Documented /init command
  - Added missing command sections (Usage, Planning, RAG, Approvals)
  - Expanded .codi.json example with all config options

## [0.9.1] - 2026-01-18

### Bug Fixes

- **JSON Parser**: Fixed tool call parsing for models that output raw newlines in JSON strings
  - Models like glm-4.7 via Ollama Cloud can now correctly parse multiline commands
  - Added `escapeNewlinesInStrings()` preprocessing before JSON parsing

- **Bracketed Paste**: Rewritten paste handling to capture and display summary
  - Now shows `[pasted N lines, M chars]` like Claude Code

- **Documentation**: Fixed README and CODI.md discrepancies
  - Added `ollama-cloud` to CLI provider options
  - Updated OpenAI models to include GPT-5

## [0.9.0] - 2026-01-17

### Command Consolidation

Commands are now organized under `/git` and `/code` prefixes for better discoverability:

**Git Commands** → `/git <action>`
- `/git commit`, `/git branch`, `/git diff`, `/git pr`, `/git stash`
- `/git log`, `/git status`, `/git undo`, `/git merge`, `/git rebase`

**Code Commands** → `/code <action>`
- `/code refactor`, `/code fix`, `/code test`, `/code doc`, `/code optimize`

**Backward Compatibility**: Popular commands still work as standalone aliases:
- `/commit`, `/branch`, `/pr` (git)
- `/refactor`, `/fix`, `/test` (code)

### Documentation

- Added CODI.md as the main documentation file (CLAUDE.md symlinked for AI compatibility)
- Added ollama-cloud provider to docs and README
- Synced all commands between README and GitHub Pages site
- Added demo GIF to README

### Other Changes

- Updated branding to "AI coding wingman"
- Set up GitHub Pages documentation site

## [0.8.6] - 2026-01-17

### Bug Fixes

- **Fixed arrow key navigation** - Resolved issue where arrow keys showed escape sequences (`^[[A`) after commands completed. Root cause was ora spinner's `discardStdin` setting interfering with readline.

### Improvements

- **Added spinner for `/compact` command** - Visual feedback while context compaction runs

### Documentation

- **Added git worktree documentation** - CLAUDE.md now includes guidance for working with multiple worktrees

### Removed

- **Removed interactive command picker** - Feature was causing terminal handling conflicts; may revisit in future

## [0.8.4] - 2026-01-16

### New `/codi` Command

Generate comprehensive AI context files automatically:

```bash
/codi generate   # Analyze codebase and create CODI.md
/codi show       # Display current context file
/codi edit       # Get AI help to improve it
```

### Auto-Generated CODI.md Includes

- Project type, language, and framework detection
- Directory structure (2 levels)
- Package.json scripts as quick reference
- Key files with purposes
- Top dependencies with descriptions
- Test framework detection
- Coding conventions based on language

### Updated `/init` Command

```bash
/init              # Now creates .codi.json, codi-models.yaml, AND CODI.md
/init --context    # Create only CODI.md template
```

### Test Reliability

- Added retry for flaky e2e tests
- Disabled file parallelism to avoid resource contention
- Increased default test timeout

### Other Improvements

- Bun lockfile detection for package manager
- Improved pytest detection (checks pyproject.toml content)
- Performance: cached stat results in directory walk

## [0.8.3] - 2026-01-16

### Adaptive Context Window Calculation

Replace fixed 40% context allocation with adaptive calculation that maximizes available context:

| Model | Context Window | Old Limit (40%) | New Adaptive Limit |
|-------|---------------|-----------------|-------------------|
| Claude (200k) | 200,000 | 80,000 | ~189,000 |
| GPT-4o (128k) | 128,000 | 51,200 | ~117,000 |
| GPT-4 base (8k) | 8,192 | 3,276 | 2,457 (30% floor) |

**Formula:** `contextWindow - systemPrompt - tools - outputReserve - buffer`

- Falls back to 30% minimum when overhead exceeds available space
- Warns when message budget is below 5k tokens
- New constants: `MAX_OUTPUT_TOKENS`, `CONTEXT_SAFETY_BUFFER`, `MIN_CONTEXT_PERCENT`, `MIN_VIABLE_CONTEXT`

### Documentation

- Added Git Workflow guidelines to CLAUDE.md and CONTRIBUTING.md
- Established branch/PR workflow (never push directly to main)

## [0.8.2] - 2026-01-16

### Token Estimation Improvements

- **Content-aware estimation**: Different ratios for prose (~4 chars/token), code (~3), and JSON (~3.5)
- **Complete context accounting**: System prompt and tool definitions now included in token counts
- **Calibration from API responses**: Exponential moving average improves accuracy over time

### New `/compact` Command

- Proper slash command (converted from built-in handler)
- Alias: `/summarize`
- Shows before/after token counts

### Code Detection Optimizations

- Pre-compiled combined regex for single-pass matching
- Minimum length guard (15 chars) skips short text
- More specific patterns reduce false positives

## [0.8.1] - 2026-01-16

### Bug Fixes

- **Tool parsing**: Fixed nested parentheses in quoted strings (e.g., `response.cookies.get('token')`) being truncated
- **Tool extraction**: Fixed tool calls not being detected when model sends all content via "thinking" field

The regex-based tool extraction `[^)]*` stopped at the first `)` even inside quoted strings. Replaced with a state machine that properly tracks string context and escape sequences.

## [0.8.0] - 2026-01-16

### Dynamic Context Window

- Context limit now adapts to the model being used (40% of model's context window)
  - Claude 200k → 80k threshold
  - GPT-4o 128k → 51k threshold
  - GPT-4 base 8k → 3.2k threshold
- Context limit automatically recalculates when switching providers mid-session

### Compression Improvements

- **Disabled by default** - was confusing models that output E1/E2 symbols
- Enable with `--compress` flag when needed
- Only applies compression if it actually saves space (including legend overhead)
- Output is now decompressed so you never see raw entity references

### RAG-Enhanced Compaction

- **Code relevance scoring** - messages discussing indexed files get higher importance during compaction
- **File context in summaries** - extracted file paths included in summarization prompts
- **Semantic deduplication** - similar messages grouped together using embeddings (when RAG enabled)

### Code Quality

- Vector utilities extracted to `src/utils/vector.ts` for reusability
- Fixed model matching to prevent "gpt-4" incorrectly matching "gpt-4o"
- Static imports for better performance

---

For earlier versions, see the [GitHub Releases](https://github.com/laynepenney/codi/releases) page.
