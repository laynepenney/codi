// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Logger
 *
 * Level-aware logging utilities for debug output.
 * Provides graduated verbosity: NORMAL → VERBOSE → DEBUG → TRACE
 */

import chalk from 'chalk';
import type { Message, ToolDefinition } from './types.js';

/**
 * Log levels for graduated verbosity.
 */
export enum LogLevel {
  /** Normal output - only essential information */
  NORMAL = 0,
  /** Verbose - tool inputs/outputs with timing */
  VERBOSE = 1,
  /** Debug - API details, context info */
  DEBUG = 2,
  /** Trace - full request/response payloads */
  TRACE = 3,
}

/**
 * Parse log level from CLI options.
 */
export function parseLogLevel(options: {
  verbose?: boolean;
  debug?: boolean;
  trace?: boolean;
}): LogLevel {
  if (options.trace) return LogLevel.TRACE;
  if (options.debug) return LogLevel.DEBUG;
  if (options.verbose) return LogLevel.VERBOSE;
  return LogLevel.NORMAL;
}

/**
 * Centralized logger with level-aware output.
 */
class Logger {
  private level: LogLevel = LogLevel.NORMAL;
  private paused: boolean = false;

  /**
   * Set the current log level.
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level.
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Pause all logging (useful during user input prompts).
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume logging.
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Check if a specific level is enabled.
   */
  isLevelEnabled(level: LogLevel): boolean {
    return !this.paused && this.level >= level;
  }

  // ============================================
  // Level-aware logging methods
  // ============================================

  /**
   * Log at VERBOSE level (shows at VERBOSE, DEBUG, TRACE).
   */
  verbose(message: string): void {
    if (this.level >= LogLevel.VERBOSE) {
      console.log(chalk.dim(message));
    }
  }

