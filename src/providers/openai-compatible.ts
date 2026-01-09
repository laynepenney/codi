import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import type { Message, ToolDefinition, ProviderResponse, ProviderConfig, ToolCall } from '../types.js';

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
    });

    let fullContent = '';
    let reasoningContent = '';
    const toolCalls: Map<number, ToolCall> = new Map();

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

      // Handle streamed tool calls
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index;
          let existing = toolCalls.get(index);

          if (!existing) {
            existing = {
              id: toolCallDelta.id || '',
              name: toolCallDelta.function?.name || '',
              input: {},
            };
            toolCalls.set(index, existing);
          }

          if (toolCallDelta.id) {
            existing.id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name) {
            existing.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            // Accumulate arguments JSON string (parse at the end)
            (existing as any)._rawArgs = ((existing as any)._rawArgs || '') + toolCallDelta.function.arguments;
          }
        }
      }
    }

    // Parse any remaining raw arguments
    for (const [, toolCall] of toolCalls) {
      if ((toolCall as any)._rawArgs) {
        try {
          toolCall.input = JSON.parse((toolCall as any)._rawArgs);
        } catch {
          toolCall.input = {};
        }
        delete (toolCall as any)._rawArgs;
      }
    }

    const hasToolCalls = toolCalls.size > 0;

    return {
      content: fullContent,
      toolCalls: Array.from(toolCalls.values()),
      stopReason: hasToolCalls ? 'tool_use' : 'end_turn',
      reasoningContent: reasoningContent || undefined,
    };
  }

  supportsToolUse(): boolean {
    // Most modern models support tool use, but some local models may not
    return true;
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

      // Handle content blocks (tool results need special handling in OpenAI format)
      const parts: OpenAI.ChatCompletionMessageParam[] = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push({
            role: msg.role,
            content: block.text || '',
          } as OpenAI.ChatCompletionMessageParam);
        } else if (block.type === 'tool_use' && msg.role === 'assistant') {
          parts.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: block.id || '',
              type: 'function',
              function: {
                name: block.name || '',
                arguments: JSON.stringify(block.input || {}),
              },
            }],
          } as OpenAI.ChatCompletionMessageParam);
        } else if (block.type === 'tool_result') {
          parts.push({
            role: 'tool',
            tool_call_id: block.tool_use_id || '',
            content: block.content || '',
          } as OpenAI.ChatCompletionMessageParam);
        }
      }

      return parts.length === 1 ? parts[0] : parts;
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
          input: JSON.parse(toolCall.function.arguments || '{}'),
        });
      }
    }

    return {
      content,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    };
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
