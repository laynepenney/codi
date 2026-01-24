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
import { homedir, tmpdir } from 'os';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';

/**
 * Resolve the codi executable path, handling dev mode (tsx) vs production.
 * When running via tsx (pnpm dev), process.argv[1] is the .ts source file.
 * Child processes need the compiled .js file since they run with node directly.
 */
function resolveCodiPath(inputPath: string): string {
  // If it's a .ts file, prefer source in dev unless explicitly forced to dist.
  if (inputPath.endsWith('.ts')) {
    const preferSource = process.env.CODI_USE_DIST !== '1';
    if (preferSource) {
      return inputPath;
    }

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

const MAX_SOCKET_PATH_BYTES = 100;

function getDefaultSocketPath(): string {
  const homeSocket = join(homedir(), '.codi', 'orchestrator.sock');
  if (Buffer.byteLength(homeSocket, 'utf8') <= MAX_SOCKET_PATH_BYTES) {
    return homeSocket;
  }

  const tmpBase = existsSync('/tmp') ? '/tmp' : tmpdir();
  return join(tmpBase, `codi-orchestrator-${process.pid}.sock`);
}
import type { Interface as ReadlineInterface } from 'readline';
import { createRequire } from 'module';
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
  /** Log message from worker */
  workerLog: (workerId: string, log: LogMessage) => void;
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
  /** Reader log message */
  readerLog: (readerId: string, log: LogMessage) => void;
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
/**
 * Callback to provide background context for spawned agents.
 */
export type ContextProviderCallback = (childId: string, task: string) => string | undefined;

export interface OrchestratorConfig extends OrchestratorOptions {
  /** Readline interface for permission prompts */
  readline?: ReadlineInterface | undefined;
  /** Custom permission prompt callback */
  onPermissionRequest?: PermissionPromptCallback | undefined;
  /** Repository root path */
  repoRoot: string;
  /** Path to codi entrypoint (script) */
  codiPath?: string;
  /** Default provider for spawned agents (inherited from parent) */
  defaultProvider?: string;
  /** Default model for spawned agents (inherited from parent) */
  defaultModel?: string;
  /** Callback to generate background context for agents */
  contextProvider?: ContextProviderCallback;
  /** Executable to run the entrypoint (default: process.execPath) */
  codiExecPath?: string;
  /** Extra exec args for the runtime (default: process.execArgv) */
  codiExecArgs?: string[];
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
  contextProvider: ContextProviderCallback | undefined;
  defaultProvider: string | undefined;
  defaultModel: string | undefined;
  codiExecPath: string;
  codiExecArgs: string[];
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
  private resultsByWorker: Map<string, WorkerResult> = new Map();
  private logBuffers: Map<string, string> = new Map();
  private started = false;
  private static readonly MAX_LOG_CHARS = 12000;

  constructor(config: OrchestratorConfig) {
    super();

    // Apply defaults
    this.config = {
      socketPath: config.socketPath || getDefaultSocketPath(),
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
      defaultProvider: config.defaultProvider,
      defaultModel: config.defaultModel,
      contextProvider: config.contextProvider,
      codiExecPath: config.codiExecPath || process.execPath,
      codiExecArgs: config.codiExecArgs || process.execArgv,
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
    const childArgs = [
      '--child-mode',
      '--socket-path', this.config.socketPath,
      '--child-id', workerId,
      '--child-task', config.task,
    ];

    // Use config values or fall back to orchestrator defaults (inherited from parent)
    const model = config.model || this.config.defaultModel;
    const provider = config.provider || this.config.defaultProvider;

    if (model) {
      childArgs.push('--model', model);
    }
    if (provider) {
      childArgs.push('--provider', provider);
    }
    if (config.autoApprove?.length) {
      childArgs.push('--auto-approve', config.autoApprove.join(','));
    }

    const { command, args } = this.resolveChildCommand(childArgs);
    const proc = spawn(command, args, {
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

    // Handle stdout/stderr from the child process (debugging and early failures)
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const flushLogBuffer = (buffer: string, level: LogMessage['level']) => {
      const lines = buffer.replace(/\r/g, '').split('\n');
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        this.handleLog(workerId, createMessage<LogMessage>('log', {
          childId: workerId,
          level,
          content: text,
        }));
      }
    };
    const flushPendingLogs = () => {
      if (stdoutBuffer) {
        flushLogBuffer(stdoutBuffer, 'info');
        stdoutBuffer = '';
      }
      if (stderrBuffer) {
        flushLogBuffer(stderrBuffer, 'error');
        stderrBuffer = '';
      }
    };

    proc.stdout?.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        this.handleLog(workerId, createMessage<LogMessage>('log', {
          childId: workerId,
          level: 'info',
          content: text,
        }));
      }
    });

    proc.stderr?.on('data', (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        this.handleLog(workerId, createMessage<LogMessage>('log', {
          childId: workerId,
          level: 'error',
          content: text,
        }));
      }
    });

    // Handle exit
    proc.on('exit', (code) => {
      this.processes.delete(workerId);
      flushPendingLogs();
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
   * Resolve the runtime command/args for child agents.
   */
  private resolveChildCommand(childArgs: string[]): { command: string; args: string[] } {
    const execArgs = [...this.config.codiExecArgs];
    const entrypoint = this.config.codiPath;

    if (!entrypoint) {
      throw new Error('Unable to resolve codi entrypoint');
    }

    if (entrypoint.endsWith('.ts') && !this.hasRuntimeLoader(execArgs)) {
      const tsxLoader = this.resolveTsxLoader();
      if (tsxLoader) {
        execArgs.push('--loader', tsxLoader);
      }
    }

    return {
      command: this.config.codiExecPath,
      args: [...execArgs, entrypoint, ...childArgs],
    };
  }

  private hasRuntimeLoader(execArgs: string[]): boolean {
    return execArgs.some((arg) =>
      arg === '--loader' ||
      arg.startsWith('--loader=') ||
      arg === '--import' ||
      arg.startsWith('--import=') ||
      arg.includes('tsx')
    );
  }

  private resolveTsxLoader(): string | null {
    try {
      const require = createRequire(import.meta.url);
      return require.resolve('tsx');
    } catch {
      return null;
    }
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

    // Use config values or fall back to orchestrator defaults (inherited from parent)
    const model = config.model || this.config.defaultModel;
    const provider = config.provider || this.config.defaultProvider;

    if (model) {
      args.push('--model', model);
    }
    if (provider) {
      args.push('--provider', provider);
    }
    // Note: scope is not a CLI flag - it should be included in the query itself

    const { command, args: childArgs } = this.resolveChildCommand(args);
    const proc = spawn(command, childArgs, {
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

    // Handle stdout/stderr for debugging or failures (readers report via IPC)
    const showReaderStdout = process.env.CODI_READER_STDIO === '1';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const flushLogBuffer = (buffer: string, level: LogMessage['level']) => {
      const lines = buffer.replace(/\r/g, '').split('\n');
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        this.handleLog(readerId, createMessage<LogMessage>('log', {
          childId: readerId,
          level,
          content: text,
        }));
      }
    };
    const flushPendingLogs = () => {
      if (showReaderStdout && stdoutBuffer) {
        flushLogBuffer(stdoutBuffer, 'info');
        stdoutBuffer = '';
      }
      if (stderrBuffer) {
        flushLogBuffer(stderrBuffer, 'error');
        stderrBuffer = '';
      }
    };

    proc.stdout?.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      if (!showReaderStdout) {
        return;
      }
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        this.handleLog(readerId, createMessage<LogMessage>('log', {
          childId: readerId,
          level: 'info',
          content: text,
        }));
      }
    });

    proc.stderr?.on('data', (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        this.handleLog(readerId, createMessage<LogMessage>('log', {
          childId: readerId,
          level: 'error',
          content: text,
        }));
      }
    });

    // Handle exit
    proc.on('exit', (code) => {
      this.processes.delete(readerId);
      flushPendingLogs();
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
   * Get the last completed result for a worker.
   */
  getResult(workerId: string): WorkerResult | undefined {
    return this.resultsByWorker.get(workerId);
  }

  /**
   * Get accumulated log output for a worker.
   */
  getLogs(workerId: string): string | undefined {
    return this.logBuffers.get(workerId);
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
      workerState.statusMessage = undefined;
      this.emit('workerStatus', childId, workerState);
      // Send background context if provider is configured
      if (this.config.contextProvider) {
        const context = this.config.contextProvider(childId, workerState.config.task);
        if (context) {
          this.server.sendContext(childId, context);
        }
      }
      return;
    }

    const readerState = this.readers.get(childId);
    if (readerState) {
      readerState.status = 'idle';
      this.emit('readerStatus', childId, readerState);

      // Send background context if provider is configured
      if (this.config.contextProvider) {
        const context = this.config.contextProvider(childId, readerState.config.query);
        if (context) {
          this.server.sendContext(childId, context);
        }
      }
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
      workerState.statusMessage = undefined;
      this.emit('workerFailed', childId, workerState.error);
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
      workerState.statusMessage = `Waiting for permission: ${request.confirmation.toolName}`;
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
      workerState.statusMessage = undefined;
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
      workerState.statusMessage = status.message;
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
      workerState.statusMessage = undefined;

      const workerResult: WorkerResult = {
        workerId: childId,
        ...result.result,
      };

      this.results.push(workerResult);
      this.emit('workerCompleted', childId, workerResult);

      this.resultsByWorker.set(childId, workerResult);

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
      workerState.statusMessage = undefined;
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
   * Append a log entry to the worker's log buffer with size limits.
   */
  private appendLog(childId: string, log: LogMessage): void {
    const existing = this.logBuffers.get(childId) || '';
    let entry = log.content;
    if (log.level !== 'text') {
      entry = `[${log.level}] ${entry}\n`;
    }
    let combined = existing + entry;
    if (combined.length > Orchestrator.MAX_LOG_CHARS) {
      combined = combined.slice(-Orchestrator.MAX_LOG_CHARS);
    }
    this.logBuffers.set(childId, combined);
  }

  /**
   * Handle log from worker or reader.
   */
  private handleLog(childId: string, log: LogMessage): void {
    const workerState = this.workers.get(childId);
    if (workerState) {
      this.appendLog(childId, log);
      if (this.listenerCount('workerLog') > 0) {
        this.emit('workerLog', childId, log);
        return;
      }
    }

    const readerState = this.readers.get(childId);
    if (readerState) {
      this.appendLog(childId, log);
      if (this.listenerCount('readerLog') > 0) {
        this.emit('readerLog', childId, log);
        return;
      }
    }
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
