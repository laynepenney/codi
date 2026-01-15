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
import { logger } from '../logger.js';

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

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
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
 * - thinking: "[Thinking]:\ncontent"
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

    case 'thinking':
      return `[Thinking]:\n${block.text || ''}`;

    default:
      // Unknown block type - log warning and return empty string
      // This ensures forward compatibility while alerting us to new block types
      logger.warn(`Unknown content block type: ${(block as ContentBlock).type}`);
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

/**
 * Block converter interface for provider-specific block conversion.
 * Each provider implements converters for each block type.
 */
export interface BlockConverters<T> {
  text: (block: ContentBlock) => T;
  tool_use: (block: ContentBlock) => T;
  tool_result: (block: ContentBlock) => T;
  image: (block: ContentBlock) => T;
  thinking: (block: ContentBlock) => T;
  /** Called for unknown block types - can return null to skip */
  unknown?: (block: ContentBlock) => T | null;
}

/**
 * Convert a single content block using provider-specific converters.
 * Centralizes the switch logic and logging for unknown types.
 *
 * This is the core function - use this when you need to process blocks
 * individually (e.g., OpenAI which restructures blocks).
 *
 * @returns The converted block, or null if unknown and no unknown handler
 */
export function mapContentBlock<T>(
  block: ContentBlock,
  converters: BlockConverters<T>
): T | null {
  switch (block.type) {
    case 'text':
      return converters.text(block);
    case 'tool_use':
      return converters.tool_use(block);
    case 'tool_result':
      return converters.tool_result(block);
    case 'image':
      return converters.image(block);
    case 'thinking':
      return converters.thinking(block);
    default:
      logger.warn(`Unknown content block type: ${(block as ContentBlock).type}`);
      return converters.unknown ? converters.unknown(block) : null;
  }
}

/**
 * Map content blocks using provider-specific converters.
 * Convenience wrapper around mapContentBlock for batch conversion.
 *
 * @example
 * const anthropicBlocks = mapContentBlocks(blocks, {
 *   text: (b) => ({ type: 'text', text: b.text || '' }),
 *   tool_use: (b) => ({ type: 'tool_use', id: b.id, name: b.name, input: b.input }),
 *   tool_result: (b) => ({ type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content }),
 *   image: (b) => ({ type: 'image', source: { ... } }),
 * });
 */
export function mapContentBlocks<T>(
  blocks: ContentBlock[],
  converters: BlockConverters<T>
): T[] {
  const results: T[] = [];
  for (const block of blocks) {
    const result = mapContentBlock(block, converters);
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}
