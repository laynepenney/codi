// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared message conversion utilities for providers.
 *
 * This module provides the SINGLE SOURCE OF TRUTH for extracting and
 * transforming message content. All providers should use these utilities
 * instead of implementing their own inline logic.
 *
 * Benefits:
 * - Tested once, all providers benefit
 * - Exhaustive type checking ensures all block types are handled
 * - Prevents silent bugs like tool_result blocks being dropped
 */

import type { Message, ContentBlock } from '../types.js';

/**
 * Typed block interfaces for type-safe extraction.
 * These narrow the generic ContentBlock to specific block types.
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  name?: string;
  content: string;
  is_error?: boolean;
}

export interface ImageBlock {
  type: 'image';
  image: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/**
 * Convert a content block to plain text representation.
 * Used by text-based providers (Ollama) that don't support structured messages.
 *
 * Handles all known block types:
 * - text: Returns the text content
 * - tool_result: "[Result from toolName]:\ncontent" or "[ERROR from toolName]:\ncontent"
 * - tool_use: "[Calling toolName]: {input}"
 * - image: "[Image attached]"
 *
 * Unknown block types return empty string for forward compatibility.
 */
export function blockToText(block: ContentBlock): string {
  // Handle each block type explicitly
  // If a new type is added to ContentBlock, this function should be updated
  switch (block.type) {
    case 'text':
      return block.text || '';

    case 'tool_result': {
      const prefix = block.is_error ? 'ERROR' : 'Result';
      const toolName = block.name || 'tool';
      return `[${prefix} from ${toolName}]:\n${block.content || ''}`;
    }

    case 'tool_use': {
      const toolName = block.name || 'tool';
      return `[Calling ${toolName}]: ${JSON.stringify(block.input || {})}`;
    }

    case 'image':
      return '[Image attached]';

    default:
      // Unknown block type - return empty string but log for debugging
      // This ensures forward compatibility if new block types are added
      return '';
  }
}

/**
 * Convert an entire message to plain text.
 * Handles both string content and content block arrays.
 *
 * This is the primary function text-based providers should use.
 */
export function messageToText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .map(blockToText)
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Extract text content from a message (handles both string and block array formats).
 * Only extracts text blocks, ignoring tool_use, tool_result, and image blocks.
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
 * Includes the optional `name` field for proper formatting.
 */
export function extractToolResultBlocks(message: Message): Array<{
  tool_use_id: string;
  name?: string;
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
      name: block.name,
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
