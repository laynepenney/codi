// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from '../src/providers/mock.js';
import {
  createMockProvider,
  mockTextResponse,
  mockToolResponse,
  mockToolCall,
  mockErrorResponse,
  expectMessage,
  expectSystemPrompt,
  getAllMessages,
} from './helpers/mock-provider.js';
import type { Message, ToolDefinition } from '../src/types.js';

describe('MockProvider', () => {
  describe('constructor', () => {
    it('should create with default configuration', () => {
      const provider = new MockProvider();
      expect(provider.getName()).toBe('Mock');
      expect(provider.getModel()).toBe('mock-model');
      expect(provider.supportsToolUse()).toBe(true);
      expect(provider.supportsVision()).toBe(false);
    });

    it('should accept custom configuration', () => {
      const provider = new MockProvider({
        model: 'custom-model',
        supportsTools: false,
        supportsVision: true,
      });
      expect(provider.getModel()).toBe('custom-model');
      expect(provider.supportsToolUse()).toBe(false);
      expect(provider.supportsVision()).toBe(true);
    });
  });

  describe('chat()', () => {
    it('should return default response when queue is empty', async () => {
      const provider = new MockProvider({ defaultResponse: 'Hello!' });
      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);

      expect(response.content).toBe('Hello!');
      expect(response.toolCalls).toEqual([]);
      expect(response.stopReason).toBe('end_turn');
    });

    it('should return responses from queue in order', async () => {
      const provider = new MockProvider({
        responses: [
          { content: 'First' },
          { content: 'Second' },
          { content: 'Third' },
        ],
      });

      const r1 = await provider.chat([{ role: 'user', content: 'a' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'b' }]);
      const r3 = await provider.chat([{ role: 'user', content: 'c' }]);

      expect(r1.content).toBe('First');
      expect(r2.content).toBe('Second');
      expect(r3.content).toBe('Third');
    });

    it('should fall back to default after queue is exhausted', async () => {
      const provider = new MockProvider({
        responses: [{ content: 'Queued' }],
        defaultResponse: 'Default',
      });

      const r1 = await provider.chat([{ role: 'user', content: 'a' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'b' }]);

      expect(r1.content).toBe('Queued');
      expect(r2.content).toBe('Default');
    });

    it('should return tool calls when configured', async () => {
      const toolCalls = [
        { id: '1', name: 'read_file', input: { path: 'test.ts' } },
      ];
      const provider = new MockProvider({
        responses: [{ toolCalls }],
      });

      const response = await provider.chat([{ role: 'user', content: 'test' }]);

      expect(response.toolCalls).toEqual(toolCalls);
      expect(response.stopReason).toBe('tool_use');
    });

    it('should throw error when configured', async () => {
      const provider = new MockProvider({
        responses: [{ error: new Error('API Error') }],
      });

      await expect(
        provider.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('API Error');
    });

    it('should record call history', async () => {
      const provider = new MockProvider();
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const tools: ToolDefinition[] = [{
        name: 'test_tool',
        description: 'A test tool',
        input_schema: { type: 'object', properties: {} },
      }];

      await provider.chat(messages, tools, 'System prompt');

      expect(provider.getCallCount()).toBe(1);
      const call = provider.getLastCall();
      expect(call).toBeDefined();
      expect(call!.method).toBe('chat');
      expect(call!.messages).toEqual(messages);
      expect(call!.tools).toEqual(tools);
      expect(call!.systemPrompt).toBe('System prompt');
    });
  });

  describe('streamChat()', () => {
    it('should stream content in chunks', async () => {
      const provider = new MockProvider({
        responses: [{ content: 'Hello World' }],
        streamChunkSize: 5,
      });

      const chunks: string[] = [];
      const response = await provider.streamChat(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        (chunk) => chunks.push(chunk)
      );

      expect(response.content).toBe('Hello World');
      expect(chunks).toEqual(['Hello', ' Worl', 'd']);
    });

    it('should respect stream delay', async () => {
      const provider = new MockProvider({
        responses: [{ content: 'AB' }],
        streamChunkSize: 1,
        streamDelay: 10,
      });

      const start = Date.now();
      await provider.streamChat(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        () => {}
      );
      const elapsed = Date.now() - start;

      // Should take at least 20ms (2 chunks * 10ms delay)
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });

    it('should record streamChat calls', async () => {
      const provider = new MockProvider();
      await provider.streamChat([{ role: 'user', content: 'test' }]);

      const call = provider.getLastCall();
      expect(call!.method).toBe('streamChat');
    });
  });

  describe('call history management', () => {
    let provider: MockProvider;

    beforeEach(() => {
      provider = new MockProvider();
    });

    it('should track multiple calls', async () => {
      await provider.chat([{ role: 'user', content: 'First' }]);
      await provider.chat([{ role: 'user', content: 'Second' }]);
      await provider.streamChat([{ role: 'user', content: 'Third' }]);

      expect(provider.getCallCount()).toBe(3);
      expect(provider.getCallHistory()).toHaveLength(3);
    });

    it('should reset call history', async () => {
      await provider.chat([{ role: 'user', content: 'test' }]);
      expect(provider.getCallCount()).toBe(1);

      provider.reset();
      expect(provider.getCallCount()).toBe(0);
      expect(provider.getCallHistory()).toEqual([]);
    });

    it('should deep clone messages in history', async () => {
      const messages: Message[] = [{ role: 'user', content: 'original' }];
      await provider.chat(messages);

      // Mutate original
      messages[0].content = 'modified';

      // History should be unchanged
      const call = provider.getLastCall();
      expect(call!.messages[0].content).toBe('original');
    });
  });

  describe('addResponses()', () => {
    it('should add responses to the queue', async () => {
      const provider = new MockProvider({
        responses: [{ content: 'Initial' }],
      });

      provider.addResponses([{ content: 'Added' }]);

      const r1 = await provider.chat([{ role: 'user', content: 'a' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'b' }]);

      expect(r1.content).toBe('Initial');
      expect(r2.content).toBe('Added');
    });
  });
});

