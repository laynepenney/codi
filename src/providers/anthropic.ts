// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider, type ModelInfo } from './base.js';
import type { Message, ToolDefinition, ProviderResponse, ProviderConfig, ToolCall } from '../types.js';
import { createProviderResponse } from './response-parser.js';
import { mapContentBlocks } from './message-converter.js';
import { getStaticModels } from '../models.js';

const DEFAULT_MODEL = 'claude-opus-4-5-20251101';
const MAX_TOKENS = 4096;

export class AnthropicProvider extends BaseProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = config.model || DEFAULT_MODEL;
  }

  /**
   * Build system prompt with cache control for prompt caching.
   * Caches the system prompt to reduce costs on subsequent calls.
   */
  private buildCachedSystemPrompt(systemPrompt: string): Anthropic.TextBlockParam[] {
    // Use type assertion since cache_control is a beta feature not yet in SDK types
    return [{
      type: 'text' as const,
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    } as Anthropic.TextBlockParam];
  }

  /**
   * Add cache control to the last tool definition for tool caching.
   */
  private buildCachedTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    if (tools.length === 0) return [];

    return tools.map((tool, index) => {
      const anthropicTool: Anthropic.Tool = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool['input_schema'],
      };
      // Cache the last tool (caches all preceding tools too)
      if (index === tools.length - 1) {
        (anthropicTool as any).cache_control = { type: 'ephemeral' };
      }
      return anthropicTool;
    });
  }

  async chat(messages: Message[], tools?: ToolDefinition[], systemPrompt?: string): Promise<ProviderResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      // Use cached system prompt for prompt caching
      ...(systemPrompt && { system: this.buildCachedSystemPrompt(systemPrompt) }),
      messages: this.convertMessages(messages),
      // Use cached tools for prompt caching
      tools: tools ? this.buildCachedTools(tools) : undefined,
    });

    return this.parseResponse(response);
  }

  async streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void,
    systemPrompt?: string,
    _onReasoningChunk?: (chunk: string) => void
  ): Promise<ProviderResponse> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: MAX_TOKENS,
      // Use cached system prompt for prompt caching
      ...(systemPrompt && { system: this.buildCachedSystemPrompt(systemPrompt) }),
      messages: this.convertMessages(messages),
      // Use cached tools for prompt caching
      tools: tools ? this.buildCachedTools(tools) : undefined,
    });

    let fullContent = '';
    const toolCalls: ToolCall[] = [];

    stream.on('text', (text: string) => {
      fullContent += text;
      onChunk?.(text);
    });

    // Process the final message to extract tool calls
    const finalMessage = await stream.finalMessage();

    // Extract tool calls from the final message
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // Extract cache metrics from usage if available
    const usage = finalMessage.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };

    return {
      content: fullContent,
      toolCalls,
      stopReason: finalMessage.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens,
      },
      rawResponse: finalMessage,
    };
  }

  supportsToolUse(): boolean {
    return true;
  }

  supportsVision(): boolean {
    // All Claude 3+ models support vision
    return this.model.includes('claude-3') || this.model.includes('claude-sonnet-4') || this.model.includes('claude-opus-4');
  }

  getName(): string {
    return 'Anthropic';
  }

  getModel(): string {
    return this.model;
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic SDK doesn't expose a models.list() API
    // Use static model list instead
    return getStaticModels('Anthropic');
  }

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    // Anthropic block type union
    type AnthropicBlock =
      | Anthropic.TextBlockParam
      | Anthropic.ToolUseBlockParam
      | Anthropic.ToolResultBlockParam
      | Anthropic.ImageBlockParam;

    return messages
      // Filter out system messages since Anthropic handles them separately
      .filter(msg => msg.role !== 'system')
      .map((msg): Anthropic.MessageParam => {
        // Map system role to user role for Anthropic compatibility
        const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';

        if (typeof msg.content === 'string') {
          return { role, content: msg.content };
        }

        // Convert content blocks using shared utility
        // This ensures all block types are handled and unknown types are logged
        const content = mapContentBlocks<AnthropicBlock>(msg.content, {
          text: (b) => ({
            type: 'text' as const,
            text: b.text || '',
          }),
          tool_use: (b) => ({
            type: 'tool_use' as const,
            id: b.id || '',
            name: b.name || '',
            input: b.input || {},
          }),
          tool_result: (b) => ({
            type: 'tool_result' as const,
            tool_use_id: b.tool_use_id || '',
            content: b.content || '',
            is_error: b.is_error || false,
          }),
          image: (b) => {
            if (!b.image) {
              return { type: 'text' as const, text: '' };
            }
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: b.image.media_type,
                data: b.image.data,
              },
            };
          },
          // Thinking blocks are converted to text for now (Anthropic API doesn't accept them as input)
          thinking: (b) => ({
            type: 'text' as const,
            text: b.text || '',
          }),
          // Unknown block types become empty text blocks (logged by mapContentBlocks)
          unknown: (b) => ({ type: 'text' as const, text: b.text || b.content || '' }),
        });

        return { role, content };
      });
  }

  private parseResponse(response: Anthropic.Message): ProviderResponse {
    let content = '';
    let thinkingContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      // Cast to handle extended thinking blocks which may not be in SDK types yet
      const blockType = (block as { type: string }).type;

      if (blockType === 'text') {
        content += (block as { text: string }).text;
      } else if (blockType === 'tool_use') {
        const toolBlock = block as { id: string; name: string; input: unknown };
        toolCalls.push({
          id: toolBlock.id,
          name: toolBlock.name,
          input: toolBlock.input as Record<string, unknown>,
        });
      } else if (blockType === 'thinking') {
        // Handle extended thinking blocks (cast via unknown as SDK types may not include it yet)
        const thinkingBlock = block as unknown as { thinking: string };
        thinkingContent += (thinkingContent ? '\n' : '') + thinkingBlock.thinking;
      }
    }

    // Extract cache metrics from usage if available
    const usage = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };

    return createProviderResponse({
      content,
      toolCalls,
      stopReason: response.stop_reason,
      reasoningContent: thinkingContent || undefined,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      rawResponse: response,
    });
  }
}
