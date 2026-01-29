// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { promptCommand, explainCommand, reviewCommand } from '../src/commands/prompt-commands.js';

describe('prompt-commands', () => {
  describe('promptCommand metadata', () => {
    it('should have correct name', () => {
      expect(promptCommand.name).toBe('prompt');
    });

    it('should have description', () => {
      expect(promptCommand.description).toBeDefined();
      expect(typeof promptCommand.description).toBe('string');
    });

    it('should have usage string', () => {
      expect(promptCommand.usage).toBeDefined();
      expect(typeof promptCommand.usage).toBe('string');
    });

    it('should have execute function', () => {
      expect(typeof promptCommand.execute).toBe('function');
    });
  });

  describe('explainCommand metadata', () => {
    it('should have correct name', () => {
      expect(explainCommand.name).toBe('explain');
    });

    it('should have aliases', () => {
      expect(explainCommand.aliases).toContain('e');
    });

    it('should have description', () => {
      expect(explainCommand.description).toBeDefined();
    });

    it('should have usage string', () => {
      expect(explainCommand.usage).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof explainCommand.execute).toBe('function');
    });
  });

  describe('reviewCommand metadata', () => {
    it('should have correct name', () => {
      expect(reviewCommand.name).toBe('review');
    });

    it('should have aliases', () => {
      expect(reviewCommand.aliases).toContain('cr');
    });

    it('should have description', () => {
      expect(reviewCommand.description).toBeDefined();
    });

    it('should have usage string', () => {
      expect(reviewCommand.usage).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof reviewCommand.execute).toBe('function');
    });
  });

  describe('execute functions', () => {
    it('promptCommand should return a string for empty args', async () => {
      const result = await promptCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('promptCommand should return a string for invalid subcommand', async () => {
      const result = await promptCommand.execute('invalid', {} as any);
      expect(typeof result).toBe('string');
    });

    it('explainCommand should return a string', async () => {
      const result = await explainCommand.execute('src/utils.ts', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('explain');
    });

    it('explainCommand should return a string for empty args', async () => {
      const result = await explainCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('reviewCommand should return a string', async () => {
      const result = await reviewCommand.execute('src/utils.ts', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('review');
    });

    it('reviewCommand should return a string for empty args', async () => {
      const result = await reviewCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});