/**
 * Ollama native provider implementation using the Ollama API directly.
 * This implementation provides better control and features compared to the OpenAI-compatible version.
 */

import { BaseProvider } from './base.js';
import { createProviderResponse } from './response-parser.js';
import type { Message, ToolDefinition, ProviderResponse, ProviderConfig, ContentBlock } from '../types.js';

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    images?: string[];
  }>;
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
  done_reason: string;
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    vision: boolean;
    toolUse: boolean;
    coding: boolean;
  };
  pricing: {
    input: number;
    output: number;
  };
}

export class OllamaNativeProvider extends BaseProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number | undefined;

  constructor(config: ProviderConfig = {}) {
    super(config);
    
    // Default to localhost:11434 which is Ollama's default
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.model = config.model || 'llama3.2';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens;
  }

  getName(): string {
    return 'Ollama Native';
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
    return this.model.includes('llava') || 
           this.model.includes('vision') || 
           this.model.includes('bakllava');
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<ProviderResponse> {
    // Convert our message format to Ollama's format
    const ollamaMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      images?: string[];
    }> = [];

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
        // Process content blocks - for now just concatenate text parts
        content = msg.content
          .map(block => {
            if ('text' in block) {
              return block.text;
            }
            return '';
          })
          .join('\n');
      } else {
        content = JSON.stringify(msg.content);
      }
      
      // Ensure role is properly typed for Ollama
      let role: 'system' | 'user' | 'assistant';
      switch (msg.role) {
        case 'system':
          role = 'system';
          break;
        case 'user':
          role = 'user';
          break;
        case 'assistant':
          role = 'assistant';
          break;
        default:
          // Fallback to user for unknown roles
          role = 'user';
      }
      
      ollamaMessages.push({
        role,
        content,
      });
    }

    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      options: {
        temperature: this.temperature,
        num_predict: this.maxTokens || undefined,
      },
    };

    try {
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
      let toolCalls = [];
      if (tools && tools.length > 0) {
        // Try to extract tool calls from the response content
        toolCalls = this.extractToolCalls(responseData.message.content, tools);
      }

      return createProviderResponse({
        content: responseData.message.content,
        toolCalls,
        stopReason: responseData.done_reason,
        inputTokens: responseData.prompt_eval_count,
        outputTokens: responseData.eval_count,
      });
    } catch (error) {
      throw new Error(`Failed to generate completion with Ollama: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void,
    systemPrompt?: string
  ): Promise<ProviderResponse> {
    // Convert our message format to Ollama's format
    const ollamaMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      images?: string[];
    }> = [];

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
        // Process content blocks - for now just concatenate text parts
        content = msg.content
          .map(block => {
            if ('text' in block) {
              return block.text;
            }
            return '';
          })
          .join('\n');
      } else {
        content = JSON.stringify(msg.content);
      }
      
      // Ensure role is properly typed for Ollama
      let role: 'system' | 'user' | 'assistant';
      switch (msg.role) {
        case 'system':
          role = 'system';
          break;
        case 'user':
          role = 'user';
          break;
        case 'assistant':
          role = 'assistant';
          break;
        default:
          // Fallback to user for unknown roles
          role = 'user';
      }
      
      ollamaMessages.push({
        role,
        content,
      });
    }

    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: ollamaMessages,
      stream: true, // Enable streaming
      options: {
        temperature: this.temperature,
        num_predict: this.maxTokens || undefined,
      },
    };

    try {
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
      let toolCalls: any[] = [];
      
      // Process streamed chunks
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              const content = data.message.content;
              fullText += content;
              if (onChunk) onChunk(content);
            }
          } catch (e) {
            // Not valid JSON, skip
            continue;
          }
        }
      }

      // Extract tool calls if tools were provided
      if (tools && tools.length > 0) {
        toolCalls = this.extractToolCalls(fullText, tools);
      }

      return createProviderResponse({
        content: fullText,
        toolCalls,
        stopReason: 'stop',
        inputTokens: undefined,
        outputTokens: undefined,
      });
    } catch (error) {
      throw new Error(`Failed to stream completion with Ollama: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      return data.models.map((m: any) => {
        // Heuristic for determining capabilities based on model names
        const isVisionModel = m.name.includes('llava') || 
                             m.name.includes('vision') || 
                             m.name.includes('bakllava');
                             
        const isCodeModel = m.name.includes('code') || 
                           m.name.includes('deepseek') || 
                           m.name.includes('codellama');
        
        return {
          id: m.name,
          name: m.name,
          provider: 'Ollama',
          capabilities: {
            vision: isVisionModel,
            toolUse: true, // Assume true for local models
            coding: isCodeModel,
          },
          pricing: {
            input: 0,
            output: 0, // Local inference is free
          },
        };
      });
    } catch (error) {
      // Ollama not running or not accessible
      return [];
    }
  }

  /**
   * Simple heuristic to extract tool calls from response content.
   * In practice, you might want to use a more sophisticated approach or structured outputs.
   */
  private extractToolCalls(content: string, tools: ToolDefinition[]): any[] {
    // Look for JSON-like structures that might represent tool calls
    const toolCallPatterns = [
      // Direct JSON objects with tool call structure
      /\{[^{}]*"name"[^{}]*\}/g,
      // JSON wrapped in ```json markers
      /```(?:json)?\s*(\{[^}]*"name"[^}]*\})\s*```/g,
      // Function-style call patterns
      /(\w+)\s*\(([^)]*)\)/g
    ];

    const toolCalls = [];
    const toolNames = tools.map(t => t.name);
    
    for (const pattern of toolCallPatterns) {
      const matches = [...content.matchAll(pattern)];
      
      for (const match of matches) {
        try {
          let jsonString: string;
          
          if (match.length > 1) {
            // Grouped match (for patterns with capture groups)
            jsonString = match[1];
          } else {
            // Direct match
            jsonString = match[0];
          }
          
          const parsed = JSON.parse(jsonString);
          
          // Validate that it contains a tool name that exists
          if (parsed.name && toolNames.includes(parsed.name)) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              name: parsed.name,
              input: parsed.arguments || parsed.input || {},
            });
          }
        } catch (e) {
          // Not valid JSON or not a proper tool call, continue
          continue;
        }
      }
    }
    
    return toolCalls;
  }

  /**
   * Pull a model if it's not already available
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
   * Check if Ollama is running and accessible
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