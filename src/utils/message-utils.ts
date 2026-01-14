// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Message analysis utilities.
 * Extracted from agent.ts for reusability.
 */

import type { Message } from '../types.js';

/**
 * Check if a message contains tool_result blocks (orphaned without preceding tool_calls).
 */
export function hasToolResultBlocks(msg: Message): boolean {
  if (typeof msg.content === 'string') return false;
  return msg.content.some(block => block.type === 'tool_result');
}

/**
 * Check if a message contains tool_use blocks.
 */
export function hasToolUseBlocks(msg: Message): boolean {
  if (typeof msg.content === 'string') return false;
  return msg.content.some(block => block.type === 'tool_use');
}

/**
 * Find the first safe starting index for recent messages.
 * Messages can't start with orphaned tool_result (needs preceding tool_calls).
 * Returns the index of the first message that's safe to start with.
 */
export function findSafeStartIndex(messages: Message[]): number {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Safe starts: user with plain text, or assistant (even with tool_use, we keep the pair)
    if (msg.role === 'user' && !hasToolResultBlocks(msg)) {
      return i;
    }
    if (msg.role === 'assistant') {
      // If assistant has tool_use, make sure next message exists and has results
      if (hasToolUseBlocks(msg)) {
        if (i + 1 < messages.length && hasToolResultBlocks(messages[i + 1])) {
          return i; // Safe: assistant with tool_use followed by tool_result
        }
        // Otherwise skip this incomplete pair
        continue;
      }
      return i; // Plain assistant message is safe
    }
  }
  return messages.length; // No safe start found, will clear all
}
