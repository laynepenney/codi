# File Picker Implementation Guide for Image Analysis

## Executive Summary

This document explores options for implementing a file picker for selecting images in Codi, analyzes the existing `analyze_image` tool, and provides recommendations for the best approach.

---

## Current State: Existing analyze_image Tool

### What It Does

The existing `src/tools/analyze-image.ts` tool provides image analysis capabilities:

```typescript
// Tool interface
analyze_image(
  path: string,           // Required: path to image file
  question?: string       // Optional: specific question for analysis
): string                 // Returns special format for AI parsing
```

### Supported Formats
- JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)
- GIF (`.gif`)
- WebP (`.webp`)

### Key Features
- ✅ File validation (exists check, extension check)
- ✅ Size warnings (5MB limit recommendation)
- ✅ Base64 encoding for AI consumption
- ✅ Special format: `__IMAGE__:media_type:question:base64data`

### How It Works

1. **User or AI calls `analyze_image` with a file path**
2. **Tool validates the file** (exists, format, size)
3. **Reads and encodes to base64**
4. **Returns special format string**
5. **Agent parses the string** and converts to image content block
6. **Model analyzes the image** with the provided question

### Current Limitations

⚠️ **No UI for file selection** - User must type full path manually
⚠️ **No file browser** - Can't explore directories to find images
⚠️ **No fuzzy matching** - Must provide exact path
⚠️ **No preview** - Can't see image before analyzing

---

## File Picker Options for Terminal Interfaces

### Option 1: Native readline with Tab Completion (Current Approach)

**How it works:**
- User types file path
- Tab key completes file/directory names
- Requires no additional dependencies

**Pros:**
- ✅ No additional dependencies
- ✅ Works in any terminal
- ✅ Users already familiar with tab completion
- ✅ Simple to implement

**Cons:**
- ❌ No visual file browser
- ❌ Requires knowing where files are located
- ❌ Can be tedious for deep directory structures
- ❌ No image preview

**Implementation:**
```typescript
// Already works with readline's built-in tab completion
// Just need to ensure it's enabled in index.ts
```

**Complexity:** ⭐ Very Low (already works)

---

### Option 2: Inquirer.js (Interactive CLI Prompts)

**How it works:**
- Use `inquirer` library for interactive prompts
- Provides list-based or fuzzy search file selection
- Multi-choice support

**Pros:**
- ✅ User-friendly interface
- ✅ List-based selection (easy to scan)
- ✅ Fuzzy search available via `inquirer-autocomplete-prompt`
- ✅ Well-maintained library
- ✅ Works with existing readline

**Cons:**
- ❌ Adds dependency (~1MB)
- ❌ Requires interrupting readline for prompt
- ❌ May feel "clunky" for CLI purists
- ❌ No image preview

