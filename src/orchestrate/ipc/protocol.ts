// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IPC Protocol for Multi-Agent Orchestration
 *
 * Defines message types for communication between the commander (parent)
 * and worker agents (children) via Unix domain sockets.
 */

import type { ToolConfirmation, ConfirmationResult } from '../../agent.js';

/**
 * All IPC message types.
 */
export type IPCMessageType =
  // Child → Parent
  | 'handshake'
  | 'permission_request'
  | 'status_update'
  | 'task_complete'
  | 'task_error'
  | 'log'
  // Parent → Child
  | 'handshake_ack'
  | 'permission_response'
  | 'cancel'
  | 'inject_context'
  | 'ping'
  | 'pong';

/**
 * Base message envelope for all IPC messages.
 */
export interface IPCMessage {
  id: string;
  type: IPCMessageType;
  timestamp: number;
}

/**
 * Worker status states.
 */
export type WorkerStatus =
  | 'starting'
  | 'idle'
  | 'thinking'
  | 'tool_call'
  | 'waiting_permission'
  | 'complete'
  | 'failed'
  | 'cancelled';

// ============================================================================
// Child → Parent Messages
// ============================================================================

/**
 * Initial handshake from child to establish connection.
 */
export interface HandshakeMessage extends IPCMessage {
  type: 'handshake';
  childId: string;
  worktree: string;
  branch: string;
  task: string;
  model?: string;
  provider?: string;
}

/**
 * Permission request from child when a tool needs confirmation.
 */
export interface PermissionRequestMessage extends IPCMessage {
  type: 'permission_request';
  childId: string;
  confirmation: ToolConfirmation;
}

/**
 * Status update from child to inform parent of progress.
 */
export interface StatusUpdateMessage extends IPCMessage {
  type: 'status_update';
  childId: string;
  status: WorkerStatus;
  currentTool?: string;
  progress?: number; // 0-100
  tokensUsed?: { input: number; output: number };
  message?: string;
}

/**
 * Task completion notification.
 */
export interface TaskCompleteMessage extends IPCMessage {
  type: 'task_complete';
  childId: string;
  result: {
    success: boolean;
    response: string;
    toolCallCount: number;
    tokensUsed: { input: number; output: number };
    duration: number; // milliseconds
    prUrl?: string;
    branch: string;
    commits: number;
    filesChanged: string[];
  };
}

/**
 * Task error notification.
 */
export interface TaskErrorMessage extends IPCMessage {
  type: 'task_error';
  childId: string;
  error: {
    message: string;
    code?: string;
    recoverable: boolean;
  };
}

/**
 * Log message for streaming output to parent.
 */
export interface LogMessage extends IPCMessage {
  type: 'log';
  childId: string;
  level: 'text' | 'tool' | 'info' | 'warn' | 'error';
  content: string;
}

// ============================================================================
// Parent → Child Messages
// ============================================================================

/**
 * Handshake acknowledgment from parent.
 */
export interface HandshakeAckMessage extends IPCMessage {
  type: 'handshake_ack';
  accepted: boolean;
  error?: string;
  config?: {
    autoApprove?: string[];
    timeout?: number;
  };
  /** Background context to inject into agent's conversation */
  context?: string;
}

/**
 * Inject background context into a running agent.
 */
export interface InjectContextMessage extends IPCMessage {
  type: 'inject_context';
  /** Background context (project info, memories, relevant history) */
  context: string;
  /** Optional: specific files or symbols to highlight */
  relevantFiles?: string[];
}

/**
 * Permission response from parent after user interaction.
 */
export interface PermissionResponseMessage extends IPCMessage {
  type: 'permission_response';
  requestId: string; // References the original permission_request id
  result: ConfirmationResult;
}

/**
 * Cancel request from parent.
 */
export interface CancelMessage extends IPCMessage {
  type: 'cancel';
  reason?: string;
}

/**
 * Ping message for connection health check.
 */
export interface PingMessage extends IPCMessage {
  type: 'ping';
}

/**
 * Pong response to ping.
 */
export interface PongMessage extends IPCMessage {
  type: 'pong';
}

// ============================================================================
// Type Guards
// ============================================================================

export function isHandshake(msg: IPCMessage): msg is HandshakeMessage {
  return msg.type === 'handshake';
}

export function isPermissionRequest(msg: IPCMessage): msg is PermissionRequestMessage {
  return msg.type === 'permission_request';
}

export function isStatusUpdate(msg: IPCMessage): msg is StatusUpdateMessage {
  return msg.type === 'status_update';
}

export function isTaskComplete(msg: IPCMessage): msg is TaskCompleteMessage {
  return msg.type === 'task_complete';
}

export function isTaskError(msg: IPCMessage): msg is TaskErrorMessage {
  return msg.type === 'task_error';
}

export function isLog(msg: IPCMessage): msg is LogMessage {
  return msg.type === 'log';
}

export function isHandshakeAck(msg: IPCMessage): msg is HandshakeAckMessage {
  return msg.type === 'handshake_ack';
}

export function isPermissionResponse(msg: IPCMessage): msg is PermissionResponseMessage {
  return msg.type === 'permission_response';
}

export function isCancel(msg: IPCMessage): msg is CancelMessage {
  return msg.type === 'cancel';
}

export function isInjectContext(msg: IPCMessage): msg is InjectContextMessage {
  return msg.type === 'inject_context';
}

export function isPing(msg: IPCMessage): msg is PingMessage {
  return msg.type === 'ping';
}

export function isPong(msg: IPCMessage): msg is PongMessage {
  return msg.type === 'pong';
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a message for transmission.
 * Uses newline-delimited JSON for easy parsing.
 */
export function serialize(message: IPCMessage): string {
  return JSON.stringify(message) + '\n';
}

/**
 * Deserialize a message from a string.
 */
export function deserialize(data: string): IPCMessage {
  return JSON.parse(data.trim()) as IPCMessage;
}

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a message with standard fields populated.
 */
export function createMessage<T extends IPCMessage>(
  type: T['type'],
  fields: Omit<T, 'id' | 'type' | 'timestamp'>
): T {
  return {
    id: generateMessageId(),
    type,
    timestamp: Date.now(),
    ...fields,
  } as T;
}
