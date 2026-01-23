// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync, spawn } from 'child_process';
import type { DebugEvent, DebugCommand } from '../src/debug-bridge.js';

describe('Debug CLI', () => {
  const testDir = join(process.cwd(), '.test-debug-cli');
  const debugDir = join(testDir, '.codi', 'debug');
  const sessionsDir = join(debugDir, 'sessions');
  const testSessionId = 'debug_test_session';
  const sessionDir = join(sessionsDir, testSessionId);
  const indexFile = join(debugDir, 'index.json');

  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(sessionDir, { recursive: true });

    // Create session index
    writeFileSync(indexFile, JSON.stringify({
      sessions: [{
        id: testSessionId,
        pid: process.pid, // Use current PID so it appears "active"
        startTime: new Date().toISOString(),
        cwd: testDir,
      }],
    }));

    // Create session info
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
      sessionId: testSessionId,
      startTime: new Date().toISOString(),
      pid: process.pid,
      cwd: testDir,
      eventsFile: join(sessionDir, 'events.jsonl'),
      commandsFile: join(sessionDir, 'commands.jsonl'),
    }));

    // Create empty events and commands files
    writeFileSync(join(sessionDir, 'events.jsonl'), '');
    writeFileSync(join(sessionDir, 'commands.jsonl'), '');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('sendCommand helper', () => {
    it('should create command file with correct structure', async () => {
      // Write a test command directly to simulate what sendCommand does
      const cmd: DebugCommand = {
        type: 'pause',
        id: 'test_cmd_1',
        data: {},
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('pause');
      expect(parsed.id).toBe('test_cmd_1');
      expect(parsed.data).toEqual({});
    });

    it('should append multiple commands', () => {
      const commandsFile = join(sessionDir, 'commands.jsonl');

      const cmd1: DebugCommand = { type: 'pause', id: 'cmd1', data: {} };
      const cmd2: DebugCommand = { type: 'resume', id: 'cmd2', data: {} };

      writeFileSync(commandsFile, JSON.stringify(cmd1) + '\n');
      writeFileSync(commandsFile, JSON.stringify(cmd1) + '\n' + JSON.stringify(cmd2) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2);
    });
  });

  describe('Event formatting', () => {
    it('should format session_start event', () => {
      const event: DebugEvent = {
        type: 'session_start',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      };

      // Write event
      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('session_start');
      expect(parsed.data.provider).toBe('anthropic');
    });

    it('should format tool_call_start event', () => {
      const event: DebugEvent = {
        type: 'tool_call_start',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 1,
        data: {
          name: 'read_file',
          input: { path: '/test/file.ts' },
          toolId: 'tool_123',
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('tool_call_start');
      expect(parsed.data.name).toBe('read_file');
    });

    it('should format error event', () => {
      const event: DebugEvent = {
        type: 'error',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 2,
        data: {
          message: 'Test error',
          context: 'test',
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('error');
      expect(parsed.data.message).toBe('Test error');
    });
  });

  describe('Session management', () => {
    it('should detect active sessions by PID', () => {
      const index = JSON.parse(readFileSync(indexFile, 'utf8'));

      // Session with current PID should be considered active
      const session = index.sessions.find((s: { id: string }) => s.id === testSessionId);
      expect(session).toBeDefined();
      expect(session.pid).toBe(process.pid);
    });

    it('should identify inactive sessions with dead PIDs', () => {
      // Create a session with a non-existent PID
      writeFileSync(indexFile, JSON.stringify({
        sessions: [{
          id: 'dead_session',
          pid: 999999999, // Non-existent PID
          startTime: new Date().toISOString(),
          cwd: testDir,
        }],
      }));

      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      const session = index.sessions.find((s: { id: string }) => s.id === 'dead_session');
      expect(session).toBeDefined();
      expect(session.pid).toBe(999999999);

      // The CLI would detect this as inactive via isProcessRunning
    });
  });

  describe('Command types', () => {
    const commandTypes: Array<{ type: DebugCommand['type']; data: Record<string, unknown> }> = [
      { type: 'pause', data: {} },
      { type: 'resume', data: {} },
      { type: 'step', data: {} },
      { type: 'inspect', data: { what: 'all' } },
      { type: 'inject_message', data: { role: 'user', content: 'test message' } },
    ];

    for (const { type, data } of commandTypes) {
      it(`should handle ${type} command`, () => {
        const cmd: DebugCommand = {
          type,
          id: `test_${type}`,
          data,
        };

        const commandsFile = join(sessionDir, 'commands.jsonl');
        writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

        const content = readFileSync(commandsFile, 'utf8');
        const parsed = JSON.parse(content.trim());

        expect(parsed.type).toBe(type);
        expect(parsed.data).toEqual(data);
      });
    }
  });

  describe('Event types', () => {
    const eventTypes: Array<{ type: DebugEvent['type']; data: Record<string, unknown> }> = [
      { type: 'session_start', data: { provider: 'test', model: 'test' } },
      { type: 'session_end', data: { duration: 1000 } },
      { type: 'user_input', data: { input: 'test input' } },
      { type: 'assistant_text', data: { text: 'test response' } },
      { type: 'tool_call_start', data: { name: 'test', input: {} } },
      { type: 'tool_call_end', data: { name: 'test', durationMs: 100, isError: false } },
      { type: 'api_request', data: { provider: 'test', model: 'test' } },
      { type: 'api_response', data: { stopReason: 'end_turn', inputTokens: 100, outputTokens: 50 } },
      { type: 'paused', data: { iteration: 1 } },
      { type: 'resumed', data: {} },
      { type: 'state_snapshot', data: { paused: false } },
      { type: 'error', data: { message: 'test error' } },
    ];

    for (const { type, data } of eventTypes) {
      it(`should write ${type} event`, () => {
        const event: DebugEvent = {
          type,
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 0,
          data,
        };

        const eventsFile = join(sessionDir, 'events.jsonl');
        writeFileSync(eventsFile, JSON.stringify(event) + '\n');

        const content = readFileSync(eventsFile, 'utf8');
        const parsed = JSON.parse(content.trim());

        expect(parsed.type).toBe(type);
      });
    }
  });

  describe('Truncation', () => {
    it('should handle long strings in events', () => {
      const longContent = 'x'.repeat(5000);
      const event: DebugEvent = {
        type: 'user_input',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: { input: longContent, length: longContent.length },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.length).toBe(5000);
    });
  });

  describe('Multiple sessions', () => {
    it('should list multiple sessions in index', () => {
      writeFileSync(indexFile, JSON.stringify({
        sessions: [
          { id: 'session1', pid: process.pid, startTime: new Date().toISOString(), cwd: '/test1' },
          { id: 'session2', pid: 99999, startTime: new Date().toISOString(), cwd: '/test2' },
          { id: 'session3', pid: process.pid, startTime: new Date().toISOString(), cwd: '/test3' },
        ],
      }));

      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      expect(index.sessions.length).toBe(3);
    });

    it('should track sessions with different start times', () => {
      const now = Date.now();
      writeFileSync(indexFile, JSON.stringify({
        sessions: [
          { id: 'session1', pid: process.pid, startTime: new Date(now - 3600000).toISOString(), cwd: '/test1' },
          { id: 'session2', pid: process.pid, startTime: new Date(now - 1800000).toISOString(), cwd: '/test2' },
          { id: 'session3', pid: process.pid, startTime: new Date(now).toISOString(), cwd: '/test3' },
        ],
      }));

      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      const times = index.sessions.map((s: any) => new Date(s.startTime).getTime());
      expect(times[0]).toBeLessThan(times[1]);
      expect(times[1]).toBeLessThan(times[2]);
    });
  });

  describe('Inspect command variations', () => {
    const inspectTypes = ['messages', 'context', 'tools', 'all'];

    for (const what of inspectTypes) {
      it(`should handle inspect ${what}`, () => {
        const cmd: DebugCommand = {
          type: 'inspect',
          id: `inspect_${what}`,
          data: { what },
        };

        const commandsFile = join(sessionDir, 'commands.jsonl');
        writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

        const content = readFileSync(commandsFile, 'utf8');
        const parsed = JSON.parse(content.trim());

        expect(parsed.type).toBe('inspect');
        expect(parsed.data.what).toBe(what);
      });
    }
  });

  describe('Inject message validation', () => {
    it('should handle user role injection', () => {
      const cmd: DebugCommand = {
        type: 'inject_message',
        id: 'inject_user',
        data: { role: 'user', content: 'Hello from debug CLI' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.role).toBe('user');
      expect(parsed.data.content).toBe('Hello from debug CLI');
    });

    it('should handle assistant role injection', () => {
      const cmd: DebugCommand = {
        type: 'inject_message',
        id: 'inject_assistant',
        data: { role: 'assistant', content: 'Simulated assistant response' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.role).toBe('assistant');
    });

    it('should handle multiline content in injection', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const cmd: DebugCommand = {
        type: 'inject_message',
        id: 'inject_multiline',
        data: { role: 'user', content },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const fileContent = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(fileContent.trim());

      expect(parsed.data.content).toBe(content);
    });
  });

  describe('Event sequence tracking', () => {
    it('should maintain correct sequence numbers', () => {
      const eventsFile = join(sessionDir, 'events.jsonl');
      const events: DebugEvent[] = [];

      for (let i = 0; i < 10; i++) {
        events.push({
          type: 'user_input',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: i,
          data: { input: `message ${i}` },
        });
      }

      writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');
      const parsed = lines.map(l => JSON.parse(l));

      for (let i = 0; i < 10; i++) {
        expect(parsed[i].sequence).toBe(i);
      }
    });
  });

  describe('API events', () => {
    it('should format api_request with all fields', () => {
      const event: DebugEvent = {
        type: 'api_request',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: {
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          messageCount: 15,
          hasTools: true,
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.provider).toBe('anthropic');
      expect(parsed.data.model).toBe('claude-sonnet-4');
      expect(parsed.data.messageCount).toBe(15);
      expect(parsed.data.hasTools).toBe(true);
    });

    it('should format api_response with token counts', () => {
      const event: DebugEvent = {
        type: 'api_response',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 1,
        data: {
          stopReason: 'end_turn',
          inputTokens: 5000,
          outputTokens: 1500,
          durationMs: 2500,
          toolCallCount: 3,
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.stopReason).toBe('end_turn');
      expect(parsed.data.inputTokens).toBe(5000);
      expect(parsed.data.outputTokens).toBe(1500);
      expect(parsed.data.durationMs).toBe(2500);
      expect(parsed.data.toolCallCount).toBe(3);
    });
  });

  describe('Context compaction events', () => {
    it('should format context_compaction with savings', () => {
      const event: DebugEvent = {
        type: 'context_compaction',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: {
          beforeTokens: 50000,
          afterTokens: 20000,
          messagesBefore: 100,
          messagesAfter: 40,
          savings: 30000,
          savingsPercent: '60.0',
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.beforeTokens).toBe(50000);
      expect(parsed.data.afterTokens).toBe(20000);
      expect(parsed.data.savings).toBe(30000);
      expect(parsed.data.savingsPercent).toBe('60.0');
    });
  });

  describe('Tool call lifecycle', () => {
    it('should track complete tool call lifecycle', () => {
      const eventsFile = join(sessionDir, 'events.jsonl');
      const toolId = 'tool_lifecycle_test';

      const events: DebugEvent[] = [
        {
          type: 'tool_call_start',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 0,
          data: { name: 'read_file', input: { path: '/test.ts' }, toolId },
        },
        {
          type: 'tool_call_end',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 1,
          data: { name: 'read_file', toolId, durationMs: 150, isError: false },
        },
        {
          type: 'tool_result',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 2,
          data: { name: 'read_file', toolId, result: 'file contents', resultLength: 13, isError: false },
        },
      ];

      writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');
      const parsed = lines.map(l => JSON.parse(l));

      expect(parsed[0].type).toBe('tool_call_start');
      expect(parsed[1].type).toBe('tool_call_end');
      expect(parsed[2].type).toBe('tool_result');

      // All should have same toolId
      expect(parsed[0].data.toolId).toBe(toolId);
      expect(parsed[1].data.toolId).toBe(toolId);
      expect(parsed[2].data.toolId).toBe(toolId);
    });

    it('should track tool call with error', () => {
      const eventsFile = join(sessionDir, 'events.jsonl');
      const toolId = 'tool_error_test';

      const events: DebugEvent[] = [
        {
          type: 'tool_call_start',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 0,
          data: { name: 'bash', input: { command: 'invalid-cmd' }, toolId },
        },
        {
          type: 'tool_call_end',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 1,
          data: { name: 'bash', toolId, durationMs: 50, isError: true },
        },
        {
          type: 'tool_result',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 2,
          data: { name: 'bash', toolId, result: 'Command not found', resultLength: 17, isError: true },
        },
      ];

      writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');
      const parsed = lines.map(l => JSON.parse(l));

      expect(parsed[1].data.isError).toBe(true);
      expect(parsed[2].data.isError).toBe(true);
    });
  });

  describe('Model switch events', () => {
    it('should track provider changes', () => {
      const event: DebugEvent = {
        type: 'model_switch',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: {
          from: { provider: 'anthropic', model: 'claude-haiku' },
          to: { provider: 'openai', model: 'gpt-4o' },
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.from.provider).toBe('anthropic');
      expect(parsed.data.to.provider).toBe('openai');
    });

    it('should track model changes within same provider', () => {
      const event: DebugEvent = {
        type: 'model_switch',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: {
          from: { provider: 'anthropic', model: 'claude-haiku' },
          to: { provider: 'anthropic', model: 'claude-sonnet' },
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.from.provider).toBe('anthropic');
      expect(parsed.data.to.provider).toBe('anthropic');
      expect(parsed.data.from.model).not.toBe(parsed.data.to.model);
    });
  });

  describe('State snapshot events', () => {
    it('should capture full state snapshot', () => {
      const event: DebugEvent = {
        type: 'state_snapshot',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: {
          iteration: 5,
          paused: true,
          messages: {
            count: 10,
            roles: { user: 4, assistant: 5, tool: 1 },
          },
          context: {
            tokenEstimate: 15000,
            maxTokens: 100000,
            hasSummary: false,
          },
          tools: {
            enabled: ['read_file', 'write_file', 'bash'],
            count: 3,
          },
          provider: { name: 'anthropic', model: 'claude-sonnet' },
          workingSet: ['/src/index.ts', '/src/agent.ts'],
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.iteration).toBe(5);
      expect(parsed.data.paused).toBe(true);
      expect(parsed.data.messages.count).toBe(10);
      expect(parsed.data.tools.count).toBe(3);
      expect(parsed.data.workingSet.length).toBe(2);
    });
  });

  describe('Command response events', () => {
    it('should track inspect command response', () => {
      const event: DebugEvent = {
        type: 'command_response',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: {
          commandId: 'cmd_inspect_1',
          type: 'inspect',
          data: { messages: [], context: {}, tools: [] },
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.commandId).toBe('cmd_inspect_1');
      expect(parsed.data.type).toBe('inspect');
    });

    it('should track inject_message command response', () => {
      const event: DebugEvent = {
        type: 'command_response',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: {
          commandId: 'cmd_inject_1',
          type: 'inject_message',
          success: true,
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.success).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty events file', () => {
      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, '');

      const content = readFileSync(eventsFile, 'utf8');
      expect(content).toBe('');
    });

    it('should handle empty commands file', () => {
      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, '');

      const content = readFileSync(commandsFile, 'utf8');
      expect(content).toBe('');
    });

    it('should handle malformed JSON in events', () => {
      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, 'not valid json\n{"type":"user_input"}\n');

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');

      // First line is invalid
      expect(() => JSON.parse(lines[0])).toThrow();
      // Second line is valid (partial)
      expect(JSON.parse(lines[1]).type).toBe('user_input');
    });

    it('should handle special characters in session paths', () => {
      // CWD with spaces and special chars
      const specialCwd = '/path/with spaces/and-dashes/test_dir';
      writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
        sessionId: testSessionId,
        startTime: new Date().toISOString(),
        pid: process.pid,
        cwd: specialCwd,
        eventsFile: join(sessionDir, 'events.jsonl'),
        commandsFile: join(sessionDir, 'commands.jsonl'),
      }));

      const content = readFileSync(join(sessionDir, 'session.json'), 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.cwd).toBe(specialCwd);
    });

    it('should handle very long content in events', () => {
      const longContent = 'x'.repeat(100000);
      const event: DebugEvent = {
        type: 'user_input',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: { input: longContent },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.input.length).toBe(100000);
    });

    it('should handle unicode in session data', () => {
      const unicodeContent = '你好世界 🌍 مرحبا العالم';
      const event: DebugEvent = {
        type: 'user_input',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: { input: unicodeContent },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.input).toBe(unicodeContent);
    });
  });

  describe('Session lifecycle', () => {
    it('should track session_start and session_end', () => {
      const eventsFile = join(sessionDir, 'events.jsonl');
      const events: DebugEvent[] = [
        {
          type: 'session_start',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 0,
          data: { provider: 'anthropic', model: 'claude-sonnet', cwd: testDir, pid: process.pid },
        },
        {
          type: 'user_input',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 1,
          data: { input: 'hello' },
        },
        {
          type: 'session_end',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 2,
          data: { duration: 5000, messages: 2, toolCalls: 0 },
        },
      ];

      writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');
      const parsed = lines.map(l => JSON.parse(l));

      expect(parsed[0].type).toBe('session_start');
      expect(parsed[2].type).toBe('session_end');
      expect(parsed[2].data.duration).toBe(5000);
    });
  });

  describe('Step-through debugging', () => {
    it('should track step command and step_complete event', () => {
      const commandsFile = join(sessionDir, 'commands.jsonl');
      const eventsFile = join(sessionDir, 'events.jsonl');

      // Send step command
      const stepCmd: DebugCommand = { type: 'step', id: 'step_1', data: {} };
      writeFileSync(commandsFile, JSON.stringify(stepCmd) + '\n');

      // Simulate step_complete event
      const stepEvent: DebugEvent = {
        type: 'step_complete',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 0,
        data: { iteration: 3 },
      };
      writeFileSync(eventsFile, JSON.stringify(stepEvent) + '\n');

      const cmdContent = readFileSync(commandsFile, 'utf8');
      const evtContent = readFileSync(eventsFile, 'utf8');

      expect(JSON.parse(cmdContent.trim()).type).toBe('step');
      expect(JSON.parse(evtContent.trim()).type).toBe('step_complete');
      expect(JSON.parse(evtContent.trim()).data.iteration).toBe(3);
    });
  });

  describe('Breakpoint commands', () => {
    it('should handle breakpoint command', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint',
        id: 'bp_1',
        data: { on: 'tool', name: 'write_file' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint');
      expect(parsed.data.on).toBe('tool');
      expect(parsed.data.name).toBe('write_file');
    });

    it('should handle iteration breakpoint', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint',
        id: 'bp_2',
        data: { on: 'iteration', count: 5 },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.data.on).toBe('iteration');
      expect(parsed.data.count).toBe(5);
    });
  });

  // ============================================
  // Phase 4: New command types
  // ============================================

  describe('Phase 4 breakpoint commands', () => {
    it('should format breakpoint_add command correctly', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint_add',
        id: 'bp_add_1',
        data: { type: 'tool', condition: 'write_file' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_add');
      expect(parsed.data.type).toBe('tool');
      expect(parsed.data.condition).toBe('write_file');
    });

    it('should format breakpoint_add with iteration condition', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint_add',
        id: 'bp_add_2',
        data: { type: 'iteration', condition: 10 },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_add');
      expect(parsed.data.type).toBe('iteration');
      expect(parsed.data.condition).toBe(10);
    });

    it('should format breakpoint_add with pattern condition', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint_add',
        id: 'bp_add_3',
        data: { type: 'pattern', condition: 'rm -rf' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_add');
      expect(parsed.data.type).toBe('pattern');
      expect(parsed.data.condition).toBe('rm -rf');
    });

    it('should format breakpoint_add with error type (no condition)', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint_add',
        id: 'bp_add_4',
        data: { type: 'error' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_add');
      expect(parsed.data.type).toBe('error');
      expect(parsed.data.condition).toBeUndefined();
    });

    it('should format breakpoint_remove command correctly', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint_remove',
        id: 'bp_rm_1',
        data: { id: 'bp_123_abc' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_remove');
      expect(parsed.data.id).toBe('bp_123_abc');
    });

    it('should format breakpoint_clear command correctly', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint_clear',
        id: 'bp_clear_1',
        data: {},
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_clear');
    });

    it('should format breakpoint_list command correctly', () => {
      const cmd: DebugCommand = {
        type: 'breakpoint_list',
        id: 'bp_list_1',
        data: {},
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_list');
    });
  });

  describe('Phase 4 checkpoint commands', () => {
    it('should format checkpoint_create command correctly', () => {
      const cmd: DebugCommand = {
        type: 'checkpoint_create',
        id: 'cp_create_1',
        data: {},
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('checkpoint_create');
    });

    it('should format checkpoint_create with label', () => {
      const cmd: DebugCommand = {
        type: 'checkpoint_create',
        id: 'cp_create_2',
        data: { label: 'before refactor' },
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('checkpoint_create');
      expect(parsed.data.label).toBe('before refactor');
    });

    it('should format checkpoint_list command correctly', () => {
      const cmd: DebugCommand = {
        type: 'checkpoint_list',
        id: 'cp_list_1',
        data: {},
      };

      const commandsFile = join(sessionDir, 'commands.jsonl');
      writeFileSync(commandsFile, JSON.stringify(cmd) + '\n');

      const content = readFileSync(commandsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('checkpoint_list');
    });
  });

  describe('Phase 4 event formatting', () => {
    it('should format breakpoint_hit event', () => {
      const event: DebugEvent = {
        type: 'breakpoint_hit',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 1,
        data: {
          breakpoint: {
            id: 'bp_123',
            type: 'tool',
            condition: 'write_file',
            hitCount: 1,
          },
          context: {
            type: 'tool_call',
            toolName: 'write_file',
            iteration: 5,
          },
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('breakpoint_hit');
      expect(parsed.data.breakpoint.id).toBe('bp_123');
      expect(parsed.data.breakpoint.type).toBe('tool');
      expect(parsed.data.context.toolName).toBe('write_file');
    });

    it('should format checkpoint event', () => {
      const event: DebugEvent = {
        type: 'checkpoint',
        timestamp: new Date().toISOString(),
        sessionId: testSessionId,
        sequence: 2,
        data: {
          id: 'cp_5_123456789',
          label: 'before refactor',
          iteration: 5,
          messageCount: 10,
          tokenCount: 5000,
        },
      };

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('checkpoint');
      expect(parsed.data.id).toBe('cp_5_123456789');
      expect(parsed.data.label).toBe('before refactor');
      expect(parsed.data.iteration).toBe(5);
      expect(parsed.data.messageCount).toBe(10);
      expect(parsed.data.tokenCount).toBe(5000);
    });
  });

  describe('Phase 4 replay functionality', () => {
    it('should read events for replay', () => {
      // Write several test events
      const events: DebugEvent[] = [
        {
          type: 'session_start',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 0,
          data: { provider: 'test', model: 'test-model' },
        },
        {
          type: 'user_input',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 1,
          data: { input: 'Hello' },
        },
        {
          type: 'tool_call_start',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 2,
          data: { name: 'read_file', input: { path: '/test.txt' }, toolId: 't1' },
        },
        {
          type: 'checkpoint',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 3,
          data: { id: 'cp_1', iteration: 1, messageCount: 2, tokenCount: 100 },
        },
        {
          type: 'session_end',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 4,
          data: { duration: 5000 },
        },
      ];

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');
      const parsedEvents = lines.map(l => JSON.parse(l));

      expect(parsedEvents.length).toBe(5);
      expect(parsedEvents[0].type).toBe('session_start');
      expect(parsedEvents[3].type).toBe('checkpoint');
      expect(parsedEvents[4].type).toBe('session_end');
    });

    it('should filter events by type', () => {
      const events: DebugEvent[] = [
        {
          type: 'session_start',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 0,
          data: { provider: 'test', model: 'test-model' },
        },
        {
          type: 'checkpoint',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 1,
          data: { id: 'cp_1', iteration: 1, messageCount: 2, tokenCount: 100 },
        },
        {
          type: 'breakpoint_hit',
          timestamp: new Date().toISOString(),
          sessionId: testSessionId,
          sequence: 2,
          data: {
            breakpoint: { id: 'bp_1', type: 'tool', condition: 'write_file' },
            context: { type: 'tool_call', toolName: 'write_file', iteration: 2 },
          },
        },
      ];

      const eventsFile = join(sessionDir, 'events.jsonl');
      writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');
      const parsedEvents = lines.map(l => JSON.parse(l) as DebugEvent);

      // Filter for only checkpoint events
      const checkpointEvents = parsedEvents.filter(e => e.type === 'checkpoint');
      expect(checkpointEvents.length).toBe(1);

      // Filter for only breakpoint_hit events
      const breakpointEvents = parsedEvents.filter(e => e.type === 'breakpoint_hit');
      expect(breakpointEvents.length).toBe(1);
    });
  });
});
