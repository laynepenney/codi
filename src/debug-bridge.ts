// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Debug Bridge
 *
 * Enables live debugging of Codi sessions by streaming events to a file
 * that can be monitored by another Claude instance or debugging tool.
 *
 * Usage:
 *   codi --debug-bridge
 *
 * Events are written to: ~/.codi/debug/events.jsonl
 * Commands are read from: ~/.codi/debug/commands.jsonl (Phase 2)
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync, watchFile, unwatchFile, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Message, ToolCall } from './types.js';

/** Debug directory */
const DEBUG_DIR = join(homedir(), '.codi', 'debug');

/** Events file - Codi writes, debugger reads */
const EVENTS_FILE = join(DEBUG_DIR, 'events.jsonl');

/** Commands file - debugger writes, Codi reads (Phase 2) */
const COMMANDS_FILE = join(DEBUG_DIR, 'commands.jsonl');

/** Session info file - metadata about current session */
const SESSION_FILE = join(DEBUG_DIR, 'session.json');

/**
 * Event types emitted by the debug bridge.
 */
export type DebugEventType =
  | 'session_start'
  | 'session_end'
  | 'user_input'
  | 'assistant_text'
  | 'assistant_thinking'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_result'
  | 'api_request'
  | 'api_response'
  | 'context_compaction'
  | 'error'
  | 'command_executed'
  | 'model_switch'
  | 'state_snapshot';

/**
 * Base debug event structure.
 */
export interface DebugEvent {
  type: DebugEventType;
  timestamp: string;
  sessionId: string;
  sequence: number;
  data: Record<string, unknown>;
}

/**
 * Command types that can be sent to Codi (Phase 2).
 */
export type DebugCommandType =
  | 'inspect'
  | 'breakpoint'
  | 'pause'
  | 'resume'
  | 'inject_message'
  | 'set_variable'
  | 'step';

/**
 * Command structure.
 */
export interface DebugCommand {
  type: DebugCommandType;
  id: string;
  data: Record<string, unknown>;
}

/**
 * Debug Bridge class for streaming events and receiving commands.
 */
