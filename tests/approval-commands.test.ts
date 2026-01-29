// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { approvalsCommand } from '../src/commands/approval-commands.js';

describe('approval-commands', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(approvalsCommand.name).toBe('approvals');
    });

    it('should have aliases', () => {
      expect(approvalsCommand.aliases).toContain('approved');
      expect(approvalsCommand.aliases).toContain('approval');
    });

    it('should have description', () => {
      expect(approvalsCommand.description).toBeDefined();
      expect(typeof approvalsCommand.description).toBe('string');
    });

    it('should have usage string', () => {
      expect(approvalsCommand.usage).toBeDefined();
      expect(typeof approvalsCommand.usage).toBe('string');
    });

    it('should have taskType set to fast', () => {
      expect(approvalsCommand.taskType).toBe('fast');
    });

    it('should have execute function', () => {
      expect(typeof approvalsCommand.execute).toBe('function');
    });
  });

  describe('execute', () => {
    it('should return a string when called with empty args', async () => {
      const result = await approvalsCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for list action', async () => {
      const result = await approvalsCommand.execute('list', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for categories action', async () => {
      const result = await approvalsCommand.execute('categories', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for pathcategories action', async () => {
      const result = await approvalsCommand.execute('pathcategories', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for invalid action', async () => {
      const result = await approvalsCommand.execute('invalid', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});