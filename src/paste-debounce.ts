// Bracketed paste mode escape sequences
export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

// Escape sequences to enable/disable bracketed paste mode
export const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
export const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

export type PasteDebounceOptions = {
  handleInput: (input: string) => void;
  rlClosed: () => boolean;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  debounceMs: number;
};

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
 * 1. Bracketed paste mode (explicit paste markers)
 * 2. Debounce-based detection (fallback for terminals without bracketed paste)
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

    // Process bracketed paste markers
    const { cleanedInput, inPaste, pasteEnded } = processBracketedPaste(input, inBracketedPaste);
    inBracketedPaste = inPaste;

    // Add cleaned input to buffer
    pasteBuffer.push(cleanedInput);

    // Clear any existing debounce timeout
    if (pasteTimeout) {
      clearTimeoutFn(pasteTimeout);
      pasteTimeout = null;
    }

    // If bracketed paste ended, flush immediately
    if (pasteEnded) {
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
