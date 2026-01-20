// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Smart Context Windowing
 *
 * Dynamically selects which messages to keep vs summarize based on:
 * - Importance scores
 * - Working set (recently accessed files)
 * - Tool call/result pairs (must stay together)
 * - Configurable thresholds
 */

import type { Message } from './types.js';
import type { MessageScore } from './importance-scorer.js';
import { hasToolUseBlocks, hasToolResultBlocks, findSafeStartIndex } from './utils/message-utils.js';
import { getMessageText } from './utils/token-counter.js';
import * as path from 'path';

/**
 * Tracks the current working context.
 */
export interface WorkingSet {
  recentFiles: Set<string>;      // Files modified/read recently
  activeEntities: Set<string>;   // Entities currently in focus
  pendingToolCalls: Set<string>; // Tool call IDs awaiting results
}

/**
 * Create an empty working set.
 */
export function createWorkingSet(): WorkingSet {
  return {
    recentFiles: new Set(),
    activeEntities: new Set(),
    pendingToolCalls: new Set(),
  };
}

/**
 * Configuration for context windowing.
 */
export interface WindowingConfig {
  minRecentMessages: number;     // Always keep at least this many recent messages
  maxMessages: number;           // Hard cap on messages to keep
  importanceThreshold: number;   // Keep messages with score >= this
  preserveToolPairs: boolean;    // Never split tool_use from tool_result
  preserveWorkingSet: boolean;   // Keep messages referencing recent files
}

/**
 * Default windowing configuration.
 */
export const DEFAULT_WINDOWING_CONFIG: WindowingConfig = {
  minRecentMessages: 3,
  maxMessages: 20,
  importanceThreshold: 0.4,
  preserveToolPairs: true,
  preserveWorkingSet: true,
};

/**
 * Result of message selection.
 */
export interface SelectionResult {
  keep: number[];       // Indices of messages to keep (sorted)
  summarize: number[];  // Indices of messages to summarize
}

/**
 * File operation tools that modify the working set.
 */
const FILE_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'insert_line',
  'patch_file',
  'glob',
  'grep',
]);

/**
 * Update the working set based on a tool execution.
 */
export function updateWorkingSet(
  workingSet: WorkingSet,
  toolName: string,
  input: Record<string, unknown>
): void {
  if (!FILE_TOOLS.has(toolName)) return;

  // Extract file path from input
  const filePath = (input.path || input.file_path || input.file) as string | undefined;

  if (filePath) {
    // Add to recent files (no limit - working set grows with session)
    workingSet.recentFiles.add(filePath);
  }

  // For glob/grep, extract pattern-matched files from results if available
  if (toolName === 'glob' || toolName === 'grep') {
    const pattern = input.pattern as string | undefined;
    if (pattern) {
      workingSet.activeEntities.add(pattern);
    }
  }
}

/**
 * Check if a message references any files in the working set.
 */
function referencesWorkingSet(message: Message, workingSet: WorkingSet): boolean {
  const text = getMessageText(message);

  // Check for file paths
  for (const file of workingSet.recentFiles) {
    if (text.includes(file) || text.includes(path.basename(file))) {
      return true;
    }
  }

  // Check for active entities (patterns, etc.)
  for (const entity of workingSet.activeEntities) {
    if (text.includes(entity)) {
      return true;
    }
  }

  return false;
}

/**
 * Select which messages to keep based on importance scores and working set.
 */
