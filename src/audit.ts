// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Audit Logger for Session Debugging
 *
 * Writes detailed JSONL logs of all API interactions, tool calls,
 * and session events to help debug issues without polluting terminal output.
 *
 * Usage:
 *   codi --audit           # Writes to ~/.codi/audit/<timestamp>.jsonl
 *   CODI_AUDIT=true codi   # Same via environment variable
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Message, ToolDefinition, ToolCall, TokenUsage } from './types.js';

/** Audit event types */
export type AuditEventType =
  | 'session_start'
  | 'session_end'
  | 'api_request'
  | 'api_response'
  | 'tool_call'
  | 'tool_result'
  | 'compaction'
  | 'max_iterations'
  | 'error'
  | 'user_input'
  | 'user_abort';

/** Base audit event */
interface AuditEventBase {
  timestamp: string;
  type: AuditEventType;
  sessionId: string;
  iteration?: number;
}

/** Session start event */
export interface SessionStartEvent extends AuditEventBase {
  type: 'session_start';
  provider: string;
  model: string;
  cwd: string;
  args: string[];
}

/** Session end event */
export interface SessionEndEvent extends AuditEventBase {
  type: 'session_end';
  totalIterations: number;
  totalApiCalls: number;
  totalTokens: { input: number; output: number };
  durationMs: number;
}

/** API request event */
export interface ApiRequestEvent extends AuditEventBase {
  type: 'api_request';
  provider: string;
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  messageCount: number;
}

/** API response event */
export interface ApiResponseEvent extends AuditEventBase {
  type: 'api_response';
  stopReason: string;
  content: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  usage?: TokenUsage;
  durationMs: number;
  rawResponse?: unknown;
}

/** Tool call event */
export interface ToolCallEvent extends AuditEventBase {
  type: 'tool_call';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolId: string;
}

/** Tool result event */
export interface ToolResultEvent extends AuditEventBase {
  type: 'tool_result';
  toolName: string;
  toolId: string;
  result: string;
  isError: boolean;
  durationMs: number;
}

/** Compaction event */
export interface CompactionEvent extends AuditEventBase {
  type: 'compaction';
  beforeTokens: number;
  afterTokens: number;
  messagesBefore: number;
  messagesAfter: number;
  summaryLength: number;
}

/** Max iterations event */
export interface MaxIterationsEvent extends AuditEventBase {
  type: 'max_iterations';
  iterations: number;
  maxIterations: number;
}

/** Error event */
export interface ErrorEvent extends AuditEventBase {
  type: 'error';
  errorMessage: string;
  errorStack?: string;
  context?: string;
}

/** User input event */
export interface UserInputEvent extends AuditEventBase {
  type: 'user_input';
  input: string;
}

/** User abort event */
export interface UserAbortEvent extends AuditEventBase {
  type: 'user_abort';
  toolName?: string;
  reason?: string;
}

export type AuditEvent =
  | SessionStartEvent
  | SessionEndEvent
  | ApiRequestEvent
  | ApiResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | CompactionEvent
  | MaxIterationsEvent
  | ErrorEvent
  | UserInputEvent
  | UserAbortEvent;

/**
 * Audit logger that writes JSONL to a file.
 */
export class AuditLogger {
  private logFile: string;
  private sessionId: string;
  private enabled: boolean;
  private iteration: number = 0;
  private apiCallCount: number = 0;
  private totalTokens = { input: 0, output: 0 };
  private sessionStartTime: number;

  constructor(options: { enabled?: boolean; logFile?: string; sessionId?: string } = {}) {
    this.enabled = options.enabled ?? false;
    this.sessionId = options.sessionId ?? this.generateSessionId();
    this.sessionStartTime = Date.now();

    // Default log file location
    const auditDir = join(homedir(), '.codi', 'audit');
    this.logFile = options.logFile ?? join(auditDir, `${this.sessionId}.jsonl`);

    if (this.enabled) {
      // Ensure audit directory exists
      if (!existsSync(auditDir)) {
        mkdirSync(auditDir, { recursive: true });
      }
      // Create empty log file
      writeFileSync(this.logFile, '');
    }
  }

