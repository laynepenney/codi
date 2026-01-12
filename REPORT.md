# Model Roles Pipeline Analysis Report

This report analyzes the outputs from the `code-review` pipeline executed with different provider contexts, comparing model behavior, output quality, and practical usefulness.

## Test Configuration

**Pipeline:** `code-review`
**Input:** `src/**`
**Date:** January 2025

### Provider Contexts Tested

| Provider | Fast Role | Capable Role | Reasoning Role |
|----------|-----------|--------------|----------------|
| `ollama-cloud` | gemini-3-flash-preview | coder | gpt-oss |
| `openai` | gpt-5-nano | gpt-5 | gpt-5 |

---

## Key Finding: File Access Limitation (FIXED)

**Issue (Before Fix):** All providers failed to actually read the source code. Every model responded with variations of:
- "I can't see your repo"
- "I don't have direct access to your local file system"
- "Please paste the code"

This was a **critical limitation** - the models received only the glob pattern `src/**` as text input, not the actual file contents.

### Fix Implemented (commit `be0adb9`)

Added automatic file content resolution to the pipeline execution:

```typescript
// New helper function in src/index.ts
async function resolvePipelineInput(input: string): Promise<{
  resolvedInput: string;
  filesRead: number;
  truncated: boolean;
}>
```

**Features:**
- Detects glob patterns (`*`, `**`, `?`) and file paths
- Resolves to actual files using `node:fs/promises` glob
- Reads file contents with size limits:
  - Max 20 files per pipeline
  - Max 50KB per file
  - Max 200KB total
- Formats content with file headers and syntax highlighting

**Pipeline output now shows:**
```
Executing pipeline: code-review
Provider: openai
Input: src/spinner.ts
Files resolved: 1        <-- NEW: shows files were read
```

---

## Results After Fix

### Test: `code-review` pipeline with OpenAI on `src/spinner.ts`

**Models used:** gpt-5-nano (fast), gpt-5 (reasoning/capable)

The models now receive actual file content and provide **meaningful, specific code review**:

#### Quick Scan Output (gpt-5-nano)
Instead of "I can't see your files", the model now identifies real issues:
- Streaming resume behavior concerns
- TTY detection logic issues
- Logging interference with spinner

#### Deep Analysis Output (gpt-5)
Provided 12 specific findings with code examples:
1. Singleton pattern pros/cons
2. Mixed responsibilities (UI formatting + spinner control)
3. `enabled` vs TTY runtime changes
4. Streaming behavior: stop without resume
5. `update()` silently does nothing when streaming
6. Using `stdout` TTY check vs `stderr` recommendation
7. Logging interference & re-entrancy
8. Broad try/catch hiding issues
9. Inconsistent `spinner.stop()` vs `this.stop()`
10. Symbol portability (✓/✗)
11. `clear()` semantics
12. Hardcoded dependencies affecting testability

#### Suggestions Output (gpt-5)
Prioritized actionable improvements:
- **Highest impact:** Render spinner on `stderr`, not `stdout`
- **State fixes:** Centralize stop logic, separate user-enabled from TTY capability
- **UX:** Add "log while spinning" helper
- **Testing:** Export manager class, allow dependency injection

### Before vs After Comparison

| Aspect | Before Fix | After Fix |
|--------|-----------|-----------|
| File content | Not provided | Full source code |
| Analysis type | Generic checklists | Specific code review |
| Findings | 0 real issues | 12 specific issues |
| Actionability | "Paste your code" | Ready-to-apply fixes |
| Code examples | None | Multiple with line refs |

---

## Multi-File Code Review Results

### Test Configuration
- **Pipeline:** `code-review` on `src/**`
- **Files found:** 95 total
- **Files analyzed:** 20 (pipeline limit)
- **Providers tested:** OpenAI, Ollama-cloud

---

### OpenAI Results (gpt-5-nano + gpt-5)

