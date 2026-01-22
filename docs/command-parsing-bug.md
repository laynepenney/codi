# Command Parsing Bug Analysis

## Issue

The system is parsing markdown examples (like `/pick-image`) as actual commands, even when they appear in code blocks or documentation.

## Why This Happens

The `isCommand()` and `parseCommand()` functions check if an input starts with `/` and doesn't start with `//`, but they don't consider:
- Markdown code blocks (`\`/pick-image\``)
- Documentation examples (`Usage: /pick-image`)
- AI responses that mention commands

```typescript
// From src/index.ts
export function isCommand(input: string): boolean {
  return input.startsWith('/') && !input.startsWith('//');
}
```

This is too broad - it catches **anything** starting with `/` as a command.

## Current Implementation

```typescript
function shouldShowHelp(args: string): boolean {
  const trimmed = args.trim().toLowerCase();
  return trimmed === 'help' || trimmed === '--help' || trimmed === '-h' || trimmed === '?';
}

export function isCommand(input: string): boolean {
  return input.startsWith('/') && !input.startsWith('//');
}

export function parseCommand(input: string): { name: string; args: string } | null {
  if (!isCommand(input)) return null;

  const trimmed = input.slice(1).trim(); // Remove leading /
  const spaceIndex = trimmed.indexOf(' ');

  if (spaceIndex === -1) {
    return { name: trimmed.toLowerCase(), args: '' };
  }

  return {
    name: trimmed.slice(0, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}
```

## The Problem

**Example scenario from the error:**
```
User: How do I use the image picker?
AI: You can use /pick-image to select an image.

[Result: ERROR - tries to parse /pick-image as a command]
```

Or in markdown:
```
AI: Here's how to use the command:
\`\`\`
/pick-image What does this show?
\`\`\`

[Result: ERROR - tries to parse /pick-image from code block]
```

## Potential Solutions

### Option 1: Only Parse User Input (RECOMMENDED)

Only parse the user's **direct input line**, not from AI responses, documentation, or code blocks.

**Pros:**
- ✅ Simple and clear
- ✅ No false positives
- ✅ Commands only when user intentionally types them
- ✅ Doesn't break existing functionality

**Cons:**
- ⚠️ AI can't suggest commands for user to use
- ⚠️ Can't have command shortcuts in documentation

**Implementation:**
```typescript
// In src/index.ts, where user input is received
async function handleUserInput(input: string) {
  const trimmed = input.trim();

  // Only parse as command if it's direct user input, not from AI responses
  if (isCommand(trimmed)) {
    const parsed = parseCommand(trimmed);
    const command = getCommand(parsed.name);
    if (command) {
      const result = await command.execute(parsed.args, context);
      // ...
    }
  }
}
```

### Option 2: Stricter Command Detection

Add more conditions before parsing as a command.

**Rules to check:**
- Not in a code (backtick) context
- Not preceded by known documentation patterns
- Not in AI response (no ":", "```", etc.)

**Pros:**
- ✅ Allows commands in some contexts
- ✅ Prevents obvious false positives

**Cons:**
- ❌ Complex to implement
- ❌ Still has edge cases
- ❌ Hard to maintain

**Implementation:**
```typescript
export function isCommand(input: string): boolean {
  // Must start with /
  if (!input.startsWith('/')) return false;
  if (input.startsWith('//')) return false;

  // Must be at the start of line or after just whitespace
  const trimmed = input.trimStart();
  if (trimmed[0] !== '/') return false;

  // Not in a markdown code block (backticks or fenced code)
  const isInCodeBlock =
    input.includes('```') ||
    input.includes('`/pick-image') ||
    input.includes('` /pick-image');

  if (isInCodeBlock) return false;

  // Not preceded by documentation markers
  const isDocumentation =
    input.includes('Usage:') ||
    input.includes('Example:') ||
    input.includes('> Usage') ||
    input.includes('Example:');

  if (isDocumentation) return false;

  // Is a valid command name
  const command = getCommand(trimmed.slice(1).split(' ')[0].toLowerCase());
  return !!command;
}
```

### Option 3: Input Source Tracking (BEST)

Track where each input comes from and only parse as command if it's from direct user input.

**Pros:**
- ✅ Completely solves the issue
- ✅ Clean separation of concerns
- ✅ Easy to maintain

**Cons:**
- ⚠️ Requires changes to input handling

**Implementation:**
```typescript
enum InputSource {
  USER = 'user',           // Direct user input at repl
  AI = 'ai',              // From AI response
  DOCUMENTATION = 'doc',   // From docs
  COMMANDS = 'commands',   // From command output
}

interface ProcessedInput {
  text: string;
  source: InputSource;
}

async function processInput(input: ProcessedInput) {
  // Only parse as command if it's direct user input
  if (input.source === InputSource.USER && isCommand(input.text)) {
    const parsed = parseCommand(input.text);
    // ... execute command
  }
}
```

### Option 4: Require Command to Be Single Line

Only parse as command if the input is exactly one line and nothing else.

**Implementation:**
```typescript
export function isCommand(input: string): boolean {
  // Must start with /
  if (!input.startsWith('/')) return false;
  if (input.startsWith('//')) return false;

  // Must be a single line only
  const lines = input.split('\n');
  if (lines.length !== 1) return false;

  // Must be at the start
  if (input.trimStart()[0] !== '/') return false;

  return true;
}
```

## Recommended Approach: Option 3 (Input Source Tracking)

This is the cleanest solution because it:
1. Completely eliminates false positives
2. Follows the principle of least surprise
3. Easy to understand and maintain
4. Commands only execute when user explicitly types them

## How to Implement

### Step 1: Find where user input is captured

Look for the readline interface in `src/index.ts`:

```typescript
rl.on('line', async (input: string) => {
  // This is the direct user input
  const trimmed = input.trim();

  // Only check for commands here, not from AI responses
  if (isCommand(trimmed)) {
    const parsed = parseCommand(trimmed);
    const command = getCommand(parsed.name);
    // ...
  }
});
```

### Step 2: Don't parse AI responses

When you display AI responses, do NOT pass them through `isCommand()`:

```typescript
// When displaying AI response
for (const text of aiResponseText) {
  console.log(text);
  // DO NOT call isCommand() here
}
```

### Step 3: Update documentation

If documentation mentions commands, use backticks to prevent parsing:

```markdown
Use `/pick-image` to select an image.

Or:

\`\`\`
/pick-image What does this show?
\`\`\`
```

## Related: Existing Bug Fix for cloud-coder

You mentioned you implemented a fix before. Let me search for it:

```bash
git log --all --grep="command" --oneline
git log --all --grep="parse" --oneline
git log --all --grep="markdown" --oneline
```

If there was a previous fix, we should:
1. Review what it did
2. Understand why you now think it's a bad idea
3. Either revert or improve it

## Summary

**Bug:** Markdown examples and AI responses are parsed as commands

**Root Cause:** `isCommand()` is too permissive - checks `startsWith('/')` without context

**Recommendation:** Use Option 3 - track input source and only parse true user input as commands

**Why Parsing Markdown as Commands is Bad:**
- AI responses containing command examples get executed unexpectedly
- Documentation gets interpreted as commands
- Hard to distinguish between examples and actual commands
- Violates user expectations (user control, not AI control)

Want me to implement Option 3 (input source tracking) to fix this?