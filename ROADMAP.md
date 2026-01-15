# Codi Roadmap

This document tracks planned features and improvements for Codi.

## Planned Features

### Test Sandbox Compatibility

Update tests that write to `~/.codi` or bind to `127.0.0.1` so they use local temporary
directories and ephemeral ports by default, avoiding sandbox permission errors.

---

### Semantic Fallback for Tool Calls

When a model attempts to call a tool that doesn't exist or uses incorrect parameter names, implement a semantic fallback system that:

1. **Tool Name Matching**: If a requested tool doesn't exist, find the closest matching tool by name similarity (e.g., `print_tree` -> `list_directory`, `search` -> `grep`)

2. **Parameter Mapping**: When a tool is called with unrecognized parameters, attempt to map them to the correct parameter names based on:
   - Common aliases (e.g., `query` -> `pattern`, `max_results` -> `head_limit`)
   - Semantic similarity (e.g., `search_term` -> `pattern`)
   - Parameter descriptions

3. **Graceful Degradation**: Instead of failing on invalid tool calls, provide helpful feedback to the model about what tools/parameters are available

This would help bridge the gap between different model training data and Codi's actual tool definitions, improving compatibility with various LLMs.

**Current Mitigations**:
- Added parameter aliases to `grep` tool (`query` -> `pattern`, `max_results`/`max`/`limit` -> `head_limit`)
- Added `print_tree` tool (commonly expected by models)

---

## Completed Features

See [CLAUDE.md](./CLAUDE.md) for documentation on implemented features.
