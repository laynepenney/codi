// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test utilities for MockProvider.
 *
 * Helper functions for creating and asserting mock provider behavior in tests.
 */

import { MockProvider, MockProviderConfig, MockResponse, MockCall } from '../../src/providers/mock.js';
import type { ToolCall } from '../../src/types.js';

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
