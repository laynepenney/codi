import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShellInfoTool } from '../src/tools/shell-info.js';
import { exec as originalExec } from 'child_process';
import { promisify } from 'util';

// Mock child_process.exec
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    exec: vi.fn(),
  };
});

import { exec as mockedExec } from 'child_process';

describe('ShellInfoTool', () => {
  let tool: ShellInfoTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new ShellInfoTool();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();

      expect(def.name).toBe('shell_info');
      expect(def.description).toContain('environment information');
      expect(def.input_schema.properties).toHaveProperty('commands');
      expect(def.input_schema.properties).toHaveProperty('include_defaults');
      expect(def.input_schema.properties).toHaveProperty('cwd');
      expect(def.input_schema.required).toEqual([]);
    });
  });

  describe('execute', () => {
    it('runs default commands when no input provided', async () => {
      // Mock exec to call callback with success
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(null, { stdout: 'v20.0.0', stderr: '' } as any);
        }
        return {} as any;
      });

      const result = await tool.execute({});

      expect(result).toContain('## Environment Information');
      expect(result).toContain('### Available');
      expect(mockedExec).toHaveBeenCalled();
    });

    it('runs custom commands when provided', async () => {
      vi.mocked(mockedExec).mockImplementation((cmd, _opts, callback) => {
        if (callback) {
          const cmdStr = cmd as string;
          if (cmdStr === 'echo hello') {
            callback(null, { stdout: 'hello', stderr: '' } as any);
          } else if (cmdStr === 'date') {
            callback(null, { stdout: '2024-01-01', stderr: '' } as any);
          }
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['echo hello', 'date'],
      });

      expect(result).toContain('echo hello');
      expect(result).toContain('date');
      // Should NOT include default commands
      expect(result).not.toContain('node -v');
    });

    it('includes defaults when include_defaults is true', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(null, { stdout: 'output', stderr: '' } as any);
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['custom-cmd'],
        include_defaults: true,
      });

      expect(result).toContain('custom-cmd');
      // Should include default commands like node -v
      const callCount = vi.mocked(mockedExec).mock.calls.length;
      expect(callCount).toBeGreaterThan(1); // custom + defaults
    });

    it('deduplicates commands', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(null, { stdout: 'output', stderr: '' } as any);
        }
        return {} as any;
      });

      await tool.execute({
        commands: ['node -v', 'node -v', 'npm -v'],
      });

      const calls = vi.mocked(mockedExec).mock.calls;
      const commands = calls.map((c) => c[0]);
      expect(new Set(commands).size).toBe(commands.length); // All unique
    });

    it('handles command failures gracefully', async () => {
      vi.mocked(mockedExec).mockImplementation((cmd, _opts, callback) => {
        if (callback) {
          const cmdStr = cmd as string;
          if (cmdStr === 'good-cmd') {
            callback(null, { stdout: 'success', stderr: '' } as any);
          } else {
            callback(new Error('Command not found') as any, { stdout: '', stderr: '' } as any);
          }
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['good-cmd', 'bad-cmd'],
      });

      expect(result).toContain('### Available');
      expect(result).toContain('good-cmd');
      expect(result).toContain('### Not Available');
      expect(result).toContain('bad-cmd');
    });

    it('shows summary with counts', async () => {
      vi.mocked(mockedExec).mockImplementation((cmd, _opts, callback) => {
        if (callback) {
          const cmdStr = cmd as string;
          if (cmdStr.includes('success')) {
            callback(null, { stdout: 'output', stderr: '' } as any);
          } else {
            callback(new Error('fail') as any, { stdout: '', stderr: '' } as any);
          }
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['success-1', 'success-2', 'fail-1'],
      });

      expect(result).toContain('**Summary:** 2 available, 1 not available');
    });

    it('shows working directory', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(null, { stdout: 'output', stderr: '' } as any);
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['test'],
        cwd: '/custom/path',
      });

      expect(result).toContain('**Working Directory:** /custom/path');
    });

    it('uses stderr when stdout is empty', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          // java -version outputs to stderr
          callback(null, { stdout: '', stderr: 'java version "17.0.1"' } as any);
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['java -version'],
      });

      expect(result).toContain('java version');
    });

    it('takes only first line of multi-line output', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(null, { stdout: 'line1\nline2\nline3', stderr: '' } as any);
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['multiline-cmd'],
      });

      expect(result).toContain('line1');
      expect(result).not.toContain('line2');
    });

    it('passes cwd option to exec', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(null, { stdout: 'output', stderr: '' } as any);
        }
        return {} as any;
      });

      await tool.execute({
        commands: ['test'],
        cwd: '/my/custom/dir',
      });

      const call = vi.mocked(mockedExec).mock.calls[0];
      const options = call[1] as { cwd: string };
      expect(options.cwd).toBe('/my/custom/dir');
    });

    it('handles all commands failing', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(new Error('not found') as any, { stdout: '', stderr: '' } as any);
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['cmd1', 'cmd2'],
      });

      expect(result).toContain('### Not Available');
      expect(result).toContain('cmd1');
      expect(result).toContain('cmd2');
      expect(result).not.toContain('### Available');
    });

    it('handles all commands succeeding', async () => {
      vi.mocked(mockedExec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) {
          callback(null, { stdout: 'success', stderr: '' } as any);
        }
        return {} as any;
      });

      const result = await tool.execute({
        commands: ['cmd1', 'cmd2'],
      });

      expect(result).toContain('### Available');
      expect(result).not.toContain('### Not Available');
    });
  });
});
