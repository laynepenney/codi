import { describe, expect, it, vi } from 'vitest';

import { createPasteDebounceHandler } from '../src/paste-debounce';

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
