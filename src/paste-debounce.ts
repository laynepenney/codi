export type PasteDebounceOptions = {
  handleInput: (input: string) => void;
  rlClosed: () => boolean;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  debounceMs: number;
};

/**
 * Creates a line handler that debounces rapid successive lines (e.g. terminal paste)
 * and forwards them to `handleInput` as a single multiline string.
 */
export function createPasteDebounceHandler(opts: PasteDebounceOptions): (input: string) => void {
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;

  let pasteBuffer: string[] = [];
  let pasteTimeout: ReturnType<typeof setTimeout> | null = null;

  return (input: string) => {
    if (opts.rlClosed()) return;

    pasteBuffer.push(input);

    if (pasteTimeout) {
      clearTimeoutFn(pasteTimeout);
    }

    pasteTimeout = setTimeoutFn(() => {
      const combinedInput = pasteBuffer.join('\n');
      pasteBuffer = [];
      pasteTimeout = null;
      opts.handleInput(combinedInput);
    }, opts.debounceMs);
  };
}
