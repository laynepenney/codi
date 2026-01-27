// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeAll, vi, afterEach } from 'vitest';
import {
  registerCommand,
  getCommand,
  getAllCommands,
  parseCommand,
  isCommand,
} from '../src/commands/index';

// Mock console.log to capture help output
const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

afterEach(() => {
  consoleSpy.mockClear();
});

// Mock command context
const mockContext = {
  projectInfo: {
    type: 'node' as const,
    name: 'test-project',
    language: 'TypeScript',
    rootPath: '/test',
    mainFiles: [],
  },
};

describe('Command Help System', () => {
  describe('parseCommand', () => {
    it('parses command with -h flag', () => {
      const result = parseCommand('/config -h');
      expect(result).toEqual({ name: 'config', args: '-h' });
    });

    it('parses command with --help flag', () => {
      const result = parseCommand('/models --help');
      expect(result).toEqual({ name: 'models', args: '--help' });
    });

    it('parses command with help subcommand', () => {
      const result = parseCommand('/switch help');
      expect(result).toEqual({ name: 'switch', args: 'help' });
    });

    it('parses command with ? flag', () => {
      const result = parseCommand('/commit ?');
      expect(result).toEqual({ name: 'commit', args: '?' });
    });

    it('handles command without args', () => {
      const result = parseCommand('/help');
      expect(result).toEqual({ name: 'help', args: '' });
    });

    it('handles command with multiple args', () => {
      const result = parseCommand('/branch create feature-x');
      expect(result).toEqual({ name: 'branch', args: 'create feature-x' });
    });
  });

  describe('isCommand', () => {
    it('identifies slash commands', () => {
      expect(isCommand('/help')).toBe(true);
      expect(isCommand('/config -h')).toBe(true);
      expect(isCommand('/models --help')).toBe(true);
    });

    it('rejects non-commands', () => {
      expect(isCommand('help')).toBe(false);
      expect(isCommand('config -h')).toBe(false);
    });

    it('rejects double-slash (comments)', () => {
      expect(isCommand('// this is a comment')).toBe(false);
      expect(isCommand('//config')).toBe(false);
    });
  });

  describe('registerCommand wrapper help handling', () => {
    // Create a test command
    const testCommand = {
      name: 'testcmd',
      description: 'A test command for help testing',
      usage: '/testcmd <action> [options]',
      execute: async (args: string) => `executed with: ${args}`,
    };

    beforeAll(() => {
      registerCommand(testCommand);
    });

    it('shows help and returns null for -h flag', async () => {
      const cmd = getCommand('testcmd');
      expect(cmd).toBeDefined();

      const result = await cmd!.execute('-h', mockContext);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      // Check that usage was displayed
      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('/testcmd');
      expect(output).toContain('A test command');
    });

    it('shows help and returns null for --help flag', async () => {
      const cmd = getCommand('testcmd');
      const result = await cmd!.execute('--help', mockContext);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('shows help and returns null for help subcommand', async () => {
      const cmd = getCommand('testcmd');
      const result = await cmd!.execute('help', mockContext);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('shows help and returns null for ? flag', async () => {
      const cmd = getCommand('testcmd');
      const result = await cmd!.execute('?', mockContext);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('executes normally for non-help args', async () => {
      const cmd = getCommand('testcmd');
      const result = await cmd!.execute('some-action', mockContext);

      expect(result).toBe('executed with: some-action');
    });

    it('executes normally for empty args', async () => {
      const cmd = getCommand('testcmd');
      const result = await cmd!.execute('', mockContext);

      expect(result).toBe('executed with: ');
    });

    it('is case-insensitive for help flags', async () => {
      const cmd = getCommand('testcmd');

      const result1 = await cmd!.execute('HELP', mockContext);
      expect(result1).toBeNull();

      consoleSpy.mockClear();

      const result2 = await cmd!.execute('Help', mockContext);
      expect(result2).toBeNull();
    });
  });

  describe('All registered commands support help', () => {
    // Import and register all command modules
    beforeAll(async () => {
      // Import all command registration functions
      const { registerGitCommands } = await import('../src/commands/git-commands');
      const { registerCodeCommands } = await import('../src/commands/code-commands');
      const { registerSessionCommands } = await import('../src/commands/session-commands');
      const { registerConfigCommands } = await import('../src/commands/config-commands');
      const { registerModelCommands } = await import('../src/commands/model-commands');
      const { registerMemoryCommands } = await import('../src/commands/memory-commands');
      const { registerHistoryCommands } = await import('../src/commands/history-commands');
      const { registerUsageCommands } = await import('../src/commands/usage-commands');
      const { registerPluginCommands } = await import('../src/commands/plugin-commands');
      const { registerPromptCommands } = await import('../src/commands/prompt-commands');
      const { registerCompactCommands } = await import('../src/commands/compact-commands');
      const { registerApprovalCommands } = await import('../src/commands/approval-commands');
      const { registerSymbolCommands } = await import('../src/commands/symbol-commands');
      const { registerRAGCommands } = await import('../src/commands/rag-commands');

      // Register all commands
      registerGitCommands();
      registerCodeCommands();
      registerSessionCommands();
      registerConfigCommands();
      registerModelCommands();
      registerMemoryCommands();
      registerHistoryCommands();
      registerUsageCommands();
      registerPluginCommands();
      registerPromptCommands();
      registerCompactCommands();
      registerApprovalCommands();
      registerSymbolCommands();
      registerRAGCommands();
    });

    it('all commands have usage defined', () => {
      const commands = getAllCommands();
      expect(commands.length).toBeGreaterThan(0);

      for (const cmd of commands) {
        expect(cmd.usage, `Command ${cmd.name} should have usage defined`).toBeDefined();
        expect(cmd.usage.length, `Command ${cmd.name} usage should not be empty`).toBeGreaterThan(0);
      }
    });

    it('all commands have description defined', () => {
      const commands = getAllCommands();

      for (const cmd of commands) {
        expect(cmd.description, `Command ${cmd.name} should have description defined`).toBeDefined();
        expect(cmd.description.length, `Command ${cmd.name} description should not be empty`).toBeGreaterThan(0);
      }
    });

    it('all commands return null for -h flag', async () => {
      const commands = getAllCommands();
      const helpFlags = ['-h', '--help', 'help', '?'];

      for (const cmd of commands) {
        for (const flag of helpFlags) {
          consoleSpy.mockClear();
          const result = await cmd.execute(flag, mockContext);
          expect(result, `Command ${cmd.name} should return null for ${flag}`).toBeNull();
        }
      }
    });

    it('all commands display help output for -h flag', async () => {
      const commands = getAllCommands();

      for (const cmd of commands) {
        consoleSpy.mockClear();
        await cmd.execute('-h', mockContext);

        expect(
          consoleSpy.mock.calls.length,
          `Command ${cmd.name} should output help text`
        ).toBeGreaterThan(0);

        // Check that usage line was displayed
        const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
        expect(
          output,
          `Command ${cmd.name} help should contain usage`
        ).toContain('Usage:');
      }
    });
  });

  describe('Help output format', () => {
    const formatTestCommand = {
      name: 'formattestcmd',
      description: 'Test command for format checking',
      usage: '/formattestcmd <required> [optional]',
      execute: async () => 'executed',
    };

    beforeAll(() => {
      registerCommand(formatTestCommand);
    });

    it('displays usage line', async () => {
      const cmd = getCommand('formattestcmd');
      await cmd!.execute('-h', mockContext);

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Usage:');
      expect(output).toContain('/formattestcmd');
    });

    it('displays description', async () => {
      consoleSpy.mockClear();
      const cmd = getCommand('formattestcmd');
      await cmd!.execute('-h', mockContext);

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Test command for format checking');
    });

    it('handles command without usage gracefully', async () => {
      const noUsageCommand = {
        name: 'nousagecmd',
        description: 'Command without usage',
        usage: '',
        execute: async () => 'executed',
      };
      registerCommand(noUsageCommand);

      consoleSpy.mockClear();
      const cmd = getCommand('nousagecmd');
      const result = await cmd!.execute('-h', mockContext);

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('No help available');
    });
  });
});
