// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test utilities for MockProvider.
 *
 * Helper functions for creating and asserting mock provider behavior in tests.
 */

import { vi } from 'vitest';
import { MockProvider, MockProviderConfig, MockResponse, MockCall } from '../../src/providers/mock.js';
import type { ToolCall, IProvider, ProviderResponse } from '../../src/types.js';
import { BaseProvider } from '../../src/providers/base.js';

/**
 * Configuration for creating a minimal provider mock.
 */
export interface MinimalProviderConfig {
  name?: string;
  model?: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  /** Default response for streamChat/chat calls */
  defaultResponse?: Partial<ProviderResponse>;
}

/**
 * Create a minimal provider mock that satisfies the IProvider interface.
 * Use this when you need a lightweight mock without full MockProvider functionality.
 *
 * @example
 * ```typescript
 * const provider = createMinimalProvider({ name: 'test', model: 'test-model' });
 * const agent = new Agent({ provider, toolRegistry: new ToolRegistry() });
 * ```
 */
export function createMinimalProvider(config: MinimalProviderConfig = {}): IProvider {
  const defaultProviderResponse: ProviderResponse = {
    content: config.defaultResponse?.content ?? '',
    toolCalls: config.defaultResponse?.toolCalls ?? [],
    stopReason: config.defaultResponse?.stopReason ?? 'end_turn',
    ...config.defaultResponse,
  };

  return {
    chat: vi.fn().mockResolvedValue(defaultProviderResponse),
    streamChat: vi.fn().mockResolvedValue(defaultProviderResponse),
    supportsToolUse: () => config.supportsTools ?? true,
    supportsVision: () => config.supportsVision ?? false,
    getName: () => config.name ?? 'mock',
    getModel: () => config.model ?? 'mock-model',
    getContextWindow: () => config.contextWindow ?? 128000,
  };
}

/**
 * Create a minimal provider with custom streamChat behavior.
 * Useful for tests that need to control streaming responses.
 *
 * @example
 * ```typescript
 * const provider = createMinimalProviderWithStream({
 *   streamChat: vi.fn().mockImplementation(async (msgs, tools, onChunk) => {
 *     onChunk?.('Hello');
 *     return { content: 'Hello', toolCalls: [], stopReason: 'end_turn' };
 *   }),
 * });
 * ```
 */
export function createMinimalProviderWithStream(
  overrides: Partial<IProvider> & { streamChat: IProvider['streamChat'] }
): IProvider {
  const base = createMinimalProvider();
  return { ...base, ...overrides };
}

/**
 * Cast a partial provider to BaseProvider for use with Agent.
 * This is a type-safe alternative to `as any` when you have a partial mock.
 *
 * @example
 * ```typescript
 * const mock = {
 *   streamChat: vi.fn().mockResolvedValue({ content: 'hi', toolCalls: [], stopReason: 'end_turn' }),
 *   supportsToolUse: () => true,
 *   getName: () => 'test',
 *   getModel: () => 'model',
 *   getContextWindow: () => 128000,
 * };
 * const provider = asProvider(mock);
 * ```
 */
export function asProvider(partial: Partial<IProvider>): BaseProvider {
  // Fill in missing methods with defaults
  const filled: IProvider = {
    chat: partial.chat ?? vi.fn().mockResolvedValue({ content: '', toolCalls: [], stopReason: 'end_turn' }),
    streamChat: partial.streamChat ?? vi.fn().mockResolvedValue({ content: '', toolCalls: [], stopReason: 'end_turn' }),
    supportsToolUse: partial.supportsToolUse ?? (() => true),
    supportsVision: partial.supportsVision ?? (() => false),
    getName: partial.getName ?? (() => 'mock'),
    getModel: partial.getModel ?? (() => 'mock-model'),
    getContextWindow: partial.getContextWindow ?? (() => 128000),
  };
  // Cast to BaseProvider - this is safe because Agent only uses IProvider methods
  return filled as unknown as BaseProvider;
}

/**
 * Interface for minimal tool registry mock.
 * This matches the subset of ToolRegistry methods used by Agent.
 */
