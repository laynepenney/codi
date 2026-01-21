// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tools for AI-driven multi-agent orchestration.
 *
 * These tools allow the AI to autonomously spawn and manage worker agents
 * that run in parallel in isolated git worktrees.
 */

import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { getOrchestratorInstance } from '../commands/orchestrate-commands.js';
import type { WorkerState, WorkerResult } from '../orchestrate/types.js';

/**
 * Generate a unique worker ID.
 */
function generateWorkerId(): string {
  return `worker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Tool for spawning a worker agent to handle a task in parallel.
 */
export class DelegateTaskTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'delegate_task',
      description: `Spawn a parallel worker agent in an isolated git worktree to handle a task.
The worker runs independently and you can continue working on other things.
Use this for tasks that can be parallelized, like implementing features on separate branches.
Workers create their own branches and can make commits.

IMPORTANT: Only use this for substantial, independent tasks that benefit from isolation.
Do NOT use for simple file reads, searches, or quick edits - do those yourself.`,
      input_schema: {
        type: 'object',
        properties: {
          branch: {
            type: 'string',
            description: 'Branch name for the worker (e.g., "feat/auth", "fix/bug-123")',
          },
          task: {
            type: 'string',
            description: 'Detailed task description for the worker. Be specific about what to implement.',
          },
          model: {
            type: 'string',
            description: 'Optional model to use (defaults to current model)',
          },
          auto_approve: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of tools to auto-approve (e.g., ["read_file", "glob"])',
          },
        },
        required: ['branch', 'task'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const orchestrator = getOrchestratorInstance();
    if (!orchestrator) {
      return 'Error: Orchestrator not available. Multi-agent orchestration requires a git repository.';
    }

    const branch = input.branch as string;
    const task = input.task as string;
    const model = input.model as string | undefined;
    const autoApprove = input.auto_approve as string[] | undefined;

    if (!branch || !task) {
      return 'Error: Both branch and task are required.';
    }

    // Validate branch name
    if (!/^[a-zA-Z0-9._/-]+$/.test(branch)) {
      return 'Error: Invalid branch name. Use alphanumeric characters, dots, underscores, slashes, and hyphens.';
    }

    try {
      const workerId = generateWorkerId();
      await orchestrator.spawnWorker({
        id: workerId,
        branch,
        task,
        model,
        autoApprove,
      });

      return `Worker spawned successfully.
- Worker ID: ${workerId}
- Branch: ${branch}
- Task: ${task}

The worker is now running in the background. Use check_workers to monitor progress.
Continue with your own work - you'll be notified when the worker needs permission or completes.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error spawning worker: ${message}`;
    }
  }
}

/**
 * Tool for checking the status of all workers.
 */
export class CheckWorkersTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'check_workers',
      description: `Check the status of all running worker agents.
Shows each worker's branch, status, current activity, and any errors.
Use this to monitor progress of delegated tasks.`,
      input_schema: {
        type: 'object',
        properties: {
          worker_id: {
            type: 'string',
            description: 'Optional specific worker ID to check. If omitted, shows all workers.',
          },
        },
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const orchestrator = getOrchestratorInstance();
    if (!orchestrator) {
      return 'Error: Orchestrator not available.';
    }

    const workerId = input.worker_id as string | undefined;

    if (workerId) {
      const worker = orchestrator.getWorker(workerId);
      if (!worker) {
        return `Worker not found: ${workerId}`;
      }
      return formatWorkerDetails(worker);
    }

    const workers = orchestrator.getWorkers();
    if (workers.length === 0) {
      return 'No workers currently active.';
    }

    const lines = ['## Active Workers\n'];
    for (const worker of workers) {
      lines.push(formatWorkerSummary(worker));
    }

    const active = workers.filter(w =>
      w.status !== 'complete' && w.status !== 'failed' && w.status !== 'cancelled'
    );
    const completed = workers.filter(w => w.status === 'complete');
    const failed = workers.filter(w => w.status === 'failed');

    lines.push('');
    lines.push(`Summary: ${active.length} active, ${completed.length} completed, ${failed.length} failed`);

    return lines.join('\n');
  }
}

/**
 * Tool for getting the result of a completed worker.
 */
export class GetWorkerResultTool extends BaseTool {
  private results: Map<string, WorkerResult> = new Map();

  getDefinition(): ToolDefinition {
    return {
      name: 'get_worker_result',
      description: `Get the result of a completed worker agent.
Returns the worker's response, files changed, commits made, and any errors.
Only works for workers that have completed (success or failure).`,
      input_schema: {
        type: 'object',
        properties: {
          worker_id: {
            type: 'string',
            description: 'The worker ID to get results for',
          },
        },
        required: ['worker_id'],
      },
    };
  }

