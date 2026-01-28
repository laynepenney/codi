// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Extended Types
 *
 * Type definitions for extending built-in or library types
 * that don't have complete type coverage.
 */

/**
 * Extended error type with stdout/stderr from exec callbacks.
 * Node's ExecException doesn't include stdout/stderr, but we attach
 * them in the error handler for access in the catch block.
 */
export interface ExecErrorWithOutput extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: string | null;
  killed?: boolean;
  cmd?: string;
}

/**
 * Key information from readline keypress events.
 * The readline module doesn't export a type for this.
 */
export interface ReadlineKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

/**
 * OpenAI streaming delta with extended reasoning support.
 * Some models (o1, o3) include reasoning_content in deltas.
 */
export interface ExtendedChatCompletionDelta {
  content?: string | null;
  role?: string;
  reasoning_content?: string;
  function_call?: {
    name?: string;
    arguments?: string;
  };
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

/**
 * Anthropic tool with cache_control support (beta feature).
 * The SDK types don't include cache_control yet.
 */
export interface AnthropicToolWithCache {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Extended OpenAI usage type with prompt_tokens_details.
 * OpenAI returns cached_tokens in prompt_tokens_details for caching-enabled responses.
 */
export interface ExtendedOpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}
