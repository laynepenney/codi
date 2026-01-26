# Changelog

All notable changes to Codi are documented in this file.

## [0.17.0] - 2026-01-26

### Breaking Changes

- **Web Search Tool Migration**: Replaced `WebSearchTool` with `EnhancedWebSearchTool`
  - Old `src/tools/web-search.ts` has been removed
  - New enhanced version provides multi-engine support, caching, and advanced features
  - Tool name remains `web_search` for backward compatibility
  - Supports Brave API (primary), Google Custom Search, Bing API, and DuckDuckGo fallback
  - Note: Configuration options may have changed - see documentation for details

### Features

- **Enhanced Web Search - Phase 2**:
  - **Search Templates System**: Domain-specific optimization for docs, pricing, and errors
    - `docs` template: Site filtering (StackOverflow, MDN, Python docs) + syntax/example keywords
    - `pricing` template: Site filtering (OpenAI, Anthropic) + pricing/cost/rate keywords
    - `errors` template: Site filtering (StackOverflow, GitHub) + error/fix/solution keywords
    - Template-aware TTL: docs 24h, pricing 7d, errors 12h, general 1h

  - **Domain-Specific Processing**:
    - Relevance scoring algorithm (0-1 scale) based on domain, content match, quality
    - URL-based scoring: StackOverflow (+0.3), GitHub (+0.2), official domains (+0.1)
    - Content matching: Query presence in title/snippet detection with weighted bonuses
    - Quality indicators: Educational/problem-solving content recognition
    - Results sorted by calculated relevance score

  - **Rate Limiting**:
    - Per-engine rate limiting: 5 requests/minute per engine
    - Graceful fallback to next engine when rate limited
    - Automatic reset after 60 seconds

  - **Enhanced Output**:
    - Score-based sorting for better result relevance
    - Score display for high-confidence results (score > 0.7)

- **Code Quality Improvements**:
  - Extracted magic numbers to named constants (RELEVANCE_SCORES, RATE_LIMITS)
  - Removed unused `sort` property from template configuration
  - Improved maintainability for configuration tuning

### Tests

- Added rate limiting tests:
  - `should enforce rate limiting for engines`
  - `should reset rate limits after time period`
- Total test coverage: 8/8 tests passing for enhanced web search

### Bug Fixes

- Removed legacy `WebSearchTool` (was replaced by `EnhancedWebSearchTool`)
- Removed legacy `web-search.test.ts` test file

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
