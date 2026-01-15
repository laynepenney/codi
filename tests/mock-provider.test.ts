// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { existsSync, unlinkSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MockProvider, type MockResponse, type MockProviderConfig } from '../src/providers/mock.js';
import {
  createMockProvider,
  mockTextResponse,
  mockToolResponse,
  mockToolCall,
  mockErrorResponse,
  expectToolCall,
  expectMessage,
  expectSystemPrompt,
  getAllMessages,
} from './helpers/mock-provider.js';
import type { Message, ToolDefinition } from '../src/types.js';

describe('MockProvider', () => {
  describe('constructor', () => {
    it('creates with default configuration', () => {
      const provider = new MockProvider();
      expect(provider.getName()).toBe('Mock');
      expect(provider.getModel()).toBe('mock-model');
      expect(provider.supportsToolUse()).toBe(true);
      expect(provider.supportsVision()).toBe(false);
    });

    it('accepts custom model name', () => {
      const provider = new MockProvider({ model: 'custom-mock' });
      expect(provider.getModel()).toBe('custom-mock');
    });

    it('configures tool support', () => {
      const withTools = new MockProvider({ supportsTools: true });
      const withoutTools = new MockProvider({ supportsTools: false });
      expect(withTools.supportsToolUse()).toBe(true);
      expect(withoutTools.supportsToolUse()).toBe(false);
    });

    it('configures vision support', () => {
      const withVision = new MockProvider({ supportsVision: true });
      const withoutVision = new MockProvider({ supportsVision: false });
      expect(withVision.supportsVision()).toBe(true);
      expect(withoutVision.supportsVision()).toBe(false);
    });
  });

  describe('chat', () => {
    it('returns default response when no queue', async () => {
      const provider = new MockProvider({ defaultResponse: 'Hello!' });
      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(response.content).toBe('Hello!');
      expect(response.stopReason).toBe('end_turn');
    });

    it('returns queued responses in order', async () => {
      const provider = new MockProvider({
        responses: [
          { content: 'First' },
          { content: 'Second' },
          { content: 'Third' },
        ],
      });

      const r1 = await provider.chat([{ role: 'user', content: 'msg1' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'msg2' }]);
      const r3 = await provider.chat([{ role: 'user', content: 'msg3' }]);

      expect(r1.content).toBe('First');
      expect(r2.content).toBe('Second');
      expect(r3.content).toBe('Third');
    });

    it('falls back to default when queue exhausted', async () => {
      const provider = new MockProvider({
        responses: [{ content: 'Only one' }],
        defaultResponse: 'Default fallback',
      });

      await provider.chat([{ role: 'user', content: 'msg1' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'msg2' }]);

      expect(r2.content).toBe('Default fallback');
    });

    it('returns tool calls', async () => {
      const provider = new MockProvider({
        responses: [{
          toolCalls: [{
            id: 'call_1',
            name: 'read_file',
            input: { path: 'test.ts' },
          }],
        }],
      });

      const response = await provider.chat([{ role: 'user', content: 'Read file' }]);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('read_file');
      expect(response.stopReason).toBe('tool_use');
    });

    it('throws error when configured', async () => {
      const provider = new MockProvider({
        responses: [{ error: new Error('API Error') }],
      });

      await expect(provider.chat([{ role: 'user', content: 'fail' }]))
        .rejects.toThrow('API Error');
    });

    it('includes usage information', async () => {
      const provider = new MockProvider({
        responses: [{
          content: 'Response',
          usage: { inputTokens: 50, outputTokens: 100 },
        }],
      });

      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(response.usage).toEqual({ inputTokens: 50, outputTokens: 100 });
    });
  });

  describe('streamChat', () => {
    it('calls onChunk for each chunk', async () => {
      const provider = new MockProvider({
        responses: [{ content: 'Hello World' }],
        streamChunkSize: 5,
      });

      const chunks: string[] = [];
      await provider.streamChat(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        (chunk) => chunks.push(chunk)
      );

      expect(chunks).toEqual(['Hello', ' Worl', 'd']);
    });

    it('respects stream delay', async () => {
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

      // Should take at least 20ms (2 chunks * 10ms)
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });

    it('returns same response as chat', async () => {
      const provider = new MockProvider({
        responses: [
          { content: 'Stream response', toolCalls: [] },
        ],
      });

      const response = await provider.streamChat([{ role: 'user', content: 'Hi' }]);
      expect(response.content).toBe('Stream response');
      expect(response.stopReason).toBe('end_turn');
    });
  });

  describe('call history', () => {
    it('records all calls', async () => {
      const provider = new MockProvider();

      await provider.chat([{ role: 'user', content: 'First' }]);
      await provider.chat([{ role: 'user', content: 'Second' }]);

      expect(provider.getCallCount()).toBe(2);
      const history = provider.getCallHistory();
      expect(history[0].messages[0].content).toBe('First');
      expect(history[1].messages[0].content).toBe('Second');
    });

    it('records method type', async () => {
      const provider = new MockProvider();

      await provider.chat([{ role: 'user', content: 'chat' }]);
      await provider.streamChat([{ role: 'user', content: 'stream' }]);

      const history = provider.getCallHistory();
      expect(history[0].method).toBe('chat');
      expect(history[1].method).toBe('streamChat');
    });

    it('records tools and system prompt', async () => {
      const provider = new MockProvider();
      const tools: ToolDefinition[] = [{
        name: 'test_tool',
        description: 'Test',
        input_schema: { type: 'object', properties: {} },
      }];

      await provider.chat(
        [{ role: 'user', content: 'Hi' }],
        tools,
        'System prompt'
      );

      const lastCall = provider.getLastCall();
      expect(lastCall?.tools).toHaveLength(1);
      expect(lastCall?.tools?.[0].name).toBe('test_tool');
      expect(lastCall?.systemPrompt).toBe('System prompt');
    });

    it('deep clones messages to prevent mutation', async () => {
      const provider = new MockProvider();
      const messages: Message[] = [{ role: 'user', content: 'Original' }];

      await provider.chat(messages);
      messages[0].content = 'Mutated';

      const history = provider.getCallHistory();
      expect(history[0].messages[0].content).toBe('Original');
    });

    it('getLastCall returns undefined when no calls', () => {
      const provider = new MockProvider();
      expect(provider.getLastCall()).toBeUndefined();
    });

    it('reset clears history and queue', async () => {
      const provider = new MockProvider({
        responses: [{ content: 'A' }, { content: 'B' }],
      });

      await provider.chat([{ role: 'user', content: 'msg' }]);
      expect(provider.getCallCount()).toBe(1);

      provider.reset();
      expect(provider.getCallCount()).toBe(0);
      expect(provider.getCallHistory()).toEqual([]);

      // Queue should also be reset
      const response = await provider.chat([{ role: 'user', content: 'msg' }]);
      expect(response.content).toBe('Mock response'); // Default
    });
  });

  describe('addResponses', () => {
    it('adds responses to the queue', async () => {
      const provider = new MockProvider();
      provider.addResponses([
        { content: 'Added 1' },
        { content: 'Added 2' },
      ]);

      const r1 = await provider.chat([{ role: 'user', content: 'Hi' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'Hi' }]);

      expect(r1.content).toBe('Added 1');
      expect(r2.content).toBe('Added 2');
    });
  });

  describe('setDefaultResponse', () => {
    it('changes the default response', async () => {
      const provider = new MockProvider({ defaultResponse: 'Original' });
      provider.setDefaultResponse('Changed');

      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(response.content).toBe('Changed');
    });
  });

  describe('file-based configuration', () => {
    const testDir = join(tmpdir(), 'codi-mock-test');
    const testFile = join(testDir, 'responses.json');

    beforeEach(() => {
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testFile)) {
        unlinkSync(testFile);
      }
    });

    it('loads responses from file', async () => {
      writeFileSync(testFile, JSON.stringify({
        responses: [
          { content: 'From file' },
        ],
        defaultResponse: 'File default',
      }));

      const provider = new MockProvider({ responsesFile: testFile });
      const r1 = await provider.chat([{ role: 'user', content: 'Hi' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'Hi' }]);

      expect(r1.content).toBe('From file');
      expect(r2.content).toBe('File default');
    });

    it('loads config options from file', () => {
      writeFileSync(testFile, JSON.stringify({
        config: {
          supportsTools: false,
          supportsVision: true,
          model: 'file-model',
        },
      }));

      const provider = new MockProvider({ responsesFile: testFile });
      expect(provider.supportsToolUse()).toBe(false);
      expect(provider.supportsVision()).toBe(true);
      expect(provider.getModel()).toBe('file-model');
    });

    it('throws if file not found', () => {
      expect(() => new MockProvider({ responsesFile: '/nonexistent/file.json' }))
        .toThrow('Mock responses file not found');
    });

    it('fromFile static method works', async () => {
      writeFileSync(testFile, JSON.stringify({
        responses: [{ content: 'Static method' }],
      }));

      const provider = MockProvider.fromFile(testFile);
      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(response.content).toBe('Static method');
    });
  });

  describe('log file', () => {
    const testDir = join(tmpdir(), 'codi-mock-log-test');
    const logFile = join(testDir, 'mock.log');

    afterEach(() => {
      if (existsSync(logFile)) {
        unlinkSync(logFile);
      }
    });

    it('logs calls and responses to file', async () => {
      const provider = new MockProvider({
        logFile,
        responses: [{ content: 'Logged response' }],
      });

      await provider.chat([{ role: 'user', content: 'Test message' }]);

      expect(existsSync(logFile)).toBe(true);
      const content = readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2); // call + response

      const callLog = JSON.parse(lines[0]);
      expect(callLog.type).toBe('call');
      expect(callLog.data.method).toBe('chat');

      const responseLog = JSON.parse(lines[1]);
      expect(responseLog.type).toBe('response');
      expect(responseLog.data.content).toBe('Logged response');
    });
  });
});

