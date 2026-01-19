// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { Transform, TransformCallback } from 'stream';
import chalk from 'chalk';

// Bracketed paste mode escape sequences
export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

// Escape sequences to enable/disable bracketed paste mode
export const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
export const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

// Default debounce - can be overridden via environment
export const DEFAULT_PASTE_DEBOUNCE_MS = 100;

/**
 * Pending paste data - captured by PasteInterceptor, consumed by line handler.
 * Includes both the prefix (what was typed before paste) and the paste content.
 */
let pendingPasteData: { prefix: string; content: string } | null = null;

/**
 * Get and clear pending paste data (prefix + content).
 */
export function consumePendingPaste(): { prefix: string; content: string } | null {
  const data = pendingPasteData;
  pendingPasteData = null;
  return data;
}

/**
 * Check if there's pending paste data.
 */
export function hasPendingPaste(): boolean {
  return pendingPasteData !== null;
}

/**
 * Transform stream that intercepts stdin to capture paste content.
 * When a paste is detected, it:
 * 1. Captures the full paste content
 * 2. Shows "[pasted N chars]" to the user
 * 3. Passes a newline to readline to trigger submission
 */
export class PasteInterceptor extends Transform {
  private buffer = '';
  private inPaste = false;
  private pasteBuffer = '';
  private prefixBuffer = ''; // Track what was typed before paste

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    const data = chunk.toString();
    this.buffer += data;

    let output = '';

    while (this.buffer.length > 0) {
      if (!this.inPaste) {
        // Look for paste start
        const startIdx = this.buffer.indexOf(PASTE_START);
        if (startIdx !== -1) {
          // Capture anything before the paste start as the prefix
          const prefix = this.buffer.slice(0, startIdx);
          // Pass through to readline for display
          output += prefix;
          // Only track the part after the last newline for the prefix
          // (newlines reset the current line in readline)
          const lastNewline = prefix.lastIndexOf('\n');
          if (lastNewline !== -1) {
            this.prefixBuffer = prefix.slice(lastNewline + 1);
          } else {
            this.prefixBuffer += prefix;
          }
          this.buffer = this.buffer.slice(startIdx + PASTE_START.length);
          this.inPaste = true;
          this.pasteBuffer = '';
        } else {
          // Check if buffer might contain partial paste start sequence
          // Keep the last few chars in case they're the start of an escape sequence
          const escIdx = this.buffer.lastIndexOf('\x1b');
          if (escIdx !== -1 && escIdx >= this.buffer.length - PASTE_START.length) {
            // Partial escape sequence at end - keep it for next chunk
            const toPass = this.buffer.slice(0, escIdx);
            this.prefixBuffer += toPass; // Track for potential paste
            output += toPass;
            this.buffer = this.buffer.slice(escIdx);
            break;
          } else {
            // No paste markers, pass through and track
            // Check for newline - reset prefix tracking on new line
            const newlineIdx = this.buffer.lastIndexOf('\n');
            if (newlineIdx !== -1) {
              // Reset prefix after newline (user pressed Enter without paste)
              this.prefixBuffer = this.buffer.slice(newlineIdx + 1);
            } else {
              this.prefixBuffer += this.buffer;
            }
            output += this.buffer;
            this.buffer = '';
          }
        }
      } else {
        // In paste - look for paste end
        const endIdx = this.buffer.indexOf(PASTE_END);
        if (endIdx !== -1) {
          // Capture paste content
          this.pasteBuffer += this.buffer.slice(0, endIdx);
          this.buffer = this.buffer.slice(endIdx + PASTE_END.length);
          this.inPaste = false;

          // Store both prefix and paste content for the line handler
          pendingPasteData = {
            prefix: this.prefixBuffer,
            content: this.pasteBuffer,
          };

          // Show paste indicator to user
          const lineCount = (this.pasteBuffer.match(/\n/g) || []).length + 1;
          const charCount = this.pasteBuffer.length;
          const indicator =
            lineCount > 1
              ? chalk.dim(`[pasted ${lineCount} lines, ${charCount} chars]`)
              : chalk.dim(`[pasted ${charCount} chars]`);

          // Write indicator directly to stdout (bypassing readline)
          process.stdout.write(indicator);

          // Send a newline to readline to trigger the line event
          output += '\n';

          this.pasteBuffer = '';
          this.prefixBuffer = ''; // Reset prefix for next line
        } else {
          // Still in paste, buffer everything
          this.pasteBuffer += this.buffer;
          this.buffer = '';
        }
      }
    }

    if (output) {
      this.push(output);
    }
    callback();
  }

  _flush(callback: TransformCallback): void {
    // If we're still in a paste at end of stream, treat remaining as paste content
    if (this.inPaste && this.pasteBuffer) {
      pendingPasteData = {
        prefix: this.prefixBuffer,
        content: this.pasteBuffer,
      };
      const charCount = this.pasteBuffer.length;
      process.stdout.write(chalk.dim(`[pasted ${charCount} chars]`));
      this.push('\n');
    } else if (this.buffer) {
      this.push(this.buffer);
    }
    this.buffer = '';
    this.pasteBuffer = '';
    this.prefixBuffer = '';
    this.inPaste = false;
    callback();
  }
}

/**
 * Create a paste interceptor stream to use between stdin and readline.
 * Copies TTY properties from stdin so readline's tab completion works.
 */
export function createPasteInterceptor(): PasteInterceptor {
  const interceptor = new PasteInterceptor();

  // Copy TTY properties from stdin to the interceptor.
  // Readline checks input.isTTY to enable features like tab completion.
  if (process.stdin.isTTY) {
    (interceptor as unknown as { isTTY: boolean }).isTTY = true;
    // Also copy setRawMode if available (needed for proper key handling)
    if (typeof process.stdin.setRawMode === 'function') {
      (interceptor as unknown as { setRawMode: typeof process.stdin.setRawMode }).setRawMode =
        process.stdin.setRawMode.bind(process.stdin);
    }
  }

  return interceptor;
}

/**
 * Enable bracketed paste mode on the terminal.
 * When enabled, pasted content is wrapped with escape sequences.
 */
export function enableBracketedPaste(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(ENABLE_BRACKETED_PASTE);
  }
}

/**
 * Disable bracketed paste mode on the terminal.
 */
export function disableBracketedPaste(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(DISABLE_BRACKETED_PASTE);
  }
}
