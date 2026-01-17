// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

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
    expect(consumePendingPaste()).toBe('pasted content');
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
    expect(consumePendingPaste()).toBe('line1\nline2\nline3');

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

    expect(consumePendingPaste()).toBe('content');

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
    expect(consumePendingPaste()).toBe('pasted');

    // Restore stdout.write
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
    expect(consumePendingPaste()).toBe('content');
    expect(hasPendingPaste()).toBe(false);
    expect(consumePendingPaste()).toBe(null);

    // Restore stdout.write
    process.stdout.write = originalWrite;
  });
});
