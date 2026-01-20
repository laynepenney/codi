// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Orchestration Commands for Multi-Agent Workflows
 *
 * Commands for spawning and managing worker agents.
 */

import chalk from 'chalk';
import { registerCommand, type Command, type CommandContext } from './index.js';
import { Orchestrator } from '../orchestrate/commander.js';
import type { WorkerConfig, WorkerState } from '../orchestrate/types.js';

// Global orchestrator instance (initialized lazily)
let orchestrator: Orchestrator | null = null;

/**
 * Get the orchestrator instance (for commands).
 */
export function getOrchestrator(context: CommandContext): Orchestrator | null {
  // Orchestrator requires the agent's context to be set up
  // This is a placeholder - actual initialization happens in index.ts
  return orchestrator;
}

/**
 * Get the orchestrator instance (for cleanup/shutdown).
 */
export function getOrchestratorInstance(): Orchestrator | null {
  return orchestrator;
}

/**
 * Set the orchestrator instance (called from index.ts).
 */
export function setOrchestrator(orch: Orchestrator | null): void {
  orchestrator = orch;
}

/**
 * Generate a unique worker ID.
 */
function generateWorkerId(): string {
  return `worker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Format worker state for display.
 */
function formatWorkerState(state: WorkerState): string {
  const statusColors: Record<string, (s: string) => string> = {
    starting: chalk.yellow,
    idle: chalk.blue,
    thinking: chalk.cyan,
    tool_call: chalk.magenta,
    waiting_permission: chalk.yellow,
    complete: chalk.green,
    failed: chalk.red,
    cancelled: chalk.gray,
  };

  const colorFn = statusColors[state.status] || chalk.white;
  const status = colorFn(state.status.toUpperCase());

  let line = `${chalk.bold(state.config.branch)} [${status}]`;

  if (state.currentTool) {
    line += ` - ${state.currentTool}`;
  }

  if (state.progress !== undefined) {
    line += ` (${state.progress}%)`;
  }

  if (state.error) {
    line += chalk.red(` Error: ${state.error}`);
  }

  return line;
}

/**
 * /delegate command - Spawn a worker agent in a new worktree.
 */
export const delegateCommand: Command = {
  name: 'delegate',
  aliases: ['spawn', 'worker'],
  description: 'Spawn a worker agent in a git worktree to work on a task',
  usage: '/delegate <branch-name> <task description> [--model <model>] [--provider <provider>]',

  execute: async (args, context): Promise<string | null> => {
    if (!args.trim()) {
      console.log(chalk.yellow('Usage: /delegate <branch-name> <task>'));
      console.log(chalk.dim('Example: /delegate feat/auth "implement user authentication"'));
      return null;
    }

    // Parse arguments
    const parts = args.match(/^(\S+)\s+(.+)$/);
    if (!parts) {
      console.log(chalk.red('Invalid arguments. Expected: /delegate <branch> <task>'));
      return null;
    }

    const [, branch, taskAndFlags] = parts;

    // Extract flags
    let task = taskAndFlags;
    let model: string | undefined;
    let provider: string | undefined;

    const modelMatch = task.match(/--model\s+(\S+)/);
    if (modelMatch) {
      model = modelMatch[1];
      task = task.replace(modelMatch[0], '').trim();
    }

    const providerMatch = task.match(/--provider\s+(\S+)/);
    if (providerMatch) {
      provider = providerMatch[1];
      task = task.replace(providerMatch[0], '').trim();
    }

    // Remove quotes from task if present
    task = task.replace(/^["']|["']$/g, '');

    if (!orchestrator) {
      console.log(chalk.red('Orchestrator not initialized. This feature requires additional setup.'));
      return null;
    }

    const config: WorkerConfig = {
      id: generateWorkerId(),
      branch,
      task,
      model,
      provider,
    };

    try {
      const workerId = await orchestrator.spawnWorker(config);
      console.log(chalk.green(`Worker spawned: ${workerId}`));
      console.log(chalk.dim(`  Branch: ${branch}`));
      console.log(chalk.dim(`  Task: ${task}`));
      if (model) console.log(chalk.dim(`  Model: ${model}`));

      return null; // Don't send to AI
    } catch (err) {
      console.error(chalk.red(`Failed to spawn worker: ${err instanceof Error ? err.message : err}`));
      return null;
    }
  },
};

/**
 * /workers command - List and manage worker agents.
 */
export const workersCommand: Command = {
  name: 'workers',
  aliases: ['wk'],
  description: 'List and manage worker agents',
  usage: '/workers [list|status|cancel <id>|wait]',
  subcommands: ['list', 'status', 'cancel', 'wait', 'cleanup'],

  execute: async (args, context): Promise<string | null> => {
    if (!orchestrator) {
      console.log(chalk.yellow('No workers active. Use /delegate to spawn workers.'));
      return null;
    }

    const [action, ...rest] = args.trim().split(/\s+/);

    switch (action || 'list') {
      case 'list':
      case 'status': {
        const workers = orchestrator.getWorkers();
        if (workers.length === 0) {
          console.log(chalk.dim('No active workers'));
          return null;
        }

        console.log(chalk.bold('\nWorkers:'));
        for (const state of workers) {
          console.log(`  ${formatWorkerState(state)}`);
        }
        console.log();
        return null;
      }

      case 'cancel': {
        const workerId = rest[0];
        if (!workerId) {
          console.log(chalk.red('Usage: /workers cancel <worker-id or branch>'));
          return null;
        }

        // Find by ID or branch
        const workers = orchestrator.getWorkers();
        const worker = workers.find(
          (w) => w.config.id === workerId || w.config.branch === workerId
        );

        if (!worker) {
          console.log(chalk.red(`Worker not found: ${workerId}`));
          return null;
        }

        await orchestrator.cancelWorker(worker.config.id);
        console.log(chalk.yellow(`Cancelled worker: ${worker.config.branch}`));
        return null;
      }

      case 'wait': {
        const active = orchestrator.getActiveWorkers();
        if (active.length === 0) {
          console.log(chalk.dim('No active workers to wait for'));
          return null;
        }

        console.log(chalk.dim(`Waiting for ${active.length} worker(s) to complete...`));
        const results = await orchestrator.waitAll();

        console.log(chalk.bold('\nResults:'));
        for (const result of results) {
          const status = result.success ? chalk.green('SUCCESS') : chalk.red('FAILED');
          console.log(`  ${result.branch}: ${status}`);
          if (result.error) {
            console.log(chalk.red(`    Error: ${result.error}`));
          }
          if (result.prUrl) {
            console.log(chalk.blue(`    PR: ${result.prUrl}`));
          }
        }
        return null;
      }

      case 'cleanup': {
        console.log(chalk.dim('Cleaning up workers and worktrees...'));
        await orchestrator.stop();
        orchestrator = null;
        console.log(chalk.green('Cleanup complete'));
        return null;
      }

      default:
        console.log(chalk.yellow(`Unknown action: ${action}`));
        console.log(chalk.dim('Available: list, status, cancel, wait, cleanup'));
        return null;
    }
  },
};

/**
 * /worktrees command - List git worktrees.
 */
export const worktreesCommand: Command = {
  name: 'worktrees',
  aliases: ['wt'],
  description: 'List git worktrees',
  usage: '/worktrees',

  execute: async (args, context): Promise<string | null> => {
    // This is a simple wrapper - actual implementation would use WorktreeManager
    return 'List all git worktrees with `git worktree list`. Show their branches, paths, and whether they are managed by the orchestrator.';
  },
};

// Register commands
registerCommand(delegateCommand);
registerCommand(workersCommand);
registerCommand(worktreesCommand);
