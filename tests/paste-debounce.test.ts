// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  createPasteInterceptor,
  consumePendingPaste,
  hasPendingPaste,
  PASTE_START,
  PASTE_END,
} from '../src/paste-debounce';

// Reset pending paste state before each test
beforeEach(() => {
  // Consume any pending paste to reset state
  consumePendingPaste();
});

describe('createPasteInterceptor', () => {
  it('copies isTTY from stdin when stdin is a TTY', () => {
    // Save original value
    const originalIsTTY = process.stdin.isTTY;

    // Mock stdin as TTY
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const interceptor = createPasteInterceptor();
    expect((interceptor as unknown as { isTTY?: boolean }).isTTY).toBe(true);

    // Restore
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('does not set isTTY when stdin is not a TTY', () => {
    // Save original value
    const originalIsTTY = process.stdin.isTTY;

    // Mock stdin as non-TTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const interceptor = createPasteInterceptor();
    expect((interceptor as unknown as { isTTY?: boolean }).isTTY).toBeUndefined();

    // Restore
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('copies setRawMode from stdin when available', () => {
    // Save original values
    const originalIsTTY = process.stdin.isTTY;
    const originalSetRawMode = process.stdin.setRawMode;

    // Mock stdin as TTY with setRawMode
    const mockSetRawMode = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', { value: mockSetRawMode, configurable: true });

    const interceptor = createPasteInterceptor();
    const interceptorWithRawMode = interceptor as unknown as { setRawMode?: (mode: boolean) => void };

    expect(interceptorWithRawMode.setRawMode).toBeDefined();
    expect(typeof interceptorWithRawMode.setRawMode).toBe('function');

    // Call it to verify it's bound correctly
    interceptorWithRawMode.setRawMode?.(true);
    expect(mockSetRawMode).toHaveBeenCalledWith(true);

    // Restore
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', { value: originalSetRawMode, configurable: true });
  });

  it('passes normal data through unchanged', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Write some data without paste markers
    interceptor.write('hello world');
    interceptor.end();

    // Wait for stream to finish
    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    expect(chunks.join('')).toBe('hello world');
    expect(hasPendingPaste()).toBe(false);
  });

  it('captures paste content and emits newline', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    // Mock stdout.write to suppress the "[pasted N chars]" message
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Write data with paste markers
    interceptor.write(`${PASTE_START}pasted content${PASTE_END}`);
    interceptor.end();

    // Wait for stream to finish
    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    // Should emit a newline (to trigger readline's line event)
    expect(chunks.join('')).toBe('\n');

    // Paste content should be stored for consumption
    expect(hasPendingPaste()).toBe(true);
    expect(consumePendingPaste()).toEqual({ prefix: '', content: 'pasted content' });
    expect(hasPendingPaste()).toBe(false);

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });

  it('captures multi-line paste content', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    // Mock stdout.write to suppress the "[pasted N chars]" message
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Write multi-line paste
    interceptor.write(`${PASTE_START}line1\nline2\nline3${PASTE_END}`);
    interceptor.end();

    // Wait for stream to finish
    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    // Paste content should be stored
    expect(consumePendingPaste()).toEqual({ prefix: '', content: 'line1\nline2\nline3' });

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });

  it('handles paste markers split across chunks', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    // Mock stdout.write
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Write paste markers in separate chunks
    interceptor.write(PASTE_START);
    interceptor.write('content');
    interceptor.write(PASTE_END);
    interceptor.end();

    // Wait for stream to finish
    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    expect(consumePendingPaste()).toEqual({ prefix: '', content: 'content' });

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });

  it('passes through content before and after paste', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    // Mock stdout.write
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Write with content before and after paste
    interceptor.write(`before${PASTE_START}pasted${PASTE_END}after`);
    interceptor.end();

    // Wait for stream to finish
    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    // "before" should pass through, then newline for paste, then "after"
    expect(chunks.join('')).toBe('before\nafter');
    // "before" is captured as prefix since it was typed before the paste
    expect(consumePendingPaste()).toEqual({ prefix: 'before', content: 'pasted' });

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });
});

