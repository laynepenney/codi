// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { Transform, TransformCallback } from 'stream';

// Bracketed paste mode escape sequences
export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

// Escape sequences to enable/disable bracketed paste mode
export const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
export const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

// Default debounce - can be overridden via environment
export const DEFAULT_PASTE_DEBOUNCE_MS = 100;

export type PasteDebounceOptions = {
  handleInput: (input: string) => void;
  rlClosed: () => boolean;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  debounceMs: number;
};

/**
 * Global paste state tracker - set by raw stdin interceptor.
 * This allows readline handler to know if we're in a paste operation
 * even though readline strips the escape sequences.
 */
let globalInPaste = false;
let globalPasteEnded = false;

export function isInPaste(): boolean {
  return globalInPaste;
}

export function didPasteEnd(): boolean {
  const ended = globalPasteEnded;
  globalPasteEnded = false; // Reset after checking
  return ended;
}

/**
 * Transform stream that intercepts stdin to detect paste markers.
 * This runs BEFORE readline processes the input, allowing us to
 * track paste state even though readline strips escape sequences.
 */
export class PasteInterceptor extends Transform {
  private buffer = '';

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    const data = chunk.toString();
    this.buffer += data;

    // Process the buffer for paste markers
    let output = this.buffer;

    // Check for paste start
    const startIdx = output.indexOf(PASTE_START);
    if (startIdx !== -1) {
      globalInPaste = true;
      output = output.slice(0, startIdx) + output.slice(startIdx + PASTE_START.length);
    }

    // Check for paste end
    const endIdx = output.indexOf(PASTE_END);
    if (endIdx !== -1) {
      globalInPaste = false;
      globalPasteEnded = true;
      output = output.slice(0, endIdx) + output.slice(endIdx + PASTE_END.length);
    }

    // Clear buffer - we've processed it
    this.buffer = '';

    // Pass cleaned data to readline
    this.push(output);
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer) {
      this.push(this.buffer);
      this.buffer = '';
    }
    callback();
  }
}

/**
 * Create a paste interceptor stream to use between stdin and readline.
 */
export function createPasteInterceptor(): PasteInterceptor {
  return new PasteInterceptor();
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

/**
 * Strip bracketed paste markers from input and detect paste boundaries.
 * Returns the cleaned input and whether we're in a paste operation.
 */
export function processBracketedPaste(
  input: string,
  wasInPaste: boolean
): { cleanedInput: string; inPaste: boolean; pasteEnded: boolean } {
  let cleanedInput = input;
  let inPaste = wasInPaste;
  let pasteEnded = false;

  // Check for paste start marker
  if (cleanedInput.includes(PASTE_START)) {
    inPaste = true;
    cleanedInput = cleanedInput.replace(PASTE_START, '');
  }

  // Check for paste end marker
  if (cleanedInput.includes(PASTE_END)) {
    pasteEnded = true;
    inPaste = false;
    cleanedInput = cleanedInput.replace(PASTE_END, '');
  }

  return { cleanedInput, inPaste, pasteEnded };
}

/**
 * Creates a line handler that supports both:
 * 1. Bracketed paste mode (via global state from PasteInterceptor)
 * 2. Inline paste markers (for terminals that pass them through)
 * 3. Debounce-based detection (fallback for terminals without bracketed paste)
 *
 * Lines are forwarded to `handleInput` as a single multiline string.
 */
export function createPasteDebounceHandler(opts: PasteDebounceOptions): (input: string) => void {
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;

  let pasteBuffer: string[] = [];
  let pasteTimeout: ReturnType<typeof setTimeout> | null = null;
  let inBracketedPaste = false;

  const flushBuffer = () => {
    if (pasteBuffer.length === 0) return;

    const combinedInput = pasteBuffer.join('\n');
    pasteBuffer = [];
    pasteTimeout = null;
    opts.handleInput(combinedInput);
  };

  return (input: string) => {
    if (opts.rlClosed()) return;

    // Check global paste state (set by PasteInterceptor if using it)
    const globalPasteActive = isInPaste();
    const globalPasteJustEnded = didPasteEnd();

    // Also process inline markers (for direct testing or terminals that pass them through)
    const { cleanedInput, inPaste, pasteEnded } = processBracketedPaste(input, inBracketedPaste);
    inBracketedPaste = inPaste || globalPasteActive;

    // Add cleaned input to buffer
    pasteBuffer.push(cleanedInput);

    // Clear any existing debounce timeout
    if (pasteTimeout) {
      clearTimeoutFn(pasteTimeout);
      pasteTimeout = null;
    }

    // If bracketed paste ended (either via inline marker or global state), flush immediately
    if (pasteEnded || globalPasteJustEnded) {
      inBracketedPaste = false;
      flushBuffer();
      return;
    }

    // If in bracketed paste, don't set timeout - wait for end marker
    if (inBracketedPaste) {
      return;
    }

    // Fall back to debounce-based detection
    pasteTimeout = setTimeoutFn(() => {
      flushBuffer();
    }, opts.debounceMs);
  };
}
