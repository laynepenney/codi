// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared message conversion utilities for providers.
 * Provides common operations for extracting and transforming message content.
 */

import type { Message, ContentBlock } from '../types.js';

/**
 * Extract text content from a message (handles both string and block array formats).
 */
export function extractTextContent(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
    .map((block) => block.text || '')
    .join('');
}

/**
 * Extract tool_use blocks from message content.
 */
export function extractToolUseBlocks(message: Message): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  if (typeof message.content === 'string') {
    return [];
  }
  return message.content
    .filter((block): block is ContentBlock & { type: 'tool_use' } => block.type === 'tool_use')
    .map((block) => ({
      id: block.id || '',
      name: block.name || '',
      input: block.input || {},
    }));
}

/**
 * Extract tool_result blocks from message content.
 */
export function extractToolResultBlocks(message: Message): Array<{
  tool_use_id: string;
  content: string;
  is_error: boolean;
}> {
  if (typeof message.content === 'string') {
    return [];
  }
  return message.content
    .filter((block): block is ContentBlock & { type: 'tool_result' } => block.type === 'tool_result')
    .map((block) => ({
      tool_use_id: block.tool_use_id || '',
      content: block.content || '',
      is_error: block.is_error || false,
    }));
}

/**
 * Extract image blocks from message content.
 */
export function extractImageBlocks(message: Message): Array<{
  media_type: string;
  data: string;
}> {
  if (typeof message.content === 'string') {
    return [];
  }
  return message.content
    .filter((block): block is ContentBlock & { type: 'image' } => block.type === 'image' && !!block.image)
    .map((block) => ({
      media_type: block.image!.media_type,
      data: block.image!.data,
    }));
}

/**
 * Check if a message has any content blocks of a specific type.
 */
export function hasBlockType(message: Message, type: ContentBlock['type']): boolean {
  if (typeof message.content === 'string') {
    return type === 'text';
  }
  return message.content.some((block) => block.type === type);
}

/**
 * Check if a message is a simple string message (no structured blocks).
 * Type guard that narrows message.content to string.
 */
export function isSimpleMessage(message: Message): message is Message & { content: string } {
  return typeof message.content === 'string';
}

/**
 * Check if a message has structured content blocks.
 * Type guard that narrows message.content to ContentBlock[].
 */
export function hasContentBlocks(message: Message): message is Message & { content: ContentBlock[] } {
  return typeof message.content !== 'string';
}
