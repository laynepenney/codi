// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * JSON parsing utilities for handling LLM output.
 * Extracted from agent.ts for reusability.
 */

import type { ToolCall } from '../types.js';

/**
 * Attempt to fix common JSON issues from LLM output:
 * - Single quotes instead of double quotes
 */
export function tryFixJson(jsonStr: string): string {
  let fixed = jsonStr;

  // Replace single-quoted strings after colons (handles multi-line)
  // Match: : 'content' and replace with : "content"
  fixed = fixed.replace(/:(\s*)'((?:[^'\\]|\\.)*)'/gs, ':$1"$2"');

  return fixed;
}

/**
 * Try to parse JSON, attempting to fix common issues if standard parse fails.
 */
export function tryParseJson(jsonStr: string): unknown | null {
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Try to fix common issues
    try {
      return JSON.parse(tryFixJson(jsonStr));
    } catch {
      return null;
    }
  }
}

/**
 * Try to extract tool calls from text when models output JSON instead of using
 * proper function calling (common with Ollama models).
 */
export function extractToolCallsFromText(text: string, availableTools: string[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  // Pattern 1: {"name": "tool_name", "arguments": {...}} or {"name": "tool_name", "parameters": {...}}
  const jsonPattern = /\{[\s\S]*?"name"\s*:\s*"(\w+)"[\s\S]*?(?:"arguments"|"parameters"|"input")\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})[\s\S]*?\}/g;

  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    const toolName = match[1];
    if (availableTools.includes(toolName)) {
      const args = tryParseJson(match[2]);
      if (args && typeof args === 'object') {
        toolCalls.push({
          id: `extracted_${Date.now()}_${toolCalls.length}`,
          name: toolName,
          input: args as Record<string, unknown>,
        });
      }
    }
  }

  // Pattern 2: Look for JSON in code blocks (objects or arrays)
  if (toolCalls.length === 0) {
    const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    while ((match = codeBlockPattern.exec(text)) !== null) {
      const content = match[1].trim();
      if (!content.startsWith('{') && !content.startsWith('[')) continue;

      const parsed = tryParseJson(content);
      if (!parsed) continue;

      // Handle array of tool calls
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.name && availableTools.includes(item.name as string)) {
            toolCalls.push({
              id: `extracted_${Date.now()}_${toolCalls.length}`,
              name: item.name as string,
              input: (item.arguments || item.parameters || item.input || {}) as Record<string, unknown>,
            });
          }
        }
      }
      // Handle single object
      else {
        const obj = parsed as Record<string, unknown>;
        if (obj.name && availableTools.includes(obj.name as string)) {
          toolCalls.push({
            id: `extracted_${Date.now()}_${toolCalls.length}`,
            name: obj.name as string,
            input: (obj.arguments || obj.parameters || obj.input || {}) as Record<string, unknown>,
          });
        }
      }
    }
  }

  return toolCalls;
}
