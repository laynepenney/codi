// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// Mock the homedir to use a temp directory
const mockHomeDir = mkdtempSync(join(tmpdir(), 'codi-debug-test-'));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => mockHomeDir,
  };
});

// Import after mocking
const {
  DebugBridge,
  getDebugBridge,
  initDebugBridge,
  isDebugBridgeEnabled,
  getDebugDir,
  getSessionsDir,
  getCurrentSessionLink,
  getSessionIndexFile,
} = await import('../src/debug-bridge.js');

describe('Debug Bridge', () => {
  let bridge: InstanceType<typeof DebugBridge>;

  beforeEach(() => {
    // Create a fresh bridge instance for each test
    bridge = new DebugBridge();
  });

  afterEach(() => {
    // Clean up
    bridge.shutdown();
  });

  describe('DebugBridge class', () => {
    it('should not be enabled by default', () => {
      expect(bridge.isEnabled()).toBe(false);
    });

    it('should be enabled after calling enable()', () => {
      bridge.enable();
      expect(bridge.isEnabled()).toBe(true);
    });

    it('should generate a unique session ID', () => {
      const id = bridge.getSessionId();
      expect(id).toMatch(/^debug_\d{8}_\d{6}_[a-z0-9]{4}$/);
    });

    it('should return the events file path after enable', () => {
      bridge.enable();
      const path = bridge.getEventsFile();
      expect(path).toContain('.codi');
      expect(path).toContain('debug');
      expect(path).toContain('sessions');
      expect(path).toContain('events.jsonl');
    });

    it('should return the commands file path after enable', () => {
      bridge.enable();
      const path = bridge.getCommandsFile();
      expect(path).toContain('.codi');
      expect(path).toContain('debug');
      expect(path).toContain('sessions');
      expect(path).toContain('commands.jsonl');
    });
  });

  describe('Event emission', () => {
    beforeEach(() => {
      bridge.enable();
    });

    it('should not write events when disabled', () => {
      const disabledBridge = new DebugBridge();
      disabledBridge.emit('user_input', { input: 'test' });
      // No error thrown, events just silently ignored
    });

    it('should write events to file when enabled', () => {
      bridge.emit('user_input', { input: 'hello world' });

      const eventsFile = bridge.getEventsFile();
      expect(existsSync(eventsFile)).toBe(true);

      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      expect(lines.length).toBeGreaterThan(0);

      const event = JSON.parse(lines[lines.length - 1]);
      expect(event.type).toBe('user_input');
      expect(event.data.input).toBe('hello world');
      expect(event.sessionId).toBe(bridge.getSessionId());
      expect(event.timestamp).toBeDefined();
      expect(event.sequence).toBeGreaterThanOrEqual(0);
    });

    it('should increment sequence numbers', () => {
      bridge.emit('user_input', { input: 'first' });
      bridge.emit('user_input', { input: 'second' });

      const eventsFile = bridge.getEventsFile();
      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      const first = JSON.parse(lines[lines.length - 2]);
      const second = JSON.parse(lines[lines.length - 1]);

      expect(second.sequence).toBe(first.sequence + 1);
    });
  });

  describe('Convenience methods', () => {
    beforeEach(() => {
      bridge.enable();
    });

    it('should emit session_start event', () => {
      bridge.sessionStart('anthropic', 'claude-sonnet-4');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('session_start');
      expect(event.data.provider).toBe('anthropic');
      expect(event.data.model).toBe('claude-sonnet-4');
    });

    it('should emit user_input event', () => {
      bridge.userInput('test input', true);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('user_input');
      expect(event.data.input).toBe('test input');
      expect(event.data.isCommand).toBe(true);
    });

    it('should truncate long user inputs', () => {
      const longInput = 'a'.repeat(2000);
      bridge.userInput(longInput);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.data.input.length).toBe(1000);
      expect(event.data.length).toBe(2000);
    });

    it('should emit tool_call_start event', () => {
      bridge.toolCallStart('read_file', { path: '/test.txt' }, 'tool-123');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('tool_call_start');
      expect(event.data.name).toBe('read_file');
      expect(event.data.input.path).toBe('/test.txt');
      expect(event.data.toolId).toBe('tool-123');
    });

    it('should truncate long tool input values', () => {
      const longValue = 'x'.repeat(1000);
      bridge.toolCallStart('write_file', { content: longValue }, 'tool-456');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.data.input.content).toContain('... (1000 chars)');
      expect(event.data.input.content.length).toBeLessThan(600);
    });

    it('should emit tool_call_end event', () => {
      bridge.toolCallEnd('read_file', 'tool-123', 150, false);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('tool_call_end');
      expect(event.data.name).toBe('read_file');
      expect(event.data.toolId).toBe('tool-123');
      expect(event.data.durationMs).toBe(150);
      expect(event.data.isError).toBe(false);
    });

    it('should emit api_request event', () => {
      bridge.apiRequest('anthropic', 'claude-sonnet-4', 5, true);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('api_request');
      expect(event.data.provider).toBe('anthropic');
      expect(event.data.model).toBe('claude-sonnet-4');
      expect(event.data.messageCount).toBe(5);
      expect(event.data.hasTools).toBe(true);
    });

    it('should emit api_response event', () => {
      bridge.apiResponse('end_turn', 1000, 500, 1234, 2);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('api_response');
      expect(event.data.stopReason).toBe('end_turn');
      expect(event.data.inputTokens).toBe(1000);
      expect(event.data.outputTokens).toBe(500);
      expect(event.data.durationMs).toBe(1234);
      expect(event.data.toolCallCount).toBe(2);
    });

    it('should emit context_compaction event', () => {
      bridge.contextCompaction(10000, 5000, 50, 25);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('context_compaction');
      expect(event.data.beforeTokens).toBe(10000);
      expect(event.data.afterTokens).toBe(5000);
      expect(event.data.messagesBefore).toBe(50);
      expect(event.data.messagesAfter).toBe(25);
      expect(event.data.savings).toBe(5000);
      expect(event.data.savingsPercent).toBe('50.0');
    });

    it('should emit error event', () => {
      bridge.error('Something went wrong', 'Error stack trace', 'tool_execution');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('error');
      expect(event.data.message).toBe('Something went wrong');
      expect(event.data.stack).toBe('Error stack trace');
      expect(event.data.context).toBe('tool_execution');
    });

    it('should emit session_end event on shutdown', () => {
      bridge.shutdown();

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('session_end');
      expect(event.data.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Session file', () => {
    it('should create session.json in session directory on enable', () => {
      bridge.enable();

      const sessionFile = bridge.getSessionFile();
      expect(existsSync(sessionFile)).toBe(true);
      expect(sessionFile).toContain(bridge.getSessionId());

      const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
      expect(session.sessionId).toBe(bridge.getSessionId());
      expect(session.pid).toBe(process.pid);
      expect(session.eventsFile).toBeDefined();
      expect(session.commandsFile).toBeDefined();
    });
  });

  describe('Session isolation', () => {
    it('should create unique session directory', () => {
      bridge.enable();

      const sessionDir = bridge.getSessionDir();
      expect(existsSync(sessionDir)).toBe(true);
      expect(sessionDir).toContain('sessions');
      expect(sessionDir).toContain(bridge.getSessionId());
    });

    it('should have events and commands files in session directory', () => {
      bridge.enable();

      const eventsFile = bridge.getEventsFile();
      const commandsFile = bridge.getCommandsFile();
      const sessionDir = bridge.getSessionDir();

      expect(eventsFile.startsWith(sessionDir)).toBe(true);
      expect(commandsFile.startsWith(sessionDir)).toBe(true);
      expect(existsSync(eventsFile)).toBe(true);
      expect(existsSync(commandsFile)).toBe(true);
    });

    it('should create current symlink pointing to session', () => {
      bridge.enable();

      const currentLink = getCurrentSessionLink();
      // On some systems (Windows), symlinks may not work
      if (existsSync(currentLink)) {
        const stats = lstatSync(currentLink);
        expect(stats.isSymbolicLink()).toBe(true);
      }
    });

    it('should register session in index', () => {
      bridge.enable();

      const indexFile = getSessionIndexFile();
      expect(existsSync(indexFile)).toBe(true);

      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      expect(index.sessions).toBeInstanceOf(Array);

      const session = index.sessions.find((s: any) => s.id === bridge.getSessionId());
      expect(session).toBeDefined();
      expect(session.pid).toBe(process.pid);
      expect(session.cwd).toBe(process.cwd());
    });

    it('should unregister session on shutdown', () => {
      bridge.enable();
      const sessionId = bridge.getSessionId();

      bridge.shutdown();

      const indexFile = getSessionIndexFile();
      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      const session = index.sessions.find((s: any) => s.id === sessionId);
      expect(session).toBeUndefined();
    });

    it('should create separate directories for multiple sessions', () => {
      const bridge1 = new DebugBridge();
      const bridge2 = new DebugBridge();

      bridge1.enable();
      bridge2.enable();

      expect(bridge1.getSessionDir()).not.toBe(bridge2.getSessionDir());
      expect(bridge1.getEventsFile()).not.toBe(bridge2.getEventsFile());
      expect(existsSync(bridge1.getSessionDir())).toBe(true);
      expect(existsSync(bridge2.getSessionDir())).toBe(true);

      // Both should be registered in index
      const indexFile = getSessionIndexFile();
      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      expect(index.sessions.length).toBeGreaterThanOrEqual(2);

      bridge1.shutdown();
      bridge2.shutdown();
    });
  });
});

// Cleanup mock home dir after all tests
afterEach(() => {
  try {
    rmSync(mockHomeDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
