// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickImageCommand } from '../src/commands/image-commands.js';

// Mock child_process to prevent spawning fzf
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd, callback) => {
    // Simulate fzf not being available
    callback(new Error('not found'), '', '');
  }),
  spawn: vi.fn(() => ({
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: { on: vi.fn() },
    on: vi.fn((event, handler) => {
      if (event === 'close') {
        // Simulate user cancellation (no selection)
        handler(1);
      }
    }),
  })),
}));

// Mock readline to prevent interactive prompts
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt, callback) => {
      // Simulate empty input (user pressed enter without typing)
      callback('');
    }),
    close: vi.fn(),
  })),
}));

describe('image-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(pickImageCommand.name).toBe('pick-image');
    });

    it('should have aliases', () => {
      expect(pickImageCommand.aliases).toBeDefined();
      expect(Array.isArray(pickImageCommand.aliases)).toBe(true);
      expect(pickImageCommand.aliases).toContain('pi');
    });

    it('should have description', () => {
      expect(pickImageCommand.description).toBeDefined();
      expect(typeof pickImageCommand.description).toBe('string');
      expect(pickImageCommand.description).toContain('fzf');
    });

    it('should have usage string', () => {
      expect(pickImageCommand.usage).toBeDefined();
      expect(typeof pickImageCommand.usage).toBe('string');
      expect(pickImageCommand.usage).toContain('/pick-image');
    });

    it('should have execute function', () => {
      expect(typeof pickImageCommand.execute).toBe('function');
    });
  });

  describe('execute', () => {
    it('should return helpful message when no image is selected', async () => {
      const result = await pickImageCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('No image selected');
    });

    it('should return helpful message with question context when no image selected', async () => {
      const result = await pickImageCommand.execute('analyze the colors', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('No image selected');
    });

    it('should suggest providing path directly in fallback message', async () => {
      const result = await pickImageCommand.execute('', {} as any);
      expect(result).toContain('provide a path directly');
    });
  });
});
