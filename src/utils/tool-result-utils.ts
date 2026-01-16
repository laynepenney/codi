// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Tool result processing utilities.
 * Extracted from agent.ts for reusability.
 */

import type { Message } from '../types.js';
import { AGENT_CONFIG } from '../constants.js';

const TOOL_RESULT_HEADER_REGEX = /(ERROR from|Result from) ([^:\n]+):\s*/g;
const TOOL_RESULT_HEADER_TEST = /(ERROR from|Result from) ([^:\n]+):/;

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

function looksLikeToolResultText(text: string): boolean {
  return TOOL_RESULT_HEADER_TEST.test(text);
}

function truncateToolResultText(text: string): string | null {
  const matches = Array.from(text.matchAll(new RegExp(TOOL_RESULT_HEADER_REGEX.source, 'g')));
  if (matches.length === 0) return null;

  let rebuilt = '';
  let lastIndex = 0;
  let changed = false;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const headerStart = match.index ?? 0;
    const headerEnd = headerStart + match[0].length;
    const nextStart = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;

    rebuilt += text.slice(lastIndex, headerStart);

    const toolName = match[2].trim();
    const isError = match[1] === 'ERROR from';
    const rawContent = text.slice(headerEnd, nextStart);
    const trimmedContent = rawContent.trim();

    if (trimmedContent.length > AGENT_CONFIG.TOOL_RESULT_TRUNCATE_THRESHOLD) {
      const summary = summarizeToolResult(toolName, trimmedContent, isError);
      if (isError) {
        rebuilt += `ERROR from ${toolName}: ${summary}\n\n`;
      } else {
        rebuilt += `Result from ${toolName}:\n${summary}\n\n`;
      }
      changed = true;
    } else {
      rebuilt += text.slice(headerStart, nextStart);
    }

    lastIndex = nextStart;
  }

  if (lastIndex < text.length) {
    rebuilt += text.slice(lastIndex);
  }

  return changed ? rebuilt : text;
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
    if (typeof msg.content === 'string') {
      if (looksLikeToolResultText(msg.content)) {
        toolResultIndices.push(i);
      }
      continue;
    }

    const hasToolResult = msg.content.some(block => block.type === 'tool_result');
    if (hasToolResult) {
      toolResultIndices.push(i);
    }
  }

  // Keep recent tool results, truncate older ones
  const indicesToTruncate = toolResultIndices.slice(0, -AGENT_CONFIG.RECENT_TOOL_RESULTS_TO_KEEP);

  for (const idx of indicesToTruncate) {
    const msg = messages[idx];
    if (typeof msg.content === 'string') {
      const truncated = truncateToolResultText(msg.content);
      if (truncated && truncated !== msg.content) {
        msg.content = truncated;
      }
      continue;
    }

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