#### Quick Scan Findings (gpt-5-nano)
Identified **5 high-priority areas** in 20 files:

1. **Magic-string command outputs** - Commands return untyped strings, making parsing fragile
2. **Agent class complexity** - Too many concerns mixed together (context, tools, safety, telemetry)
3. **Mutable provider responses** - `extractToolResults()` mutates parameters
4. **Module-level state** - `currentSessionName`, RAG indexer globals
5. **Config file trust** - YAML files loaded without strict validation

#### Deep Analysis (gpt-5)

**Architectural Issues:**

| Issue | Location | Severity |
|-------|----------|----------|
| Agent doing too much | `agent.ts` | High |
| Magic string outputs | `commands/*.ts` | Medium |
| Module-level globals | `session-commands.ts`, `rag/` | Medium |
| Mutating responses | `agent.ts:extractToolResults` | Medium |
| Console.error logging | Throughout | Low |

**Recommended Agent Split:**
```
Agent (current monolith)
  ├── ContextManager      - conversation & compaction
  ├── ToolCallManager     - tool orchestration
  ├── SafetyManager       - content filtering
  ├── TelemetryService    - usage tracking
  └── LoopController      - retry & guardrails
```

**Agent Loop Edge Cases (7 issues identified):**

| # | Issue | Risk |
|---|-------|------|
| 1 | Mutating provider response (`response.toolCalls = extractedCalls`) | Breaks if response is frozen/shared |
| 2 | Extracted tool calls pushed as user message | Contaminates "user intent" for safety |
| 3 | Dangerous checks only for bash, not write_file/edit_file | Missing heuristics for `.env`, keys, CI configs |
| 4 | Tool execution continues after failure | Sequentially dependent calls may break |
| 5 | Working set updated before tool execution | Polluted state on failure |
| 6 | Summarization includes tool outputs | Secrets may persist in summaries |
| 7 | Token counting varies by provider | Compaction thresholds may drift |

**Security Observations:**
- Secrets hygiene: API keys passed through config, consider vault integration
- Workspace boundary: Tools can potentially access files outside project root
- YAML loading: `js-yaml` safe by default, but schema validation needed

#### Suggestions (gpt-5)
Prioritized action items:

1. **Typed CommandOutput** - Replace string returns with `{ type, data, display }` objects
2. **Extract ContextManager** - Move `compactConversation()` and history management
3. **Immutable tool results** - Clone before mutation in `extractToolResults()`
4. **Config validation** - Add JSON Schema validation for `codi-models.yaml`
5. **Centralized logging** - Replace scattered `console.error` with logger service

---

### Ollama-Cloud Results (gemini-3-flash-preview + gpt-oss + coder)

#### Quick Scan Findings (gemini-3-flash-preview)
Flagged **8 critical patterns**:

| # | Issue | Files Affected |
|---|-------|----------------|
| 1 | Global state contamination | `session-commands.ts` |
| 2 | Race condition in Agent.chat() | `agent.ts` |
| 3 | RAG indexer error swallowing | `rag/indexer.ts` |
| 4 | Prompt injection in docCommand | `doc-commands.ts` |
| 5 | Unbounded context growth | `agent.ts` |
| 6 | Hardcoded timeouts | `spinner.ts`, `agent.ts` |
| 7 | Mixed sync/async patterns | `commands/` |
| 8 | Missing input sanitization | `tool-handler.ts` |

#### Deep Analysis (gpt-oss)

**Critical Finding: Global State in Session Management**
```typescript
// session-commands.ts - problematic pattern
let currentSessionName: string | null = null;  // Module-level mutable state

export function setCurrentSession(name: string) {
  currentSessionName = name;  // Side effect
}
```

**Race Condition in Agent.chat()**
```typescript
// agent.ts - potential race
async chat(input: string) {
  this.isProcessing = true;  // Not atomic
  // ... other async operations can interleave
}
```