  private generateSessionId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const rand = Math.random().toString(36).slice(2, 6);
    return `${date}_${time}_${rand}`;
  }

  private write(event: AuditEvent): void {
    if (!this.enabled) return;

    try {
      appendFileSync(this.logFile, JSON.stringify(event) + '\n');
    } catch {
      // Ignore write errors to avoid disrupting the session
    }
  }

  private baseEvent(type: AuditEventType): AuditEventBase {
    return {
      timestamp: new Date().toISOString(),
      type,
      sessionId: this.sessionId,
      iteration: this.iteration,
    };
  }

  /** Get the log file path */
  getLogFile(): string {
    return this.logFile;
  }

  /** Check if audit logging is enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Set current iteration */
  setIteration(iteration: number): void {
    this.iteration = iteration;
  }

  /** Log session start */
  sessionStart(provider: string, model: string, cwd: string, args: string[]): void {
    this.write({
      ...this.baseEvent('session_start'),
      type: 'session_start',
      provider,
      model,
      cwd,
      args,
    });
  }

  /** Log session end */
  sessionEnd(): void {
    this.write({
      ...this.baseEvent('session_end'),
      type: 'session_end',
      totalIterations: this.iteration,
      totalApiCalls: this.apiCallCount,
      totalTokens: this.totalTokens,
      durationMs: Date.now() - this.sessionStartTime,
    });
  }

  /** Log API request */
  apiRequest(
    provider: string,
    model: string,
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): void {
    this.apiCallCount++;
    this.write({
      ...this.baseEvent('api_request'),
      type: 'api_request',
      provider,
      model,
      messages,
      tools,
      systemPrompt,
      messageCount: messages.length,
    });
  }

  /** Log API response */
  apiResponse(
    stopReason: string,
    content: string,
    toolCalls: ToolCall[],
    usage: TokenUsage | undefined,
    durationMs: number,
    rawResponse?: unknown
  ): void {
    if (usage) {
      this.totalTokens.input += usage.inputTokens;
      this.totalTokens.output += usage.outputTokens;
    }

    this.write({
      ...this.baseEvent('api_response'),
      type: 'api_response',
      stopReason,
      content,
      toolCalls: toolCalls.map(tc => ({ name: tc.name, input: tc.input })),
      usage,
      durationMs,
      rawResponse,
    });
  }

  /** Log tool call start */
  toolCall(toolName: string, toolInput: Record<string, unknown>, toolId: string): void {
    this.write({
      ...this.baseEvent('tool_call'),
      type: 'tool_call',
      toolName,
      toolInput,
      toolId,
    });
  }

  /** Log tool result */
  toolResult(
    toolName: string,
    toolId: string,
    result: string,
    isError: boolean,
    durationMs: number
  ): void {
    this.write({
      ...this.baseEvent('tool_result'),
      type: 'tool_result',
      toolName,
      toolId,
      result,
      isError,
      durationMs,
    });
  }

  /** Log compaction */
  compaction(
    beforeTokens: number,
    afterTokens: number,
    messagesBefore: number,
    messagesAfter: number,
    summaryLength: number
  ): void {
    this.write({
      ...this.baseEvent('compaction'),
      type: 'compaction',
      beforeTokens,
      afterTokens,
      messagesBefore,
      messagesAfter,
      summaryLength,
    });
  }

  /** Log max iterations reached */
  maxIterations(iterations: number, maxIterations: number): void {
    this.write({
      ...this.baseEvent('max_iterations'),
      type: 'max_iterations',
      iterations,
      maxIterations,
    });
  }

  /** Log error */
  error(errorMessage: string, errorStack?: string, context?: string): void {
    this.write({
      ...this.baseEvent('error'),
      type: 'error',
      errorMessage,
      errorStack,
      context,
    });
  }

  /** Log user input */
  userInput(input: string): void {
    this.write({
      ...this.baseEvent('user_input'),
      type: 'user_input',
      input,
    });
  }

  /** Log user abort */
  userAbort(toolName?: string, reason?: string): void {
    this.write({
      ...this.baseEvent('user_abort'),
      type: 'user_abort',
      toolName,
      reason,
    });
  }
}

/** Global audit logger instance (set by CLI) */
let globalAuditLogger: AuditLogger | null = null;

/** Set the global audit logger */
export function setAuditLogger(logger: AuditLogger): void {
  globalAuditLogger = logger;
}

/** Get the global audit logger (may be null if not enabled) */
export function getAuditLogger(): AuditLogger | null {
  return globalAuditLogger;
}

/** Convenience function to create and set audit logger */
export function initAuditLogger(enabled: boolean): AuditLogger {
  const logger = new AuditLogger({ enabled });
  setAuditLogger(logger);
  return logger;
}