**Example:**
```typescript
import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
inquirer.registerPrompt('autocomplete', autocompletePrompt);

async function pickImage() {
  const { imagePath } = await inquirer.prompt([
    {
      type: 'autocomplete',
      name: 'imagePath',
      message: 'Select an image file:',
      source: async (answersSoFar, input) => {
        if (!input) return [];
        const files = await glob(`**/*${input}*.{png,jpg,jpeg,gif,webp}`);
        return files;
      },
    },
  ]);
  return imagePath;
}
```

**Complexity:** ⭐⭐ Low

---

### Option 3: Native fzf Integration (fzf = Fuzzy Finder)

**How it works:**
- Spawn `fzf` process for interactive fuzzy file search
- Returns selected file path
- Best-in-class fuzzy search experience

**Pros:**
- ✅ Incredible fuzzy search (best UX)
- ✅ Fast even with large file sets
- ✅ Many developers already have fzf installed
- ✅ Preview support (can show file info, even thumbnails via ueberzug)
- ✅ Lightweight (only spawns process)
- ✅ Falls back gracefully if not installed

**Cons:**
- ❌ Requires external binary (fzf)
- ❌ Not all users have fzf installed
- ❌ Need to handle errors if fzf not found
- ❌ Requires spawning child process

**Example:**
```typescript
import { spawn } from 'child_process';
import { promisify } from 'util';
import { lookup } from 'mime-types';
import { existsSync } from 'fs';
const execAsync = promisify(require('child_process').exec);

async function pickImageWithFzf(): Promise<string | null> {
  // Check if fzf is installed
  try {
    await execAsync('which fzf');
  } catch {
    return null; // fzf not installed
  }

  return new Promise((resolve, reject) => {
    const fzf = spawn('fzf', [
      '--prompt', 'Select image: ',
      '--preview', 'file {}',
      '--filter', '*.png *.jpg *.jpeg *.gif *.webp'
    ]);

    let stdout = '';

    fzf.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    fzf.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        resolve(null);
      }
    });

    // Pipe image list to fzf
    // (would need to generate list separately)
  });
}
```

**Complexity:** ⭐⭐⭐ Medium

---

### Option 4: Custom TUI with blessed or ink

**How it works:**
- Full terminal UI with ncurses-like library
- Rich interactive file browser
- Can show image previews (ASCII or kitty graphics protocol)

**Pros:**
- ✅ Full control over UX
- ✅ Can show image previews
- ✅ Keyboard navigation
- ✅ Looks professional

**Cons:**
- ❌ Heavy dependency (blessed: ~1MB)
- ❌ Complex to implement
- ❌ May conflict with existing readline
- ❌ Overkill for simple image picker
- ❌ Terminal compatibility issues

**Complexity:** ⭐⭐⭐⭐ High

---

### Option 5: Simple Directory Browser with readline

**How it works:**
- Custom file browser using only readline
- List files, navigate directories with keyboard
- Select image with Enter

**Pros:**
- ✅ No external dependencies
- ✅ Works with existing readline
- ✅ Simple to understand
- ✅ Customizable

**Cons:**
- ❌ Requires implementing from scratch
- ❌ No fuzzy search
- ❌ Limited interactivity
- ❌ Can be sluggish with many files

**Complexity:** ⭐⭐⭐ Medium

---

## Recommendation: Hybrid Approach

### Best Solution: fzf First, Fallback to readline

**Why this is the best approach:**

1. **fzf provides best UX** when available (many developers have it)
2. **Graceful fallback** to manual path typing for others
3. **No runtime dependency** (fzf is optional)
4. **Maintains CLI purity** for purists who prefer typing
5. **Can be triggered manually** via command: `/pick-image`

---

## Implementation Plan

### Step 1: Create a new command `/pick-image`

```typescript
// src/commands/image-commands.ts

import { registerCommand } from './index.js';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { glob } from 'node:fs/promises';

export const pickImageCommand: Command = {
  name: 'pick-image',
  aliases: ['pi'],
  description: 'Interactive image picker using fzf (if available)',
  usage: '/pick-image [question]',
  execute: async (args, context) => {
    const question = args.trim();

    // Try fzf first
    const selectedPath = await pickImageWithFzf();

    if (selectedPath) {
      // Return prompt for AI to use analyze_image
      return `Analyze this image: ${selectedPath}${question ? `\nFocus on: ${question}` : ''}`;
    } else {
      // Fallback instructions
      return `Fzf not available. Please provide an image path to analyze.\n` +
             `Usage: "Analyze the image at ./assets/banner.png"`;
    }
  },
};

async function pickImageWithFzf(): Promise<string | null> {
  try {
    // Find fzf binary
    await execAsync('which fzf');

    // Find image files
    const images = await glob('**/*.{png,jpg,jpeg,gif,webp}', {
      ignore: ['**/node_modules/**', '**/.git/**', '**/coverage/**'],
    });

    if (images.length === 0) {
      return null;
    }

    // Spawn fzf with image list
    return new Promise((resolve, reject) => {
      const fzf = spawn('fzf', [
        '--prompt', 'Select image: ',
        '--preview', 'file {}',
        '--height', '50%',
        '--border'
      ]);

      let stdout = '';

      fzf.stdin.write(images.join('\n'));
      fzf.stdin.end();

      fzf.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      fzf.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve(null);
        }
      });

      fzf.on('error', (err) => {
        reject(err);
      });
    });
  } catch {
    return null; // fzf not available
  }
}

