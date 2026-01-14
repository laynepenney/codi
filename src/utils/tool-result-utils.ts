// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Tool result processing utilities.
 * Extracted from agent.ts for reusability.
 */

import type { Message } from '../types.js';
import { AGENT_CONFIG } from '../constants.js';

/**
 * Create a short summary of a tool result for truncation.
 */
export function summarizeToolResult(toolName: string, content: string, isError: boolean): string {
  const lines = content.split('\n').length;
  const chars = content.length;

  if (isError) {
    // Keep first line of error for context
    const firstLine = content.split('\n')[0].slice(0, 100);
    return `[${toolName} ERROR: ${firstLine}...]`;
  }

  // Create summary based on tool type
  switch (toolName) {
    case 'read_file':
    case 'list_directory':
      return `[${toolName}: ${lines} lines, ${chars} chars]`;
    case 'glob':
    case 'grep': {
      const matchCount = content.split('\n').filter(l => l.trim()).length;
      return `[${toolName}: ${matchCount} matches]`;
    }
    case 'bash': {
      const preview = content.slice(0, 100).replace(/\n/g, ' ');
      return `[${toolName}: ${preview}${chars > 100 ? '...' : ''} (${lines} lines)]`;
    }
    case 'write_file':
    case 'edit_file':
    case 'insert_line':
    case 'patch_file':
      return `[${toolName}: success]`;
    default:
      return `[${toolName}: ${lines} lines, ${chars} chars]`;
  }
}

/**
 * Truncate old tool results in message history to save context.
 * Keeps recent tool results intact, truncates older ones to summaries.
 */
export function truncateOldToolResults(messages: Message[]): void {
  // Find indices of messages containing tool_result blocks
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (typeof msg.content !== 'string') {
      const hasToolResult = msg.content.some(block => block.type === 'tool_result');
      if (hasToolResult) {
        toolResultIndices.push(i);
      }
    }
  }

  // Keep recent tool results, truncate older ones
  const indicesToTruncate = toolResultIndices.slice(0, -AGENT_CONFIG.RECENT_TOOL_RESULTS_TO_KEEP);

  for (const idx of indicesToTruncate) {
    const msg = messages[idx];
    if (typeof msg.content === 'string') continue;

    msg.content = msg.content.map(block => {
      if (block.type !== 'tool_result') return block;
      if (!block.content || block.content.length <= AGENT_CONFIG.TOOL_RESULT_TRUNCATE_THRESHOLD) return block;

      // Truncate to summary
      const summary = summarizeToolResult(
        block.name || 'tool',
        block.content,
        !!block.is_error
      );

      return {
        ...block,
        content: summary,
      };
    });
  }
}
