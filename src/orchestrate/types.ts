// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared types for Multi-Agent Orchestration
 */

import type { WorkerStatus } from './ipc/protocol.js';

/**
 * Configuration for spawning a worker agent.
 */
export interface WorkerConfig {
  /** Unique identifier for this worker */
  id: string;
  /** Branch name to create for this worker */
  branch: string;
  /** Task description/prompt for the worker */
  task: string;
  /** Model to use (from model-map) */
  model?: string;
  /** Provider override */
  provider?: string;
  /** Worker role (from codi-models.yaml) */
  role?: string;
  /** Tools to auto-approve for this worker */
  autoApprove?: string[];
  /** Maximum iterations for the agent loop */
  maxIterations?: number;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Information about a git worktree.
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch checked out in this worktree */
  branch: string;
  /** Whether this worktree was created by the orchestrator */
  managed: boolean;
  /** When the worktree was created */
  createdAt: Date;
}

/**
 * Current state of a worker agent.
 */
export interface WorkerState {
  /** Worker configuration */
  config: WorkerConfig;
  /** Worktree information */
  worktree: WorktreeInfo;
  /** Current status */
  status: WorkerStatus;
  /** Child process PID */
  pid?: number;
  /** Current tool being executed */
  currentTool?: string;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Token usage */
  tokensUsed?: { input: number; output: number };
  /** Number of restart attempts */
  restartCount: number;
  /** Error message if failed */
  error?: string;
  /** Start time */
  startedAt: Date;
  /** Completion time */
  completedAt?: Date;
}

/**
 * Result of a completed worker task.
 */
export interface WorkerResult {
  /** Worker ID */
  workerId: string;
  /** Whether the task succeeded */
  success: boolean;
  /** Response from the agent */
  response: string;
  /** Number of tool calls made */
  toolCallCount: number;
  /** Total tokens used */
  tokensUsed: { input: number; output: number };
  /** Duration in milliseconds */
  duration: number;
  /** PR URL if created */
  prUrl?: string;
  /** Branch name */
  branch: string;
  /** Number of commits made */
  commits: number;
  /** Files changed */
  filesChanged: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Options for the orchestrator.
 */
export interface OrchestratorOptions {
  /** Path to the Unix socket (default: ~/.codi/orchestrator.sock) */
  socketPath?: string;
  /** Maximum concurrent workers (default: 4) */
  maxWorkers?: number;
  /** Directory for worktrees (default: parent of repo) */
  worktreeDir?: string;
  /** Prefix for worktree directories (default: 'codi-worker-') */
  worktreePrefix?: string;
  /** Base branch to create feature branches from (default: 'main') */
  baseBranch?: string;
  /** Whether to cleanup worktrees on exit (default: true) */
  cleanupOnExit?: boolean;
  /** Maximum restart attempts for failed workers (default: 1) */
  maxRestarts?: number;
}

/**
 * Worker role configuration (from codi-models.yaml).
 */
export interface WorkerRole {
  /** Model to use for this role */
  model: string;
  /** Provider override */
  provider?: string;
  /** Tools to auto-approve */
  autoApprove?: string[];
  /** Description of the role */
  description?: string;
}

/**
 * Default orchestrator options.
 */
export const DEFAULT_ORCHESTRATOR_OPTIONS: Required<OrchestratorOptions> = {
  socketPath: '', // Will be computed at runtime
  maxWorkers: 4,
  worktreeDir: '', // Will be computed at runtime
  worktreePrefix: 'codi-worker-',
  baseBranch: 'main',
  cleanupOnExit: true,
  maxRestarts: 1,
};
