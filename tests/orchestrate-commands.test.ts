// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  delegateCommand,
  workersCommand,
  worktreesCommand,
  setOrchestrator,
  getOrchestratorInstance,
} from '../src/commands/orchestrate-commands.js';
import type { CommandContext } from '../src/commands/index.js';

// Mock chalk to avoid color codes in tests
vi.mock('chalk', () => ({
  default: {
    yellow: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
    blue: (s: string) => s,
    magenta: (s: string) => s,
    gray: (s: string) => s,
    white: (s: string) => s,
    bold: (s: string) => s,
  },
}));

// Create mock orchestrator
function createMockOrchestrator() {
  return {
    spawnWorker: vi.fn().mockResolvedValue('worker_123'),
    getWorkers: vi.fn().mockReturnValue([
      {
        config: { id: 'worker_1', branch: 'feat/auth', task: 'implement auth' },
        status: 'thinking',
        currentTool: null,
      },
      {
        config: { id: 'worker_2', branch: 'feat/api', task: 'add API' },
        status: 'tool_call',
        currentTool: 'write_file',
      },
    ]),
    getActiveWorkers: vi.fn().mockReturnValue([]),
    cancelWorker: vi.fn().mockResolvedValue(undefined),
    waitAll: vi.fn().mockResolvedValue([]),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

const createContext = (): CommandContext => ({
  workingDirectory: '/test/project',
});

describe('Orchestrate Commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset module state
    setOrchestrator(null);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('delegateCommand', () => {
    it('has correct name and aliases', () => {
      expect(delegateCommand.name).toBe('delegate');
      expect(delegateCommand.aliases).toContain('spawn');
      expect(delegateCommand.aliases).toContain('worker');
    });

    it('shows usage when no args provided', async () => {
      const result = await delegateCommand.execute('', createContext());

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Usage:');
    });

    it('shows error when args are invalid', async () => {
      const result = await delegateCommand.execute('only-branch', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Invalid arguments');
    });

    it('shows error when orchestrator is not initialized', async () => {
      const result = await delegateCommand.execute('feat/test "implement test"', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Orchestrator not initialized');
    });

    it('spawns worker with valid args', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      const result = await delegateCommand.execute('feat/auth "implement authentication"', createContext());

      expect(result).toBeNull();
      expect(mockOrch.spawnWorker).toHaveBeenCalled();
      const call = mockOrch.spawnWorker.mock.calls[0][0];
      expect(call.branch).toBe('feat/auth');
      expect(call.task).toBe('implement authentication');
    });

    it('parses --model flag', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      await delegateCommand.execute('feat/test "task" --model claude-3', createContext());

      const call = mockOrch.spawnWorker.mock.calls[0][0];
      expect(call.model).toBe('claude-3');
    });

    it('parses --provider flag', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      await delegateCommand.execute('feat/test "task" --provider anthropic', createContext());

      const call = mockOrch.spawnWorker.mock.calls[0][0];
      expect(call.provider).toBe('anthropic');
    });

    it('handles spawn error', async () => {
      const mockOrch = createMockOrchestrator();
      mockOrch.spawnWorker.mockRejectedValue(new Error('Branch already exists'));
      setOrchestrator(mockOrch as any);

      const result = await delegateCommand.execute('feat/test "task"', createContext());

      expect(result).toBeNull();
      const errorOutput = vi.mocked(console.error).mock.calls.flat().join('\n');
      expect(errorOutput).toContain('Failed to spawn worker');
    });
  });

  describe('workersCommand', () => {
    it('has correct name', () => {
      expect(workersCommand.name).toBe('workers');
    });

    it('shows "no workers active" when orchestrator is null', async () => {
      const result = await workersCommand.execute('', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('No workers active');
    });

    it('shows no active workers message when none active', async () => {
      const mockOrch = createMockOrchestrator();
      mockOrch.getWorkers.mockReturnValue([]);
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('No active workers');
    });

    it('lists active workers', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('', createContext());

      expect(result).toBeNull();
      expect(mockOrch.getWorkers).toHaveBeenCalled();
    });

    it('cancels specific worker', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('cancel worker_1', createContext());

      expect(result).toBeNull();
      expect(mockOrch.cancelWorker).toHaveBeenCalledWith('worker_1');
    });

    it('cancels worker by branch name', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('cancel feat/auth', createContext());

      expect(result).toBeNull();
      expect(mockOrch.cancelWorker).toHaveBeenCalledWith('worker_1');
    });

    it('shows error when no worker ID provided for cancel', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('cancel', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Usage:');
    });

    it('shows error when worker not found', async () => {
      const mockOrch = createMockOrchestrator();
      mockOrch.getWorkers.mockReturnValue([]);
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('cancel unknown', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Worker not found');
    });

    it('handles wait command with no active workers', async () => {
      const mockOrch = createMockOrchestrator();
      mockOrch.getActiveWorkers.mockReturnValue([]);
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('wait', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('No active workers to wait for');
    });

    it('handles cleanup command', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('cleanup', createContext());

      expect(result).toBeNull();
      expect(mockOrch.stop).toHaveBeenCalled();
    });

    it('shows error for unknown action', async () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);

      const result = await workersCommand.execute('unknown', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Unknown action');
    });
  });

  describe('worktreesCommand', () => {
    it('has correct name', () => {
      expect(worktreesCommand.name).toBe('worktrees');
    });

    it('returns a prompt string for the AI', async () => {
      const result = await worktreesCommand.execute('', createContext());

      // worktreesCommand returns a prompt for the AI to list worktrees
      expect(result).toContain('git worktree');
    });
  });

  describe('getOrchestratorInstance', () => {
    it('returns null when not set', () => {
      setOrchestrator(null);
      expect(getOrchestratorInstance()).toBeNull();
    });

    it('returns orchestrator when set', () => {
      const mockOrch = createMockOrchestrator();
      setOrchestrator(mockOrch as any);
      expect(getOrchestratorInstance()).toBe(mockOrch);
    });
  });
});