describe('prefix capture', () => {
  it('captures command prefix typed before paste', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    // Mock stdout.write
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // User types "/mcp " then pastes "tool-name"
    interceptor.write(`/mcp ${PASTE_START}tool-name${PASTE_END}`);
    interceptor.end();

    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    // The prefix "/mcp " should be captured along with paste content
    const pasteData = consumePendingPaste();
    expect(pasteData).toEqual({ prefix: '/mcp ', content: 'tool-name' });

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });

  it('resets prefix after newline without paste', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    // Mock stdout.write
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // User types something, presses Enter, then types more and pastes
    interceptor.write(`ignored\n/cmd ${PASTE_START}arg${PASTE_END}`);
    interceptor.end();

    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    // Only "/cmd " should be captured as prefix (after the newline reset)
    const pasteData = consumePendingPaste();
    expect(pasteData).toEqual({ prefix: '/cmd ', content: 'arg' });

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });
});

describe('escape sequence handling', () => {
  it('passes arrow key escape sequences through immediately', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Arrow key escape sequences used for history navigation
    const UP_ARROW = '\x1b[A';
    const DOWN_ARROW = '\x1b[B';
    const LEFT_ARROW = '\x1b[D';
    const RIGHT_ARROW = '\x1b[C';

    interceptor.write(UP_ARROW);
    interceptor.write(DOWN_ARROW);
    interceptor.write(LEFT_ARROW);
    interceptor.write(RIGHT_ARROW);
    interceptor.end();

    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    // All escape sequences should pass through unchanged
    expect(chunks.join('')).toBe(UP_ARROW + DOWN_ARROW + LEFT_ARROW + RIGHT_ARROW);
    expect(hasPendingPaste()).toBe(false);
  });

  it('does not buffer non-paste escape sequences', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Various terminal escape sequences that should pass through
    const sequences = [
      '\x1b[A',     // Up arrow
      '\x1b[B',     // Down arrow
      '\x1b[H',     // Home
      '\x1b[F',     // End
      '\x1b[3~',    // Delete
      '\x1bOH',     // Home (alternate)
    ];

    for (const seq of sequences) {
      interceptor.write(seq);
    }
    interceptor.end();

    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    expect(chunks.join('')).toBe(sequences.join(''));
  });

  it('only buffers potential paste start sequences', async () => {
    const interceptor = createPasteInterceptor();
    const chunks: string[] = [];

    interceptor.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    // Write partial paste start sequence - this SHOULD be buffered
    // PASTE_START is '\x1b[200~'
    interceptor.write('\x1b[2');  // Partial paste start

    // Give it a moment, then complete the sequence
    await new Promise(resolve => setTimeout(resolve, 10));

    // Mock stdout.write
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.write(`00~content${PASTE_END}`);
    interceptor.end();

    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    // The paste should have been captured
    expect(hasPendingPaste()).toBe(true);
    expect(consumePendingPaste()?.content).toBe('content');

    process.stdout.write = originalWrite;
  });
});

describe('consumePendingPaste', () => {
  it('returns null when no paste pending', () => {
    expect(consumePendingPaste()).toBe(null);
  });

  it('clears pending paste after consumption', async () => {
    const interceptor = createPasteInterceptor();

    // Mock stdout.write
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true);

    interceptor.write(`${PASTE_START}content${PASTE_END}`);
    interceptor.end();
    await new Promise<void>(resolve => interceptor.on('finish', resolve));

    expect(hasPendingPaste()).toBe(true);
    expect(consumePendingPaste()).toEqual({ prefix: '', content: 'content' });
    expect(hasPendingPaste()).toBe(false);
    expect(consumePendingPaste()).toBe(null);

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });
});
