# Codi Tool Reference

This document provides a comprehensive reference for all tools available in Codi.

## File Reading with Offset Support

The `read_file` tool now supports reading from any line in a file:

```
read_file({ path: "src/index.ts", offset: 2230, max_lines: 40 })
```

**Parameters:**
- `path` (required): File path to read
- `offset` (optional): Line number to start from (1-indexed, default: 1)
- `max_lines` (optional): Maximum lines to read

**Example output:**
```
2230:     }
2231:   }
2232:   console.log();
...
... (showing lines 2230-2269 of 3259 total)
```

---

## Default Tools (12 tools)

### read_file
Read the contents of a file from the filesystem. Returns the file content as text with line numbers.

**Parameters:**
- `path` (required): The path to the file to read (relative or absolute)
- `offset` (optional): Line number to start reading from (1-indexed, default: 1)
- `max_lines` (optional): Maximum number of lines to read (optional, defaults to all)

### write_file
Write content to a file. Creates the file if it does not exist, or overwrites it if it does. Parent directories are created automatically.

**Parameters:**
- `path` (required): The path to the file to write (relative or absolute)
- `content` (required): The content to write to the file

### edit_file
Make a targeted edit to a file by replacing a specific string with new content. More precise than rewriting the entire file. The old_string must match exactly (including whitespace and indentation).

**Parameters:**
- `path` (required): Path to the file to edit
- `old_string` (required): The exact string to find and replace (must match exactly)
- `new_string` (required): The string to replace it with
- `replace_all` (optional): Replace all occurrences (default: false, only replaces first occurrence)

### insert_line
Insert text at a specific line number. Line numbers start at 1. The new content is inserted BEFORE the specified line.

**Parameters:**
- `path` (required): Path to the file
- `line` (required): Line number to insert BEFORE (1-indexed). Use 1 to insert at the start of the file.
- `content` (required): The text to insert (will be followed by a newline)

### patch_file
Apply a unified diff patch to a file. Useful for making multiple changes at once.

**Parameters:**
- `path` (required): Path to the file to patch
- `patch` (required): The unified diff patch to apply

### glob
Find files matching a glob pattern.

**Parameters:**
- `pattern` (required): Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")
- `cwd` (optional): Directory to search in

### grep
Search for a pattern in file contents. Returns matching lines with file paths and line numbers.

**Parameters:**
- `pattern` (required): Search pattern (string or regex)
- `path` (optional): File or directory to search in
- `file_pattern` (optional): Glob pattern to filter files (e.g., "*.ts")
- `ignore_case` (optional): Case-insensitive search (default: false)

### list_directory
List files and directories in a given path.

**Parameters:**
- `path` (optional): Directory path to list
- `show_hidden` (optional): Include hidden files (default: false)

### bash
Execute a bash command in the current working directory.

**Parameters:**
- `command` (required): The bash command to execute
- `cwd` (optional): Working directory for the command

### analyze_image
Analyze an image file using vision capabilities. Supports JPEG, PNG, GIF, and WebP.

**Parameters:**
- `path` (required): Path to the image file
- `question` (optional): Specific question for the analysis

### run_tests
Run project tests. Auto-detects test runner.

**Parameters:**
- `command` (optional): Specific test command
- `filter` (optional): Filter tests by name or pattern
- `timeout` (optional): Timeout in seconds (default: 60)

### web_search
Search the web for current information.

**Parameters:**
- `query` (required): The search query
- `num_results` (optional): Number of results (1-10, default: 5)

---

## Symbol Index Tools (6 tools)

> **Important:** These tools require running `/symbols rebuild` first to build the index.

### find_symbol
Find symbol definitions by name across the codebase.

**Parameters:**
- `name` (required): Symbol name (supports partial matching)
- `kind` (optional): Filter by kind (function, class, interface, type, enum, variable, constant, method, property)
- `exact` (optional): Require exact match (default: false)
- `exported_only` (optional): Only exported symbols (default: false)
- `max_results` (optional): Max results (default: 10)

### find_references
Find all files that reference, import, or use a symbol.

**Parameters:**
- `name` (required): Symbol name to find references for
- `file` (optional): File where symbol is defined (helps disambiguate)
- `include_imports` (optional): Include import statements (default: true)
- `include_callsites` (optional): Include callsites (default: true)
- `max_results` (optional): Max results (default: 20)

### goto_definition
Navigate to the definition of a symbol.

**Parameters:**
- `name` (required): Symbol name
- `from_file` (optional): File where symbol is used
- `resolve_reexports` (optional): Follow re-exports (default: true)

### get_dependency_graph
Show the dependency graph for a file.

**Parameters:**
- `file` (required): File path to analyze
- `direction` (optional): "imports", "importedBy", or "both" (default: both)
- `depth` (optional): Levels deep (default: 1)
- `flat` (optional): Flat list vs nested (default: false)
- `include_external` (optional): Include node_modules (default: false)

### get_inheritance
Show inheritance hierarchy for a class or interface.

**Parameters:**
- `name` (required): Class or interface name
- `direction` (optional): "ancestors", "descendants", or "both" (default: both)

### get_call_graph
Show potential callers of a function based on import analysis.

**Parameters:**
- `name` (required): Function name
- `file` (optional): File where function is defined
- `direction` (optional): "callers" (default: callers)
- `depth` (optional): Levels deep (default: 1)

---

## Key Code Locations

### Readline Interface
**File:** `src/index.ts:2237`
```typescript
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  history,
  historySize: MAX_HISTORY_SIZE,
  terminal: true,
  prompt: chalk.bold.cyan('\nYou: '),
  completer,
});
```

### Paste Detection (Already Implemented!)
**File:** `src/index.ts:3211-3238`
```typescript
// Paste detection via debouncing
const PASTE_DEBOUNCE_MS = 50;
let pasteBuffer: string[] = [];
let pasteTimeout: NodeJS.Timeout | null = null;

rl.on('line', (input) => {
  if (rlClosed) return;
  pasteBuffer.push(input);
  if (pasteTimeout) clearTimeout(pasteTimeout);
  pasteTimeout = setTimeout(() => {
    const combinedInput = pasteBuffer.join('\n');
    pasteBuffer = [];
    pasteTimeout = null;
    handleInput(combinedInput);
  }, PASTE_DEBOUNCE_MS);
});
```

### Input Handler
**File:** `src/index.ts:2474` - The `handleInput` function processes user input

### Agent Creation
**File:** `src/index.ts:2322` - Where the Agent is instantiated

---

## Tips for Navigating Large Files

1. **Use grep to find keywords:**
   ```
   grep({ pattern: "createInterface", path: "src/index.ts" })
   ```

2. **Read specific sections with offset:**
   ```
   read_file({ path: "src/index.ts", offset: 2230, max_lines: 50 })
   ```

3. **Find function definitions:**
   ```
   grep({ pattern: "function handleInput", path: "src/" })
   ```

4. **Use symbol tools (after /symbols rebuild):**
   ```
   find_symbol({ name: "handleInput" })
   goto_definition({ name: "Agent" })
   ```
