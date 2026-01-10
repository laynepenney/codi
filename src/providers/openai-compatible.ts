import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import type { Message, ToolDefinition, ProviderResponse, ProviderConfig, ToolCall } from '../types.js';
import { createProviderResponse, safeParseJson, StreamingToolCallAccumulator } from './response-parser.js';

const DEFAULT_MODEL = 'gpt-4o';
const MAX_TOKENS = 4096;

// Models that use max_completion_tokens instead of max_tokens
const COMPLETION_TOKEN_MODELS = ['gpt-5', 'o1', 'o3'];

/**
 * OpenAI-compatible provider that works with:
 * - OpenAI API
 * - Ollama (via OpenAI compatibility layer)
 * - vLLM
 * - LocalAI
 * - Any other OpenAI-compatible server
 */
export class OpenAICompatibleProvider extends BaseProvider {
  private client: OpenAI;
  private model: string;
  private providerName: string;

  constructor(config: ProviderConfig & { providerName?: string } = {}) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || 'not-needed',
      baseURL: config.baseUrl,
    });
    this.model = config.model || DEFAULT_MODEL;
    this.providerName = config.providerName || 'OpenAI';
  }

  private getTokenParams(): { max_tokens?: number; max_completion_tokens?: number } {
    const usesCompletionTokens = COMPLETION_TOKEN_MODELS.some(m => this.model.startsWith(m));
    return usesCompletionTokens
      ? { max_completion_tokens: MAX_TOKENS }
      : { max_tokens: MAX_TOKENS };
  }

  async chat(messages: Message[], tools?: ToolDefinition[], systemPrompt?: string): Promise<ProviderResponse> {
    const convertedMessages = this.convertMessages(messages);
    const messagesWithSystem: OpenAI.ChatCompletionMessageParam[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...convertedMessages]
      : convertedMessages;

    const response = await this.client.chat.completions.create({
      model: this.model,
      ...this.getTokenParams(),
      messages: messagesWithSystem,
      tools: tools ? this.convertTools(tools) : undefined,
    });

    return this.parseResponse(response);
  }

  async streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void,
    systemPrompt?: string
  ): Promise<ProviderResponse> {
    const convertedMessages = this.convertMessages(messages);
    const messagesWithSystem: OpenAI.ChatCompletionMessageParam[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...convertedMessages]
      : convertedMessages;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      ...this.getTokenParams(),
      messages: messagesWithSystem,
      tools: tools ? this.convertTools(tools) : undefined,
      stream: true,
      stream_options: { include_usage: true },
    });

    let fullContent = '';
    let reasoningContent = '';
    const toolCallAccumulator = new StreamingToolCallAccumulator();
    let streamUsage: { prompt_tokens: number; completion_tokens: number } | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Handle reasoning content from reasoning models (e.g., DeepSeek-R1)
      const reasoningDelta = (delta as any)?.reasoning_content;
      if (reasoningDelta) {
        reasoningContent += reasoningDelta;
      }

      if (delta?.content) {
        fullContent += delta.content;
        onChunk?.(delta.content);
      }

      // Handle streamed tool calls using the accumulator
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          toolCallAccumulator.accumulate(toolCallDelta.index, {
            id: toolCallDelta.id,
            name: toolCallDelta.function?.name,
            arguments: toolCallDelta.function?.arguments,
          });
        }
      }

      // Capture usage from final chunk (when stream_options.include_usage is true)
      if (chunk.usage) {
        streamUsage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
        };
      }
    }

    // Use actual usage from stream if available, otherwise estimate
    const inputTokens = streamUsage?.prompt_tokens ?? 0;
    const outputTokens = streamUsage?.completion_tokens ??
      Math.ceil((fullContent.length + reasoningContent.length) / 4);

    return createProviderResponse({
      content: fullContent,
      toolCalls: toolCallAccumulator.getToolCalls(),
      stopReason: toolCallAccumulator.hasToolCalls() ? 'tool_use' : 'end_turn',
      reasoningContent: reasoningContent || undefined,
      inputTokens,
      outputTokens,
    });
  }

  supportsToolUse(): boolean {
    // Most modern models support tool use, but some local models may not
    return true;
  }

  supportsVision(): boolean {
    // GPT-4V, GPT-4O, and similar models support vision
    return this.model.includes('gpt-4') || this.model.includes('gpt-5') || this.model.includes('vision');
  }

  getName(): string {
    return this.providerName;
  }

  getModel(): string {
    return this.model;
  }

  private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content,
        } as OpenAI.ChatCompletionMessageParam;
      }

      // Handle content blocks - OpenAI requires all tool_calls in a single assistant message
      // and tool results must immediately follow the assistant message
      const parts: OpenAI.ChatCompletionMessageParam[] = [];
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
      const toolResults: OpenAI.ChatCompletionMessageParam[] = [];
      let textContent = '';
      const imageBlocks: Array<{ type: 'image_url'; image_url: { url: string } }> = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          textContent += block.text || '';
        } else if (block.type === 'tool_use' && msg.role === 'assistant') {
          toolCalls.push({
            id: block.id || '',
            type: 'function',
            function: {
              name: block.name || '',
              arguments: JSON.stringify(block.input || {}),
            },
          });
        } else if (block.type === 'tool_result') {
          toolResults.push({
            role: 'tool',
            tool_call_id: block.tool_use_id || '',
            content: block.content || '',
          } as OpenAI.ChatCompletionMessageParam);
        } else if (block.type === 'image' && block.image) {
          // Convert to OpenAI's image_url format with data URL
          imageBlocks.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.image.media_type};base64,${block.image.data}`,
            },
          });
        }
      }

      // Build parts in correct order for OpenAI:
      // 1. Assistant message with tool_calls (if any)
      // 2. Tool result messages (must follow assistant with tool_calls)
      // 3. Text content as user/assistant message (if any, after tool results)
      if (toolCalls.length > 0) {
        parts.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls,
        } as OpenAI.ChatCompletionMessageParam);
        // Don't include textContent separately when it's part of assistant tool call message
        textContent = '';
      }

      // Add tool results
      parts.push(...toolResults);

      // Add text content after tool results (if any remaining)
      // If there are images, use the multimodal content format
      if (textContent || imageBlocks.length > 0) {
        if (imageBlocks.length > 0) {
          // Use array format for multimodal content
          const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
          if (textContent) {
            contentParts.push({ type: 'text', text: textContent });
          }
          contentParts.push(...imageBlocks);
          parts.push({
            role: msg.role,
            content: contentParts,
          } as OpenAI.ChatCompletionMessageParam);
        } else {
          parts.push({
            role: msg.role,
            content: textContent,
          } as OpenAI.ChatCompletionMessageParam);
        }
      }

      return parts;
    }).flat();
  }

  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  private parseResponse(response: OpenAI.ChatCompletion): ProviderResponse {
    const message = response.choices[0]?.message;
    const content = message?.content || '';
    const toolCalls: ToolCall[] = [];

    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        toolCalls.push({
          id: toolCall.id,
          name: toolCall.function.name,
          input: safeParseJson(toolCall.function.arguments),
        });
      }
    }

    return createProviderResponse({
      content,
      toolCalls,
      stopReason: response.choices[0]?.finish_reason,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    });
  }
}

/**
 * Create a provider for Ollama (running locally)
 */
export function createOllamaProvider(model: string = 'llama3.2'): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: 'http://localhost:11434/v1',
    model,
    providerName: 'Ollama',
  });
}

/**
 * Create a provider for RunPod Serverless (vLLM with OpenAI-compatible API)
 * @param endpointId - Your RunPod serverless endpoint ID
 * @param model - The model name (must match MODEL_NAME env var on your endpoint)
 * @param apiKey - RunPod API key (defaults to RUNPOD_API_KEY env var)
 */
export function createRunPodProvider(
  endpointId: string,
  model: string,
  apiKey?: string
): OpenAICompatibleProvider {
  const key = apiKey || process.env.RUNPOD_API_KEY;
  if (!key) {
    throw new Error('RunPod API key required. Set RUNPOD_API_KEY or pass --api-key');
  }
  if (!endpointId) {
    throw new Error('RunPod endpoint ID required. Pass --endpoint-id');
  }
  return new OpenAICompatibleProvider({
    baseUrl: `https://api.runpod.ai/v2/${endpointId}/openai/v1`,
    apiKey: key,
    model,
    providerName: 'RunPod',
  });
}
