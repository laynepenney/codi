// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Orchestrator (Commander) for Multi-Agent Orchestration
 *
 * Manages worker agents, handles permission bubbling, and coordinates
 * parallel task execution across git worktrees.
 */

import { spawn, type ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';

/**
 * Resolve the codi executable path, handling dev mode (tsx) vs production.
 * When running via tsx (pnpm dev), process.argv[1] is the .ts source file.
 * Child processes need the compiled .js file since they run with node directly.
 */
function resolveCodiPath(inputPath: string): string {
  // If it's a .ts file, convert to the compiled .js equivalent
  if (inputPath.endsWith('.ts')) {
    // Convert src/index.ts -> dist/index.js
    const compiledPath = inputPath
      .replace(/\/src\//, '/dist/')
      .replace(/\.ts$/, '.js');

    // Verify the compiled file exists
    if (existsSync(compiledPath)) {
      return compiledPath;
    }

    // Fallback: try finding dist/index.js in the same project
    const projectRoot = dirname(dirname(inputPath));
    const fallbackPath = join(projectRoot, 'dist', 'index.js');
    if (existsSync(fallbackPath)) {
      return fallbackPath;
    }
  }

  return inputPath;
}
import type { Interface as ReadlineInterface } from 'readline';
import chalk from 'chalk';

import { IPCServer } from './ipc/server.js';
import type {
  HandshakeMessage,
  PermissionRequestMessage,
  StatusUpdateMessage,
  TaskCompleteMessage,
  TaskErrorMessage,
  LogMessage,
} from './ipc/protocol.js';
import { createMessage, type PermissionResponseMessage } from './ipc/protocol.js';
import { WorktreeManager } from './worktree.js';
import type {
  WorkerConfig,
  WorkerState,
  WorkerResult,
  ReaderConfig,
  ReaderState,
  ReaderResult,
  OrchestratorOptions,
  DEFAULT_ORCHESTRATOR_OPTIONS,
} from './types.js';
import { READER_ALLOWED_TOOLS } from './types.js';
import type { ConfirmationResult, ToolConfirmation } from '../agent.js';

/**
 * Events emitted by the orchestrator.
 */
export interface OrchestratorEvents {
  /** Worker started */
  workerStarted: (workerId: string, config: WorkerConfig) => void;
  /** Worker status changed */
  workerStatus: (workerId: string, state: WorkerState) => void;
  /** Worker completed */
  workerCompleted: (workerId: string, result: WorkerResult) => void;
  /** Worker failed */
  workerFailed: (workerId: string, error: string) => void;
  /** Permission request from worker */
  permissionRequest: (workerId: string, confirmation: ToolConfirmation) => void;
  /** All workers completed */
  allCompleted: (results: WorkerResult[]) => void;
  /** Reader started */
  readerStarted: (readerId: string, config: ReaderConfig) => void;
  /** Reader status changed */
  readerStatus: (readerId: string, state: ReaderState) => void;
  /** Reader completed */
  readerCompleted: (readerId: string, result: ReaderResult) => void;
  /** Reader failed */
  readerFailed: (readerId: string, error: string) => void;
}

/**
 * Callback for prompting user for permission.
 */
export type PermissionPromptCallback = (
  workerId: string,
  confirmation: ToolConfirmation
) => Promise<ConfirmationResult>;

/**
 * Orchestrator options with readline for user interaction.
 */
export interface OrchestratorConfig extends OrchestratorOptions {
  /** Readline interface for permission prompts */
  readline?: ReadlineInterface | undefined;
  /** Custom permission prompt callback */
  onPermissionRequest?: PermissionPromptCallback | undefined;
  /** Repository root path */
  repoRoot: string;
  /** Path to codi executable */
  codiPath?: string;
}

/**
 * Internal config with resolved defaults.
 */
interface ResolvedOrchestratorConfig {
  socketPath: string;
  maxWorkers: number;
  worktreeDir: string;
  worktreePrefix: string;
  baseBranch: string;
  cleanupOnExit: boolean;
  maxRestarts: number;
  readline: ReadlineInterface | undefined;
  onPermissionRequest: PermissionPromptCallback | undefined;
  repoRoot: string;
  codiPath: string;
}

/**
 * Orchestrator for managing multiple worker agents.
 */
export class Orchestrator extends EventEmitter {
  private config: ResolvedOrchestratorConfig;
  private server: IPCServer;
  private worktreeManager: WorktreeManager;
  private workers: Map<string, WorkerState> = new Map();
  private readers: Map<string, ReaderState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private pendingPermissions: Map<string, {
    workerId: string;
    requestId: string;
    confirmation: ToolConfirmation;
  }> = new Map();
  private results: WorkerResult[] = [];
  private readerResults: ReaderResult[] = [];
  private started = false;

  constructor(config: OrchestratorConfig) {
    super();

    // Apply defaults
    this.config = {
      socketPath: config.socketPath || join(homedir(), '.codi', 'orchestrator.sock'),
      maxWorkers: config.maxWorkers || 4,
      worktreeDir: config.worktreeDir || '',
      worktreePrefix: config.worktreePrefix || 'codi-worker-',
      baseBranch: config.baseBranch || 'main',
      cleanupOnExit: config.cleanupOnExit ?? true,
      maxRestarts: config.maxRestarts || 1,
      readline: config.readline,
      onPermissionRequest: config.onPermissionRequest,
      repoRoot: config.repoRoot,
      codiPath: resolveCodiPath(config.codiPath || process.argv[1]), // Resolve to compiled JS
    };

    // Initialize IPC server
    this.server = new IPCServer(this.config.socketPath);
    this.setupServerHandlers();

    // Initialize worktree manager
    this.worktreeManager = new WorktreeManager({
      repoRoot: this.config.repoRoot,
      worktreeDir: this.config.worktreeDir || undefined,
      prefix: this.config.worktreePrefix,
      baseBranch: this.config.baseBranch,
    });
  }

  /**
   * Start the orchestrator.
   */
  async start(): Promise<void> {
    if (this.started) return;
    await this.server.start();
    this.started = true;
  }

  /**
   * Stop the orchestrator and cleanup.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // Kill all worker processes
    for (const [workerId, proc] of this.processes) {
      proc.kill();
      this.processes.delete(workerId);
    }

    // Stop IPC server
    await this.server.stop();

    // Cleanup worktrees if configured
    if (this.config.cleanupOnExit) {
      await this.worktreeManager.cleanup();
    }

    this.started = false;
  }

  /**
   * Spawn a new worker agent.
   */
  async spawnWorker(config: WorkerConfig): Promise<string> {
    if (!this.started) {
      await this.start();
    }

    if (this.workers.size >= this.config.maxWorkers) {
      throw new Error(`Maximum workers (${this.config.maxWorkers}) reached`);
    }

    // Create worktree
    const worktree = await this.worktreeManager.create(config.branch);

    // Initialize worker state
    const state: WorkerState = {
      config,
      worktree,
      status: 'starting',
      restartCount: 0,
      startedAt: new Date(),
    };
    this.workers.set(config.id, state);

    // Spawn child process
    await this.spawnChildProcess(config.id, config, worktree.path);

    this.emit('workerStarted', config.id, config);
    return config.id;
  }

  /**
   * Spawn the child codi process.
   */
  private async spawnChildProcess(
    workerId: string,
    config: WorkerConfig,
    worktreePath: string
  ): Promise<void> {
    const args = [
      '--child-mode',
      '--socket-path', this.config.socketPath,
      '--child-id', workerId,
      '--child-task', config.task,
    ];

    if (config.model) {
      args.push('--model', config.model);
    }
    if (config.provider) {
      args.push('--provider', config.provider);
    }
    if (config.autoApprove?.length) {
      args.push('--auto-approve', config.autoApprove.join(','));
    }

    const proc = spawn('node', [this.config.codiPath, ...args], {
      cwd: worktreePath,
      env: {
        ...process.env,
        CODI_CHILD_MODE: '1',
        CODI_SOCKET_PATH: this.config.socketPath,
        CODI_CHILD_ID: workerId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(workerId, proc);

    // Handle stdout (for debugging)
    proc.stdout?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.log(chalk.dim(`[${config.branch}] ${text}`));
      }
    });

    // Handle stderr
    proc.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error(chalk.red(`[${config.branch}] ${text}`));
      }
    });

    // Handle exit
    proc.on('exit', (code) => {
      this.processes.delete(workerId);
      const state = this.workers.get(workerId);

      if (state && state.status !== 'complete' && state.status !== 'failed') {
        if (code !== 0) {
          state.status = 'failed';
          state.error = `Process exited with code ${code}`;
          this.emit('workerFailed', workerId, state.error);
        }
      }
    });
  }

  /**
   * Cancel a worker.
   */
  async cancelWorker(workerId: string): Promise<void> {
    const state = this.workers.get(workerId);
    if (!state) return;

    // Send cancel message via IPC
    this.server.send(workerId, createMessage('cancel', { reason: 'User cancelled' }));

    // Give it a moment to cleanup, then force kill
    setTimeout(() => {
      const proc = this.processes.get(workerId);
      if (proc) {
        proc.kill('SIGTERM');
      }
    }, 1000);

    state.status = 'cancelled';
    this.emit('workerStatus', workerId, state);
  }

  /**
   * Spawn a lightweight reader agent (no worktree, read-only).
   */
  async spawnReader(config: ReaderConfig): Promise<string> {
    if (!this.started) {
      await this.start();
    }

    // Initialize reader state
    const state: ReaderState = {
      config,
      status: 'starting',
      restartCount: 0,
      startedAt: new Date(),
    };
    this.readers.set(config.id, state);

    // Spawn child process in the repo root (no worktree)
    await this.spawnReaderProcess(config.id, config);

    this.emit('readerStarted', config.id, config);
    return config.id;
  }

  /**
   * Spawn the child codi process for a reader.
   */
  private async spawnReaderProcess(
    readerId: string,
    config: ReaderConfig
  ): Promise<void> {
    const args = [
      '--reader-mode', // Reader-only mode (read-only tools, auto-approved)
      '--socket-path', this.config.socketPath,
      '--child-id', readerId,
      '--child-task', config.query,
    ];

    if (config.model) {
      args.push('--model', config.model);
    }
    if (config.provider) {
      args.push('--provider', config.provider);
    }
    // Note: scope is not a CLI flag - it should be included in the query itself

    const proc = spawn('node', [this.config.codiPath, ...args], {
      cwd: this.config.repoRoot, // Run in main repo, not a worktree
      env: {
        ...process.env,
        CODI_CHILD_MODE: '1',
        CODI_READER_MODE: '1',
        CODI_SOCKET_PATH: this.config.socketPath,
        CODI_CHILD_ID: readerId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(readerId, proc);

    // Handle stdout (for debugging)
    proc.stdout?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.log(chalk.dim(`[reader:${readerId.slice(-5)}] ${text}`));
      }
    });

    // Handle stderr
    proc.stderr?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error(chalk.red(`[reader:${readerId.slice(-5)}] ${text}`));
      }
    });

    // Handle exit
    proc.on('exit', (code) => {
      this.processes.delete(readerId);
      const state = this.readers.get(readerId);

      if (state && state.status !== 'complete' && state.status !== 'failed') {
        if (code !== 0) {
          state.status = 'failed';
          state.error = `Process exited with code ${code}`;
          this.emit('readerFailed', readerId, state.error);
        }
      }
    });
  }

  /**
   * Cancel a reader.
   */
  async cancelReader(readerId: string): Promise<void> {
    const state = this.readers.get(readerId);
    if (!state) return;

    // Send cancel message via IPC
    this.server.send(readerId, createMessage('cancel', { reason: 'User cancelled' }));

    // Give it a moment to cleanup, then force kill
    setTimeout(() => {
      const proc = this.processes.get(readerId);
      if (proc) {
        proc.kill('SIGTERM');
      }
    }, 1000);

    state.status = 'cancelled';
    this.emit('readerStatus', readerId, state);
  }

  /**
   * Get reader state.
   */
  getReader(readerId: string): ReaderState | undefined {
    return this.readers.get(readerId);
  }

  /**
   * Get all reader states.
   */
  getReaders(): ReaderState[] {
    return Array.from(this.readers.values());
  }

  /**
   * Get active (non-completed) readers.
   */
  getActiveReaders(): ReaderState[] {
    return this.getReaders().filter(
      (r) => r.status !== 'complete' && r.status !== 'failed' && r.status !== 'cancelled'
    );
  }

  /**
   * Get worker state.
   */
  getWorker(workerId: string): WorkerState | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all worker states.
   */
  getWorkers(): WorkerState[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get active (non-completed) workers.
   */
  getActiveWorkers(): WorkerState[] {
    return this.getWorkers().filter(
      (w) => w.status !== 'complete' && w.status !== 'failed' && w.status !== 'cancelled'
    );
  }

  /**
   * Wait for all workers to complete.
   */
  async waitAll(): Promise<WorkerResult[]> {
    return new Promise((resolve) => {
      const checkComplete = () => {
        const active = this.getActiveWorkers();
        if (active.length === 0) {
          resolve(this.results);
        }
      };

      this.on('workerCompleted', checkComplete);
      this.on('workerFailed', checkComplete);

      // Initial check in case all already done
      checkComplete();
    });
  }

  /**
   * Setup IPC server event handlers.
   */
  private setupServerHandlers(): void {
    this.server.on('workerConnected', (childId, handshake) => {
      this.handleWorkerConnected(childId, handshake);
    });

    this.server.on('workerDisconnected', (childId) => {
      this.handleWorkerDisconnected(childId);
    });

    this.server.on('permissionRequest', (childId, request) => {
      this.handlePermissionRequest(childId, request);
    });

    this.server.on('statusUpdate', (childId, status) => {
      this.handleStatusUpdate(childId, status);
    });

    this.server.on('taskComplete', (childId, result) => {
      this.handleTaskComplete(childId, result);
    });

    this.server.on('taskError', (childId, error) => {
      this.handleTaskError(childId, error);
    });

    this.server.on('log', (childId, log) => {
      this.handleLog(childId, log);
    });
  }

  /**
   * Handle worker connected via IPC.
   */
  private handleWorkerConnected(childId: string, handshake: HandshakeMessage): void {
    const workerState = this.workers.get(childId);
    if (workerState) {
      workerState.status = 'idle';
      this.emit('workerStatus', childId, workerState);
      return;
    }

    const readerState = this.readers.get(childId);
    if (readerState) {
      readerState.status = 'idle';
      this.emit('readerStatus', childId, readerState);
    }
  }

  /**
   * Handle worker disconnected.
   */
  private handleWorkerDisconnected(childId: string): void {
    const workerState = this.workers.get(childId);
    if (workerState && workerState.status !== 'complete' && workerState.status !== 'failed') {
      workerState.status = 'failed';
      workerState.error = 'Worker disconnected unexpectedly';
      this.emit('workerFailed', childId, workerState.error);
      return;
    }

    const readerState = this.readers.get(childId);
    if (readerState && readerState.status !== 'complete' && readerState.status !== 'failed') {
      readerState.status = 'failed';
      readerState.error = 'Reader disconnected unexpectedly';
      this.emit('readerFailed', childId, readerState.error);
    }
  }

  /**
   * Handle permission request from worker or reader.
   */
  private async handlePermissionRequest(
    childId: string,
    request: PermissionRequestMessage
  ): Promise<void> {
    const workerState = this.workers.get(childId);
    const readerState = this.readers.get(childId);
    const state = workerState || readerState;
    if (!state) return;

    state.status = 'waiting_permission';
    state.currentTool = request.confirmation.toolName;

    if (workerState) {
      this.emit('workerStatus', childId, workerState);
    } else if (readerState) {
      this.emit('readerStatus', childId, readerState);
    }
    this.emit('permissionRequest', childId, request.confirmation);

    // Prompt user for permission
    let result: ConfirmationResult;

    if (this.config.onPermissionRequest) {
      // Use custom callback
      result = await this.config.onPermissionRequest(childId, request.confirmation);
    } else {
      // Default: auto-deny (no readline available)
      const label = workerState ? workerState.config.branch : `reader:${childId.slice(-5)}`;
      console.log(chalk.yellow(`\n[${label}] Permission request: ${request.confirmation.toolName}`));
      console.log(chalk.dim('No permission handler configured, auto-denying'));
      result = 'deny';
    }

    // Send response back to worker/reader
    const response = createMessage<PermissionResponseMessage>('permission_response', {
      requestId: request.id,
      result,
    });
    this.server.send(childId, response);

    state.status = 'thinking';
    if (workerState) {
      this.emit('workerStatus', childId, workerState);
    } else if (readerState) {
      this.emit('readerStatus', childId, readerState);
    }
  }

  /**
   * Handle status update from worker or reader.
   */
  private handleStatusUpdate(childId: string, status: StatusUpdateMessage): void {
    const workerState = this.workers.get(childId);
    if (workerState) {
      workerState.status = status.status;
      workerState.currentTool = status.currentTool;
      workerState.progress = status.progress;
      if (status.tokensUsed) {
        workerState.tokensUsed = status.tokensUsed;
      }
      this.emit('workerStatus', childId, workerState);
      return;
    }

    const readerState = this.readers.get(childId);
    if (readerState) {
      readerState.status = status.status;
      readerState.currentTool = status.currentTool;
      readerState.progress = status.progress;
      if (status.tokensUsed) {
        readerState.tokensUsed = status.tokensUsed;
      }
      this.emit('readerStatus', childId, readerState);
    }
  }

  /**
   * Handle task completion from worker or reader.
   */
  private handleTaskComplete(childId: string, result: TaskCompleteMessage): void {
    const workerState = this.workers.get(childId);
    if (workerState) {
      workerState.status = 'complete';
      workerState.completedAt = new Date();

      const workerResult: WorkerResult = {
        workerId: childId,
        ...result.result,
      };

      this.results.push(workerResult);
      this.emit('workerCompleted', childId, workerResult);

      // Check if all done
      if (this.getActiveWorkers().length === 0) {
        this.emit('allCompleted', this.results);
      }
      return;
    }

    const readerState = this.readers.get(childId);
    if (readerState) {
      readerState.status = 'complete';
      readerState.completedAt = new Date();

      const readerResult: ReaderResult = {
        readerId: childId,
        success: result.result.success,
        response: result.result.response,
        toolCallCount: result.result.toolCallCount,
        tokensUsed: result.result.tokensUsed,
        duration: result.result.duration,
        filesRead: result.result.filesChanged || [], // Use filesChanged as filesRead for readers
        // Error is set via handleTaskError, not in successful completion
      };

      this.readerResults.push(readerResult);
      this.emit('readerCompleted', childId, readerResult);
    }
  }

  /**
   * Handle task error from worker or reader.
   */
  private handleTaskError(childId: string, error: TaskErrorMessage): void {
    const workerState = this.workers.get(childId);
    if (workerState) {
      workerState.status = 'failed';
      workerState.error = error.error.message;
      workerState.completedAt = new Date();

      this.emit('workerFailed', childId, error.error.message);

      // Check if all done
      if (this.getActiveWorkers().length === 0) {
        this.emit('allCompleted', this.results);
      }
      return;
    }

    const readerState = this.readers.get(childId);
    if (readerState) {
      readerState.status = 'failed';
      readerState.error = error.error.message;
      readerState.completedAt = new Date();

      this.emit('readerFailed', childId, error.error.message);
    }
  }

  /**
   * Handle log from worker or reader.
   */
  private handleLog(childId: string, log: LogMessage): void {
    const workerState = this.workers.get(childId);
    const readerState = this.readers.get(childId);
    const prefix = workerState
      ? `[${workerState.config.branch}]`
      : readerState
        ? `[reader:${childId.slice(-5)}]`
        : `[${childId}]`;

    switch (log.level) {
      case 'text':
        // Stream AI output
        process.stdout.write(chalk.cyan(`${prefix} `) + log.content);
        break;
      case 'tool':
        console.log(chalk.dim(`${prefix} ${log.content}`));
        break;
      case 'info':
        console.log(chalk.blue(`${prefix} ${log.content}`));
        break;
      case 'warn':
        console.log(chalk.yellow(`${prefix} ${log.content}`));
        break;
      case 'error':
        console.error(chalk.red(`${prefix} ${log.content}`));
        break;
    }
  }
}

// Type-safe event emitter interface
export interface Orchestrator {
  on<K extends keyof OrchestratorEvents>(event: K, listener: OrchestratorEvents[K]): this;
  off<K extends keyof OrchestratorEvents>(event: K, listener: OrchestratorEvents[K]): this;
  emit<K extends keyof OrchestratorEvents>(event: K, ...args: Parameters<OrchestratorEvents[K]>): boolean;
}
