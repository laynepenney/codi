# Paste Enhancement Plan: Bracketed Paste Mode

## Current State

Paste detection is **already implemented** using debounce detection at `src/index.ts:3211-3238`:

```typescript
const PASTE_DEBOUNCE_MS = 50;
let pasteBuffer: string[] = [];
let pasteTimeout: NodeJS.Timeout | null = null;

rl.on('line', (input) => {
  pasteBuffer.push(input);
  if (pasteTimeout) clearTimeout(pasteTimeout);
  pasteTimeout = setTimeout(() => {
    const combinedInput = pasteBuffer.join('\n');
    pasteBuffer = [];
    handleInput(combinedInput);
  }, PASTE_DEBOUNCE_MS);
});
```

**How it works:**
- Lines arriving within 50ms are buffered
- After 50ms of no input, buffer is combined with `\n` and processed

**Limitation:** Debounce-based detection can have false positives/negatives depending on terminal speed.

---

## Enhancement: Bracketed Paste Mode

Bracketed paste mode is a terminal feature where pasted content is wrapped with escape sequences:
- Start: `\x1b[200~`
- End: `\x1b[201~`

This provides **explicit** paste detection rather than timing-based heuristics.

---

## Implementation Plan

### 1. Enable Bracketed Paste Mode

**File:** `src/index.ts` (near line 2237 where readline is created)

```typescript
// Enable bracketed paste mode
process.stdout.write('\x1b[?2004h');

// Disable on exit
process.on('exit', () => {
  process.stdout.write('\x1b[?2004l');
});
rl.on('close', () => {
  process.stdout.write('\x1b[?2004l');
});
```

### 2. Add Bracketed Paste Detection to stdin

**File:** `src/index.ts` (before the line handler, around line 3210)

```typescript
// Bracketed paste mode detection
let inBracketedPaste = false;
let bracketedPasteBuffer = '';

// Listen for raw input to detect bracketed paste sequences
if (process.stdin.isTTY) {
  process.stdin.setRawMode(false); // readline handles this
}

// Override the line handler to support bracketed paste
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

// Process input for bracketed paste markers
function processRawInput(data: string): string {
  let result = data;

  // Check for paste start
  if (result.includes(PASTE_START)) {
    inBracketedPaste = true;
    result = result.replace(PASTE_START, '');
  }

  // Check for paste end
  if (result.includes(PASTE_END)) {
    inBracketedPaste = false;
    result = result.replace(PASTE_END, '');
  }

  return result;
}
```

### 3. Modify Line Handler

**File:** `src/index.ts:3219`

```typescript
rl.on('line', (rawInput) => {
  if (rlClosed) return;

  const input = processRawInput(rawInput);

  // If in bracketed paste, buffer without timeout
  if (inBracketedPaste) {
    pasteBuffer.push(input);
    return; // Don't process yet, wait for paste end
  }

  // If we have buffered paste content, process it now
  if (pasteBuffer.length > 0) {
    pasteBuffer.push(input);
    const combinedInput = pasteBuffer.join('\n');
    pasteBuffer = [];
    handleInput(combinedInput);
    return;
  }

  // Fall back to debounce detection for non-bracketed terminals
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

---

## Files to Modify

| File | Line | Change |
|------|------|--------|
| `src/index.ts` | ~2237 | Enable bracketed paste mode |
| `src/index.ts` | ~3210 | Add bracketed paste detection |
| `src/index.ts` | ~3219 | Modify line handler for bracketed paste |
| `tests/paste.test.ts` | NEW | Add tests for paste handling |

---

## Test Cases

```typescript
describe('Paste Detection', () => {
  it('handles bracketed paste with multiple lines', () => {
    // Simulate: \x1b[200~line1\nline2\nline3\x1b[201~
    // Should produce single input: "line1\nline2\nline3"
  });

  it('falls back to debounce for non-bracketed terminals', () => {
    // Rapid line input within 50ms should be combined
  });

  it('handles single line input normally', () => {
    // Single line after 50ms should not be buffered
  });
});
```

---

## Verification

```bash
# Build
npm run build

# Test manually
codi

# Paste multi-line text - should submit as one message
# Try: Select and paste 3+ lines of text
```

---

## Alternative: Keep Current Implementation

The current debounce-based implementation (50ms) works well for most terminals. Bracketed paste mode adds complexity and may not be supported by all terminals.

**Recommendation:** The current implementation is sufficient. Only add bracketed paste if users report issues with the debounce approach.
