// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { pickImageCommand } from '../src/commands/image-commands.js';

describe('image-commands', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(pickImageCommand.name).toBe('image');
    });

    it('should have aliases', () => {
      expect(pickImageCommand.aliases).toBeDefined();
      expect(Array.isArray(pickImageCommand.aliases)).toBe(true);
    });

    it('should have description', () => {
      expect(pickImageCommand.description).toBeDefined();
      expect(typeof pickImageCommand.description).toBe('string');
    });

    it('should have usage string', () => {
      expect(pickImageCommand.usage).toBeDefined();
      expect(typeof pickImageCommand.usage).toBe('string');
    });

    it('should have execute function', () => {
      expect(typeof pickImageCommand.execute).toBe('function');
    });
  });

  describe('execute', () => {
    it('should return a string for analyze subcommand', async () => {
      const result = await pickImageCommand.execute('analyze image.png', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('analyze');
    });

    it('should return a string for describe subcommand', async () => {
      const result = await pickImageCommand.execute('describe image.png', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('describe');
    });

    it('should return a string for empty args', async () => {
      const result = await pickImageCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for invalid subcommand', async () => {
      const result = await pickImageCommand.execute('invalid', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});