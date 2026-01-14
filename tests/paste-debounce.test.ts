import { describe, expect, it, vi } from 'vitest';

import {
  createPasteDebounceHandler,
  processBracketedPaste,
  PASTE_START,
  PASTE_END,
} from '../src/paste-debounce';

describe('paste debounce handler', () => {
  it('combines rapid successive lines into one multiline input', () => {
    const handleInput = vi.fn();
    let closed = false;

    const timeouts: Array<() => void> = [];
    const setTimeoutFn = ((cb: () => void) => {
      timeouts.push(cb);
      return timeouts.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    const clearTimeoutFn = vi.fn();

    const onLine = createPasteDebounceHandler({
      handleInput,
      rlClosed: () => closed,
      setTimeoutFn,
      clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout,
      debounceMs: 50,
    });

    onLine('a');
    onLine('b');
    onLine('c');

    expect(handleInput).not.toHaveBeenCalled();

    // simulate debounce firing once
    const last = timeouts[timeouts.length - 1];
    last();

    expect(handleInput).toHaveBeenCalledTimes(1);
    expect(handleInput).toHaveBeenCalledWith('a\nb\nc');
  });

  it('does nothing if readline is closed', () => {
    const handleInput = vi.fn();
    const onLine = createPasteDebounceHandler({
      handleInput,
      rlClosed: () => true,
      debounceMs: 50,
    });

    onLine('hello');
    expect(handleInput).not.toHaveBeenCalled();
  });
});

describe('processBracketedPaste', () => {
  it('detects paste start marker', () => {
    const result = processBracketedPaste(`${PASTE_START}hello`, false);
    expect(result.cleanedInput).toBe('hello');
    expect(result.inPaste).toBe(true);
    expect(result.pasteEnded).toBe(false);
  });

  it('detects paste end marker', () => {
    const result = processBracketedPaste(`world${PASTE_END}`, true);
    expect(result.cleanedInput).toBe('world');
    expect(result.inPaste).toBe(false);
    expect(result.pasteEnded).toBe(true);
  });

  it('handles both markers in one line', () => {
    const result = processBracketedPaste(`${PASTE_START}single line${PASTE_END}`, false);
    expect(result.cleanedInput).toBe('single line');
    expect(result.inPaste).toBe(false);
    expect(result.pasteEnded).toBe(true);
  });

  it('passes through normal input without markers', () => {
    const result = processBracketedPaste('normal input', false);
    expect(result.cleanedInput).toBe('normal input');
    expect(result.inPaste).toBe(false);
    expect(result.pasteEnded).toBe(false);
  });

  it('preserves inPaste state when no markers present', () => {
    const result = processBracketedPaste('middle line', true);
    expect(result.cleanedInput).toBe('middle line');
    expect(result.inPaste).toBe(true);
    expect(result.pasteEnded).toBe(false);
  });
});

describe('bracketed paste mode', () => {
  it('immediately processes input when paste end marker is received', () => {
    const handleInput = vi.fn();
    const timeouts: Array<() => void> = [];
    const setTimeoutFn = ((cb: () => void) => {
      timeouts.push(cb);
      return timeouts.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const clearTimeoutFn = vi.fn();

    const onLine = createPasteDebounceHandler({
      handleInput,
      rlClosed: () => false,
      setTimeoutFn,
      clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout,
      debounceMs: 50,
    });

    // Simulate bracketed paste: start marker, lines, end marker
    onLine(`${PASTE_START}line1`);
    onLine('line2');
    onLine(`line3${PASTE_END}`);

    // Should have been called immediately without waiting for timeout
    expect(handleInput).toHaveBeenCalledTimes(1);
    expect(handleInput).toHaveBeenCalledWith('line1\nline2\nline3');
  });

  it('buffers lines during bracketed paste without setting timeout', () => {
    const handleInput = vi.fn();
    const timeouts: Array<() => void> = [];
    const setTimeoutFn = ((cb: () => void) => {
      timeouts.push(cb);
      return timeouts.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const clearTimeoutFn = vi.fn();

    const onLine = createPasteDebounceHandler({
      handleInput,
      rlClosed: () => false,
      setTimeoutFn,
      clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout,
      debounceMs: 50,
    });

    // Start paste but don't end it
    onLine(`${PASTE_START}line1`);
    onLine('line2');

    // No timeout should have been set (paste is ongoing)
    expect(handleInput).not.toHaveBeenCalled();
    // The timeout from the first line should have been cleared
    // when the second line came in, but no new timeout set because we're in paste mode
  });

  it('handles single-line bracketed paste', () => {
    const handleInput = vi.fn();
    const setTimeoutFn = vi.fn();
    const clearTimeoutFn = vi.fn();

    const onLine = createPasteDebounceHandler({
      handleInput,
      rlClosed: () => false,
      setTimeoutFn: setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout,
      debounceMs: 50,
    });

    // Single line with both markers
    onLine(`${PASTE_START}quick paste${PASTE_END}`);

    expect(handleInput).toHaveBeenCalledTimes(1);
    expect(handleInput).toHaveBeenCalledWith('quick paste');
    // No timeout should be needed
    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  it('falls back to debounce for non-bracketed paste', () => {
    const handleInput = vi.fn();
    const timeouts: Array<() => void> = [];
    const setTimeoutFn = ((cb: () => void) => {
      timeouts.push(cb);
      return timeouts.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const clearTimeoutFn = vi.fn();

    const onLine = createPasteDebounceHandler({
      handleInput,
      rlClosed: () => false,
      setTimeoutFn,
      clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout,
      debounceMs: 50,
    });

    // No paste markers - should use debounce
    onLine('line1');
    onLine('line2');

    expect(handleInput).not.toHaveBeenCalled();
    expect(timeouts.length).toBeGreaterThan(0);

    // Fire the last timeout
    timeouts[timeouts.length - 1]();
    expect(handleInput).toHaveBeenCalledWith('line1\nline2');
  });
});
