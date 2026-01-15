// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Mock Provider for Testing
 *
 * A configurable mock provider that simulates AI model responses
 * for deterministic testing without real API calls.
 *
 * Supports two modes:
 * 1. In-process: Pass responses directly to constructor
 * 2. File-based: Load responses from JSON file (for E2E/PTY tests)
 *
 * For E2E tests, set CODI_MOCK_FILE to point to a JSON file with responses.
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { BaseProvider } from './base.js';
import type { Message, ToolDefinition, ProviderResponse, ToolCall, TokenUsage } from '../types.js';

/**
 * A single mock response configuration.
 */
export interface MockResponse {
  /** Text content to return */
  content?: string;
  /** Tool calls to return */
  toolCalls?: ToolCall[];
  /** Stop reason (defaults to 'end_turn' or 'tool_use' if toolCalls present) */
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
  /** Simulate an error */
  error?: Error;
  /** Optional token usage to report */
  usage?: TokenUsage;
}

/**
 * File format for mock responses.
 * Used when loading responses from a JSON file for E2E tests.
 */
export interface MockResponsesFile {
  /** Array of responses to return in order */
  responses?: MockResponse[];
  /** Default response when queue is empty */
  defaultResponse?: string;
  /** Provider configuration overrides */
  config?: Omit<MockProviderConfig, 'responses' | 'defaultResponse' | 'responsesFile'>;
}

/**
 * Configuration for MockProvider.
 */
export interface MockProviderConfig {
  /** Queue of responses to return in order */
  responses?: MockResponse[];
  /** Default response when queue is empty */
  defaultResponse?: string;
  /** Path to JSON file containing responses (for E2E tests) */
  responsesFile?: string;
  /** Path to log file for recording interactions (for debugging) */
  logFile?: string;
  /** Delay between streaming chunks in ms (default: 0) */
  streamDelay?: number;
  /** Chunk size for streaming (default: 10 characters) */
  streamChunkSize?: number;
  /** Whether to report tool use support (default: true) */
  supportsTools?: boolean;
  /** Whether to report vision support (default: false) */
  supportsVision?: boolean;
  /** Model name to report (default: 'mock-model') */
  model?: string;
}

/**
 * Record of a single call to the provider.
 */
export interface MockCall {
  /** Method that was called */
  method: 'chat' | 'streamChat';
  /** Messages sent to the provider */
  messages: Message[];
  /** Tool definitions if provided */
  tools?: ToolDefinition[];
  /** System prompt if provided */
  systemPrompt?: string;
  /** Timestamp of the call */
  timestamp: Date;
}

/**
 * Mock provider for testing.
 * Simulates AI provider responses with configurable behavior.
 */
export class MockProvider extends BaseProvider {
  private responseQueue: MockResponse[];
  private defaultResponse: string;
  private streamDelay: number;
  private streamChunkSize: number;
  private toolSupport: boolean;
  private visionSupport: boolean;
  private modelName: string;
  private callHistory: MockCall[] = [];
  private logFile?: string;

