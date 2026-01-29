// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { codeCommand } from '../src/commands/code-commands.js';

describe('code-commands', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(codeCommand.name).toBe('code');
    });

    it('should have aliases', () => {
      expect(codeCommand.aliases).toBeDefined();
      expect(Array.isArray(codeCommand.aliases)).toBe(true);
    });

    it('should have description', () => {
      expect(codeCommand.description).toBeDefined();
      expect(typeof codeCommand.description).toBe('string');
    });

    it('should have usage string', () => {
      expect(codeCommand.usage).toBeDefined();
      expect(typeof codeCommand.usage).toBe('string');
    });

    it('should have execute function', () => {
      expect(typeof codeCommand.execute).toBe('function');
    });
  });

  describe('execute', () => {
    it('should return a string for refactor subcommand', async () => {
      const result = await codeCommand.execute('refactor src/utils.ts', {} as any);
      expect(typeof result).toBe('string');
      expect(result.toLowerCase()).toContain('refactor');
    });

    it('should return a string for fix subcommand', async () => {
      const result = await codeCommand.execute('fix src/utils.ts bug', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('fix');
    });

    it('should return a string for test subcommand', async () => {
      const result = await codeCommand.execute('test src/utils.ts', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('test');
    });

    it('should return a string for doc subcommand', async () => {
      const result = await codeCommand.execute('doc src/utils.ts', {} as any);
      expect(typeof result).toBe('string');
      expect(result).toContain('document');
    });

    it('should return a string for optimize subcommand', async () => {
      const result = await codeCommand.execute('optimize src/utils.ts', {} as any);
      expect(typeof result).toBe('string');
      expect(result.toLowerCase()).toContain('optimize');
    });

    it('should return a string for empty args', async () => {
      const result = await codeCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for invalid subcommand', async () => {
      const result = await codeCommand.execute('invalid-subcommand', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});