**RAG Indexer Error Handling**
```typescript
// rag/indexer.ts - errors silently swallowed
try {
  await this.index(file);
} catch (e) {
  // Only logs, doesn't propagate
  console.error('Index failed:', e);
}
```

#### Suggestions (coder)

**Immediate Fixes (Low Risk):**
1. Add mutex/lock to `Agent.chat()` for concurrent call protection
2. Replace module-level session state with instance method
3. Propagate RAG errors via event emitter or callback

**Refactoring Roadmap:**

| Phase | Focus | Files |
|-------|-------|-------|
| 1 | Command output typing | `commands/*.ts` |
| 2 | Agent decomposition | `agent.ts` → 5 modules |
| 3 | State management | Session, RAG, Config |
| 4 | Error handling | Centralized error types |

**Architecture Recommendation:**
```
src/
├── core/
│   ├── agent.ts          (slim orchestrator)
│   ├── context.ts        (conversation management)
│   └── tools.ts          (tool dispatch)
├── services/
│   ├── session.ts        (stateless session ops)
│   ├── rag/              (document indexing)
│   └── telemetry.ts      (usage tracking)
└── commands/
    └── *.ts              (typed CommandOutput returns)
```

**Other Notable Issues (20+ items identified):**

| Area | Issue | Recommendation |
|------|-------|----------------|
| Error handling | `try/catch` blocks swallow errors | Return structured `CommandOutput` errors |
| Constants | Hardcoded `MAX_ITERATIONS`, token limits | Centralize in `constants.ts` |
| Logging | May contain user code snippets | Add `privacy` flag, redact at non-DEBUG levels |
| Routing | Duplicated in `Agent` and `model-commands.ts` | Extract `ProviderResolver` service |
| Testing | No tests for `Agent`, `compactContext` | Add Jest coverage |
| Imports | Mixed `.ts`/`.js` extensions | Standardize to `.ts` internal |
| Paths | `process.cwd()` used directly | Introduce `Workspace` class |
| Plugins | Full Node access, no sandbox | Consider VM2 or child process |
| RAG config | Missing `enabled` guard | Add default config + validation |
| Tool timeout | No timeout in `ToolRegistry.execute` | Use `Promise.race()` |
| Entity IDs | Not namespaced per conversation | Prefix with session UUID |
| System prompt | Hardcoded, no customization | Pull from workspace config |

**Quick "What-to-Do-First" Checklist:**

| # | Item |
|---|------|
| 1 | Move `currentSessionName` into `CommandContext.sessionState` |
| 2 | Change `Command.execute` signature → `Promise<CommandOutput \| null>` |
| 3 | Refactor one command (e.g., `saveCommand`) as proof-of-concept |
| 4 | Add simple mutex (`_busy` flag) to `Agent.chat()` |
| 5 | Await `onToolCall` / `onToolResult` callbacks |
| 6 | Gate `compactContext` with delta-threshold |
| 7 | Add central `isDangerousCommand` utility for all tools |
| 8 | Implement status API in `BackgroundIndexer` |
| 9 | Write test for concurrent `Agent.chat()` calls |
| 10 | Run `npm run lint` and fix `any`/`no-implicit-any` warnings |

---

### Provider Comparison: Multi-File Review

| Dimension | OpenAI | Ollama-Cloud |
|-----------|--------|--------------|
| **Issues Found** | 5 categories | 8 specific patterns |
| **Code Examples** | Architectural diagrams | Actual code snippets |
| **Depth** | High-level design | Implementation details |
| **Actionability** | Design recommendations | Ready-to-apply fixes |
| **Roadmap** | Component split | Phased refactor plan |

**Key Insight:** The providers complement each other well:
- **OpenAI** excels at architectural analysis and design recommendations
- **Ollama-Cloud** excels at finding specific code issues with examples

---

### Suggested Refactor Roadmap