  /**
   * Load mock configuration from a JSON file.
   */
  static loadFromFile(filePath: string): MockProviderConfig {
    if (!existsSync(filePath)) {
      throw new Error(`Mock responses file not found: ${filePath}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as MockResponsesFile;

    return {
      responses: data.responses,
      defaultResponse: data.defaultResponse,
      ...data.config,
    };
  }

  /**
   * Create a MockProvider from a responses file.
   */
  static fromFile(filePath: string): MockProvider {
    const config = MockProvider.loadFromFile(filePath);
    return new MockProvider(config);
  }

  constructor(config: MockProviderConfig = {}) {
    super({});

    // Load from file if specified
    let effectiveConfig = config;
    if (config.responsesFile) {
      const fileConfig = MockProvider.loadFromFile(config.responsesFile);
      effectiveConfig = { ...fileConfig, ...config, responses: config.responses || fileConfig.responses };
    }

    this.responseQueue = [...(effectiveConfig.responses || [])];
    this.defaultResponse = effectiveConfig.defaultResponse || 'Mock response';
    this.streamDelay = effectiveConfig.streamDelay || 0;
    this.streamChunkSize = effectiveConfig.streamChunkSize || 10;
    this.toolSupport = effectiveConfig.supportsTools !== false;
    this.visionSupport = effectiveConfig.supportsVision || false;
    this.modelName = effectiveConfig.model || 'mock-model';
    this.logFile = effectiveConfig.logFile;
  }

  /**
   * Add responses to the queue.
   */
  addResponses(responses: MockResponse[]): void {
    this.responseQueue.push(...responses);
  }

  /**
   * Set the default response when queue is empty.
   */
  setDefaultResponse(response: string): void {
    this.defaultResponse = response;
  }

  /**
   * Get the call history.
   */
  getCallHistory(): MockCall[] {
    return [...this.callHistory];
  }

  /**
   * Get the most recent call.
   */
  getLastCall(): MockCall | undefined {
    return this.callHistory[this.callHistory.length - 1];
  }

  /**
   * Get call count.
   */
  getCallCount(): number {
    return this.callHistory.length;
  }

  /**
   * Reset the provider state.
   */
  reset(): void {
    this.callHistory = [];
    this.responseQueue = [];
  }

  /**
   * Get the next response from the queue or default.
   */
  private getNextResponse(): MockResponse {
    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift()!;
    }
    return { content: this.defaultResponse };
  }

  /**
   * Build a ProviderResponse from a MockResponse.
   */
  private buildResponse(mock: MockResponse): ProviderResponse {
    const toolCalls = mock.toolCalls || [];
    const stopReason = mock.stopReason || (toolCalls.length > 0 ? 'tool_use' : 'end_turn');

    return {
      content: mock.content || '',
      toolCalls,
      stopReason,
      usage: mock.usage || {
        inputTokens: 100,
        outputTokens: 50,
      },
    };
  }

  /**
   * Record a call to the provider.
   */
  private recordCall(
    method: 'chat' | 'streamChat',
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): void {
    const call: MockCall = {
      method,
      messages: JSON.parse(JSON.stringify(messages)), // Deep clone
      tools: tools ? JSON.parse(JSON.stringify(tools)) : undefined,
      systemPrompt,
      timestamp: new Date(),
    };

    this.callHistory.push(call);
    this.logToFile('call', call);
  }

  /**
   * Log an event to the log file (if configured).
   */
  private logToFile(type: 'call' | 'response', data: unknown): void {
    if (!this.logFile) return;

    try {
      // Ensure directory exists
      const dir = dirname(this.logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const entry = {
        type,
        timestamp: new Date().toISOString(),
        data,
      };

      appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Ignore logging errors in tests
    }
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<ProviderResponse> {
    this.recordCall('chat', messages, tools, systemPrompt);

    const response = this.getNextResponse();

    if (response.error) {
      this.logToFile('response', { error: response.error.message });
      throw response.error;
    }

    const result = this.buildResponse(response);
    this.logToFile('response', result);
    return result;
  }

  async streamChat(
    messages: Message[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: string) => void,
    systemPrompt?: string,
    _onReasoningChunk?: (chunk: string) => void
  ): Promise<ProviderResponse> {
    this.recordCall('streamChat', messages, tools, systemPrompt);

    const response = this.getNextResponse();

    if (response.error) {
      this.logToFile('response', { error: response.error.message });
      throw response.error;
    }

    // Simulate streaming if there's content and a callback
    if (response.content && onChunk) {
      const content = response.content;
      for (let i = 0; i < content.length; i += this.streamChunkSize) {
        const chunk = content.slice(i, i + this.streamChunkSize);
        onChunk(chunk);
        if (this.streamDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, this.streamDelay));
        }
      }
    }

    const result = this.buildResponse(response);
    this.logToFile('response', result);
    return result;
  }

  supportsToolUse(): boolean {
    return this.toolSupport;
  }

  supportsVision(): boolean {
    return this.visionSupport;
  }

  getName(): string {
    return 'Mock';
  }

  getModel(): string {
    return this.modelName;
  }
}