  /**
   * Log at DEBUG level (shows at DEBUG, TRACE).
   */
  debug(message: string): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(chalk.dim(`[Debug] ${message}`));
    }
  }

  /**
   * Log at TRACE level (shows only at TRACE).
   */
  trace(message: string): void {
    if (this.level >= LogLevel.TRACE) {
      console.log(chalk.gray(`[Trace] ${message}`));
    }
  }

  // ============================================
  // Formatted output helpers
  // ============================================

  /**
   * Log tool input at VERBOSE level.
   */
  toolInput(name: string, input: Record<string, unknown>): void {
    if (this.level >= LogLevel.VERBOSE) {
      console.log(chalk.yellow(`\n📎 ${name}`));
      for (const [key, value] of Object.entries(input)) {
        const valueStr = typeof value === 'string'
          ? value.length > 80 ? value.slice(0, 80) + '...' : value
          : JSON.stringify(value);
        console.log(chalk.dim(`   ${key}: ${valueStr}`));
      }
    }
  }

  /**
   * Log tool output at VERBOSE level.
   */
  toolOutput(name: string, result: string, duration: number, isError: boolean): void {
    if (this.level >= LogLevel.VERBOSE) {
      const lines = result.split('\n').length;
      const durationStr = duration.toFixed(2);

      if (isError) {
        console.log(chalk.red(`✗ ${name}`) + chalk.dim(` (error, ${durationStr}s)`));
        if (this.level >= LogLevel.DEBUG) {
          console.log(chalk.red(chalk.dim(`   ${result.slice(0, 200)}`)));
        }
      } else {
        console.log(chalk.green(`✓ ${name}`) + chalk.dim(` (${lines} lines, ${durationStr}s)`));
      }
    }
  }

  /**
   * Log context state at DEBUG level.
   */
  contextState(messageCount: number, tokenEstimate: number): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(chalk.dim(`[Context] ${tokenEstimate.toLocaleString()} tokens, ${messageCount} messages`));
    }
  }

  /**
   * Log context compaction at DEBUG level.
   */
  contextCompaction(
    beforeTokens: number,
    afterTokens: number,
    messagesKept: number,
    messagesSummarized: number
  ): void {
    if (this.level >= LogLevel.DEBUG) {
      const saved = beforeTokens - afterTokens;
      const percent = ((saved / beforeTokens) * 100).toFixed(1);
      console.log(chalk.dim(
        `[Context] Compacted: ${beforeTokens.toLocaleString()} → ${afterTokens.toLocaleString()} tokens ` +
        `(saved ${percent}%), kept ${messagesKept} messages, summarized ${messagesSummarized}`
      ));
    }
  }

  /**
   * Log compression stats at DEBUG level.
   */
  compressionStats(savings: number, savingsPercent: number, entityCount: number): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(chalk.dim(
        `[Compression] Saved ${savings} chars (${savingsPercent.toFixed(1)}%), ${entityCount} entities`
      ));
    }
  }

  /**
   * Log API request at DEBUG/TRACE level.
   */
  apiRequest(model: string, messageCount: number, hasTools: boolean): void {
    if (this.level >= LogLevel.DEBUG) {
      const toolsStr = hasTools ? ', with tools' : '';
      console.log(chalk.dim(`[API] Sending to ${model} (${messageCount} messages${toolsStr})...`));
    }
  }

  /**
   * Log API response at DEBUG level.
   */
  apiResponse(
    outputTokens: number,
    stopReason: string,
    duration: number,
    toolCallCount?: number
  ): void {
    if (this.level >= LogLevel.DEBUG) {
      let details = `${outputTokens} tokens, ${stopReason}`;
      if (toolCallCount && toolCallCount > 0) {
        details += `, ${toolCallCount} tool calls`;
      }
      details += `, ${duration.toFixed(2)}s`;
      console.log(chalk.dim(`[API] Response: ${details}`));
    }
  }

  /**
   * Sanitize a string for safe terminal output.
   */
  private sanitize(str: string): string {
    // Replace control characters and escape sequences that could mess up the terminal
    return str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except \t, \n, \r
      .replace(/\r?\n/g, '\\n') // Show newlines as \n
      .replace(/\t/g, '\\t'); // Show tabs as \t
  }

  /**
   * Log full API request at TRACE level.
   */
  apiRequestFull(
    model: string,
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): void {
    if (this.level >= LogLevel.TRACE) {
      console.log(chalk.gray('\n' + '='.repeat(60)));
      console.log(chalk.gray('[API Request]'));
      console.log(chalk.gray('='.repeat(60)));
      console.log(chalk.gray(`  model: ${model}`));

      if (systemPrompt) {
        const truncated = systemPrompt.length > 200
          ? systemPrompt.slice(0, 200) + '...'
          : systemPrompt;
        console.log(chalk.gray(`  system: "${this.sanitize(truncated)}"`));
      }

      console.log(chalk.gray(`  messages: [`));
      for (const msg of messages.slice(-5)) { // Show last 5 messages
        const content = typeof msg.content === 'string'
          ? msg.content.slice(0, 100)
          : '[complex content]';
        console.log(chalk.gray(`    { role: "${msg.role}", content: "${this.sanitize(content)}${content.length >= 100 ? '...' : ''}" }`));
      }
      if (messages.length > 5) {
        console.log(chalk.gray(`    ... and ${messages.length - 5} more messages`));
      }
      console.log(chalk.gray(`  ]`));

      if (tools && tools.length > 0) {
        const toolNames = tools.map(t => t.name).join(', ');
        console.log(chalk.gray(`  tools: [${toolNames}]`));
      }
      console.log(chalk.gray('='.repeat(60) + '\n'));
    }
  }

  /**
   * Log full API response at TRACE level.
   */
  apiResponseFull(
    stopReason: string,
    inputTokens: number,
    outputTokens: number,
    content: string | unknown[],
    toolCalls?: Array<{ name: string; input: unknown }>
  ): void {
    if (this.level >= LogLevel.TRACE) {
      console.log(chalk.gray('\n' + '='.repeat(60)));
      console.log(chalk.gray('[API Response]'));
      console.log(chalk.gray('='.repeat(60)));
      console.log(chalk.gray(`  stop_reason: ${stopReason}`));
      console.log(chalk.gray(`  usage: { input: ${inputTokens}, output: ${outputTokens} }`));

      if (typeof content === 'string') {
        const truncated = content.length > 300 ? content.slice(0, 300) + '...' : content;
        console.log(chalk.gray(`  content: "${this.sanitize(truncated)}"`));
      } else if (Array.isArray(content)) {
        console.log(chalk.gray(`  content: [${content.length} blocks]`));
      }

      if (toolCalls && toolCalls.length > 0) {
        console.log(chalk.gray(`  tool_calls: [`));
        for (const call of toolCalls) {
          const inputStr = this.sanitize(JSON.stringify(call.input).slice(0, 100));
          console.log(chalk.gray(`    { name: "${call.name}", input: ${inputStr}${inputStr.length >= 100 ? '...' : ''} }`));
        }
        console.log(chalk.gray(`  ]`));
      }
      console.log(chalk.gray('='.repeat(60) + '\n'));
    }
  }

  /**
   * Log an error with optional stack trace at DEBUG level.
   */
  error(message: string, error?: Error): void {
    console.error(chalk.red(`Error: ${message}`));
    if (error && this.level >= LogLevel.DEBUG) {
      console.error(chalk.dim(error.stack || 'No stack trace available'));
    }
  }

  /**
   * Log a warning.
   */
  warn(message: string): void {
    console.warn(chalk.yellow(`Warning: ${message}`));
  }

  /**
   * Log an info message.
   */
  info(message: string): void {
    console.log(chalk.blue(`Info: ${message}`));
  }
}

/**
 * Singleton logger instance for global use.
 */
export const logger = new Logger();
