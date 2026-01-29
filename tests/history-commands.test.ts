// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { undoCommand, redoCommand, historyCommand } from '../src/commands/history-commands.js';

describe('history-commands', () => {
  describe('undoCommand metadata', () => {
    it('should have correct name', () => {
      expect(undoCommand.name).toBe('revert-file');
    });

    it('should have aliases', () => {
      expect(undoCommand.aliases).toContain('rf');
      expect(undoCommand.aliases).toContain('fileundo');
      expect(undoCommand.aliases).toContain('fu');
    });

    it('should have description', () => {
      expect(undoCommand.description).toBeDefined();
    });

    it('should have usage string', () => {
      expect(undoCommand.usage).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof undoCommand.execute).toBe('function');
    });
  });

  describe('redoCommand metadata', () => {
    it('should have correct name', () => {
      expect(redoCommand.name).toBe('redo');
    });

    it('should have description', () => {
      expect(redoCommand.description).toBeDefined();
    });

    it('should have usage string', () => {
      expect(redoCommand.usage).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof redoCommand.execute).toBe('function');
    });
  });

  describe('historyCommand metadata', () => {
    it('should have correct name', () => {
      expect(historyCommand.name).toBe('filehistory');
    });

    it('should have aliases', () => {
      expect(historyCommand.aliases).toContain('fh');
    });

    it('should have description', () => {
      expect(historyCommand.description).toBeDefined();
    });

    it('should have usage string', () => {
      expect(historyCommand.usage).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof historyCommand.execute).toBe('function');
    });
  });

  describe('execute functions', () => {
    it('undoCommand should return a string', async () => {
      const result = await undoCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('redoCommand should return a string', async () => {
      const result = await redoCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('historyCommand should return a string for empty args', async () => {
      const result = await historyCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('historyCommand should return a string for clear subcommand', async () => {
      const result = await historyCommand.execute('clear', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});