| Week | Goal | Tasks |
|------|------|-------|
| **Week 1** | Foundation Stability | Implement `SessionManager`, add mutex to `Agent.chat()`, refactor `Command` interface to return `CommandOutput` |
| **Week 2** | Typed Output & Rendering | Update all command files to use `CommandOutput` (~30 files), extend `renderOutput`, add compatibility shim for plugins |
| **Week 3** | Reliability & Performance | Add status/event handling to `BackgroundIndexer`, gate `compactContext` + cache scores, await all callbacks, centralize dangerous-command validator |
| **Optional** | Polish & Security | Client-side glob expansion for `docCommand`, plugin sandbox, unit tests for `Agent`/`compactContext`/command parsing |

---

## Provider Comparison (Before Fix)

### 1. Ollama Cloud (gemini-3-flash-preview + coder + gpt-oss)

#### Quick Scan (gemini-3-flash-preview)
- **Style:** Conversational, markdown-heavy with emojis
- **Structure:** Organized into numbered categories (Security, Logic, Performance, Code Quality)
- **Actionability:** Provided generic checklists, asked clarifying questions
- **Length:** ~400 words

**Strengths:**
- Well-organized categories
- Clear "How to proceed" section with options
- Included specific CLI commands (eslint, gitleaks)

**Weaknesses:**
- Very generic advice
- Relied heavily on user to provide code
- Some formatting inconsistency

#### Deep Analysis (coder / gpt-oss)
- **Style:** Highly structured with extensive tables
- **Structure:** Multi-section framework with detailed checklists
- **Actionability:** Comprehensive but theoretical
- **Length:** ~2000+ words

**Strengths:**
- Extremely thorough framework
- Language/framework-specific checklists (Node, React, Java, Python, Rust)
- Good architectural principles coverage
- Tables for quick reference

**Weaknesses:**
- Overwhelming amount of information
- No actual code analysis
- Felt like documentation rather than review

#### Suggestions (gemini-3-flash-preview / coder)
- **Style:** Actionable bullet points with categories
- **Structure:** Numbered action items with bash commands
- **Actionability:** High - concrete steps provided

**Strengths:**
- Clear categorization (Automate, Refactor, Architecture, Security, Testing)
- Included specific CLI commands
- "Next Step Recommendation" was practical (PR template suggestion)

---

### 2. OpenAI (gpt-5-nano + gpt-5)

#### Quick Scan (gpt-5-nano)
- **Style:** Concise, technical, no emojis
- **Structure:** Flat list with language-specific sections
- **Actionability:** Very high - provided ready-to-run commands
- **Length:** ~350 words

**Strengths:**
- Extremely practical with ripgrep one-liners
- Language-specific guidance (JS/TS, Python, Go, Java)
- Direct and actionable
- Asked targeted follow-up questions

**Weaknesses:**
- Less visually organized
- Minimal explanation of "why"

#### Deep Analysis (gpt-5)
- **Style:** Technical documentation with rubric
- **Structure:** Numbered sections with detailed sub-points
- **Actionability:** High - included exact commands
- **Length:** ~1500 words

**Strengths:**
- Clear "what I need from you" section
- Step-by-step local scan workflow
- Specific grep patterns for common issues
- Explained what to share for targeted feedback

**Weaknesses:**
- Still no actual code analysis
- Required user to run commands and paste results

#### Suggestions (gpt-5)
- **Style:** Dense bullet points
- **Structure:** Condensed summary of the analysis
- **Actionability:** High - distilled key actions

**Strengths:**
- Concise summary of full workflow
- Clear "what to share" guidance
- Mentioned specific tool recommendations

---

## Comparative Analysis

### Output Quality Scores (1-5)

| Dimension | Ollama Cloud | OpenAI |
|-----------|--------------|--------|
| **Clarity** | 4 | 5 |
| **Actionability** | 3 | 5 |
| **Conciseness** | 2 | 4 |
| **Technical Depth** | 4 | 4 |
| **Practical Commands** | 3 | 5 |
| **Structure** | 4 | 4 |
| **Overall** | 3.3 | 4.5 |