describe('Test Helper Functions', () => {
  describe('createMockProvider', () => {
    it('creates with string response', async () => {
      const provider = createMockProvider('Simple response');
      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(response.content).toBe('Simple response');
    });

    it('creates with response array', async () => {
      const provider = createMockProvider([
        mockTextResponse('First'),
        mockTextResponse('Second'),
      ]);

      const r1 = await provider.chat([{ role: 'user', content: 'Hi' }]);
      const r2 = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(r1.content).toBe('First');
      expect(r2.content).toBe('Second');
    });

    it('creates with config object', async () => {
      const provider = createMockProvider({
        responses: [mockTextResponse('Config')],
        supportsVision: true,
      });

      expect(provider.supportsVision()).toBe(true);
      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(response.content).toBe('Config');
    });
  });

  describe('mockToolResponse', () => {
    it('creates tool response with correct stop reason', async () => {
      const provider = createMockProvider([
        mockToolResponse([mockToolCall('test_tool', { arg: 'value' })]),
      ]);

      const response = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(response.stopReason).toBe('tool_use');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('test_tool');
    });
  });

  describe('mockErrorResponse', () => {
    it('creates error response', async () => {
      const provider = createMockProvider([mockErrorResponse('Test error')]);
      await expect(provider.chat([{ role: 'user', content: 'Hi' }]))
        .rejects.toThrow('Test error');
    });
  });

  describe('expectToolCall', () => {
    it('returns call when tool is present', async () => {
      const provider = new MockProvider();
      const tools: ToolDefinition[] = [{
        name: 'my_tool',
        description: 'Test',
        input_schema: { type: 'object', properties: {} },
      }];

      await provider.chat([{ role: 'user', content: 'Hi' }], tools);
      const call = expectToolCall(provider, 'my_tool');
      expect(call).toBeDefined();
    });

    it('returns undefined when tool not present', async () => {
      const provider = new MockProvider();
      await provider.chat([{ role: 'user', content: 'Hi' }]);
      const call = expectToolCall(provider, 'nonexistent');
      expect(call).toBeUndefined();
    });
  });

  describe('expectMessage', () => {
    it('finds message by string', async () => {
      const provider = new MockProvider();
      await provider.chat([{ role: 'user', content: 'Find this text' }]);
      const call = expectMessage(provider, 'user', 'this text');
      expect(call).toBeDefined();
    });

    it('finds message by regex', async () => {
      const provider = new MockProvider();
      await provider.chat([{ role: 'user', content: 'Pattern: 12345' }]);
      const call = expectMessage(provider, 'user', /Pattern: \d+/);
      expect(call).toBeDefined();
    });

    it('returns undefined when not found', async () => {
      const provider = new MockProvider();
      await provider.chat([{ role: 'user', content: 'Something else' }]);
      const call = expectMessage(provider, 'user', 'not here');
      expect(call).toBeUndefined();
    });
  });

  describe('expectSystemPrompt', () => {
    it('finds system prompt by string', async () => {
      const provider = new MockProvider();
      await provider.chat(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        'You are a helpful assistant'
      );
      const call = expectSystemPrompt(provider, 'helpful assistant');
      expect(call).toBeDefined();
    });

    it('finds system prompt by regex', async () => {
      const provider = new MockProvider();
      await provider.chat(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        'Version: 1.2.3'
      );
      const call = expectSystemPrompt(provider, /Version: \d+\.\d+\.\d+/);
      expect(call).toBeDefined();
    });
  });

  describe('getAllMessages', () => {
    it('returns all messages across calls', async () => {
      const provider = new MockProvider();
      await provider.chat([{ role: 'user', content: 'First' }]);
      await provider.chat([
        { role: 'user', content: 'Second' },
        { role: 'assistant', content: 'Response' },
      ]);

      const messages = getAllMessages(provider);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Response');
    });
  });
});
