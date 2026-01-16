// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import type { Message, ToolDefinition, ProviderResponse, ProviderConfig } from '../types.js';

/**
 * Information about an available model.
 */
export interface ModelInfo {
  /** Model identifier (e.g., "claude-sonnet-4-20250514") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Provider name (e.g., "Anthropic", "OpenAI") */
  provider: string;
  /** Model capabilities */
  capabilities: {
    vision: boolean;
    toolUse: boolean;
  };
  /** Context window size in tokens */
  contextWindow?: number;
  /** Pricing per million tokens (USD) */
  pricing?: {
    input: number;
    output: number;
  };
  /** Whether the model is deprecated */
  deprecated?: boolean;
}

/**
 * Abstract base class for AI model providers.
 * Implement this interface to add support for new model backends.
 */
export abstract class BaseProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Send a chat completion request to the model.
   * @param messages - Conversation history
   * @param tools - Optional tool definitions for function calling
   * @param systemPrompt - Optional system prompt (uses native API support when available)
   * @returns Provider response with content and any tool calls
   */
  abstract chat(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<ProviderResponse>;

  /**
   * Send a streaming chat completion request.
   * @param messages - Conversation history
   * @param tools - Optional tool definitions
   * @param onChunk - Callback for each text chunk received
   * @param systemPrompt - Optional system prompt (uses native API support when available)
   * @returns Final provider response
   */
  abstract streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void,
    systemPrompt?: string,
    onReasoningChunk?: (chunk: string) => void
  ): Promise<ProviderResponse>;

  /**
   * Check if this provider supports tool use / function calling.
   */
  abstract supportsToolUse(): boolean;

  /**
   * Check if this provider supports vision / image analysis.
   * Override in providers that support multimodal input.
   */
  supportsVision(): boolean {
    return false;
  }

  /**
   * Get the name of this provider for display purposes.
   */
  abstract getName(): string;

  /**
   * Get the current model being used.
   */
  abstract getModel(): string;

  /**
   * List available models from this provider.
   * Optional - not all providers may support model listing.
   * @returns List of available models with their info
   */
  async listModels?(): Promise<ModelInfo[]>;
}
