// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { symbolsCommand } from '../src/commands/symbol-commands.js';

describe('symbol-commands', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(symbolsCommand.name).toBe('symbols');
    });

    it('should have description', () => {
      expect(symbolsCommand.description).toBeDefined();
      expect(typeof symbolsCommand.description).toBe('string');
    });

    it('should have usage string', () => {
      expect(symbolsCommand.usage).toBeDefined();
      expect(typeof symbolsCommand.usage).toBe('string');
    });

    it('should have execute function', () => {
      expect(typeof symbolsCommand.execute).toBe('function');
    });
  });

  describe('execute', () => {
    it('should return a string for empty args', async () => {
      const result = await symbolsCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
      // May contain "symbols" in any format (__SYMBOLS_STATS__ or similar)
      expect(result.toLowerCase()).toMatch(/(symbols|__)/);
    });

    it('should return a string for rebuild subcommand', async () => {
      const result = await symbolsCommand.execute('rebuild', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for update subcommand', async () => {
      const result = await symbolsCommand.execute('update', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for stats subcommand', async () => {
      const result = await symbolsCommand.execute('stats', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for search subcommand', async () => {
      const result = await symbolsCommand.execute('search User', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for clear subcommand', async () => {
      const result = await symbolsCommand.execute('clear', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for invalid subcommand', async () => {
      const result = await symbolsCommand.execute('invalid', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});