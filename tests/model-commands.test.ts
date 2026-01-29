// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { modelsCommand, switchCommand } from '../src/commands/model-commands.js';

describe('model-commands', () => {
  describe('modelsCommand metadata', () => {
    it('should have correct name', () => {
      expect(modelsCommand.name).toBe('models');
    });

    it('should have aliases', () => {
      expect(modelsCommand.aliases).toContain('model');
      expect(modelsCommand.aliases).toContain('list-models');
    });

    it('should have description', () => {
      expect(modelsCommand.description).toBeDefined();
      expect(typeof modelsCommand.description).toBe('string');
    });

    it('should have usage string', () => {
      expect(modelsCommand.usage).toBeDefined();
      expect(typeof modelsCommand.usage).toBe('string');
    });

    it('should have taskType set to fast', () => {
      expect(modelsCommand.taskType).toBe('fast');
    });

    it('should have execute function', () => {
      expect(typeof modelsCommand.execute).toBe('function');
    });
  });

  describe('switchCommand metadata', () => {
    it('should have correct name', () => {
      expect(switchCommand.name).toBe('switch');
    });

    it('should have aliases', () => {
      expect(switchCommand.aliases).toContain('use');
      expect(switchCommand.aliases).toContain('model-switch');
    });

    it('should have description', () => {
      expect(switchCommand.description).toBeDefined();
    });

    it('should have usage string', () => {
      expect(switchCommand.usage).toBeDefined();
    });

    it('should have taskType set to fast', () => {
      expect(switchCommand.taskType).toBe('fast');
    });

    it('should have execute function', () => {
      expect(typeof switchCommand.execute).toBe('function');
    });
  });

  describe('execute functions', () => {
    it('modelsCommand should return a string for empty args', async () => {
      const result = await modelsCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });

    it('modelsCommand should return a string for provider filter', async () => {
      const result = await modelsCommand.execute('anthropic', {} as any);
      expect(typeof result).toBe('string');
    });

    it('modelsCommand should return a string for --local flag', async () => {
      const result = await modelsCommand.execute('--local', {} as any);
      expect(typeof result).toBe('string');
    });

    it('switchCommand should return a string for model name', async () => {
      const result = await switchCommand.execute('claude-sonnet-4-20250514', {} as any);
      expect(typeof result).toBe('string');
    });

    it('switchCommand should return a string for provider/model format', async () => {
      const result = await switchCommand.execute('anthropic claude-sonnet-4-20250514', {} as any);
      expect(typeof result).toBe('string');
    });

    it('switchCommand should return a string for empty args', async () => {
      const result = await switchCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});