export class DebugBridge {
  private enabled: boolean = false;
  private sessionId: string;
  private sequence: number = 0;
  private startTime: number;
  private paused: boolean = false;
  private commandCallback?: (cmd: DebugCommand) => void;
  private lastCommandPosition: number = 0;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();
  }

  /**
   * Enable the debug bridge.
   */
  enable(): void {
    this.enabled = true;
    this.ensureDebugDir();
    this.clearEvents();
    this.writeSessionInfo();
    console.log(`\n🔧 Debug bridge enabled`);
    console.log(`   Events: ${EVENTS_FILE}`);
    console.log(`   Session: ${this.sessionId}\n`);
  }

  /**
   * Check if debug bridge is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the events file path.
   */
  getEventsFile(): string {
    return EVENTS_FILE;
  }

  /**
   * Get the commands file path.
   */
  getCommandsFile(): string {
    return COMMANDS_FILE;
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  private generateSessionId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const rand = Math.random().toString(36).slice(2, 6);
    return `debug_${date}_${time}_${rand}`;
  }

  private ensureDebugDir(): void {
    if (!existsSync(DEBUG_DIR)) {
      mkdirSync(DEBUG_DIR, { recursive: true });
    }
  }

  private clearEvents(): void {
    writeFileSync(EVENTS_FILE, '');
    writeFileSync(COMMANDS_FILE, '');
  }

  private writeSessionInfo(): void {
    const info = {
      sessionId: this.sessionId,
      startTime: new Date(this.startTime).toISOString(),
      pid: process.pid,
      cwd: process.cwd(),
      eventsFile: EVENTS_FILE,
      commandsFile: COMMANDS_FILE,
    };
    writeFileSync(SESSION_FILE, JSON.stringify(info, null, 2));
  }

  /**
   * Emit a debug event.
   */
  emit(type: DebugEventType, data: Record<string, unknown> = {}): void {
    if (!this.enabled) return;

    const event: DebugEvent = {
      type,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      sequence: this.sequence++,
      data,
    };

    try {
      appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
    } catch {
      // Ignore write errors to avoid disrupting the session
    }
  }

  // ============================================
  // Convenience methods for common events
  // ============================================

  /**
   * Emit session start event.
   */
  sessionStart(provider: string, model: string): void {
    this.emit('session_start', {
      provider,
      model,
      cwd: process.cwd(),
      pid: process.pid,
    });
  }

  /**
   * Emit session end event.
   */
  sessionEnd(stats?: { messages?: number; toolCalls?: number; duration?: number }): void {
    this.emit('session_end', {
      ...stats,
      duration: Date.now() - this.startTime,
    });
  }

  /**
   * Emit user input event.
   */
  userInput(input: string, isCommand: boolean = false): void {
    this.emit('user_input', {
      input: input.slice(0, 1000), // Truncate long inputs
      isCommand,
      length: input.length,
    });
  }

  /**
   * Emit assistant text event.
   */
  assistantText(text: string, isStreaming: boolean = false): void {
    this.emit('assistant_text', {
      text: text.slice(0, 2000), // Truncate long responses
      length: text.length,
      isStreaming,
    });
  }

  /**
   * Emit tool call start event.
   */
  toolCallStart(name: string, input: Record<string, unknown>, toolId: string): void {
    // Sanitize input - truncate long values
    const sanitizedInput: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && value.length > 500) {
        sanitizedInput[key] = value.slice(0, 500) + `... (${value.length} chars)`;
      } else {
        sanitizedInput[key] = value;
      }
    }

    this.emit('tool_call_start', {
      name,
      input: sanitizedInput,
      toolId,
    });
  }

  /**
   * Emit tool call end event.
   */
  toolCallEnd(name: string, toolId: string, durationMs: number, isError: boolean): void {
    this.emit('tool_call_end', {
      name,
      toolId,
      durationMs,
      isError,
    });
  }

  /**
   * Emit tool result event.
   */
  toolResult(name: string, toolId: string, result: string, isError: boolean): void {
    this.emit('tool_result', {
      name,
      toolId,
      result: result.slice(0, 1000), // Truncate long results
      resultLength: result.length,
      isError,
    });
  }

  /**
   * Emit API request event.
   */
  apiRequest(provider: string, model: string, messageCount: number, hasTools: boolean): void {
    this.emit('api_request', {
      provider,
      model,
      messageCount,
      hasTools,
    });
  }

  /**
   * Emit API response event.
   */
  apiResponse(
    stopReason: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    toolCallCount: number
  ): void {
    this.emit('api_response', {
      stopReason,
      inputTokens,
      outputTokens,
      durationMs,
      toolCallCount,
    });
  }

  /**
   * Emit context compaction event.
   */
  contextCompaction(
    beforeTokens: number,
    afterTokens: number,
    messagesBefore: number,
    messagesAfter: number
  ): void {
    this.emit('context_compaction', {
      beforeTokens,
      afterTokens,
      messagesBefore,
      messagesAfter,
      savings: beforeTokens - afterTokens,
      savingsPercent: ((beforeTokens - afterTokens) / beforeTokens * 100).toFixed(1),
    });
  }

  /**
   * Emit error event.
   */
  error(message: string, stack?: string, context?: string): void {
    this.emit('error', {
      message,
      stack,
      context,
    });
  }

  /**
   * Emit command executed event.
   */
  commandExecuted(command: string, result?: string): void {
    this.emit('command_executed', {
      command,
      result: result?.slice(0, 500),
    });
  }

  /**
   * Emit model switch event.
   */
  modelSwitch(fromProvider: string, fromModel: string, toProvider: string, toModel: string): void {
    this.emit('model_switch', {
      from: { provider: fromProvider, model: fromModel },
      to: { provider: toProvider, model: toModel },
    });
  }

  /**
   * Emit state snapshot event.
   */
  stateSnapshot(data: {
    messageCount?: number;
    tokenEstimate?: number;
    hasSummary?: boolean;
    provider?: string;
    model?: string;
    workingSetSize?: number;
  }): void {
    this.emit('state_snapshot', data);
  }

  /**
   * Shutdown the debug bridge.
   */
  shutdown(): void {
    if (!this.enabled) return;
    this.sessionEnd();
    this.enabled = false;
  }
}

// ============================================
// Global instance
// ============================================

let globalDebugBridge: DebugBridge | null = null;

/**
 * Get or create the global debug bridge instance.
 */
export function getDebugBridge(): DebugBridge {
  if (!globalDebugBridge) {
    globalDebugBridge = new DebugBridge();
  }
  return globalDebugBridge;
}

/**
 * Initialize and enable the debug bridge.
 */
export function initDebugBridge(): DebugBridge {
  const bridge = getDebugBridge();
  bridge.enable();
  return bridge;
}

/**
 * Check if debug bridge is enabled.
 */
export function isDebugBridgeEnabled(): boolean {
  return globalDebugBridge?.isEnabled() ?? false;
}
