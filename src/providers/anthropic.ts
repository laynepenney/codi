import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './base.js';
import type { Message, ToolDefinition, ProviderResponse, ProviderConfig, ToolCall } from '../types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
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

  async chat(messages: Message[], tools?: ToolDefinition[], systemPrompt?: string): Promise<ProviderResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      ...(systemPrompt && { system: systemPrompt }),
      messages: this.convertMessages(messages),
      tools: tools as Anthropic.Tool[] | undefined,
    });

    return this.parseResponse(response);
  }

  async streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void,
    systemPrompt?: string
  ): Promise<ProviderResponse> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: MAX_TOKENS,
      ...(systemPrompt && { system: systemPrompt }),
      messages: this.convertMessages(messages),
      tools: tools as Anthropic.Tool[] | undefined,
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

    return {
      content: fullContent,
      toolCalls,
      stopReason: finalMessage.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
    };
  }

  supportsToolUse(): boolean {
    return true;
  }

  getName(): string {
    return 'Anthropic';
  }

  getModel(): string {
    return this.model;
  }

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages.map((msg): Anthropic.MessageParam => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content,
        };
      }

      // Convert content blocks to the appropriate Anthropic types
      const content: Array<
        | Anthropic.TextBlockParam
        | Anthropic.ToolUseBlockParam
        | Anthropic.ToolResultBlockParam
      > = msg.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text || '' };
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id || '',
            name: block.name || '',
            input: block.input || {},
          };
        }
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id || '',
            content: block.content || '',
            is_error: block.is_error || false,
          };
        }
        return { type: 'text' as const, text: '' };
      });

      return { role: msg.role, content };
    });
  }

  private parseResponse(response: Anthropic.Message): ProviderResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
    };
  }
}
