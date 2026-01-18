// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * JSON parsing utilities for handling LLM output.
 * Extracted from agent.ts for reusability.
 */

import type { ToolCall, ToolDefinition } from '../types.js';
import {
  DEFAULT_FALLBACK_CONFIG,
  findBestToolMatch,
  type ToolFallbackConfig,
} from '../tools/tool-fallback.js';

/**
 * Attempt to fix common JSON issues from LLM output:
 * - Single quotes instead of double quotes
 * - Raw newlines inside strings (should be escaped as \n)
 * - Trailing quotes after numbers (e.g., "count":15"} -> "count":15})
 */
export function tryFixJson(jsonStr: string): string {
  let fixed = jsonStr;

  // Replace single-quoted strings after colons (handles multi-line)
  // Match: : 'content' and replace with : "content"
  fixed = fixed.replace(/:(\s*)'((?:[^'\\]|\\.)*)'/gs, ':$1"$2"');

  // Fix trailing quotes after numbers (LLM sometimes adds extra quote)
  // Match: :number"} or :number", and remove the errant quote
  fixed = fixed.replace(/:(\s*-?\d+(?:\.\d+)?)"(\s*[},\]])/g, ':$1$2');

  // Escape raw newlines inside double-quoted strings
  // This handles LLM output that includes literal newlines in JSON strings
  fixed = escapeNewlinesInStrings(fixed);

  return fixed;
}

/**
 * Escape raw newlines inside JSON string values.
 * Walks through the string tracking quote state to only escape
 * newlines that appear inside quoted strings.
 */
function escapeNewlinesInStrings(jsonStr: string): string {
  const result: string[] = [];
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (isEscaped) {
      result.push(char);
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      result.push(char);
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result.push(char);
      continue;
    }

    // If we're inside a string and hit a raw newline, escape it
    if (inString && (char === '\n' || char === '\r')) {
      if (char === '\r' && jsonStr[i + 1] === '\n') {
        // Handle CRLF as single \n
        result.push('\\n');
        i++; // Skip the \n
      } else if (char === '\n') {
        result.push('\\n');
      } else {
        result.push('\\r');
      }
      continue;
    }

    result.push(char);
  }

  return result.join('');
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

function extractJsonObjectFromIndex(
  text: string,
  startIndex: number
): { json: string; endIndex: number } | null {
  const start = text.indexOf('{', startIndex);
  if (start === -1) return null;

  // Try strict extraction first (respecting string boundaries)
  const strictResult = extractJsonObjectStrict(text, start);
  if (strictResult) {
    return strictResult;
  }

  // Fallback: try greedy extraction for each potential closing brace
  // This handles malformed JSON like {"max_lines":15"} where the extra " breaks string tracking
  return extractJsonObjectGreedy(text, start);
}

/**
 * Extract JSON object respecting string boundaries.
 */
function extractJsonObjectStrict(
  text: string,
  start: number
): { json: string; endIndex: number } | null {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { json: text.slice(start, i + 1), endIndex: i + 1 };
      }
    }
  }

  return null;
}

/**
 * Greedy extraction that tries each closing brace and validates with tryParseJson.
 * Handles malformed JSON where extra quotes break string state tracking.
 */
function extractJsonObjectGreedy(
  text: string,
  start: number
): { json: string; endIndex: number } | null {
  let depth = 0;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        // Try to parse (tryParseJson applies fixes like removing trailing quotes after numbers)
        if (tryParseJson(candidate) !== null) {
          return { json: candidate, endIndex: i + 1 };
        }
        // Keep looking for next potential closing brace
        depth = 1; // Reset to continue searching
      }
    }
  }

  return null;
}

/**
 * Try to extract tool calls from text when models output JSON instead of using
 * proper function calling (common with Ollama models).
 */
export function extractToolCallsFromText(
  text: string,
  toolDefinitions: ToolDefinition[],
  fallbackConfig: ToolFallbackConfig = DEFAULT_FALLBACK_CONFIG
): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const resolveToolName = (requestedName: string): string | null => {
    const match = findBestToolMatch(requestedName, toolDefinitions, fallbackConfig);
    if (match.exactMatch) return requestedName;
    if (match.shouldAutoCorrect && match.matchedName) return match.matchedName;
    return null;
  };

  // Pattern 1: {"name": "tool_name", "arguments": {...}} or {"name": "tool_name", "parameters": {...}}
  const jsonPattern = /\{[\s\S]*?"name"\s*:\s*"(\w+)"[\s\S]*?(?:"arguments"|"parameters"|"input")\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})[\s\S]*?\}/g;

  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    const resolvedName = resolveToolName(match[1]);
    if (resolvedName) {
      const args = tryParseJson(match[2]);
      if (args && typeof args === 'object') {
        toolCalls.push({
          id: `extracted_${Date.now()}_${toolCalls.length}`,
          name: resolvedName,
          input: args as Record<string, unknown>,
        });
      }
    }
  }

  // Pattern 2: [Calling tool_name]: {json} or [Running tool_name] {json} format
  if (toolCalls.length === 0) {
    const callingPattern = /\[(?:Calling|Running)\s+([a-z_][a-z0-9_]*)\]\s*:?\s*/gi;

    while ((match = callingPattern.exec(text)) !== null) {
      const resolvedName = resolveToolName(match[1]);
      if (!resolvedName) continue;

      const extracted = extractJsonObjectFromIndex(text, match.index + match[0].length);
      if (!extracted) continue;

      const args = tryParseJson(extracted.json);
      if (args && typeof args === 'object') {
        toolCalls.push({
          id: `extracted_${Date.now()}_${toolCalls.length}`,
          name: resolvedName,
          input: args as Record<string, unknown>,
        });
      }

      callingPattern.lastIndex = extracted.endIndex;
    }
  }

  // Pattern 3: Look for JSON in code blocks (objects or arrays)
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
          if (item?.name) {
            const resolvedName = resolveToolName(item.name as string);
            if (!resolvedName) continue;
            toolCalls.push({
              id: `extracted_${Date.now()}_${toolCalls.length}`,
              name: resolvedName,
              input: (item.arguments || item.parameters || item.input || {}) as Record<string, unknown>,
            });
          }
        }
      }
      // Handle single object
      else {
        const obj = parsed as Record<string, unknown>;
        if (obj.name) {
          const resolvedName = resolveToolName(obj.name as string);
          if (!resolvedName) continue;
          toolCalls.push({
            id: `extracted_${Date.now()}_${toolCalls.length}`,
            name: resolvedName,
            input: (obj.arguments || obj.parameters || obj.input || {}) as Record<string, unknown>,
          });
        }
      }
    }
  }

  return toolCalls;
}