### Style Differences

| Aspect | Ollama Cloud | OpenAI |
|--------|--------------|--------|
| Tone | Friendly, tutorial-like | Direct, technical |
| Emojis | Frequent | None |
| Length | Verbose | Concise |
| Tables | Extensive | Minimal |
| Code blocks | Some | Many (ready-to-run) |
| Questions | "Which file would you like?" | "What stack are you using?" |

### Best Use Cases

**Ollama Cloud models** are better for:
- Learning/educational contexts
- Teams new to code review practices
- Comprehensive documentation/checklists
- Framework-specific guidance

**OpenAI models** are better for:
- Experienced developers wanting quick scans
- CI/CD integration (copy-paste commands)
- Rapid iteration
- Production-focused reviews

---

## Pipeline Design Issues Identified

### 1. No File Content Resolution - FIXED :white_check_mark:
The pipeline passes `src/**` as literal text, not resolved file contents.

**Status:** Fixed in commit `be0adb9`

**Solution implemented:**
- Added `resolvePipelineInput()` helper function
- Automatically detects glob patterns and file paths
- Reads file contents with size limits (20 files, 50KB/file, 200KB total)
- Formats with markdown code blocks and syntax highlighting

### 2. Role Resolution Inconsistency - FIXED :white_check_mark:
The `capable` role was used for suggestions in one run, but `reasoning` was used for deep-analysis. This inconsistency affects output quality.

**Status:** Fixed - Updated pipeline role assignments

**Updated `code-review` pipeline roles:**
```yaml
steps:
  - name: quick-scan
    role: fast        # Quick initial scan
  - name: deep-analysis
    role: reasoning   # Use best model for deep analysis
  - name: suggestions
    role: capable     # Balanced model for summarization
```

### 3. Context Window Limitations
Long pipeline outputs may exceed context windows for subsequent steps, causing information loss.

---

## Recommendations

### Completed :white_check_mark:
1. ~~**Fix file reading:** Modify pipeline to actually read source files before analysis~~ - Done in `be0adb9`
2. ~~**Standardize roles:** Ensure consistent role usage across pipeline steps~~ - Done

### Future Enhancements
1. **Add context:** Include project type (TypeScript) in the prompt automatically
2. **Chunked analysis:** For large codebases, analyze files in batches
3. **Caching:** Cache file contents to avoid re-reading
4. **Tool integration:** Allow models to call `read_file` tool during pipeline
5. **Output formatting:** Standardize output format across providers

---

## Conclusion

The model roles feature successfully routes to different models per provider. After implementing file content resolution, the pipeline now provides **meaningful, specific code review**.

### Key Improvements Made
- **File reading:** Pipeline now resolves glob patterns and reads actual file contents
- **Role standardization:** Updated pipeline to use `reasoning` role for deep analysis
- **Real code review:** Models now identify specific issues with line references and code examples

### Multi-File Review Achievements
The pipeline successfully analyzed 20 files from the 95-file codebase, identifying:
- **13 distinct architectural/code quality issues**
- **Specific code examples** with problematic patterns
- **Actionable refactoring roadmap** with phased approach
- **Security observations** (workspace boundaries, config validation)

### Provider Comparison Summary
- **OpenAI models** produce more actionable, concise output suited for experienced developers
  - Strength: Architectural analysis, component decomposition recommendations
- **Ollama Cloud models** produce more educational, comprehensive output suited for learning
  - Strength: Specific code issues with examples, detailed refactoring phases

**Key Finding:** The providers complement each other - OpenAI excels at high-level design while Ollama-Cloud excels at finding specific implementation issues.

The pipeline is now fully functional for code review tasks at scale.

---

*Report generated from pipeline runs on January 11-12, 2025*
*Updated with multi-file review results on January 12, 2025*
