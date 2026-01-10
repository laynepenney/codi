/**
 * Shared response parsing utilities for providers.
 * Provides common operations for extracting tool calls, usage, and stop reasons.
 */

import type { ToolCall, ProviderResponse } from '../types.js';

/**
 * Map a provider-specific stop reason to our standard format.
 */
export function mapStopReason(
  reason: string | null | undefined,
  hasToolCalls: boolean
): 'end_turn' | 'tool_use' | 'max_tokens' {
  // If there are tool calls, it's a tool_use stop
  if (hasToolCalls) {
    return 'tool_use';
  }

  // Map common stop reason strings
  const normalizedReason = reason?.toLowerCase() || '';

  if (normalizedReason.includes('tool')) {
    return 'tool_use';
  }
  if (normalizedReason.includes('length') || normalizedReason.includes('max_tokens')) {
    return 'max_tokens';
  }

  return 'end_turn';
}

/**
 * Create a standard ProviderResponse object.
 */
export function createProviderResponse(params: {
  content: string;
  toolCalls: ToolCall[];
  stopReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  reasoningContent?: string;
}): ProviderResponse {
  const { content, toolCalls, stopReason, inputTokens, outputTokens, reasoningContent } = params;

  return {
    content,
    toolCalls,
    stopReason: mapStopReason(stopReason, toolCalls.length > 0),
    ...(reasoningContent && { reasoningContent }),
    ...(inputTokens !== undefined && outputTokens !== undefined && {
      usage: {
        inputTokens,
        outputTokens,
      },
    }),
  };
}

/**
 * Parse a JSON string safely, returning an empty object on failure.
 */
export function safeParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
}

/**
 * Accumulate streamed tool call arguments.
 * Handles the pattern of receiving partial JSON chunks during streaming.
 */
export class StreamingToolCallAccumulator {
  private toolCalls: Map<number | string, {
    id: string;
    name: string;
    rawArgs: string;
  }> = new Map();

  /**
   * Add or update a tool call with streamed data.
   */
  accumulate(index: number | string, data: {
    id?: string;
    name?: string;
    arguments?: string;
  }): void {
    let existing = this.toolCalls.get(index);

    if (!existing) {
      existing = { id: '', name: '', rawArgs: '' };
      this.toolCalls.set(index, existing);
    }

    if (data.id) {
      existing.id = data.id;
    }
    if (data.name) {
      existing.name = data.name;
    }
    if (data.arguments) {
      existing.rawArgs += data.arguments;
    }
  }

  /**
   * Get the finalized tool calls with parsed arguments.
   */
  getToolCalls(): ToolCall[] {
    return Array.from(this.toolCalls.values()).map(({ id, name, rawArgs }) => ({
      id,
      name,
      input: safeParseJson(rawArgs),
    }));
  }

  /**
   * Check if there are any accumulated tool calls.
   */
  hasToolCalls(): boolean {
    return this.toolCalls.size > 0;
  }
}
