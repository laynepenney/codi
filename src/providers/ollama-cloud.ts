// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Ollama Cloud provider implementation using the Ollama API directly.
 * Optimized for hosted Ollama services with rate limiting and retry logic.
 * Use 'ollama' provider for local usage, 'ollama-cloud' for hosted services.
 */

import { BaseProvider } from './base.js';
import { createProviderResponse } from './response-parser.js';
import { withRetry, type RetryOptions } from './retry.js';
import { getProviderRateLimiter, type RateLimiter } from './rate-limiter.js';
import type { Message, ToolDefinition, ProviderResponse, ProviderConfig, ToolCall } from '../types.js';

/** Ollama message format */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  format?: string;
  options?: {
    num_predict?: number;
    temperature?: number;
    top_k?: number;
    top_p?: number;
    repeat_penalty?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    mirostat?: number;
    mirostat_tau?: number;
    mirostat_eta?: number;
    penalize_newline?: boolean;
    stop?: string[];
  };
  keep_alive?: string | number;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    vision: boolean;
    toolUse: boolean;
  };
  pricing: {
    input: number;
    output: number;
  };
}

export class OllamaCloudProvider extends BaseProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number | undefined;
  private readonly retryOptions: RetryOptions;
  private readonly rateLimiter: RateLimiter;
  private retryCallback?: (attempt: number, error: Error, delayMs: number) => void;

  constructor(config: ProviderConfig & { retry?: RetryOptions } = {}) {
    super(config);

    // Default to localhost:11434 which is Ollama's default
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.model = config.model || 'llama3.2';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens;
    // Default retry options: 5 retries with exponential backoff starting at 5s
    // Tuned for Ollama cloud rate limits (~1 req/sec)
    this.retryOptions = {
      maxRetries: 5,
      initialDelayMs: 5000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitter: true,
      ...config.retry,
    };
    // Get shared rate limiter for Ollama Cloud provider
    this.rateLimiter = getProviderRateLimiter('ollama-cloud');
  }

  /**
   * Set a callback to be notified when retries occur.
   */
  setRetryCallback(callback: (attempt: number, error: Error, delayMs: number) => void): void {
    this.retryCallback = callback;
  }

  getName(): string {
    return 'Ollama Cloud';
  }

  getModel(): string {
    return this.model;
  }

  supportsToolUse(): boolean {
    // Ollama doesn't natively support tool calling, but we can simulate it through structured outputs or parsing
    return true;
  }

  supportsVision(): boolean {
    // Some Ollama models support vision (like LLaVA-based ones)
    const modelLower = this.model.toLowerCase();
    return modelLower.includes('llava') ||
           modelLower.includes('vision') ||
           modelLower.includes('bakllava');
  }

  /**
   * Convert our message format to Ollama's format.
   */
  private convertMessages(messages: Message[], systemPrompt?: string): OllamaMessage[] {
    const ollamaMessages: OllamaMessage[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      ollamaMessages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Convert messages, handling content blocks
    for (const msg of messages) {
      let content: string;

      // Handle different content formats
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Process content blocks - concatenate text parts
        content = msg.content
          .map(block => {
            if ('text' in block) {
              return block.text;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      } else {
        content = JSON.stringify(msg.content);
      }

      // Map role to Ollama's expected values
      const role: 'system' | 'user' | 'assistant' =
        msg.role === 'system' ? 'system' :
        msg.role === 'assistant' ? 'assistant' : 'user';

      ollamaMessages.push({ role, content });
    }

    return ollamaMessages;
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<ProviderResponse> {
    const ollamaMessages = this.convertMessages(messages, systemPrompt);

    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      options: {
        temperature: this.temperature,
        ...(this.maxTokens && { num_predict: this.maxTokens }),
      },
    };

    // Use rate limiter to prevent 429 errors
    return this.rateLimiter.schedule(() =>
      withRetry(
        async () => {
          const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            throw new Error(`Ollama API request failed: ${response.status} ${response.statusText}`);
          }

          const responseData: OllamaChatResponse = await response.json();

          // Extract tool calls from response if tools were provided
          let toolCalls: ToolCall[] = [];
          if (tools && tools.length > 0) {
            toolCalls = this.extractToolCalls(responseData.message.content, tools);
          }

          return createProviderResponse({
            content: responseData.message.content,
            toolCalls,
            stopReason: responseData.done_reason,
            inputTokens: responseData.prompt_eval_count,
            outputTokens: responseData.eval_count,
          });
        },
        {
          ...this.retryOptions,
          onRetry: this.retryCallback,
        }
      )
    );
  }

  async streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void,
    systemPrompt?: string
  ): Promise<ProviderResponse> {
    const ollamaMessages = this.convertMessages(messages, systemPrompt);

    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: ollamaMessages,
      stream: true,
      options: {
        temperature: this.temperature,
        ...(this.maxTokens && { num_predict: this.maxTokens }),
      },
    };

    // Use rate limiter to prevent 429 errors
    return this.rateLimiter.schedule(() =>
      withRetry(
        async () => {
          const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            throw new Error(`Ollama API request failed: ${response.status} ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error('Response body is undefined');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullText = '';
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;
          let stopReason: string | undefined;

          // Process streamed chunks
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
              try {
                const data: OllamaChatResponse = JSON.parse(line);

                if (data.message?.content) {
                  const content = data.message.content;
                  fullText += content;
                  if (onChunk) onChunk(content);
                }

                // Capture token counts and stop reason from final chunk
                if (data.done) {
                  inputTokens = data.prompt_eval_count;
                  outputTokens = data.eval_count;
                  stopReason = data.done_reason;
                }
              } catch {
                // Not valid JSON, skip
                continue;
              }
            }
          }

          // Extract tool calls if tools were provided
          let toolCalls: ToolCall[] = [];
          if (tools && tools.length > 0) {
            toolCalls = this.extractToolCalls(fullText, tools);
          }

          return createProviderResponse({
            content: fullText,
            toolCalls,
            stopReason: stopReason || 'stop',
            inputTokens,
            outputTokens,
          });
        },
        {
          ...this.retryOptions,
          onRetry: this.retryCallback,
        }
      )
    );
  }

  async listModels(): Promise<OllamaModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.models || []).map((m: { name: string }) => {
        const nameLower = m.name.toLowerCase();
        const isVisionModel = nameLower.includes('llava') ||
                             nameLower.includes('vision') ||
                             nameLower.includes('bakllava');

        return {
          id: m.name,
          name: m.name,
          provider: 'Ollama',
          capabilities: {
            vision: isVisionModel,
            toolUse: true, // Assume true for local models
          },
          pricing: {
            input: 0,
            output: 0, // Local inference is free
          },
        };
      });
    } catch {
      // Ollama not running or not accessible
      return [];
    }
  }

  /**
   * Extract tool calls from response content.
   * Looks for JSON structures that match tool call format.
   */
  private extractToolCalls(content: string, tools: ToolDefinition[]): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const toolNames = new Set(tools.map(t => t.name));

    // Pattern 1: JSON in code blocks - most reliable
    const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockPattern.exec(content)) !== null) {
      const jsonContent = match[1].trim();
      const extracted = this.tryParseToolCall(jsonContent, toolNames);
      if (extracted) {
        toolCalls.push(extracted);
      }
    }

    // If we found tool calls in code blocks, return them
    if (toolCalls.length > 0) {
      return toolCalls;
    }

    // Pattern 2: Look for JSON objects with "name" field
    // This pattern handles nested braces properly
    const jsonPattern = /\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g;

    while ((match = jsonPattern.exec(content)) !== null) {
      const extracted = this.tryParseToolCall(match[0], toolNames);
      if (extracted) {
        toolCalls.push(extracted);
      }
    }

    return toolCalls;
  }

  /**
   * Try to parse a JSON string as a tool call.
   */
  private tryParseToolCall(jsonString: string, validToolNames: Set<string>): ToolCall | null {
    try {
      const parsed = JSON.parse(jsonString);

      // Check if it has a valid tool name
      if (parsed.name && validToolNames.has(parsed.name)) {
        return {
          id: `extracted_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          name: parsed.name,
          input: parsed.arguments || parsed.input || parsed.parameters || {},
        };
      }
    } catch {
      // Not valid JSON
    }
    return null;
  }

  /**
   * Pull a model if it's not already available.
   */
  async pullModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: modelName,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model ${modelName}: ${response.statusText}`);
    }

    // Wait for the pull to complete
    await response.json();
  }

  /**
   * Check if Ollama is running and accessible.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
