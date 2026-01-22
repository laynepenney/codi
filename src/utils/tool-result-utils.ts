// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tool result processing utilities.
 * Handles truncation and caching of tool results for context management.
 */

import type { Message, ContentBlock } from '../types.js';
import { estimateTokens } from './token-counter.js';
import { cacheToolResult, generateCacheId } from './tool-result-cache.js';

/**
 * Configuration for tool result truncation.
 */
export interface ToolResultConfig {
  /** Token budget for all tool results combined */
  toolResultsTokenBudget: number;
  /** Truncate individual tool results longer than this (characters) */
  toolResultTruncateThreshold: number;
}

/**
 * Create a short summary of a tool result for truncation.
 * Includes a cache ID for later retrieval.
 */
export function summarizeToolResult(
  toolName: string,
  content: string,
  isError: boolean,
  cacheId?: string
): string {
  const lines = content.split('\n').length;
  const chars = content.length;
  const tokens = estimateTokens(content);

  // Build base summary based on tool type
  let baseSummary: string;

  if (isError) {
    // Keep first line of error for context
    const firstLine = content.split('\n')[0].slice(0, 100);
    baseSummary = `ERROR: ${firstLine}...`;
  } else {
    // Create summary based on tool type
    switch (toolName) {
      case 'read_file':
      case 'list_directory':
        baseSummary = `${lines} lines, ${chars} chars`;
        break;
      case 'glob':
      case 'grep': {
        const matchCount = content.split('\n').filter(l => l.trim()).length;
        baseSummary = `${matchCount} matches`;
        break;
      }
      case 'bash': {
        const preview = content.slice(0, 80).replace(/\n/g, ' ').trim();
        baseSummary = `${preview}${chars > 80 ? '...' : ''} (${lines} lines)`;
        break;
      }
      case 'write_file':
      case 'edit_file':
      case 'insert_line':
      case 'patch_file':
        baseSummary = 'success';
        break;
      default:
        baseSummary = `${lines} lines, ${chars} chars`;
    }
  }

  // Include cache ID for retrieval if available
  if (cacheId) {
    return `[${toolName}: ${baseSummary}] (cached: ${cacheId}, ~${tokens} tokens)`;
  }

  return `[${toolName}: ${baseSummary}]`;
}

/**
 * Tool result info extracted from message.
 */
interface ToolResultInfo {
  index: number;
  messageIndex: number;
  toolName: string;
  content: string;
  isError: boolean;
  tokens: number;
}

/**
 * Get all tool results from message history with token estimates.
 */
function getToolResultsInfo(messages: Message[]): ToolResultInfo[] {
  const results: ToolResultInfo[] = [];

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    if (typeof msg.content === 'string') continue;

    for (let blockIdx = 0; blockIdx < msg.content.length; blockIdx++) {
      const block = msg.content[blockIdx];
      if (block.type !== 'tool_result') continue;

      const content = block.content || '';
      results.push({
        index: blockIdx,
        messageIndex: msgIdx,
        toolName: block.name || 'unknown',
        content,
        isError: !!block.is_error,
        tokens: estimateTokens(content),
      });
    }
  }

  return results;
}

/**
 * Truncate old tool results to fit within token budget.
 * Caches truncated results for later retrieval via RAG.
 *
 * Strategy:
 * 1. Calculate total tokens used by tool results
 * 2. If over budget, truncate oldest results first
 * 3. Cache full content and replace with summary + cache ID
 *
 * @param messages - Message history to process (mutated in place)
 * @param config - Token budget configuration
 */
export function truncateOldToolResults(messages: Message[], config: ToolResultConfig): void {
  const toolResults = getToolResultsInfo(messages);
  if (toolResults.length === 0) return;

  // Calculate total tokens used by tool results
  let totalTokens = toolResults.reduce((sum, r) => sum + r.tokens, 0);

  // If within budget, nothing to do
  if (totalTokens <= config.toolResultsTokenBudget) {
    return;
  }

  // Process from oldest to newest, truncating until within budget
  // Keep at least the last 2 results intact for immediate context
  const minKeepIntact = Math.min(2, toolResults.length);
  const candidatesForTruncation = toolResults.slice(0, -minKeepIntact);

  for (const result of candidatesForTruncation) {
    // Skip if already truncated (summary format)
    if (result.content.startsWith('[') && result.content.includes('cached:')) {
      continue;
    }

    // Skip small results (not worth truncating)
    if (result.content.length < config.toolResultTruncateThreshold / 10) {
      continue;
    }

    // Cache the full result
    const cacheId = generateCacheId(result.toolName, result.content);
    const summary = summarizeToolResult(
      result.toolName,
      result.content,
      result.isError,
      cacheId
    );

    // Store in cache
    cacheToolResult(
      result.toolName,
      result.content,
      summary,
      result.tokens,
      result.isError
    );

    // Update the message with summary
    const msg = messages[result.messageIndex];
    if (typeof msg.content !== 'string') {
      const block = msg.content[result.index] as ContentBlock;
      if (block.type === 'tool_result') {
        // Calculate token savings
        const oldTokens = result.tokens;
        const newTokens = estimateTokens(summary);
        totalTokens -= (oldTokens - newTokens);

        // Replace content with summary
        (block as { content: string }).content = summary;
      }
    }

    // Check if we're now within budget
    if (totalTokens <= config.toolResultsTokenBudget) {
      break;
    }
  }
}

/**
 * Check if a tool result has been truncated (is a summary).
 */
export function isToolResultTruncated(content: string): boolean {
  return content.startsWith('[') && content.includes('cached:');
}

/**
 * Extract cache ID from a truncated tool result summary.
 */
export function extractCacheId(summary: string): string | null {
  const match = summary.match(/cached:\s*([^,)]+)/);
  return match ? match[1].trim() : null;
}