export interface IToolRegistry {
  getDefinitions(): Array<{ name: string; description: string; input_schema: unknown }>;
  get(name: string): unknown;
  has(name: string): boolean;
  execute?(call: { id: string; name: string; input: unknown }): Promise<{ tool_use_id: string; content: string; is_error?: boolean }>;
}

/**
 * Create a minimal tool registry mock for tests that don't need full tool functionality.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   provider: createMinimalProvider(),
 *   toolRegistry: createMinimalToolRegistry(),
 * });
 * ```
 */
export function createMinimalToolRegistry(): IToolRegistry {
  return {
    getDefinitions: () => [],
    get: () => undefined,
    has: () => false,
  };
}

/**
 * Create a MockProvider with a simple text response.
 */
export function createMockProvider(responseOrConfig?: string | MockResponse[] | MockProviderConfig): MockProvider {
  if (typeof responseOrConfig === 'string') {
    return new MockProvider({ defaultResponse: responseOrConfig });
  }
  if (Array.isArray(responseOrConfig)) {
    return new MockProvider({ responses: responseOrConfig });
  }
  return new MockProvider(responseOrConfig);
}

/**
 * Create a mock response with text content.
 */
export function mockTextResponse(content: string): MockResponse {
  return { content };
}

/**
 * Create a mock response with tool calls.
 */
export function mockToolResponse(toolCalls: ToolCall[]): MockResponse {
  return { toolCalls, stopReason: 'tool_use' };
}

/**
 * Create a mock tool call.
 */
export function mockToolCall(name: string, input: Record<string, unknown> = {}, id?: string): ToolCall {
  return {
    id: id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    input,
  };
}

/**
 * Create a mock response that throws an error.
 */
export function mockErrorResponse(message: string): MockResponse {
  return { error: new Error(message) };
}

/**
 * Assert that a specific tool was called.
 */
export function expectToolCall(
  provider: MockProvider,
  name: string,
  params?: Record<string, unknown>
): MockCall | undefined {
  const calls = provider.getCallHistory();

  for (const call of calls) {
    if (!call.tools) continue;

    // Check if the tool was in the available tools
    const hasTool = call.tools.some(t => t.name === name);
    if (hasTool) {
      // If params specified, check messages for tool results
      if (params) {
        for (const msg of call.messages) {
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'tool_use' && block.name === name) {
                const inputMatch = Object.entries(params).every(
                  ([key, value]) => block.input?.[key] === value
                );
                if (inputMatch) return call;
              }
            }
          }
        }
      } else {
        return call;
      }
    }
  }

  return undefined;
}

/**
 * Assert that a message with specific content was sent.
 */
export function expectMessage(
  provider: MockProvider,
  role: 'user' | 'assistant' | 'system',
  contentPattern: string | RegExp
): MockCall | undefined {
  const calls = provider.getCallHistory();

  for (const call of calls) {
    for (const msg of call.messages) {
      if (msg.role !== role) continue;

      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map(b => b.text || b.content || '').join('');

      const matches = typeof contentPattern === 'string'
        ? content.includes(contentPattern)
        : contentPattern.test(content);

      if (matches) return call;
    }
  }

  return undefined;
}

/**
 * Assert that a system prompt was used.
 */
export function expectSystemPrompt(
  provider: MockProvider,
  contentPattern: string | RegExp
): MockCall | undefined {
  const calls = provider.getCallHistory();

  for (const call of calls) {
    if (!call.systemPrompt) continue;

    const matches = typeof contentPattern === 'string'
      ? call.systemPrompt.includes(contentPattern)
      : contentPattern.test(call.systemPrompt);

    if (matches) return call;
  }

  return undefined;
}

/**
 * Get all messages sent across all calls.
 */
export function getAllMessages(provider: MockProvider): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];

  for (const call of provider.getCallHistory()) {
    for (const msg of call.messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map(b => b.text || b.content || '').join('');
      result.push({ role: msg.role, content });
    }
  }

  return result;
}
