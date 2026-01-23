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
 * Directory structure:
 *   ~/.codi/debug/
 *   ├── sessions/
 *   │   ├── debug_20260123_131000_abc1/
 *   │   │   ├── events.jsonl
 *   │   │   ├── commands.jsonl
 *   │   │   └── session.json
 *   │   └── ...
 *   ├── current -> sessions/debug_20260123_131000_abc1  (symlink)
 *   └── index.json  (list of active sessions)
 */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { watch, type FSWatcher } from 'chokidar';
import type { Message, ToolCall } from './types.js';

/** Debug directory */
const DEBUG_DIR = join(homedir(), '.codi', 'debug');

/** Sessions directory */
const SESSIONS_DIR = join(DEBUG_DIR, 'sessions');

/** Symlink to current session */
const CURRENT_LINK = join(DEBUG_DIR, 'current');

/** Session index file */
const INDEX_FILE = join(DEBUG_DIR, 'index.json');

/**
 * Session index entry.
 */
interface SessionIndexEntry {
  id: string;
  pid: number;
  startTime: string;
  cwd: string;
}

/**
 * Session index structure.
 */
interface SessionIndex {
  sessions: SessionIndexEntry[];
}

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
  | 'state_snapshot'
  | 'paused'
  | 'resumed'
  | 'step_complete'
  | 'command_response';

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
  private sessionDir: string = '';
  private sequence: number = 0;
  private startTime: number;
  private paused: boolean = false;
  private commandCallback?: (cmd: DebugCommand) => Promise<void>;
  private lastCommandPosition: number = 0;
  private commandWatcher?: FSWatcher;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();
  }

  /**
   * Enable the debug bridge.
   */
  enable(): void {
    this.enabled = true;
    this.sessionDir = join(SESSIONS_DIR, this.sessionId);
    this.ensureSessionDir();
    this.cleanupStaleSessions();
    this.registerSession();
    this.updateCurrentSymlink();
    this.initializeFiles();
    this.writeSessionInfo();
    console.log(`\n🔧 Debug bridge enabled`);
    console.log(`   Events: ${this.getEventsFile()}`);
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
    return join(this.sessionDir, 'events.jsonl');
  }

  /**
   * Get the commands file path.
   */
  getCommandsFile(): string {
    return join(this.sessionDir, 'commands.jsonl');
  }

  /**
   * Get the session file path.
   */
  getSessionFile(): string {
    return join(this.sessionDir, 'session.json');
  }

  /**
   * Get the session directory path.
   */
  getSessionDir(): string {
    return this.sessionDir;
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

  private ensureSessionDir(): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private initializeFiles(): void {
    writeFileSync(this.getEventsFile(), '');
    writeFileSync(this.getCommandsFile(), '');
  }

  private updateCurrentSymlink(): void {
    try {
      // Remove existing symlink if present
      if (existsSync(CURRENT_LINK)) {
        unlinkSync(CURRENT_LINK);
      }
      // Create relative symlink to current session (sessions/<session-id>)
      const relativeTarget = join('sessions', this.sessionId);
      symlinkSync(relativeTarget, CURRENT_LINK);
    } catch {
      // Symlinks may fail on Windows or due to permissions, ignore
    }
  }

  private registerSession(): void {
    const index = this.loadSessionIndex();
    index.sessions.push({
      id: this.sessionId,
      pid: process.pid,
      startTime: new Date(this.startTime).toISOString(),
      cwd: process.cwd(),
    });
    this.saveSessionIndex(index);
  }

  private unregisterSession(): void {
    const index = this.loadSessionIndex();
    index.sessions = index.sessions.filter(s => s.id !== this.sessionId);
    this.saveSessionIndex(index);
  }

  private loadSessionIndex(): SessionIndex {
    if (!existsSync(INDEX_FILE)) {
      return { sessions: [] };
    }
    try {
      return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
    } catch {
      return { sessions: [] };
    }
  }

  private saveSessionIndex(index: SessionIndex): void {
    // Ensure debug directory exists
    if (!existsSync(DEBUG_DIR)) {
      mkdirSync(DEBUG_DIR, { recursive: true });
    }
    writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  }

  /**
   * Clean up stale sessions (processes that no longer exist).
   */
  private cleanupStaleSessions(): void {
    const index = this.loadSessionIndex();
    const activeSessions: SessionIndexEntry[] = [];

    for (const session of index.sessions) {
      if (this.isProcessRunning(session.pid)) {
        activeSessions.push(session);
      } else {
        // Process no longer running, remove session directory
        const sessionDir = join(SESSIONS_DIR, session.id);
        try {
          rmSync(sessionDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    if (activeSessions.length !== index.sessions.length) {
      this.saveSessionIndex({ sessions: activeSessions });
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private writeSessionInfo(): void {
    const info = {
      sessionId: this.sessionId,
      startTime: new Date(this.startTime).toISOString(),
      pid: process.pid,
      cwd: process.cwd(),
      eventsFile: this.getEventsFile(),
      commandsFile: this.getCommandsFile(),
    };
    writeFileSync(this.getSessionFile(), JSON.stringify(info, null, 2));
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
      appendFileSync(this.getEventsFile(), JSON.stringify(event) + '\n');
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
    this.stopCommandWatcher();
    this.sessionEnd();
    this.unregisterSession();
    this.enabled = false;
  }

  // ============================================
  // Command watching (Phase 2)
  // ============================================

  /**
   * Start watching the commands file for incoming commands.
   * Commands are processed asynchronously via the callback.
   */
  startCommandWatcher(callback: (cmd: DebugCommand) => Promise<void>): void {
    if (!this.enabled) return;

    this.commandCallback = callback;

    // Initialize lastCommandPosition to current file length
    // so we only process commands written after watcher starts
    try {
      const content = readFileSync(this.getCommandsFile(), 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      this.lastCommandPosition = lines.length;
    } catch {
      this.lastCommandPosition = 0;
    }

    // Use chokidar for reliable cross-platform file watching
    this.commandWatcher = watch(this.getCommandsFile(), {
      persistent: true,
      usePolling: true, // More reliable for tests
      interval: 50,
    });

    this.commandWatcher.on('change', () => this.processNewCommands());
    console.log(`   Commands: ${this.getCommandsFile()}`);
  }

  /**
   * Stop watching the commands file.
   */
  stopCommandWatcher(): void {
    if (this.commandWatcher) {
      this.commandWatcher.close();
      this.commandWatcher = undefined;
    }
  }

  /**
   * Process new commands from the commands file.
   */
  private async processNewCommands(): Promise<void> {
    if (!this.commandCallback) return;

    try {
      const content = readFileSync(this.getCommandsFile(), 'utf8');
      const lines = content.split('\n').filter(l => l.trim());

      // Process only new commands since last check
      const newLines = lines.slice(this.lastCommandPosition);
      this.lastCommandPosition = lines.length;

      for (const line of newLines) {
        try {
          const cmd = JSON.parse(line) as DebugCommand;
          await this.commandCallback(cmd);
          this.emit('command_executed', { commandId: cmd.id, type: cmd.type });
        } catch (err) {
          this.emit('error', {
            message: `Invalid command: ${err instanceof Error ? err.message : String(err)}`,
            context: 'command_processing',
          });
        }
      }
    } catch (err) {
      // File read error, ignore
    }
  }
}

// ============================================
// Utility functions for external access
// ============================================

/**
 * Get the debug directory path.
 */
export function getDebugDir(): string {
  return DEBUG_DIR;
}

/**
 * Get the sessions directory path.
 */
export function getSessionsDir(): string {
  return SESSIONS_DIR;
}

/**
 * Get the current session symlink path.
 */
export function getCurrentSessionLink(): string {
  return CURRENT_LINK;
}

/**
 * Get the session index file path.
 */
export function getSessionIndexFile(): string {
  return INDEX_FILE;
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
