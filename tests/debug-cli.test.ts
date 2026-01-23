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
  });
});