export function selectMessagesToKeep(
  messages: Message[],
  scores: MessageScore[],
  workingSet: WorkingSet,
  config: WindowingConfig = DEFAULT_WINDOWING_CONFIG
): SelectionResult {
  if (messages.length === 0) {
    return { keep: [], summarize: [] };
  }

  const keep = new Set<number>();

  // 1. Always keep the last minRecentMessages
  const recentStart = Math.max(0, messages.length - config.minRecentMessages);
  for (let i = recentStart; i < messages.length; i++) {
    keep.add(i);
  }

  // 2. Keep messages above importance threshold
  for (const score of scores) {
    if (score.totalScore >= config.importanceThreshold) {
      keep.add(score.messageIndex);
    }
  }

  // 3. Keep messages referencing working set files
  if (config.preserveWorkingSet && workingSet.recentFiles.size > 0) {
    for (let i = 0; i < messages.length; i++) {
      if (referencesWorkingSet(messages[i], workingSet)) {
        keep.add(i);
      }
    }
  }

  // 4. Preserve tool_use/tool_result pairs
  if (config.preserveToolPairs) {
    const toAdd: number[] = [];

    for (const idx of keep) {
      const msg = messages[idx];

      // If this message has tool_use, keep the next message (results)
      if (hasToolUseBlocks(msg) && idx + 1 < messages.length) {
        toAdd.push(idx + 1);
      }

      // If this message has tool_result, keep the previous message (call)
      if (hasToolResultBlocks(msg) && idx > 0 && hasToolUseBlocks(messages[idx - 1])) {
        toAdd.push(idx - 1);
      }
    }

    for (const idx of toAdd) {
      keep.add(idx);
    }
  }

  // 5. Enforce maxMessages cap by keeping highest scores
  if (keep.size > config.maxMessages) {
    // Create score lookup
    const scoreMap = new Map(scores.map(s => [s.messageIndex, s.totalScore]));

    // Sort by score descending, keeping recent messages priority
    const sorted = [...keep].sort((a, b) => {
      // Recent messages get priority
      const recentA = a >= recentStart ? 1 : 0;
      const recentB = b >= recentStart ? 1 : 0;
      if (recentA !== recentB) return recentB - recentA;

      // Then by score
      const scoreA = scoreMap.get(a) ?? 0;
      const scoreB = scoreMap.get(b) ?? 0;
      return scoreB - scoreA;
    });

    // Keep only top maxMessages
    keep.clear();
    for (const idx of sorted.slice(0, config.maxMessages)) {
      keep.add(idx);
    }

    // Re-add tool pairs that might have been removed
    if (config.preserveToolPairs) {
      const toAdd: number[] = [];
      for (const idx of keep) {
        const msg = messages[idx];
        if (hasToolUseBlocks(msg) && idx + 1 < messages.length && !keep.has(idx + 1)) {
          toAdd.push(idx + 1);
        }
        if (hasToolResultBlocks(msg) && idx > 0 && hasToolUseBlocks(messages[idx - 1]) && !keep.has(idx - 1)) {
          toAdd.push(idx - 1);
        }
      }
      for (const idx of toAdd) {
        keep.add(idx);
      }
    }
  }

  // 6. Build summarize list
  const summarize: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (!keep.has(i)) {
      summarize.push(i);
    }
  }

  // 7. Sort keep indices for proper message ordering
  const sortedKeep = [...keep].sort((a, b) => a - b);

  return {
    keep: sortedKeep,
    summarize,
  };
}

/**
 * Apply selection to get the kept messages.
 * Ensures the result starts at a safe index (no orphaned tool_results).
 */
export function applySelection(
  messages: Message[],
  selection: SelectionResult
): Message[] {
  // Get kept messages in order
  const kept = selection.keep.map(i => messages[i]);

  // Find safe start index
  const safeStart = findSafeStartIndex(kept);

  return kept.slice(safeStart);
}

/**
 * Get statistics about the selection.
 */
export interface SelectionStats {
  totalMessages: number;
  keptMessages: number;
  summarizedMessages: number;
  keptPercent: number;
  workingSetSize: number;
}

export function getSelectionStats(
  messages: Message[],
  selection: SelectionResult,
  workingSet: WorkingSet
): SelectionStats {
  return {
    totalMessages: messages.length,
    keptMessages: selection.keep.length,
    summarizedMessages: selection.summarize.length,
    keptPercent: messages.length > 0
      ? (selection.keep.length / messages.length) * 100
      : 100,
    workingSetSize: workingSet.recentFiles.size,
  };
}
