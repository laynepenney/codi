/**
 * Token counting utilities.
 * Extracted from agent.ts for reusability.
 */

import type { Message } from '../types.js';

/**
 * Estimate token count for a string (rough approximation: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get the text content of a message for token counting.
 */
export function getMessageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text || '';
      if (block.type === 'tool_use') return JSON.stringify(block.input || {});
      if (block.type === 'tool_result') return block.content || '';
      return '';
    })
    .join('\n');
}

/**
 * Count total tokens in a message array.
 */
export function countMessageTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => total + estimateTokens(getMessageText(msg)), 0);
}
