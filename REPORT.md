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

## Key Finding: File Access Limitation

**All providers failed to actually read the source code.** Every model responded with variations of:
- "I can't see your repo"
- "I don't have direct access to your local file system"
- "Please paste the code"

This is a **critical limitation** of the current pipeline design - the models receive only the glob pattern `src/**` as text input, not the actual file contents.

### Recommendation
The pipeline needs to be enhanced to:
1. Resolve glob patterns to actual file paths
2. Read file contents before passing to the pipeline
3. Or integrate with tools that can read files during pipeline execution

---

## Provider Comparison

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

### 1. No File Content Resolution
The pipeline passes `src/**` as literal text, not resolved file contents.

**Fix:** Add a pre-processing step to resolve globs and read files:
```yaml
pipelines:
  code-review:
    pre-process:
      - resolve-glob: true
      - read-files: true
      - max-chars: 50000
```

### 2. Role Resolution Inconsistency
The `capable` role was used for suggestions in one run, but `reasoning` was used for deep-analysis. This inconsistency affects output quality.

**Current mapping observed:**
```
ollama-cloud run 1: fast→gemini, capable→coder
ollama-cloud run 2: fast→gemini, reasoning→gpt-oss, capable→coder
openai: fast→gpt-5-nano, capable→gpt-5, reasoning→gpt-5
```

### 3. Context Window Limitations
Long pipeline outputs may exceed context windows for subsequent steps, causing information loss.

---

## Recommendations

### Immediate Actions
1. **Fix file reading:** Modify pipeline to actually read source files before analysis
2. **Standardize roles:** Ensure consistent role usage across pipeline steps
3. **Add context:** Include project type (TypeScript) in the prompt automatically

### Future Enhancements
1. **Chunked analysis:** For large codebases, analyze files in batches
2. **Caching:** Cache file contents to avoid re-reading
3. **Tool integration:** Allow models to call `read_file` tool during pipeline
4. **Output formatting:** Standardize output format across providers

---

## Conclusion

The model roles feature successfully routes to different models per provider, but the **pipeline's effectiveness is limited by not providing actual code to analyze**.

**OpenAI models** produced more actionable, concise output suited for experienced developers.
**Ollama Cloud models** produced more educational, comprehensive output suited for learning.

The next priority should be enhancing the pipeline to resolve file globs and provide actual source code content to the models for meaningful code review.

---

*Report generated from pipeline runs on January 11, 2025*
