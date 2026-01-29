// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { configCommand } from '../src/commands/config-commands.js';

describe('config-commands', () => {
  describe('metadata', () => {
    it('should have correct name', () => {
      expect(configCommand.name).toBe('config');
    });

    it('should have description', () => {
      expect(configCommand.description).toBeDefined();
      expect(typeof configCommand.description).toBe('string');
    });

    it('should have usage string', () => {
      expect(configCommand.usage).toBeDefined();
      expect(typeof configCommand.usage).toBe('string');
    });

    it('should have execute function', () => {
      expect(typeof configCommand.execute).toBe('function');
    });
  });

  describe('execute', () => {
    it('should return a string for empty args', async () => {
      const result = await configCommand.execute('', {} as any);
      expect(typeof result).toBe('string');
      // Result is a control string like __CONFIG_SHOW__ or __CONFIG_NOT_FOUND__
      expect(result?.toLowerCase()).toContain('config');
    });

    it('should return a string for init subcommand', async () => {
      const result = await configCommand.execute('init', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for example subcommand', async () => {
      const result = await configCommand.execute('example', {} as any);
      expect(typeof result).toBe('string');
    });

    it('should return a string for invalid subcommand', async () => {
      const result = await configCommand.execute('invalid', {} as any);
      expect(typeof result).toBe('string');
    });
  });
});