registerCommand(pickImageCommand);
```

### Step 2: Enhance the command with preview

```typescript
// Use ueberzugpp for image previews if available
const hasUeberzug = await checkUeberzug();

if (hasUeberzug) {
  fzfArgs.push('--preview', 'ueberzugpp img --format json --source {}');
} else {
  fzfArgs.push('--preview', 'file {}');
}
```

### Step 3: Alternative: Simple readline-based picker

```typescript
// For users without fzf, provide simple directory browsing
async function pickImageWithReadline(): Promise<string | null> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter image path (use tab for completion): ', (answer) => {
      rl.close();
      if (answer && existsSync(answer)) {
        const ext = extname(answer).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
          resolve(answer);
        } else {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  });
}
```

---

## Testing the Current analyze_image Tool

Let me demonstrate how the existing tool works:

### Test Setup

```typescript
// Create a simple test to verify analyze_image works
import { AnalyzeImageTool } from './tools/analyze-image.js';

const tool = new AnalyzeImageTool();

// Test with a real image
const result = await tool.execute({
  path: 'assets/banner.png',
  question: 'What does this banner show?'
});

console.log('Result format:', result.substring(0, 100) + '...');
// Output: __IMAGE__:image/jpeg:What%20does%20this%20banner%20show%3F:iVBORw0KG...
```

### How AI Uses It

```
User: "Analyze the banner image"
AI (agent): Calls analyze_image tool with path="assets/banner.png"
Tool: Returns: __IMAGE__:image/jpeg::iVBORw0KG...
AI (agent): Parses result, creates image content block:
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "iVBORw0KG..."
            }
          }
Provider: Sends image to model (Claude 3+/GPT-4V/etc.)
Model: Analyzes image and responds
```

---

## Comparison Summary

| Option | Dependency | UX Quality | Dev Effort | Recommended |
|--------|-----------|------------|------------|------------|
| **Native readline (current)** | None | ⭐⭐ | None | ✅ Baseline |
| **Inquirer.js** | 1MB | ⭐⭐⭐ | Low | Maybe |
| **fzf integration** | Optional | ⭐⭐⭐⭐⭐ | Medium | ✅✅ **BEST** |
| **blessed TUI** | 1MB | ⭐⭐⭐⭐ | High | No |
| **Custom readline browser** | None | ⭐⭐ | Medium | Maybe |

---

## Final Recommendation

### For Codi's CLI:

**Primary Approach:** Use the existing `analyze_image` tool with manual path typing (tab completion enabled). This works well and requires no changes.

**Enhancement:** Add a `/pick-image` command that:
1. **First tries fzf** (if installed) for best UX
2. **Falls back to readline** prompt if fzf unavailable
3. **Returns a prompt** that triggers the AI to use `analyze_image`

**Why This Works:**
- ✅ No breaking changes to existing workflow
- ✅ Users who type paths manually can continue doing so
- ✅ Users with fzf get interactive picker (delight)
- ✅ No runtime dependencies required
- ✅ Simple to implement and maintain

### Example User Flow Without Enhancement:

```bash
codi> Analyze the banner image
AI: I'll analyze the banner image for you.
[AI calls analyze_image with "assets/banner.png"]
AI: The banner shows "Codi - Your AI Coding Wingman" with... (analysis)
```

### Example User Flow With `/pick-image` Command:

```bash
codi> /pick-image
[Interactive fzf opens]
[User navigates, selects "assets/banner.png"]
codi> /pick-image assets/banner.png

Analyze this image: assets/banner.png
```

---

## Next Steps

1. ✅ **Confirm existing `analyze_image` works well** (it does!)
2. **Decide if interactive picker is needed** - Likely yes for better UX
3. **Implement `/pick-image` command** with fzf + readline fallback
4. **Test with various image files**
5. **Document the new command** in CLAUDE.md and README.md
6. **Consider adding image preview** with ueberzugpp

Would you like me to implement the `/pick-image` command?