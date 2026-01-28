// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Agent Module
 *
 * This module contains the Agent class and related functionality.
 * Components are split for better separation of concerns:
 *
 * - debugger.ts: Breakpoints, checkpoints, and time-travel debugging
 * - (future) context.ts: Context windowing and compression
 * - (future) execution.ts: Tool execution and batching
 * - (future) security.ts: Approvals and validation
 */

export {
  AgentDebugger,
  type DebuggerAgentState,
  type DebuggerConfig,
  type RewindResult,
  type WorkingSetState,
  // Re-exported from debug-bridge
  type Breakpoint,
  type BreakpointContext,
  type BreakpointType,
  type Checkpoint,
  type FullCheckpoint,
  type Branch,
  type Timeline,
} from './debugger.js';
