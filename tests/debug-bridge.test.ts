// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, appendFileSync } from 'fs';
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

  describe('Command watching (Phase 2)', () => {
    beforeEach(() => {
      bridge.enable();
    });

    it('should start command watcher and process commands', async () => {
      const receivedCommands: any[] = [];

      bridge.startCommandWatcher(async (cmd) => {
        receivedCommands.push(cmd);
      });

      // Wait for watcher to be ready
      await new Promise(r => setTimeout(r, 100));

      // Write a command to the commands file
      const command = {
        type: 'pause',
        id: 'test-cmd-1',
        data: {},
      };
      appendFileSync(bridge.getCommandsFile(), JSON.stringify(command) + '\n');

      // Wait for polling-based watcher to detect the change
      await new Promise(r => setTimeout(r, 300));

      expect(receivedCommands.length).toBe(1);
      expect(receivedCommands[0].type).toBe('pause');
      expect(receivedCommands[0].id).toBe('test-cmd-1');
    });

    it('should emit command_executed event after processing', async () => {
      bridge.startCommandWatcher(async () => {
        // Command processed
      });

      // Wait for watcher to be ready
      await new Promise(r => setTimeout(r, 100));

      // Write a command
      const command = {
        type: 'inspect',
        id: 'test-cmd-2',
        data: { what: 'all' },
      };
      appendFileSync(bridge.getCommandsFile(), JSON.stringify(command) + '\n');

      // Wait for processing
      await new Promise(r => setTimeout(r, 300));

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const events = lines.map(l => JSON.parse(l));

      const executed = events.find(e => e.type === 'command_executed');
      expect(executed).toBeDefined();
      expect(executed.data.commandId).toBe('test-cmd-2');
      expect(executed.data.type).toBe('inspect');
    });

    it('should process only new commands', async () => {
      const receivedCommands: any[] = [];

      // Write first command before starting watcher
      const cmd1 = { type: 'pause', id: 'cmd-1', data: {} };
      appendFileSync(bridge.getCommandsFile(), JSON.stringify(cmd1) + '\n');

      // Start watcher (should skip existing commands)
      bridge.startCommandWatcher(async (cmd) => {
        receivedCommands.push(cmd);
      });

      // Wait for watcher to be ready
      await new Promise(r => setTimeout(r, 150));

      // Write second command after starting watcher
      const cmd2 = { type: 'resume', id: 'cmd-2', data: {} };
      appendFileSync(bridge.getCommandsFile(), JSON.stringify(cmd2) + '\n');

      // Wait for processing
      await new Promise(r => setTimeout(r, 300));

      // Should only receive the second command (watcher started after first)
      expect(receivedCommands.length).toBe(1);
      expect(receivedCommands[0].id).toBe('cmd-2');
    });

    it('should handle invalid JSON gracefully', async () => {
      const receivedCommands: any[] = [];

      bridge.startCommandWatcher(async (cmd) => {
        receivedCommands.push(cmd);
      });

      // Wait for watcher to be ready
      await new Promise(r => setTimeout(r, 100));

      // Write invalid JSON
      appendFileSync(bridge.getCommandsFile(), 'invalid json\n');

      // Wait for processing
      await new Promise(r => setTimeout(r, 300));

      // Should not crash, should emit error event
      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const events = lines.map(l => JSON.parse(l));

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.data.context).toBe('command_processing');
    });

    it('should emit new event types: paused, resumed, step_complete', () => {
      // Test paused event
      bridge.emit('paused', { iteration: 1 });
      // Test resumed event
      bridge.emit('resumed', { iteration: 1 });
      // Test step_complete event
      bridge.emit('step_complete', { iteration: 2 });
      // Test command_response event
      bridge.emit('command_response', { commandId: 'test', type: 'inspect', data: {} });

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const events = lines.map(l => JSON.parse(l));

      expect(events.some(e => e.type === 'paused')).toBe(true);
      expect(events.some(e => e.type === 'resumed')).toBe(true);
      expect(events.some(e => e.type === 'step_complete')).toBe(true);
      expect(events.some(e => e.type === 'command_response')).toBe(true);
    });

    it('should stop command watcher on shutdown', async () => {
      const receivedCommands: any[] = [];

      bridge.startCommandWatcher(async (cmd) => {
        receivedCommands.push(cmd);
      });

      // Shutdown stops the watcher
      bridge.shutdown();

      // Write a command after shutdown
      const cmd = { type: 'pause', id: 'after-shutdown', data: {} };
      appendFileSync(bridge.getCommandsFile(), JSON.stringify(cmd) + '\n');

      // Wait
      await new Promise(r => setTimeout(r, 200));

      // Should not receive any commands after shutdown
      expect(receivedCommands.length).toBe(0);
    });

    it('should process multiple commands in sequence', async () => {
      const receivedCommands: any[] = [];

      bridge.startCommandWatcher(async (cmd) => {
        receivedCommands.push(cmd);
      });

      await new Promise(r => setTimeout(r, 100));

      // Write multiple commands at once
      const cmds = [
        { type: 'pause', id: 'cmd-a', data: {} },
        { type: 'inspect', id: 'cmd-b', data: { what: 'messages' } },
        { type: 'resume', id: 'cmd-c', data: {} },
      ];
      for (const cmd of cmds) {
        appendFileSync(bridge.getCommandsFile(), JSON.stringify(cmd) + '\n');
      }

      await new Promise(r => setTimeout(r, 400));

      expect(receivedCommands.length).toBe(3);
      expect(receivedCommands[0].id).toBe('cmd-a');
      expect(receivedCommands[1].id).toBe('cmd-b');
      expect(receivedCommands[2].id).toBe('cmd-c');
    });

    it('should continue processing after callback error', async () => {
      const receivedCommands: any[] = [];
      let errorCount = 0;

      bridge.startCommandWatcher(async (cmd) => {
        if (cmd.id === 'cmd-error') {
          errorCount++;
          throw new Error('Callback error');
        }
        receivedCommands.push(cmd);
      });

      await new Promise(r => setTimeout(r, 100));

      // Write commands including one that will error
      appendFileSync(bridge.getCommandsFile(), JSON.stringify({ type: 'pause', id: 'cmd-1', data: {} }) + '\n');
      appendFileSync(bridge.getCommandsFile(), JSON.stringify({ type: 'pause', id: 'cmd-error', data: {} }) + '\n');
      appendFileSync(bridge.getCommandsFile(), JSON.stringify({ type: 'resume', id: 'cmd-2', data: {} }) + '\n');

      await new Promise(r => setTimeout(r, 400));

      // Should process all commands despite error
      expect(receivedCommands.length).toBe(2);
      expect(errorCount).toBe(1);
    });

    it('should handle step command type', async () => {
      const receivedCommands: any[] = [];

      bridge.startCommandWatcher(async (cmd) => {
        receivedCommands.push(cmd);
      });

      await new Promise(r => setTimeout(r, 100));

      const cmd = { type: 'step', id: 'step-1', data: {} };
      appendFileSync(bridge.getCommandsFile(), JSON.stringify(cmd) + '\n');

      await new Promise(r => setTimeout(r, 300));

      expect(receivedCommands.length).toBe(1);
      expect(receivedCommands[0].type).toBe('step');
    });

    it('should handle inject_message command type', async () => {
      const receivedCommands: any[] = [];

      bridge.startCommandWatcher(async (cmd) => {
        receivedCommands.push(cmd);
      });

      await new Promise(r => setTimeout(r, 100));

      const cmd = {
        type: 'inject_message',
        id: 'inject-1',
        data: { role: 'user', content: 'test message' },
      };
      appendFileSync(bridge.getCommandsFile(), JSON.stringify(cmd) + '\n');

      await new Promise(r => setTimeout(r, 300));

      expect(receivedCommands.length).toBe(1);
      expect(receivedCommands[0].type).toBe('inject_message');
      expect(receivedCommands[0].data.role).toBe('user');
      expect(receivedCommands[0].data.content).toBe('test message');
    });
  });

  describe('Additional event types', () => {
    beforeEach(() => {
      bridge.enable();
    });

    it('should emit assistant_text event', () => {
      bridge.assistantText('Hello, how can I help?', false);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('assistant_text');
      expect(event.data.text).toBe('Hello, how can I help?');
      expect(event.data.isStreaming).toBe(false);
    });

    it('should truncate long assistant text', () => {
      const longText = 'y'.repeat(3000);
      bridge.assistantText(longText, true);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.data.text.length).toBe(2000);
      expect(event.data.length).toBe(3000);
      expect(event.data.isStreaming).toBe(true);
    });

    it('should emit tool_result event', () => {
      bridge.toolResult('read_file', 'tool-789', 'file contents here', false);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('tool_result');
      expect(event.data.name).toBe('read_file');
      expect(event.data.toolId).toBe('tool-789');
      expect(event.data.result).toBe('file contents here');
      expect(event.data.isError).toBe(false);
    });

    it('should truncate long tool results', () => {
      const longResult = 'z'.repeat(2000);
      bridge.toolResult('bash', 'tool-999', longResult, false);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.data.result.length).toBe(1000);
      expect(event.data.resultLength).toBe(2000);
    });

    it('should emit model_switch event', () => {
      bridge.modelSwitch('anthropic', 'claude-haiku', 'openai', 'gpt-4');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('model_switch');
      expect(event.data.from.provider).toBe('anthropic');
      expect(event.data.from.model).toBe('claude-haiku');
      expect(event.data.to.provider).toBe('openai');
      expect(event.data.to.model).toBe('gpt-4');
    });

    it('should emit state_snapshot event with all fields', () => {
      bridge.stateSnapshot({
        messageCount: 10,
        tokenEstimate: 5000,
        hasSummary: true,
        provider: 'anthropic',
        model: 'claude-sonnet',
        workingSetSize: 3,
      });

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('state_snapshot');
      expect(event.data.messageCount).toBe(10);
      expect(event.data.tokenEstimate).toBe(5000);
      expect(event.data.hasSummary).toBe(true);
      expect(event.data.provider).toBe('anthropic');
      expect(event.data.model).toBe('claude-sonnet');
      expect(event.data.workingSetSize).toBe(3);
    });

    it('should emit command_executed event with details', () => {
      bridge.commandExecuted('/help', 'Showed help menu');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('command_executed');
      expect(event.data.command).toBe('/help');
      expect(event.data.result).toBe('Showed help menu');
    });

    it('should truncate long command results', () => {
      const longResult = 'r'.repeat(1000);
      bridge.commandExecuted('/test', longResult);

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.data.result.length).toBe(500);
    });
  });

  describe('Stale session cleanup', () => {
    it('should clean up sessions with non-existent PIDs on enable', () => {
      // Pre-create a stale session in the index
      const debugDir = getDebugDir();
      const indexFile = getSessionIndexFile();
      const sessionsDir = getSessionsDir();

      mkdirSync(sessionsDir, { recursive: true });

      // Create a stale session directory
      const staleSessionId = 'debug_stale_session';
      const staleSessionDir = join(sessionsDir, staleSessionId);
      mkdirSync(staleSessionDir, { recursive: true });
      writeFileSync(join(staleSessionDir, 'events.jsonl'), '');

      // Write index with stale session (non-existent PID)
      writeFileSync(indexFile, JSON.stringify({
        sessions: [{
          id: staleSessionId,
          pid: 999999999, // Non-existent PID
          startTime: new Date().toISOString(),
          cwd: '/tmp',
        }],
      }));

      // Enable bridge - should clean up stale session
      bridge.enable();

      // Check that stale session was removed from index
      const index = JSON.parse(readFileSync(indexFile, 'utf8'));
      const staleSession = index.sessions.find((s: any) => s.id === staleSessionId);
      expect(staleSession).toBeUndefined();

      // New session should be in index
      const newSession = index.sessions.find((s: any) => s.id === bridge.getSessionId());
      expect(newSession).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty data in emit', () => {
      bridge.enable();
      bridge.emit('user_input', {});

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.type).toBe('user_input');
      expect(event.data).toEqual({});
    });

    it('should handle special characters in event data', () => {
      bridge.enable();
      bridge.userInput('Hello "world" with \'quotes\' and\nnewlines\ttabs');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.data.input).toContain('"world"');
      expect(event.data.input).toContain("'quotes'");
    });

    it('should handle unicode in event data', () => {
      bridge.enable();
      bridge.userInput('Hello 世界 🌍 مرحبا');

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const event = JSON.parse(lines[lines.length - 1]);

      expect(event.data.input).toBe('Hello 世界 🌍 مرحبا');
    });

    it('should not fail when emitting before enable', () => {
      // Should not throw
      bridge.emit('user_input', { input: 'test' });
      bridge.sessionStart('test', 'test');
      bridge.userInput('test');
      bridge.assistantText('test');
      bridge.toolCallStart('test', {}, 'id');
      bridge.toolCallEnd('test', 'id', 100, false);
      bridge.apiRequest('test', 'test', 1, false);
      bridge.apiResponse('end', 100, 50, 1000, 0);
      bridge.error('test');
    });

    it('should handle rapid event emission', () => {
      bridge.enable();

      // Emit many events rapidly
      for (let i = 0; i < 100; i++) {
        bridge.emit('user_input', { input: `message ${i}` });
      }

      const content = readFileSync(bridge.getEventsFile(), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      // Should have all 100 events
      expect(lines.length).toBe(100);

      // Sequence numbers should be correct
      const events = lines.map(l => JSON.parse(l));
      for (let i = 0; i < 100; i++) {
        expect(events[i].sequence).toBe(i);
      }
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
