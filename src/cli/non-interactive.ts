// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-interactive mode execution for single-prompt CLI usage.
 */

import chalk from 'chalk';
import type { Agent } from '../agent.js';
import type { AuditLogger } from '../audit.js';
import type { BackgroundIndexer } from '../rag/index.js';
import type { MCPClientManager } from '../mcp/index.js';
import { spinner } from '../spinner.js';

/**
 * Non-interactive mode result type for JSON output.
 */
export interface NonInteractiveResult {
  success: boolean;
  response: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number } | null;
  error?: string;
}

/**
 * Options for non-interactive mode execution.
 */
export interface NonInteractiveOptions {
  outputFormat: 'text' | 'json';
  quiet: boolean;
  auditLogger: AuditLogger;
  ragIndexer: BackgroundIndexer | null;
  mcpManager: MCPClientManager | null;
  autoSave?: () => void;
}

/**
 * Run Codi in non-interactive mode with a single prompt.
 * Outputs result to stdout and exits with appropriate code.
 */
export async function runNonInteractive(
  agent: Agent,
  prompt: string,
  options: NonInteractiveOptions
): Promise<void> {
  const { outputFormat, quiet, auditLogger, ragIndexer, mcpManager, autoSave } = options;

  // Disable spinner in quiet mode
  if (quiet) {
    spinner.setEnabled(false);
  }

  // Track tool calls for JSON output
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let lastUsage: { inputTokens: number; outputTokens: number } | null = null;

  try {
    // Suppress normal output in JSON mode, collect for later
    let responseText = '';

    if (outputFormat === 'json') {
      // In JSON mode, suppress streaming output - we'll collect it
      // Note: The agent's callbacks are already set up, but we need to
      // track the response ourselves
    }

    // Log user input
    auditLogger.userInput(prompt);

    // Run the agent
    if (!quiet) {
      spinner.thinking();
    }

    const response = await agent.chat(prompt);
    responseText = response;

    // Stop spinner
    spinner.stop();

    autoSave?.();

    // Get usage info from agent's context
    const contextInfo = agent.getContextInfo();

    // Output based on format
    if (outputFormat === 'json') {
      const result: NonInteractiveResult = {
        success: true,
        response: responseText,
        toolCalls,
        usage: lastUsage,
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Text format - response was already streamed by agent callbacks
      // Just add a newline for clean output
      if (!responseText.endsWith('\n')) {
        console.log();
      }
    }

    // Cleanup
    if (ragIndexer) {
      ragIndexer.shutdown();
    }
    if (mcpManager) {
      await mcpManager.disconnectAll();
    }
    auditLogger.sessionEnd();

    process.exit(0);
  } catch (error) {
    spinner.stop();

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (outputFormat === 'json') {
      const result: NonInteractiveResult = {
        success: false,
        response: '',
        toolCalls,
        usage: lastUsage,
        error: errorMessage,
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(chalk.red('Error: ' + errorMessage));
    }

    // Cleanup
    if (ragIndexer) {
      ragIndexer.shutdown();
    }
    if (mcpManager) {
      await mcpManager.disconnectAll();
    }
    auditLogger.sessionEnd();

    process.exit(1);
  }
}
