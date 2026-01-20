// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import {
  setupMockE2E,
  cleanupMockE2E,
  readMockLog,
  textResponse,
  toolResponse,
  toolCall,
  conversationSequence,
  type MockE2ESession,
} from './helpers/mock-e2e.js';
import {
  MockServer,
  serverTextResponse,
  serverToolResponse,
  serverErrorResponse,
} from './helpers/mock-server.js';
import { MockProvider } from '../src/providers/mock.js';

describe('Mock E2E Helpers', () => {
  describe('setupMockE2E', () => {
    let session: MockE2ESession;

    afterEach(() => {
      if (session) {
        cleanupMockE2E(session);
      }
    });

    it('should create mock responses file', () => {
      session = setupMockE2E([textResponse('Hello!')]);

      expect(existsSync(session.responsesFile)).toBe(true);
      expect(session.env.CODI_MOCK_FILE).toBe(session.responsesFile);
    });

    it('should support logging', () => {
      session = setupMockE2E([textResponse('Hello!')], { enableLogging: true });

      expect(session.logFile).toBeDefined();
      expect(session.env.CODI_MOCK_LOG).toBe(session.logFile);
    });

    it('should work with MockProvider.fromFile', () => {
      session = setupMockE2E([
        textResponse('First response'),
        textResponse('Second response'),
      ]);

      const provider = MockProvider.fromFile(session.responsesFile);
      return Promise.all([
        provider.chat([{ role: 'user', content: 'a' }]),
        provider.chat([{ role: 'user', content: 'b' }]),
      ]).then(([r1, r2]) => {
        expect(r1.content).toBe('First response');
        expect(r2.content).toBe('Second response');
      });
    });

    it('should support tool responses', async () => {
      session = setupMockE2E([
        toolResponse([toolCall('read_file', { path: 'test.ts' })]),
        textResponse('File contains test code.'),
      ]);

      const provider = MockProvider.fromFile(session.responsesFile);

      const r1 = await provider.chat([{ role: 'user', content: 'Read test.ts' }]);
      expect(r1.toolCalls).toHaveLength(1);
      expect(r1.toolCalls[0].name).toBe('read_file');
      expect(r1.stopReason).toBe('tool_use');

      const r2 = await provider.chat([{ role: 'user', content: 'continue' }]);
      expect(r2.content).toBe('File contains test code.');
    });

    it('should support logging interactions', async () => {
      session = setupMockE2E([textResponse('Hello!')], { enableLogging: true });

      const provider = new MockProvider({
        responsesFile: session.responsesFile,
        logFile: session.logFile,
      });

      await provider.chat([{ role: 'user', content: 'Hi there' }]);

      const logs = readMockLog(session);
      expect(logs).toHaveLength(2); // call + response
      expect(logs[0].type).toBe('call');
      expect(logs[1].type).toBe('response');
    });
  });

  describe('conversationSequence', () => {
    let session: MockE2ESession;

    afterEach(() => {
      if (session) {
        cleanupMockE2E(session);
      }
    });

    it('should create a conversation with tool calls', async () => {
      const responses = conversationSequence([
        { ai: 'Let me read that file.' },
        { tool: 'read_file', input: { path: 'test.ts' } },
        { ai: 'The file contains a test function.' },
      ]);

      session = setupMockE2E(responses);
      const provider = MockProvider.fromFile(session.responsesFile);

      // First response: text + tool call
      const r1 = await provider.chat([{ role: 'user', content: 'Read test.ts' }]);
      expect(r1.content).toBe('Let me read that file.');
      expect(r1.toolCalls).toHaveLength(1);
      expect(r1.toolCalls[0].name).toBe('read_file');

      // Second response: after tool result
      const r2 = await provider.chat([{ role: 'user', content: 'tool result' }]);
      expect(r2.content).toBe('The file contains a test function.');
    });

    it('should handle multiple tool calls', () => {
      const responses = conversationSequence([
        { ai: 'I will check multiple files.' },
        { tool: 'glob', input: { pattern: '*.ts' } },
        { ai: 'Found some files. Let me read one.' },
        { tool: 'read_file', input: { path: 'index.ts' } },
        { ai: 'Done analyzing the codebase.' },
      ]);

      expect(responses).toHaveLength(4);
      expect(responses[0].toolCalls?.[0].name).toBe('glob');
      expect(responses[2].toolCalls?.[0].name).toBe('read_file');
    });
  });
});

describe('MockServer', () => {
  let server: MockServer;

  beforeEach(() => {
    server = new MockServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('basic functionality', () => {
    it('should start and stop', async () => {
      const url = await server.start();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await server.stop();
    });

    it('should respond to requests', async () => {
      server.addResponses([serverTextResponse('Hello from mock server!')]);
      const url = await server.start();

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      const data = await response.json();
      expect(data.choices[0].message.content).toBe('Hello from mock server!');
    });

    it('should record request history', async () => {
      server.addResponses([serverTextResponse('Response')]);
      const url = await server.start();

      await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test',
          messages: [{ role: 'user', content: 'Test message' }],
        }),
      });

      expect(server.getRequestHistory()).toHaveLength(1);
      const req = server.getLastRequest();
      expect(req?.body).toHaveProperty('messages');
    });

    it('should handle error responses', async () => {
      server.addResponses([serverErrorResponse('Invalid API key', 'authentication_error')]);
      const url = await server.start();

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message).toBe('Invalid API key');
    });
  });

  describe('response queue', () => {
    it('should return responses in order', async () => {
      server.addResponses([
        serverTextResponse('First'),
        serverTextResponse('Second'),
        serverTextResponse('Third'),
      ]);
      const url = await server.start();

      const makeRequest = () =>
        fetch(`${url}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'test', messages: [] }),
        }).then(r => r.json());

      const r1 = await makeRequest();
      const r2 = await makeRequest();
      const r3 = await makeRequest();

      expect(r1.choices[0].message.content).toBe('First');
      expect(r2.choices[0].message.content).toBe('Second');
      expect(r3.choices[0].message.content).toBe('Third');
    });

    it('should use default response when queue empty', async () => {
      server.setDefaultResponse(serverTextResponse('Default response'));
      const url = await server.start();

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      });

      const data = await response.json();
      expect(data.choices[0].message.content).toBe('Default response');
    });
  });

  describe('tool calls', () => {
    it('should return tool calls in OpenAI format', async () => {
      server.addResponses([
        serverToolResponse([
          { id: 'call_1', name: 'read_file', input: { path: 'test.ts' } },
        ]),
      ]);
      const url = await server.start();

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      });

      const data = await response.json();
      expect(data.choices[0].message.tool_calls).toHaveLength(1);
      expect(data.choices[0].message.tool_calls[0].function.name).toBe('read_file');
      expect(data.choices[0].finish_reason).toBe('tool_calls');
    });
  });

  describe('streaming', () => {
    it('should stream responses when requested', async () => {
      server.addResponses([serverTextResponse('Hello World!')]);
      const url = await server.start();

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test',
          messages: [],
          stream: true,
        }),
      });

      expect(response.headers.get('content-type')).toBe('text/event-stream');

      const text = await response.text();
      expect(text).toContain('data:');
      expect(text).toContain('[DONE]');
      expect(text).toContain('Hello');
    });
  });

  describe('reset', () => {
    it('should clear state on reset', async () => {
      server.addResponses([serverTextResponse('Test')]);
      const url = await server.start();

      await fetch(`${url}/test`, { method: 'POST' });

      expect(server.getRequestHistory()).toHaveLength(1);

      server.reset();

      expect(server.getRequestHistory()).toHaveLength(0);
    });
  });
});
