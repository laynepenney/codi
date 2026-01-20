// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-Agent Orchestration Module
 *
 * Exports for managing parallel worker agents via git worktrees
 * with IPC-based permission bubbling.
 */

// Types
export * from './types.js';

// IPC Protocol
export {
  type IPCMessage,
  type IPCMessageType,
  type WorkerStatus,
  type HandshakeMessage,
  type PermissionRequestMessage,
  type StatusUpdateMessage,
  type TaskCompleteMessage,
  type TaskErrorMessage,
  type LogMessage,
  type HandshakeAckMessage,
  type PermissionResponseMessage,
  type CancelMessage,
  type PingMessage,
  type PongMessage,
  serialize,
  deserialize,
  generateMessageId,
  createMessage,
  isHandshake,
  isPermissionRequest,
  isStatusUpdate,
  isTaskComplete,
  isTaskError,
  isLog,
  isHandshakeAck,
  isPermissionResponse,
  isCancel,
  isPing,
  isPong,
} from './ipc/protocol.js';

// IPC Server (commander side)
export { IPCServer, type IPCServerEvents } from './ipc/server.js';

// IPC Client (worker side)
export { IPCClient, type IPCClientConfig, type IPCClientEvents } from './ipc/client.js';

// Worktree Management
export { WorktreeManager, type WorktreeManagerConfig } from './worktree.js';

// Child Agent (worker side)
export { ChildAgent, runChildAgent, type ChildAgentConfig } from './child-agent.js';

// Orchestrator/Commander (parent side)
export {
  Orchestrator,
  type OrchestratorConfig,
  type OrchestratorEvents,
  type PermissionPromptCallback,
} from './commander.js';
