// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IPC Client for Multi-Agent Orchestration
 *
 * Unix domain socket client that runs on worker (child) agents.
 * Connects to the commander's server to request permissions and report status.
 */

import { createConnection, type Socket } from 'net';
import { EventEmitter } from 'events';
import {
  type IPCMessage,
  type HandshakeMessage,
  type HandshakeAckMessage,
  type PermissionRequestMessage,
  type PermissionResponseMessage,
  type StatusUpdateMessage,
  type TaskCompleteMessage,
  type TaskErrorMessage,
  type LogMessage,
  type WorkerStatus,
  type CancelMessage,
  serialize,
  deserialize,
  createMessage,
  isHandshakeAck,
  isPermissionResponse,
  isCancel,
  isPing,
} from './protocol.js';
import type { ToolConfirmation, ConfirmationResult } from '../../agent.js';

/**
 * Events emitted by the IPC client.
 */
export interface IPCClientEvents {
  /** Connection established */
  connected: () => void;
  /** Connection lost */
  disconnected: () => void;
  /** Cancel request from commander */
  cancel: (message: CancelMessage) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Pending request waiting for response.
 */
interface PendingRequest {
  resolve: (response: IPCMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Configuration for the IPC client.
 */
export interface IPCClientConfig {
  socketPath: string;
  childId: string;
  worktree: string;
  branch: string;
  task: string;
  model?: string;
  provider?: string;
}

/**
 * IPC Client for worker agents.
 */
export class IPCClient extends EventEmitter {
  private socket: Socket | null = null;
  private config: IPCClientConfig;
  private buffer = '';
  private connected = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private cancelled = false;

  constructor(config: IPCClientConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to the commander's IPC server.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createConnection(this.config.socketPath);

      this.socket.on('connect', async () => {
        try {
          // Set connected early so handshake can send messages
          this.connected = true;
          await this.performHandshake();
          this.emit('connected');
          resolve();
        } catch (err) {
          this.connected = false;
          reject(err);
        }
      });

      this.socket.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
      });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
    });
  }

  /**
   * Disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  /**
   * Check if connected to the server.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if the task has been cancelled.
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Request permission from the commander.
   * Blocks until the user responds or timeout.
   */
  async requestPermission(
    confirmation: ToolConfirmation,
    timeoutMs = 300000 // 5 minute default timeout
  ): Promise<ConfirmationResult> {
    if (this.cancelled) {
      return 'abort';
    }

    const message = createMessage<PermissionRequestMessage>('permission_request', {
      childId: this.config.childId,
      confirmation,
    });

    const response = await this.sendAndWait<PermissionResponseMessage>(
      message,
      'permission_response',
      timeoutMs
    );

    return response.result;
  }

  /**
   * Send a status update to the commander.
   */
  sendStatus(
    status: WorkerStatus,
    options?: {
      currentTool?: string;
      progress?: number;
      tokensUsed?: { input: number; output: number };
      message?: string;
    }
  ): void {
    const message = createMessage<StatusUpdateMessage>('status_update', {
      childId: this.config.childId,
      status,
      ...options,
    });
    this.send(message);
  }

  /**
   * Send task completion notification.
   */
  sendTaskComplete(result: TaskCompleteMessage['result']): void {
    const message = createMessage<TaskCompleteMessage>('task_complete', {
      childId: this.config.childId,
      result,
    });
    this.send(message);
  }

  /**
   * Send task error notification.
   */
  sendTaskError(error: TaskErrorMessage['error']): void {
    const message = createMessage<TaskErrorMessage>('task_error', {
      childId: this.config.childId,
      error,
    });
    this.send(message);
  }

  /**
   * Send a log message to the commander.
   */
  sendLog(level: LogMessage['level'], content: string): void {
    const message = createMessage<LogMessage>('log', {
      childId: this.config.childId,
      level,
      content,
    });
    this.send(message);
  }

  /**
   * Send a message to the server.
   */
  private send(message: IPCMessage): void {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected to IPC server');
    }
    this.socket.write(serialize(message));
  }

  /**
   * Send a message and wait for a specific response type.
   */
  private async sendAndWait<T extends IPCMessage>(
    message: IPCMessage,
    responseType: string,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request timed out waiting for ${responseType}`));
      }, timeoutMs);

      this.pendingRequests.set(message.id, {
        resolve: (response) => resolve(response as T),
        reject,
        timeout,
      });

      this.send(message);
    });
  }

  /**
   * Perform handshake with the server.
   */
  private async performHandshake(): Promise<void> {
    const handshake = createMessage<HandshakeMessage>('handshake', {
      childId: this.config.childId,
      worktree: this.config.worktree,
      branch: this.config.branch,
      task: this.config.task,
      model: this.config.model,
      provider: this.config.provider,
    });

    const response = await this.sendAndWait<HandshakeAckMessage>(
      handshake,
      'handshake_ack',
      10000 // 10 second timeout for handshake
    );

    if (!response.accepted) {
      throw new Error(`Handshake rejected: ${response.error || 'Unknown reason'}`);
    }
  }

  /**
   * Process the message buffer.
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = deserialize(line);
        this.handleMessage(message);
      } catch (err) {
        console.error('Failed to parse IPC message:', err);
      }
    }
  }

  /**
   * Handle a received message.
   */
  private handleMessage(message: IPCMessage): void {
    // Handle ping/pong
    if (isPing(message)) {
      const pong = createMessage('pong', {});
      this.send(pong);
      return;
    }

    // Handle cancel
    if (isCancel(message)) {
      this.cancelled = true;
      this.emit('cancel', message);
      return;
    }

    // Handle handshake ack
    if (isHandshakeAck(message)) {
      // Find pending handshake request
      for (const [id, pending] of this.pendingRequests) {
        // The handshake message ID is not in the response, so check all pending
        clearTimeout(pending.timeout);
        pending.resolve(message);
        this.pendingRequests.delete(id);
        break;
      }
      return;
    }

    // Handle permission response
    if (isPermissionResponse(message)) {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(message);
        this.pendingRequests.delete(message.requestId);
      }
      return;
    }
  }
}

// Type-safe event emitter interface
export interface IPCClient {
  on<K extends keyof IPCClientEvents>(event: K, listener: IPCClientEvents[K]): this;
  off<K extends keyof IPCClientEvents>(event: K, listener: IPCClientEvents[K]): this;
  emit<K extends keyof IPCClientEvents>(event: K, ...args: Parameters<IPCClientEvents[K]>): boolean;
}
