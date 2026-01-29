// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tests for Ink UI components.
 *
 * These tests verify:
 * 1. CompletableInput handles capital letters correctly
 * 2. CompletableInput cursor behavior is correct
 * 3. Rendering doesn't produce duplicate lines during re-renders
 *
 * Note: ink-testing-library has a quirk where the first character
 * written to stdin is "eaten" and not processed. Tests must prime
 * the input with a dummy character first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CompletableInput } from '../src/ui/ink/completable-input.js';

// Helper to wait for ink to process input
const waitForInk = (ms = 100) => new Promise(r => setTimeout(r, ms));

// Helper to prime stdin (workaround for ink-testing-library quirk)
async function primeStdin(stdin: { write: (data: string) => void }) {
  stdin.write('\x00'); // Write a null character that will be eaten
  await waitForInk();
}

describe('CompletableInput', () => {
  describe('capital letters', () => {
    it('should accept uppercase letters when shift is pressed', async () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { stdin } = render(
        <CompletableInput
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
        />
      );

      // Prime stdin (first char is always eaten by ink-testing-library)
      await primeStdin(stdin);

      // Type uppercase 'A' (simulating Shift+A)
      stdin.write('A');
      await waitForInk();

      expect(onChange).toHaveBeenCalledWith('A');
    });

    it('should accept lowercase letters', async () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { stdin } = render(
        <CompletableInput
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
        />
      );

      await primeStdin(stdin);

      stdin.write('a');
      await waitForInk();

      expect(onChange).toHaveBeenCalledWith('a');
    });

    it('should accept mixed case input in sequence', async () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { stdin } = render(
        <CompletableInput
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
        />
      );

      await primeStdin(stdin);

      // Type several characters in sequence without rerender
      // This tests that the component accepts both cases
      stdin.write('H');
      await waitForInk();

      stdin.write('i');
      await waitForInk();

      // Verify both uppercase and lowercase were accepted
      // Note: without controlled value updates, each char starts fresh
      expect(onChange).toHaveBeenNthCalledWith(1, 'H');
      expect(onChange).toHaveBeenNthCalledWith(2, 'i');
      expect(onChange.mock.calls.length).toBe(2);
    });
  });

  describe('cursor rendering', () => {
    it('should show cursor at end when value is empty', () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { lastFrame } = render(
        <CompletableInput
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
          placeholder="Type here"
        />
      );

      // Should show cursor indicator
      const frame = lastFrame();
      expect(frame).toContain('_');
    });

    it('should show cursor at end of text', () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { lastFrame } = render(
        <CompletableInput
          value="hello"
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
        />
      );

      const frame = lastFrame();
      // Text should be visible
      expect(frame).toContain('hello');
      // Cursor should be visible
      expect(frame).toContain('_');
    });

    it('should not show cursor when not focused', () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { lastFrame } = render(
        <CompletableInput
          value="hello"
          onChange={onChange}
          onSubmit={onSubmit}
          focus={false}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('hello');
      // Cursor should not be visible when not focused
      expect(frame).not.toContain('_');
    });
  });

  describe('render stability', () => {
    it('should not duplicate content on re-render', () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { lastFrame, rerender } = render(
        <CompletableInput
          value="test"
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
        />
      );

      const frame1 = lastFrame();

      // Re-render with same value
      rerender(
        <CompletableInput
          value="test"
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
        />
      );

      const frame2 = lastFrame();

      // Frames should be identical - no duplication
      expect(frame2).toBe(frame1);
    });

    it('should handle rapid value changes without duplication', () => {
      const onChange = vi.fn();
      const onSubmit = vi.fn();

      const { lastFrame, rerender } = render(
        <CompletableInput
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
        />
      );

      // Simulate rapid typing
      for (let i = 0; i < 50; i++) {
        const value = 'l'.repeat(i + 1);
        rerender(
          <CompletableInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            focus={true}
          />
        );
      }

      const finalFrame = lastFrame();

      // Should only have one instance of the text
      const matches = finalFrame?.match(/l/g) || [];
      // 50 l's + 1 cursor
      expect(matches.length).toBe(50);
    });
  });
});
