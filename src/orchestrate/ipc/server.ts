// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IPC Server for Multi-Agent Orchestration
 *
 * Unix domain socket server that runs on the commander (parent) side.
 * Handles connections from worker agents and routes messages.
 */

import { createServer, type Server, type Socket } from 'net';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { EventEmitter } from 'events';
import {
  type IPCMessage,
  type HandshakeMessage,
  type PermissionRequestMessage,
  type StatusUpdateMessage,
  type TaskCompleteMessage,
  type TaskErrorMessage,
  type LogMessage,
  type PongMessage,
  serialize,
  deserialize,
  createMessage,
  isHandshake,
  isPong,
} from './protocol.js';

/**
 * Events emitted by the IPC server.
 */
export interface IPCServerEvents {
  /** New worker connected and completed handshake */
  workerConnected: (childId: string, handshake: HandshakeMessage) => void;
  /** Worker disconnected */
  workerDisconnected: (childId: string) => void;
  /** Permission request from worker */
  permissionRequest: (childId: string, request: PermissionRequestMessage) => void;
  /** Status update from worker */
  statusUpdate: (childId: string, status: StatusUpdateMessage) => void;
  /** Task completed by worker */
  taskComplete: (childId: string, result: TaskCompleteMessage) => void;
  /** Task error from worker */
  taskError: (childId: string, error: TaskErrorMessage) => void;
  /** Log message from worker */
  log: (childId: string, log: LogMessage) => void;
  /** Server error */
  error: (error: Error) => void;
}

/**
 * Connected client state.
 */
interface ConnectedClient {
  socket: Socket;
  childId: string;
  buffer: string;
  lastActivity: number;
}

/**
 * IPC Server for managing worker connections.
 */
export class IPCServer extends EventEmitter {
  private server: Server | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private socketPath: string;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
  }

  /**
   * Start the server.
   */
  async start(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.socketPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Remove stale socket file if it exists
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        // Start ping interval to detect dead connections
        this.pingInterval = setInterval(() => this.pingClients(), 30000);
        resolve();
      });
    });
  }

  /**
   * Stop the server and close all connections.
   */
  async stop(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Close all client connections
    for (const [, client] of this.clients) {
      client.socket.destroy();
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          // Clean up socket file
          if (existsSync(this.socketPath)) {
            try {
              unlinkSync(this.socketPath);
            } catch {
              // Ignore cleanup errors
            }
          }
          resolve();
        });
      });
    }
  }

  /**
   * Send a message to a specific worker.
   */
  send(childId: string, message: IPCMessage): boolean {
    const client = this.clients.get(childId);
    if (!client) {
      return false;
    }

    try {
      client.socket.write(serialize(message));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast a message to all workers.
   */
  broadcast(message: IPCMessage): void {
    for (const [, client] of this.clients) {
      try {
        client.socket.write(serialize(message));
      } catch {
        // Ignore individual failures
      }
    }
  }

  /**
   * Get list of connected worker IDs.
   */
  getConnectedWorkers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if a specific worker is connected.
   */
  isConnected(childId: string): boolean {
    return this.clients.has(childId);
  }

  /**
   * Handle a new socket connection.
   */
  private handleConnection(socket: Socket): void {
    // Temporary client until handshake completes
    const tempClient: ConnectedClient = {
      socket,
      childId: '',
      buffer: '',
      lastActivity: Date.now(),
    };

    socket.on('data', (data) => {
      tempClient.buffer += data.toString();
      tempClient.lastActivity = Date.now();
      this.processBuffer(tempClient);
    });

    socket.on('close', () => {
      if (tempClient.childId) {
        this.clients.delete(tempClient.childId);
        this.emit('workerDisconnected', tempClient.childId);
      }
    });

    socket.on('error', (err) => {
      // Log but don't crash on individual socket errors
      console.error(`Socket error for ${tempClient.childId || 'unknown'}:`, err.message);
    });
  }

  /**
   * Process the message buffer for a client.
   */
  private processBuffer(client: ConnectedClient): void {
    const lines = client.buffer.split('\n');
    client.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = deserialize(line);
        this.handleMessage(client, message);
      } catch (err) {
        console.error('Failed to parse IPC message:', err);
      }
    }
  }

  /**
   * Handle a parsed message from a client.
   */
  private handleMessage(client: ConnectedClient, message: IPCMessage): void {
    // Handle handshake specially - it establishes the client identity
    if (isHandshake(message)) {
      client.childId = message.childId;
      this.clients.set(client.childId, client);

      // Send acknowledgment
      const ack = createMessage('handshake_ack', {
        accepted: true,
      });
      client.socket.write(serialize(ack));

      this.emit('workerConnected', client.childId, message);
      return;
    }

    // Handle pong (response to ping)
    if (isPong(message)) {
      client.lastActivity = Date.now();
      return;
    }

    // Route other messages to appropriate event handlers
    switch (message.type) {
      case 'permission_request':
        this.emit('permissionRequest', client.childId, message as PermissionRequestMessage);
        break;
      case 'status_update':
        this.emit('statusUpdate', client.childId, message as StatusUpdateMessage);
        break;
      case 'task_complete':
        this.emit('taskComplete', client.childId, message as TaskCompleteMessage);
        break;
      case 'task_error':
        this.emit('taskError', client.childId, message as TaskErrorMessage);
        break;
      case 'log':
        this.emit('log', client.childId, message as LogMessage);
        break;
    }
  }

  /**
   * Ping all clients to check connection health.
   */
  private pingClients(): void {
    const now = Date.now();
    const timeout = 60000; // 60 seconds

    for (const [childId, client] of this.clients) {
      if (now - client.lastActivity > timeout) {
        // Client hasn't responded, consider it dead
        console.warn(`Worker ${childId} timed out, disconnecting`);
        client.socket.destroy();
        this.clients.delete(childId);
        this.emit('workerDisconnected', childId);
      } else {
        // Send ping
        const ping = createMessage('ping', {});
        try {
          client.socket.write(serialize(ping));
        } catch {
          // Socket write failed, clean up
          this.clients.delete(childId);
          this.emit('workerDisconnected', childId);
        }
      }
    }
  }
}

// Type-safe event emitter interface
export interface IPCServer {
  on<K extends keyof IPCServerEvents>(event: K, listener: IPCServerEvents[K]): this;
  off<K extends keyof IPCServerEvents>(event: K, listener: IPCServerEvents[K]): this;
  emit<K extends keyof IPCServerEvents>(event: K, ...args: Parameters<IPCServerEvents[K]>): boolean;
}
