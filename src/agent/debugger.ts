// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Agent Debugger Module
 *
 * Manages debugging functionality including breakpoints, checkpoints, and time-travel.
 * Extracted from agent.ts for better separation of concerns.
 */

import type { Message, ToolDefinition } from '../types.js';
import type { BaseProvider } from '../providers/base.js';
import type { WorkingSet } from '../context-windowing.js';
import { createWorkingSet } from '../context-windowing.js';
import { countMessageTokens, getMessageText } from '../utils/index.js';
import { logger } from '../logger.js';
import {
  getDebugBridge,
  isDebugBridgeEnabled,
  type Breakpoint,
  type BreakpointContext,
  type BreakpointType,
  type Checkpoint,
  type FullCheckpoint,
  type Branch,
  type Timeline,
} from '../debug-bridge.js';

/**
 * Serializable working set state for checkpoints.
 */
export interface WorkingSetState {
  recentFiles: string[];
  activeEntities: string[];
}

/**
 * Agent state needed by the debugger for snapshots and checkpoints.
 */
export interface DebuggerAgentState {
  messages: Message[];
  conversationSummary: string | null;
  workingSet: WorkingSet;
  provider: BaseProvider;
  toolDefinitions: ToolDefinition[];
  maxContextTokens: number;
}

/**
 * Result of a rewind operation.
 */
export interface RewindResult {
  success: boolean;
  state?: {
    messages: Message[];
    summary: string | null;
    workingSet: WorkingSetState;
    iteration: number;
  };
}

/**
 * Configuration for the debugger.
 */
export interface DebuggerConfig {
  checkpointInterval?: number;
}

/**
 * AgentDebugger manages all debugging functionality for the Agent.
 *
 * Features:
 * - Breakpoints (tool, iteration, pattern, error)
 * - Checkpoints (manual and auto)
 * - Time travel (rewind, branches)
 * - State snapshots
 */
export class AgentDebugger {
  // Debug control
  private debugPaused: boolean = false;
  private debugStepMode: boolean = false;
  private currentIteration: number = 0;

  // Breakpoints
  private breakpoints: Map<string, Breakpoint> = new Map();

  // Checkpoints
  private lastCheckpointIteration: number = 0;
  private checkpointInterval: number;

  // Time travel
  private currentBranch: string = 'main';
  private timeline: Timeline = {
    branches: [{
      name: 'main',
      created: new Date().toISOString(),
      checkpoints: [],
      current: true,
    }],
    activeBranch: 'main',
  };

  constructor(config: DebuggerConfig = {}) {
    this.checkpointInterval = config.checkpointInterval ?? 5;
  }

  // ====================
  // Iteration Tracking
  // ====================

  /**
   * Get the current iteration number.
   */
  getCurrentIteration(): number {
    return this.currentIteration;
  }

  /**
   * Increment and return the new iteration number.
   */
  incrementIteration(): number {
    return ++this.currentIteration;
  }

  /**
   * Set the current iteration (used when loading checkpoints).
   */
  setCurrentIteration(iteration: number): void {
    this.currentIteration = iteration;
  }

  // ====================
  // Pause Control
  // ====================

  /**
   * Check if the debugger is paused.
   */
  isPaused(): boolean {
    return this.debugPaused;
  }

  /**
   * Set the paused state.
   */
  setPaused(paused: boolean): void {
    this.debugPaused = paused;
  }

  /**
   * Check if in step mode.
   */
  isStepMode(): boolean {
    return this.debugStepMode;
  }

  /**
   * Set step mode.
   */
  setStepMode(stepMode: boolean): void {
    this.debugStepMode = stepMode;
  }

  /**
   * Wait for debug resume signal.
   * Called before each API request in the chat loop.
   */
  async waitForDebugResume(messageCount: number): Promise<void> {
    if (!isDebugBridgeEnabled() || !this.debugPaused) return;

    // Emit paused state periodically while waiting
    while (this.debugPaused) {
      getDebugBridge().emit('state_snapshot', {
        paused: true,
        waiting: 'resume',
        iteration: this.currentIteration,
        messageCount,
      });
      await new Promise(r => setTimeout(r, 500)); // Check every 500ms
    }
  }

