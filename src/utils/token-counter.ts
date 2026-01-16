// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Token counting utilities with content-aware estimation.
 *
 * Different content types have different token densities:
 * - English prose: ~4 chars/token
 * - Code: ~3 chars/token (more punctuation, shorter identifiers)
 * - JSON/structured: ~3.5 chars/token
 * - File paths: ~4 chars/token
 */

import type { Message, ToolDefinition } from '../types.js';

/** Default chars per token for general text */
const DEFAULT_CHARS_PER_TOKEN = 4;

/** Chars per token for code content */
const CODE_CHARS_PER_TOKEN = 3;

/** Chars per token for JSON/structured content */
const JSON_CHARS_PER_TOKEN = 3.5;

/** Overhead per message (role, structure, etc.) in tokens */
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Calibration data from actual API responses.
 * Used to improve estimation accuracy over time.
 */
interface CalibrationData {
  /** Running average of chars per token from actual usage */
  averageCharsPerToken: number;
  /** Number of samples used in calibration */
  sampleCount: number;
  /** Last updated timestamp */
  lastUpdated: number;
}

let calibrationData: CalibrationData | null = null;

/**
 * Detect if text contains code (heuristic).
 */
function isCodeContent(text: string): boolean {
  // Check for common code indicators
  const codeIndicators = [
    /```[\s\S]*```/,           // Markdown code blocks
    /function\s+\w+\s*\(/,     // Function declarations
    /const\s+\w+\s*=/,         // Const declarations
    /let\s+\w+\s*=/,           // Let declarations
    /=>\s*{/,                  // Arrow functions
    /class\s+\w+/,             // Class declarations
    /import\s+.*from/,         // ES imports
    /export\s+(default\s+)?/,  // ES exports
    /if\s*\(.*\)\s*{/,         // If statements
    /for\s*\(.*\)\s*{/,        // For loops
    /\.\w+\(.*\)/,             // Method calls
  ];

  return codeIndicators.some(pattern => pattern.test(text));
}

/**
 * Detect if text is JSON-like.
 */
function isJsonContent(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

/**
 * Estimate token count for a string with content-aware heuristics.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Use calibration data if available and recent (within 1 hour)
  const now = Date.now();
  if (calibrationData &&
      calibrationData.sampleCount >= 10 &&
      now - calibrationData.lastUpdated < 3600000) {
    return Math.ceil(text.length / calibrationData.averageCharsPerToken);
  }

  // Content-aware estimation
  let charsPerToken = DEFAULT_CHARS_PER_TOKEN;

  if (isCodeContent(text)) {
    charsPerToken = CODE_CHARS_PER_TOKEN;
  } else if (isJsonContent(text)) {
    charsPerToken = JSON_CHARS_PER_TOKEN;
  }

  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate tokens for a system prompt.
 */
export function estimateSystemPromptTokens(systemPrompt: string): number {
  // System prompts are typically prose-heavy
  return Math.ceil(systemPrompt.length / DEFAULT_CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for tool definitions.
 * Tool schemas are JSON with descriptions.
 */
export function estimateToolDefinitionTokens(tools: ToolDefinition[]): number {
  if (!tools || tools.length === 0) return 0;

  let total = 0;
  for (const tool of tools) {
    // Tool name and description
    total += estimateTokens(tool.name);
    total += estimateTokens(tool.description);

    // Input schema (JSON)
    const schemaStr = JSON.stringify(tool.input_schema);
    total += Math.ceil(schemaStr.length / JSON_CHARS_PER_TOKEN);

    // Overhead per tool
    total += 10;
  }

  return total;
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
 * Includes per-message overhead for role/structure.
 */
export function countMessageTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    const contentTokens = estimateTokens(getMessageText(msg));
    return total + contentTokens + MESSAGE_OVERHEAD_TOKENS;
  }, 0);
}

/**
 * Estimate total context tokens including system prompt and tools.
 */
export function estimateTotalContextTokens(
  messages: Message[],
  systemPrompt?: string,
  tools?: ToolDefinition[]
): number {
  let total = countMessageTokens(messages);

  if (systemPrompt) {
    total += estimateSystemPromptTokens(systemPrompt);
  }

  if (tools && tools.length > 0) {
    total += estimateToolDefinitionTokens(tools);
  }

  return total;
}

/**
 * Update calibration data with actual token counts from API response.
 * Call this after each API response to improve estimation accuracy.
 */
export function updateCalibration(
  textLength: number,
  actualTokens: number
): void {
  if (actualTokens <= 0 || textLength <= 0) return;

  const actualCharsPerToken = textLength / actualTokens;

  // Reject outliers (less than 1 or more than 10 chars per token)
  if (actualCharsPerToken < 1 || actualCharsPerToken > 10) return;

  if (!calibrationData) {
    calibrationData = {
      averageCharsPerToken: actualCharsPerToken,
      sampleCount: 1,
      lastUpdated: Date.now(),
    };
  } else {
    // Exponential moving average with decay
    const alpha = Math.min(0.1, 1 / calibrationData.sampleCount);
    calibrationData.averageCharsPerToken =
      alpha * actualCharsPerToken + (1 - alpha) * calibrationData.averageCharsPerToken;
    calibrationData.sampleCount++;
    calibrationData.lastUpdated = Date.now();
  }
}

/**
 * Get current calibration data (for debugging/testing).
 */
export function getCalibrationData(): CalibrationData | null {
  return calibrationData ? { ...calibrationData } : null;
}

/**
 * Reset calibration data (for testing).
 */
export function resetCalibration(): void {
  calibrationData = null;
}
