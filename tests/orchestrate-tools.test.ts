// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DelegateTaskTool,
  CheckWorkersTool,
  GetWorkerResultTool,
  CancelWorkerTool,
} from '../src/tools/orchestrate-tools.js';

// Mock the orchestrate-commands module
vi.mock('../src/commands/orchestrate-commands.js', () => {
  let mockOrchestrator: unknown = null;
  return {
    getOrchestratorInstance: () => mockOrchestrator,
    __setMockOrchestrator: (orch: unknown) => {
      mockOrchestrator = orch;
    },
  };
});

import { __setMockOrchestrator } from '../src/commands/orchestrate-commands.js';

describe('Orchestration Tools', () => {
  beforeEach(() => {
    __setMockOrchestrator(null);
  });

  describe('DelegateTaskTool', () => {
    it('has correct tool definition', () => {
      const tool = new DelegateTaskTool();
      const def = tool.getDefinition();

      expect(def.name).toBe('delegate_task');
      expect(def.description).toContain('Spawn a parallel worker agent');
      expect(def.input_schema.required).toContain('branch');
      expect(def.input_schema.required).toContain('task');
    });

    it('returns error when orchestrator not available', async () => {
      const tool = new DelegateTaskTool();
      const result = await tool.execute({ branch: 'feat/test', task: 'do something' });

      expect(result).toContain('Orchestrator not available');
    });

    it('returns error for missing branch', async () => {
      const mockOrchestrator = {
        spawnWorker: vi.fn(),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new DelegateTaskTool();
      const result = await tool.execute({ task: 'do something' });

      expect(result).toContain('Both branch and task are required');
    });

    it('returns error for missing task', async () => {
      const mockOrchestrator = {
        spawnWorker: vi.fn(),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new DelegateTaskTool();
      const result = await tool.execute({ branch: 'feat/test' });

      expect(result).toContain('Both branch and task are required');
    });

    it('returns error for invalid branch name', async () => {
      const mockOrchestrator = {
        spawnWorker: vi.fn(),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new DelegateTaskTool();
      const result = await tool.execute({ branch: 'feat test!@#', task: 'do something' });

      expect(result).toContain('Invalid branch name');
    });

    it('spawns worker successfully', async () => {
      const mockOrchestrator = {
        spawnWorker: vi.fn().mockResolvedValue('worker_123'),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new DelegateTaskTool();
      const result = await tool.execute({
        branch: 'feat/auth',
        task: 'implement authentication',
      });

      expect(mockOrchestrator.spawnWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: 'feat/auth',
          task: 'implement authentication',
        })
      );
      expect(result).toContain('Worker spawned successfully');
      expect(result).toContain('feat/auth');
    });

    it('handles spawn error gracefully', async () => {
      const mockOrchestrator = {
        spawnWorker: vi.fn().mockRejectedValue(new Error('Worktree creation failed')),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new DelegateTaskTool();
      const result = await tool.execute({
        branch: 'feat/test',
        task: 'do something',
      });

      expect(result).toContain('Error spawning worker');
      expect(result).toContain('Worktree creation failed');
    });
  });

  describe('CheckWorkersTool', () => {
    it('has correct tool definition', () => {
      const tool = new CheckWorkersTool();
      const def = tool.getDefinition();

      expect(def.name).toBe('check_workers');
      expect(def.description).toContain('Check the status');
    });

    it('returns error when orchestrator not available', async () => {
      const tool = new CheckWorkersTool();
      const result = await tool.execute({});

      expect(result).toContain('Orchestrator not available');
    });

    it('returns message when no workers active', async () => {
      const mockOrchestrator = {
        getWorkers: vi.fn().mockReturnValue([]),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CheckWorkersTool();
      const result = await tool.execute({});

      expect(result).toContain('No workers currently active');
    });

    it('lists all workers', async () => {
      const mockOrchestrator = {
        getWorkers: vi.fn().mockReturnValue([
          {
            config: { id: 'worker_1', branch: 'feat/auth', task: 'implement auth' },
            status: 'thinking',
            currentTool: 'read_file',
          },
          {
            config: { id: 'worker_2', branch: 'feat/api', task: 'add endpoints' },
            status: 'complete',
          },
        ]),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CheckWorkersTool();
      const result = await tool.execute({});

      expect(result).toContain('Active Workers');
      expect(result).toContain('feat/auth');
      expect(result).toContain('feat/api');
      expect(result).toContain('thinking');
      expect(result).toContain('complete');
    });

    it('shows specific worker details', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue({
          config: { id: 'worker_1', branch: 'feat/auth', task: 'implement auth' },
          status: 'tool_call',
          currentTool: 'write_file',
          progress: 50,
          tokensUsed: { input: 1000, output: 500 },
          startedAt: new Date(Date.now() - 60000),
        }),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CheckWorkersTool();
      const result = await tool.execute({ worker_id: 'worker_1' });

      expect(result).toContain('Worker: worker_1');
      expect(result).toContain('feat/auth');
      expect(result).toContain('tool_call');
      expect(result).toContain('**Current Tool:** write_file');
      expect(result).toContain('**Progress:** 50%');
    });

    it('returns error when worker not found', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue(null),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CheckWorkersTool();
      const result = await tool.execute({ worker_id: 'nonexistent' });

      expect(result).toContain('Worker not found');
    });
  });

  describe('GetWorkerResultTool', () => {
    it('has correct tool definition', () => {
      const tool = new GetWorkerResultTool();
      const def = tool.getDefinition();

      expect(def.name).toBe('get_worker_result');
      expect(def.description).toContain('result of a completed worker');
      expect(def.input_schema.required).toContain('worker_id');
    });

    it('returns error when orchestrator not available', async () => {
      const tool = new GetWorkerResultTool();
      const result = await tool.execute({ worker_id: 'test' });

      expect(result).toContain('Orchestrator not available');
    });

    it('returns error when worker_id missing', async () => {
      const mockOrchestrator = {};
      __setMockOrchestrator(mockOrchestrator);

      const tool = new GetWorkerResultTool();
      const result = await tool.execute({});

      expect(result).toContain('worker_id is required');
    });

    it('returns error when worker not found', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue(null),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new GetWorkerResultTool();
      const result = await tool.execute({ worker_id: 'nonexistent' });

      expect(result).toContain('Worker not found');
    });

    it('returns error when worker not completed', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue({
          status: 'thinking',
          config: { id: 'worker_1', branch: 'feat/test' },
        }),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new GetWorkerResultTool();
      const result = await tool.execute({ worker_id: 'worker_1' });

      expect(result).toContain('has not completed yet');
      expect(result).toContain('thinking');
    });

    it('returns stored result for completed worker', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue({
          status: 'complete',
          config: { id: 'worker_1', branch: 'feat/auth' },
        }),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new GetWorkerResultTool();

      // Store a result
      tool.storeResult({
        workerId: 'worker_1',
        branch: 'feat/auth',
        success: true,
        response: 'Implemented OAuth2 authentication',
        toolCallCount: 15,
        tokensUsed: { input: 5000, output: 2000 },
        duration: 120000,
        filesChanged: ['src/auth/oauth.ts', 'src/auth/index.ts'],
        commits: 2,
      });

      const result = await tool.execute({ worker_id: 'worker_1' });

      expect(result).toContain('Worker Result: worker_1');
      expect(result).toContain('feat/auth');
      expect(result).toContain('**Success:** Yes');
      expect(result).toContain('**Tool Calls:** 15');
      expect(result).toContain('**Files Changed:** 2');
      expect(result).toContain('oauth.ts');
      expect(result).toContain('Implemented OAuth2');
    });

    it('returns fallback message when no stored result', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue({
          status: 'complete',
          config: { id: 'worker_1', branch: 'feat/test', task: 'some task' },
        }),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new GetWorkerResultTool();
      const result = await tool.execute({ worker_id: 'worker_1' });

      expect(result).toContain('Detailed result not available');
    });
  });

  describe('CancelWorkerTool', () => {
    it('has correct tool definition', () => {
      const tool = new CancelWorkerTool();
      const def = tool.getDefinition();

      expect(def.name).toBe('cancel_worker');
      expect(def.description).toContain('Cancel a running worker');
      expect(def.input_schema.required).toContain('worker_id');
    });

    it('returns error when orchestrator not available', async () => {
      const tool = new CancelWorkerTool();
      const result = await tool.execute({ worker_id: 'test' });

      expect(result).toContain('Orchestrator not available');
    });

    it('returns error when worker_id missing', async () => {
      const mockOrchestrator = {};
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CancelWorkerTool();
      const result = await tool.execute({});

      expect(result).toContain('worker_id is required');
    });

    it('returns error when worker not found', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue(null),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CancelWorkerTool();
      const result = await tool.execute({ worker_id: 'nonexistent' });

      expect(result).toContain('Worker not found');
    });

    it('returns message when worker already finished', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue({
          status: 'complete',
          config: { id: 'worker_1', branch: 'feat/test' },
        }),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CancelWorkerTool();
      const result = await tool.execute({ worker_id: 'worker_1' });

      expect(result).toContain('already finished');
      expect(result).toContain('complete');
    });

    it('cancels running worker successfully', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue({
          status: 'thinking',
          config: { id: 'worker_1', branch: 'feat/auth' },
        }),
        cancelWorker: vi.fn().mockResolvedValue(undefined),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CancelWorkerTool();
      const result = await tool.execute({ worker_id: 'worker_1' });

      expect(mockOrchestrator.cancelWorker).toHaveBeenCalledWith('worker_1');
      expect(result).toContain('cancelled successfully');
      expect(result).toContain('feat/auth');
    });

    it('handles cancel error gracefully', async () => {
      const mockOrchestrator = {
        getWorker: vi.fn().mockReturnValue({
          status: 'thinking',
          config: { id: 'worker_1', branch: 'feat/test' },
        }),
        cancelWorker: vi.fn().mockRejectedValue(new Error('Process already terminated')),
      };
      __setMockOrchestrator(mockOrchestrator);

      const tool = new CancelWorkerTool();
      const result = await tool.execute({ worker_id: 'worker_1' });

      expect(result).toContain('Error cancelling worker');
      expect(result).toContain('Process already terminated');
    });
  });
});