  /**
   * Store a worker result (called by orchestrator event handler).
   */
  storeResult(result: WorkerResult): void {
    this.results.set(result.workerId, result);
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const orchestrator = getOrchestratorInstance();
    if (!orchestrator) {
      return 'Error: Orchestrator not available.';
    }

    const workerId = input.worker_id as string;
    if (!workerId) {
      return 'Error: worker_id is required.';
    }

    const worker = orchestrator.getWorker(workerId);
    if (!worker) {
      return `Worker not found: ${workerId}`;
    }

    if (worker.status !== 'complete' && worker.status !== 'failed') {
      return `Worker ${workerId} has not completed yet. Status: ${worker.status}`;
    }

    // Check if we have a cached result
    const result = this.results.get(workerId);
    if (result) {
      return formatWorkerResult(result);
    }

    // Worker completed but we don't have the result (might have been before we started listening)
    return `Worker ${workerId} status: ${worker.status}
Branch: ${worker.config.branch}
${worker.error ? `Error: ${worker.error}` : ''}

Note: Detailed result not available. The worker may have completed before result tracking started.`;
  }
}

/**
 * Tool for cancelling a running worker.
 */
export class CancelWorkerTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'cancel_worker',
      description: `Cancel a running worker agent.
Use this if a worker is stuck, taking too long, or no longer needed.
The worker's worktree and branch will be cleaned up.`,
      input_schema: {
        type: 'object',
        properties: {
          worker_id: {
            type: 'string',
            description: 'The worker ID to cancel',
          },
        },
        required: ['worker_id'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const orchestrator = getOrchestratorInstance();
    if (!orchestrator) {
      return 'Error: Orchestrator not available.';
    }

    const workerId = input.worker_id as string;
    if (!workerId) {
      return 'Error: worker_id is required.';
    }

    const worker = orchestrator.getWorker(workerId);
    if (!worker) {
      return `Worker not found: ${workerId}`;
    }

    if (worker.status === 'complete' || worker.status === 'failed' || worker.status === 'cancelled') {
      return `Worker ${workerId} already finished with status: ${worker.status}`;
    }

    try {
      await orchestrator.cancelWorker(workerId);
      return `Worker ${workerId} (${worker.config.branch}) cancelled successfully.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error cancelling worker: ${message}`;
    }
  }
}

/**
 * Format worker state for summary display.
 */
function formatWorkerSummary(state: WorkerState): string {
  const statusEmoji: Record<string, string> = {
    starting: '🔄',
    idle: '💤',
    thinking: '🤔',
    tool_call: '🔧',
    waiting_permission: '⏸️',
    complete: '✅',
    failed: '❌',
    cancelled: '🚫',
  };

  const emoji = statusEmoji[state.status] || '❓';
  let line = `${emoji} **${state.config.branch}** - ${state.status}`;

  if (state.currentTool) {
    line += ` (${state.currentTool})`;
  }

  if (state.error) {
    line += ` - Error: ${state.error}`;
  }

  return line;
}

/**
 * Format detailed worker state.
 */
function formatWorkerDetails(state: WorkerState): string {
  const lines = [
    `## Worker: ${state.config.id}`,
    '',
    `**Branch:** ${state.config.branch}`,
    `**Status:** ${state.status}`,
    `**Task:** ${state.config.task}`,
    '',
  ];

  if (state.currentTool) {
    lines.push(`**Current Tool:** ${state.currentTool}`);
  }

  if (state.progress !== undefined) {
    lines.push(`**Progress:** ${state.progress}%`);
  }

  if (state.tokensUsed) {
    lines.push(`**Tokens:** ${state.tokensUsed.input} in / ${state.tokensUsed.output} out`);
  }

  const duration = state.completedAt
    ? state.completedAt.getTime() - state.startedAt.getTime()
    : Date.now() - state.startedAt.getTime();
  lines.push(`**Duration:** ${Math.round(duration / 1000)}s`);

  if (state.error) {
    lines.push('');
    lines.push(`**Error:** ${state.error}`);
  }

  return lines.join('\n');
}

/**
 * Format worker result.
 */
function formatWorkerResult(result: WorkerResult): string {
  const lines = [
    `## Worker Result: ${result.workerId}`,
    '',
    `**Branch:** ${result.branch}`,
    `**Success:** ${result.success ? 'Yes' : 'No'}`,
    `**Duration:** ${Math.round(result.duration / 1000)}s`,
    `**Tool Calls:** ${result.toolCallCount}`,
    `**Tokens:** ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`,
    '',
  ];

  if (result.commits > 0) {
    lines.push(`**Commits:** ${result.commits}`);
  }

  if (result.filesChanged.length > 0) {
    lines.push(`**Files Changed:** ${result.filesChanged.length}`);
    for (const file of result.filesChanged.slice(0, 10)) {
      lines.push(`  - ${file}`);
    }
    if (result.filesChanged.length > 10) {
      lines.push(`  - ... and ${result.filesChanged.length - 10} more`);
    }
  }

  if (result.prUrl) {
    lines.push(`**PR:** ${result.prUrl}`);
  }

  if (result.error) {
    lines.push('');
    lines.push(`**Error:** ${result.error}`);
  }

  lines.push('');
  lines.push('**Response:**');
  lines.push(result.response);

  return lines.join('\n');
}