  // ====================
  // State Snapshots
  // ====================

  /**
   * Get a snapshot of the agent state for debugging.
   */
  getStateSnapshot(
    agentState: DebuggerAgentState,
    what: 'messages' | 'context' | 'tools' | 'all' = 'all'
  ): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      sessionId: isDebugBridgeEnabled() ? getDebugBridge().getSessionId() : null,
      iteration: this.currentIteration,
      paused: this.debugPaused,
    };

    if (what === 'messages' || what === 'all') {
      const roleCount = { user: 0, assistant: 0, tool: 0 };
      for (const msg of agentState.messages) {
        if (msg.role === 'user') {
          if (typeof msg.content !== 'string' &&
              msg.content.some(b => b.type === 'tool_result')) {
            roleCount.tool++;
          } else {
            roleCount.user++;
          }
        } else if (msg.role === 'assistant') {
          roleCount.assistant++;
        }
      }

      snapshot.messages = {
        count: agentState.messages.length,
        roles: roleCount,
        recent: agentState.messages.slice(-3).map(m => ({
          role: m.role,
          preview: getMessageText(m).slice(0, 200),
        })),
      };
    }

    if (what === 'context' || what === 'all') {
      snapshot.context = {
        tokenEstimate: countMessageTokens(agentState.messages),
        maxTokens: agentState.maxContextTokens,
        hasSummary: !!agentState.conversationSummary,
        summaryPreview: agentState.conversationSummary?.slice(0, 200),
      };
    }

    if (what === 'tools' || what === 'all') {
      snapshot.tools = {
        enabled: agentState.toolDefinitions.map(d => d.name),
        count: agentState.toolDefinitions.length,
      };
    }

    snapshot.provider = {
      name: agentState.provider.getName(),
      model: agentState.provider.getModel(),
    };

    snapshot.workingSet = [...agentState.workingSet.recentFiles];

    return snapshot;
  }

  // ====================
  // Breakpoints
  // ====================

  /**
   * Add a breakpoint.
   */
  addBreakpoint(type: BreakpointType, condition?: string | number): string {
    const id = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.breakpoints.set(id, {
      id,
      type,
      condition,
      enabled: true,
      hitCount: 0,
    });
    return id;
  }

  /**
   * Remove a breakpoint by ID.
   */
  removeBreakpoint(id: string): boolean {
    return this.breakpoints.delete(id);
  }

  /**
   * Clear all breakpoints.
   */
  clearBreakpoints(): void {
    this.breakpoints.clear();
  }

  /**
   * List all breakpoints.
   */
  listBreakpoints(): Breakpoint[] {
    return [...this.breakpoints.values()];
  }

  /**
   * Check if any breakpoint should trigger.
   * Returns the first matching breakpoint or null.
   */
  checkBreakpoints(context: BreakpointContext): Breakpoint | null {
    for (const bp of this.breakpoints.values()) {
      if (!bp.enabled) continue;

      switch (bp.type) {
        case 'tool':
          if (context.type === 'tool_call' && context.toolName === bp.condition) {
            bp.hitCount++;
            return bp;
          }
          break;

        case 'iteration':
          if (context.iteration === bp.condition) {
            bp.hitCount++;
            return bp;
          }
          break;

        case 'pattern':
          if (context.toolInput && typeof bp.condition === 'string') {
            const inputStr = JSON.stringify(context.toolInput);
            const regex = new RegExp(bp.condition, 'i');
            if (regex.test(inputStr)) {
              bp.hitCount++;
              return bp;
            }
          }
          break;

        case 'error':
          if (context.type === 'error') {
            bp.hitCount++;
            return bp;
          }
          break;
      }
    }
    return null;
  }

  // ====================
  // Checkpoints
  // ====================

  /**
   * Create a checkpoint with current state.
   * Saves full state to disk if debug bridge is enabled.
   */
  createCheckpoint(
    agentState: DebuggerAgentState,
    label?: string
  ): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `cp_${this.currentIteration}_${Date.now()}`,
      label,
      iteration: this.currentIteration,
      timestamp: new Date().toISOString(),
      messageCount: agentState.messages.length,
      tokenCount: countMessageTokens(agentState.messages),
    };

    this.lastCheckpointIteration = this.currentIteration;

    // Save full checkpoint to disk if debug bridge enabled
    if (isDebugBridgeEnabled()) {
      const fullCheckpoint: FullCheckpoint = {
        ...checkpoint,
        branch: this.currentBranch,
        state: {
          messages: structuredClone(agentState.messages),
          summary: agentState.conversationSummary,
          workingSet: {
            recentFiles: [...agentState.workingSet.recentFiles],
            activeEntities: [...agentState.workingSet.activeEntities],
          },
        },
      };
      this.saveCheckpoint(fullCheckpoint);
      getDebugBridge().checkpoint(checkpoint);
    }

    return checkpoint;
  }

  /**
   * Check if a checkpoint should be created based on interval.
   * Returns true if checkpoint was created.
   */
  maybeCreateCheckpoint(agentState: DebuggerAgentState): boolean {
    if (!isDebugBridgeEnabled()) return false;

    if (this.currentIteration - this.lastCheckpointIteration >= this.checkpointInterval) {
      this.createCheckpoint(agentState);
      return true;
    }
    return false;
  }

  /**
   * Set the auto-checkpoint interval.
   */
  setCheckpointInterval(interval: number): void {
    this.checkpointInterval = interval;
  }

  /**
   * Get the auto-checkpoint interval.
   */
  getCheckpointInterval(): number {
    return this.checkpointInterval;
  }

  /**
   * Save a full checkpoint to disk.
   */
  private saveCheckpoint(checkpoint: FullCheckpoint): void {
    if (!isDebugBridgeEnabled()) return;

    const { mkdirSync, writeFileSync } = require('fs');
    const { join } = require('path');

    const checkpointsDir = join(getDebugBridge().getSessionDir(), 'checkpoints');
    mkdirSync(checkpointsDir, { recursive: true });

    const filePath = join(checkpointsDir, `${checkpoint.id}.json`);
    writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));

    // Add to branch's checkpoint list
    const branch = this.timeline.branches.find(b => b.name === this.currentBranch);
    if (branch && !branch.checkpoints.includes(checkpoint.id)) {
      branch.checkpoints.push(checkpoint.id);
      this.saveTimeline();
    }
  }

  /**
   * Load a checkpoint from disk.
   */
  loadCheckpoint(checkpointId: string): FullCheckpoint | null {
    if (!isDebugBridgeEnabled()) return null;

    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');

    const filePath = join(getDebugBridge().getSessionDir(), 'checkpoints', `${checkpointId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      logger.debug(`Failed to load checkpoint ${checkpointId}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * List all checkpoints in the current session.
   */
  listCheckpoints(): Checkpoint[] {
    if (!isDebugBridgeEnabled()) return [];

    const { existsSync, readdirSync, readFileSync } = require('fs');
    const { join } = require('path');

    const checkpointsDir = join(getDebugBridge().getSessionDir(), 'checkpoints');
    if (!existsSync(checkpointsDir)) return [];

    const checkpoints: Checkpoint[] = [];
    const files = readdirSync(checkpointsDir).filter((f: string) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = readFileSync(join(checkpointsDir, file), 'utf8');
        const cp = JSON.parse(content) as FullCheckpoint;
        checkpoints.push({
          id: cp.id,
          label: cp.label,
          iteration: cp.iteration,
          timestamp: cp.timestamp,
          messageCount: cp.messageCount,
          tokenCount: cp.tokenCount,
        });
      } catch (error) {
        logger.debug(`Skipping invalid checkpoint file ${file}: ${error instanceof Error ? error.message : error}`);
      }
    }

    return checkpoints.sort((a, b) => a.iteration - b.iteration);
  }

  // ====================
  // Time Travel
  // ====================

  /**
   * Rewind to a checkpoint.
   * Returns the state to restore (agent applies it).
   */
  rewind(checkpointId: string): RewindResult {
    const checkpoint = this.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      return { success: false };
    }

    // Update iteration tracking
    this.currentIteration = checkpoint.iteration;
    this.lastCheckpointIteration = checkpoint.iteration;

    if (isDebugBridgeEnabled()) {
      getDebugBridge().rewind(checkpointId, checkpoint.iteration, checkpoint.state.messages.length);
    }

    return {
      success: true,
      state: {
        messages: structuredClone(checkpoint.state.messages) as Message[],
        summary: checkpoint.state.summary,
        workingSet: checkpoint.state.workingSet,
        iteration: checkpoint.iteration,
      },
    };
  }

  /**
   * Apply rewound state to a working set.
   * Helper to reconstruct WorkingSet from serialized state.
   */
  applyRewindState(state: WorkingSetState): WorkingSet {
    const workingSet = createWorkingSet();
    for (const file of state.recentFiles || []) {
      workingSet.recentFiles.add(file);
    }
    for (const entity of state.activeEntities || []) {
      workingSet.activeEntities.add(entity);
    }
    return workingSet;
  }

  /**
   * Create a branch from a checkpoint.
   */
  createBranch(checkpointId: string, branchName: string): boolean {
    const checkpoint = this.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      return false;
    }

    // Check if branch already exists
    if (this.timeline.branches.some(b => b.name === branchName)) {
      return false;
    }

    const branch: Branch = {
      name: branchName,
      parentBranch: checkpoint.branch,
      forkPoint: checkpointId,
      created: new Date().toISOString(),
      checkpoints: [],
      current: false,
    };

    this.timeline.branches.push(branch);
    this.saveTimeline();

    if (isDebugBridgeEnabled()) {
      getDebugBridge().branchCreated(branchName, checkpointId, checkpoint.branch);
    }

    return true;
  }

  /**
   * Switch to a different branch.
   * Returns the state to restore (agent applies it), or null if branch not found.
   */
  switchBranch(branchName: string): RewindResult {
    const branch = this.timeline.branches.find(b => b.name === branchName);
    if (!branch) {
      return { success: false };
    }

    // Find the latest checkpoint in the branch to restore from
    let checkpointId: string | undefined;
    if (branch.checkpoints.length > 0) {
      checkpointId = branch.checkpoints[branch.checkpoints.length - 1];
    } else if (branch.forkPoint) {
      checkpointId = branch.forkPoint;
    }

    let result: RewindResult = { success: true };
    if (checkpointId) {
      result = this.rewind(checkpointId);
      if (!result.success) {
        return { success: false };
      }
    }

    // Update current branch
    this.timeline.branches.forEach(b => b.current = false);
    branch.current = true;
    this.currentBranch = branchName;
    this.timeline.activeBranch = branchName;
    this.saveTimeline();

    if (isDebugBridgeEnabled()) {
      getDebugBridge().branchSwitched(branchName, this.currentIteration);
    }

    return result;
  }

  /**
   * List all branches.
   */
  listBranches(): Branch[] {
    return this.timeline.branches;
  }

  /**
   * Get the current branch name.
   */
  getCurrentBranch(): string {
    return this.currentBranch;
  }

  /**
   * Get the timeline.
   */
  getTimeline(): Timeline {
    return this.timeline;
  }

  /**
   * Save the timeline to disk.
   */
  private saveTimeline(): void {
    if (!isDebugBridgeEnabled()) return;

    const { writeFileSync } = require('fs');
    const { join } = require('path');

    const filePath = join(getDebugBridge().getSessionDir(), 'timeline.json');
    writeFileSync(filePath, JSON.stringify(this.timeline, null, 2));
  }

  /**
   * Load the timeline from disk.
   */
  loadTimeline(): void {
    if (!isDebugBridgeEnabled()) return;

    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');

    const filePath = join(getDebugBridge().getSessionDir(), 'timeline.json');
    if (!existsSync(filePath)) return;

    try {
      this.timeline = JSON.parse(readFileSync(filePath, 'utf8'));
      this.currentBranch = this.timeline.activeBranch;
    } catch (error) {
      logger.debug(`Failed to load timeline: ${error instanceof Error ? error.message : error}`);
    }
  }
}

// Re-export types from debug-bridge for convenience
export type {
  Breakpoint,
  BreakpointContext,
  BreakpointType,
  Checkpoint,
  FullCheckpoint,
  Branch,
  Timeline,
} from '../debug-bridge.js';