describe('Test Helpers', () => {
  describe('createMockProvider()', () => {
    it('should create with string as default response', () => {
      const provider = createMockProvider('Hello');
      return provider.chat([{ role: 'user', content: 'test' }])
        .then(r => expect(r.content).toBe('Hello'));
    });

    it('should create with array of responses', () => {
      const provider = createMockProvider([
        mockTextResponse('First'),
        mockTextResponse('Second'),
      ]);
      return Promise.all([
        provider.chat([{ role: 'user', content: 'a' }]),
        provider.chat([{ role: 'user', content: 'b' }]),
      ]).then(([r1, r2]) => {
        expect(r1.content).toBe('First');
        expect(r2.content).toBe('Second');
      });
    });

    it('should create with config object', () => {
      const provider = createMockProvider({ model: 'test-model' });
      expect(provider.getModel()).toBe('test-model');
    });
  });

  describe('mockToolCall()', () => {
    it('should create a tool call with auto-generated id', () => {
      const call = mockToolCall('read_file', { path: 'test.ts' });
      expect(call.name).toBe('read_file');
      expect(call.input).toEqual({ path: 'test.ts' });
      expect(call.id).toMatch(/^call_/);
    });

    it('should use provided id', () => {
      const call = mockToolCall('read_file', {}, 'custom-id');
      expect(call.id).toBe('custom-id');
    });
  });

  describe('mockToolResponse()', () => {
    it('should create a tool use response', () => {
      const response = mockToolResponse([
        mockToolCall('read_file', { path: 'test.ts' }),
      ]);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.stopReason).toBe('tool_use');
    });
  });

  describe('mockErrorResponse()', () => {
    it('should create an error response', async () => {
      const provider = createMockProvider([mockErrorResponse('Test error')]);
      await expect(provider.chat([{ role: 'user', content: 'test' }]))
        .rejects.toThrow('Test error');
    });
  });

  describe('expectMessage()', () => {
    it('should find message by string content', async () => {
      const provider = createMockProvider('Response');
      await provider.chat([{ role: 'user', content: 'Hello world' }]);

      const found = expectMessage(provider, 'user', 'Hello');
      expect(found).toBeDefined();
    });

    it('should find message by regex', async () => {
      const provider = createMockProvider('Response');
      await provider.chat([{ role: 'user', content: 'Hello world' }]);

      const found = expectMessage(provider, 'user', /world$/);
      expect(found).toBeDefined();
    });

    it('should return undefined when not found', async () => {
      const provider = createMockProvider('Response');
      await provider.chat([{ role: 'user', content: 'Hello' }]);

      const found = expectMessage(provider, 'assistant', 'Hello');
      expect(found).toBeUndefined();
    });
  });

  describe('expectSystemPrompt()', () => {
    it('should find system prompt', async () => {
      const provider = createMockProvider('Response');
      await provider.chat([{ role: 'user', content: 'test' }], undefined, 'You are a helpful assistant');

      const found = expectSystemPrompt(provider, 'helpful assistant');
      expect(found).toBeDefined();
    });
  });

  describe('getAllMessages()', () => {
    it('should return all messages across calls', async () => {
      const provider = createMockProvider('Response');
      await provider.chat([{ role: 'user', content: 'First' }]);
      await provider.chat([
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Second' },
      ]);

      const messages = getAllMessages(provider);
      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({ role: 'user', content: 'First' });
      expect(messages[3]).toEqual({ role: 'user', content: 'Second' });
    });
  });
});
