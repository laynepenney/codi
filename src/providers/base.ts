import type { Message, ToolDefinition, ProviderResponse, ProviderConfig } from '../types.js';

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
    systemPrompt?: string
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
}
