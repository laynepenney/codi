// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InkUiController, UiMessage } from '../src/ui/ink/controller.js';

describe('Ink UI Controller', () => {
  let controller: InkUiController;

  beforeEach(() => {
    controller = new InkUiController();
  });

  describe('Tool Call Messages', () => {
    it('should emit tool call messages', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolCall('read_file', { path: '/test/file.ts' });

      expect(messageHandler).toHaveBeenCalledOnce();
      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.kind).toBe('system');
      expect(message.text).toContain('📎 read_file');
      expect(message.text).toContain('/test/file.ts');
    });

    it('should truncate long tool call inputs', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      const longContent = 'x'.repeat(200);
      controller.addToolCall('write_file', { content: longContent });

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text.length).toBeLessThan(200);
      expect(message.text).toContain('...');
    });

    it('should emit tool result messages for success', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolResult('read_file', 'line1\nline2\nline3', false, 1500);

      expect(messageHandler).toHaveBeenCalledOnce();
      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.kind).toBe('system');
      expect(message.text).toContain('✓ read_file');
      expect(message.text).toContain('3 lines');
      expect(message.text).toContain('1.5s');
    });

    it('should emit tool result messages for errors', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolResult('write_file', 'Permission denied', true, 100);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('❌ write_file Error');
      expect(message.text).toContain('Permission denied');
      expect(message.text).toContain('0.1s');
    });

    it('should truncate long error messages', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      const longError = 'Error: ' + 'x'.repeat(300);
      controller.addToolResult('bash', longError, true, 500);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text.length).toBeLessThan(350);
      expect(message.text).toContain('...');
    });

    it('should handle empty tool name', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolCall('', { path: '/test' });

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.kind).toBe('system');
      expect(message.text).toContain('📎');
    });

    it('should handle 0ms duration', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolResult('fast_tool', 'result', false, 0);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('0.0s');
    });

    it('should handle empty result', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolResult('empty_tool', '', false, 100);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('1 lines');
      expect(message.text).toContain('0.1s');
    });

    it('should handle empty input object', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolCall('no_args', {});

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('📎 no_args');
      expect(message.text).toContain('{}');
    });

    it('should handle special characters in input', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolCall('bash', { command: 'echo "hello\nworld" | grep \'test\'' });

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('📎 bash');
      expect(message.text).toContain('echo');
    });

    it('should handle nested objects in input', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolCall('complex_tool', {
        config: { nested: { deeply: { value: 123 } } },
        array: [1, 2, 3],
      });

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('📎 complex_tool');
      expect(message.text).toContain('config');
    });

    it('should handle unicode and emoji in results', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolResult('emoji_tool', '✅ Success! 🎉\n日本語テスト', false, 100);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('✓ emoji_tool');
      expect(message.text).toContain('2 lines');
    });

    it('should handle whitespace-only result', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolResult('whitespace_tool', '   \n\t\n   ', false, 50);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('✓ whitespace_tool');
      expect(message.text).toContain('3 lines');
    });

    it('should handle very large duration', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      // 1 hour in ms
      controller.addToolResult('slow_tool', 'done', false, 3600000);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('3600.0s');
    });

    it('should handle result with many newlines', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      const manyLines = Array(100).fill('line').join('\n');
      controller.addToolResult('multiline_tool', manyLines, false, 200);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('100 lines');
    });

    it('should handle input with null values', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addToolCall('nullable_tool', {
        value: null,
        defined: 'yes',
      } as unknown as Record<string, unknown>);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('📎 nullable_tool');
      expect(message.text).toContain('null');
    });

    it('should handle multiple rapid tool calls', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      // Simulate rapid sequential tool calls
      for (let i = 0; i < 10; i++) {
        controller.addToolCall(`tool_${i}`, { index: i });
      }

      expect(messageHandler).toHaveBeenCalledTimes(10);

      // Verify each has unique message id
      const ids = new Set(messageHandler.mock.calls.map(call => call[0].id));
      expect(ids.size).toBe(10);
    });

    it('should handle error with newlines', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      const multilineError = 'Error: Something failed\n  at function1()\n  at function2()';
      controller.addToolResult('failing_tool', multilineError, true, 100);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('❌ failing_tool Error');
      expect(message.text).toContain('Error: Something failed');
    });

    it('should handle input at exactly truncation boundary', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      // Create input that serializes to exactly 100 characters
      const exactInput = { data: 'x'.repeat(85) }; // {"data":"xxx..."} = ~100 chars
      controller.addToolCall('boundary_tool', exactInput);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('📎 boundary_tool');
    });

    it('should handle result at exactly truncation boundary', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      const exactError = 'E'.repeat(200);
      controller.addToolResult('boundary_error', exactError, true, 100);

      const message: UiMessage = messageHandler.mock.calls[0][0];
      expect(message.text).toContain('❌ boundary_error Error');
    });
  });

  describe('Status Updates', () => {
    it('should debounce rapid status updates', () => {
      const statusHandler = vi.fn();
      controller.on('status', statusHandler);

      // Simulate rapid status changes - these are debounced to reduce re-renders
      controller.setStatus({ activity: 'tool', activityDetail: 'read_file' });
      controller.setStatus({ activity: 'thinking' });
      controller.setStatus({ activity: 'tool', activityDetail: 'write_file' });
      controller.setStatus({ activity: 'thinking' });
      controller.setStatus({ activity: 'idle' });
      controller.flush();

      // Debounced: only final state is emitted
      expect(statusHandler).toHaveBeenCalledTimes(1);
      expect(statusHandler.mock.calls[0][0].activity).toBe('idle');
    });

    it('should merge status updates', () => {
      const statusHandler = vi.fn();
      controller.on('status', statusHandler);

      controller.setStatus({ provider: 'anthropic', model: 'claude-3-5-sonnet' });
      controller.setStatus({ activity: 'thinking' });
      controller.flush();

      // Merged into single emission
      expect(statusHandler).toHaveBeenCalledTimes(1);
      const lastStatus = statusHandler.mock.calls[0][0];
      expect(lastStatus.provider).toBe('anthropic');
      expect(lastStatus.model).toBe('claude-3-5-sonnet');
      expect(lastStatus.activity).toBe('thinking');
    });

    it('should handle null values in status', () => {
      const statusHandler = vi.fn();
      controller.on('status', statusHandler);

      controller.setStatus({ sessionName: 'test-session' });
      controller.setStatus({ sessionName: null });
      controller.flush();

      // Merged with final null value
      const lastStatus = statusHandler.mock.calls[0][0];
      expect(lastStatus.sessionName).toBeNull();
    });

    it('should handle empty activity detail', () => {
      const statusHandler = vi.fn();
      controller.on('status', statusHandler);

      controller.setStatus({ activity: 'tool', activityDetail: '' });
      controller.flush();

      const status = statusHandler.mock.calls[0][0];
      expect(status.activity).toBe('tool');
      expect(status.activityDetail).toBe('');
    });

    it('should preserve previous status values', () => {
      controller.setStatus({ provider: 'openai', model: 'gpt-4' });
      controller.setStatus({ activity: 'thinking' });
      controller.flush();

      const status = controller.getStatus();
      expect(status.provider).toBe('openai');
      expect(status.model).toBe('gpt-4');
      expect(status.activity).toBe('thinking');
    });
  });

  describe('Confirmation Queue', () => {
    it('should queue confirmations correctly', async () => {
      const confirmHandler = vi.fn();
      controller.on('confirmation', confirmHandler);

      // Request first confirmation
      const confirmation1 = controller.requestConfirmation('agent', {
        toolName: 'bash',
        input: { command: 'rm -rf /' },
        isDangerous: true,
      });

      // Request second confirmation
      const confirmation2 = controller.requestConfirmation('agent', {
        toolName: 'write_file',
        input: { path: '/test.txt' },
        isDangerous: false,
      });

      // First confirmation should be active
      expect(controller.getActiveConfirmation()?.confirmation.toolName).toBe('bash');

      // Resolve first
      controller.resolveConfirmation(controller.getActiveConfirmation()!.id, 'approve');

      // Second should now be active
      expect(controller.getActiveConfirmation()?.confirmation.toolName).toBe('write_file');

      // Resolve second
      controller.resolveConfirmation(controller.getActiveConfirmation()!.id, 'deny');

      // Queue should be empty
      expect(controller.getActiveConfirmation()).toBeNull();

      // Both promises should resolve
      const result1 = await confirmation1;
      const result2 = await confirmation2;
      expect(result1).toBe('approve');
      expect(result2).toBe('deny');
    });

    it('should handle resolving non-existent confirmation', () => {
      // Should not throw
      controller.resolveConfirmation('non-existent-id', 'approve');
      expect(controller.getActiveConfirmation()).toBeNull();
    });

    it('should handle worker confirmation source', async () => {
      const confirmHandler = vi.fn();
      controller.on('confirmation', confirmHandler);

      const confirmation = controller.requestConfirmation('worker', {
        toolName: 'bash',
        input: { command: 'npm install' },
        isDangerous: false,
      }, 'worker-123');

      const active = controller.getActiveConfirmation();
      expect(active?.source).toBe('worker');
      expect(active?.workerId).toBe('worker-123');

      controller.resolveConfirmation(active!.id, 'approve');
      expect(await confirmation).toBe('approve');
    });

    it('should handle abort result', async () => {
      const confirmation = controller.requestConfirmation('agent', {
        toolName: 'dangerous_tool',
        input: {},
        isDangerous: true,
      });

      controller.resolveConfirmation(controller.getActiveConfirmation()!.id, 'abort');
      expect(await confirmation).toBe('abort');
    });

    it('should handle complex approval result', async () => {
      const confirmation = controller.requestConfirmation('agent', {
        toolName: 'bash',
        input: { command: 'npm test' },
        isDangerous: false,
      });

      const patternResult = { type: 'approve_pattern' as const, pattern: 'npm *' };
      controller.resolveConfirmation(controller.getActiveConfirmation()!.id, patternResult);

      const result = await confirmation;
      expect(result).toEqual(patternResult);
    });

    it('should handle many queued confirmations', async () => {
      const promises: Promise<unknown>[] = [];

      // Queue 10 confirmations
      for (let i = 0; i < 10; i++) {
        promises.push(controller.requestConfirmation('agent', {
          toolName: `tool_${i}`,
          input: { index: i },
          isDangerous: false,
        }));
      }

      // Resolve all
      for (let i = 0; i < 10; i++) {
        const active = controller.getActiveConfirmation();
        expect(active?.confirmation.toolName).toBe(`tool_${i}`);
        controller.resolveConfirmation(active!.id, 'approve');
      }

      // All should resolve
      const results = await Promise.all(promises);
      expect(results.every(r => r === 'approve')).toBe(true);
    });
  });

  describe('Message Streaming', () => {
    it('should handle message chunks (batched)', () => {
      const chunkHandler = vi.fn();
      controller.on('messageChunk', chunkHandler);

      // Chunks are now batched to reduce re-renders
      controller.appendToMessage('m1', 'Hello ');
      controller.appendToMessage('m1', 'World');
      controller.appendToMessage('m1', '!');
      controller.flush();

      // Batched into single emission
      expect(chunkHandler).toHaveBeenCalledTimes(1);
      expect(chunkHandler.mock.calls[0][0]).toEqual({ id: 'm1', chunk: 'Hello World!' });
    });

    it('should ignore empty chunks', () => {
      const chunkHandler = vi.fn();
      controller.on('messageChunk', chunkHandler);

      controller.appendToMessage('m1', '');
      controller.appendToMessage('m1', null as unknown as string);
      controller.flush();

      expect(chunkHandler).not.toHaveBeenCalled();
    });

    it('should emit message complete events', () => {
      const completeHandler = vi.fn();
      controller.on('messageComplete', completeHandler);

      controller.completeAssistantMessage('m1');

      expect(completeHandler).toHaveBeenCalledWith('m1');
    });

    it('should handle chunks with unicode (batched)', () => {
      const chunkHandler = vi.fn();
      controller.on('messageChunk', chunkHandler);

      controller.appendToMessage('m1', '你好');
      controller.appendToMessage('m1', '世界');
      controller.appendToMessage('m1', '🌍');
      controller.flush();

      // Batched into single emission
      expect(chunkHandler).toHaveBeenCalledTimes(1);
      expect(chunkHandler.mock.calls[0][0].chunk).toBe('你好世界🌍');
    });

    it('should handle chunks with newlines', () => {
      const chunkHandler = vi.fn();
      controller.on('messageChunk', chunkHandler);

      controller.appendToMessage('m1', 'line1\nline2\n');
      controller.flush(); // Flush debounced chunks

      expect(chunkHandler).toHaveBeenCalledWith({ id: 'm1', chunk: 'line1\nline2\n' });
    });

    it('should handle interleaved messages', () => {
      const chunkHandler = vi.fn();
      controller.on('messageChunk', chunkHandler);

      // Chunks are now batched per message ID to reduce re-renders
      controller.appendToMessage('m1', 'A');
      controller.appendToMessage('m2', 'B');
      controller.appendToMessage('m1', 'C');
      controller.appendToMessage('m2', 'D');
      controller.flush(); // Flush debounced chunks

      // Batched chunks: m1 gets 'AC', m2 gets 'BD'
      expect(chunkHandler).toHaveBeenCalledTimes(2);
      expect(chunkHandler.mock.calls).toContainEqual([{ id: 'm1', chunk: 'AC' }]);
      expect(chunkHandler.mock.calls).toContainEqual([{ id: 'm2', chunk: 'BD' }]);
    });

    it('should start assistant message and return id', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      const id1 = controller.startAssistantMessage();
      const id2 = controller.startAssistantMessage();

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
      expect(messageHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Worker and Reader Events', () => {
    it('should emit worker state updates', () => {
      const workerHandler = vi.fn();
      controller.on('worker', workerHandler);

      const workerState = {
        config: { id: 'w1', branch: 'feat/test', task: 'test task' },
        status: 'thinking',
        startedAt: new Date(),
      };

      controller.updateWorker(workerState as any);

      expect(workerHandler).toHaveBeenCalledWith(workerState);
    });

    it('should emit worker result', () => {
      const resultHandler = vi.fn();
      controller.on('workerResult', resultHandler);

      const result = { workerId: 'w1', response: 'done', success: true };
      controller.updateWorkerResult(result as any);

      expect(resultHandler).toHaveBeenCalledWith(result);
    });

    it('should emit worker logs', () => {
      const logHandler = vi.fn();
      controller.on('workerLog', logHandler);

      controller.addWorkerLog('w1', { level: 'info', content: 'Working...' } as any);

      expect(logHandler).toHaveBeenCalled();
      expect(logHandler.mock.calls[0][0].workerId).toBe('w1');
      expect(logHandler.mock.calls[0][0].content).toBe('Working...');
    });

    it('should emit reader state updates', () => {
      const readerHandler = vi.fn();
      controller.on('reader', readerHandler);

      const readerState = {
        config: { id: 'r1', query: 'test query' },
        status: 'thinking',
      };

      controller.updateReader(readerState as any);

      expect(readerHandler).toHaveBeenCalledWith(readerState);
    });

    it('should emit reader result', () => {
      const resultHandler = vi.fn();
      controller.on('readerResult', resultHandler);

      const result = { readerId: 'r1', response: 'found it', success: true };
      controller.updateReaderResult(result as any);

      expect(resultHandler).toHaveBeenCalledWith(result);
    });

    it('should emit reader logs', () => {
      const logHandler = vi.fn();
      controller.on('readerLog', logHandler);

      controller.addReaderLog('r1', { level: 'debug', content: 'Searching...' } as any);

      expect(logHandler).toHaveBeenCalled();
      expect(logHandler.mock.calls[0][0].readerId).toBe('r1');
    });
  });

  describe('Session Selection', () => {
    it('should request session selection', async () => {
      const selectionHandler = vi.fn();
      controller.on('sessionSelection', selectionHandler);

      const sessions = [
        { name: 'session1', provider: 'anthropic', model: 'claude-3' },
        { name: 'session2', provider: 'openai', model: 'gpt-4' },
      ];

      const promise = controller.requestSessionSelection(sessions as any);

      expect(controller.getActiveSessionSelection()).not.toBeNull();
      expect(controller.getActiveSessionSelection()?.sessions).toEqual(sessions);

      controller.resolveSessionSelection(controller.getActiveSessionSelection()!.id, sessions[0] as any);

      const result = await promise;
      expect(result).toEqual(sessions[0]);
    });

    it('should handle session selection cancellation', async () => {
      const sessions = [{ name: 'session1' }];
      const promise = controller.requestSessionSelection(sessions as any);

      controller.resolveSessionSelection(controller.getActiveSessionSelection()!.id, null);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should handle custom prompt', () => {
      controller.requestSessionSelection([], 'Pick a session:');

      expect(controller.getActiveSessionSelection()?.prompt).toBe('Pick a session:');
    });

    it('should ignore resolving wrong session selection', async () => {
      const promise = controller.requestSessionSelection([{ name: 's1' }] as any);

      // Try to resolve with wrong id
      controller.resolveSessionSelection('wrong-id', null);

      // Original should still be active
      expect(controller.getActiveSessionSelection()).not.toBeNull();

      // Now resolve correctly
      controller.resolveSessionSelection(controller.getActiveSessionSelection()!.id, null);
      expect(await promise).toBeNull();
    });
  });

  describe('Exit and Lifecycle', () => {
    it('should emit exit event', () => {
      const exitHandler = vi.fn();
      controller.on('exit', exitHandler);

      controller.requestExit();

      expect(exitHandler).toHaveBeenCalled();
    });

    it('should handle multiple exit requests', () => {
      const exitHandler = vi.fn();
      controller.on('exit', exitHandler);

      controller.requestExit();
      controller.requestExit();
      controller.requestExit();

      expect(exitHandler).toHaveBeenCalledTimes(3);
    });
  });

  describe('Message Types', () => {
    it('should handle user messages', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addMessage('user', 'Hello AI');

      const message = messageHandler.mock.calls[0][0];
      expect(message.kind).toBe('user');
      expect(message.text).toBe('Hello AI');
    });

    it('should handle assistant messages', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addMessage('assistant', 'Hello human');

      const message = messageHandler.mock.calls[0][0];
      expect(message.kind).toBe('assistant');
    });

    it('should handle worker messages with workerId', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addMessage('worker', 'Task complete', 'worker-456');

      const message = messageHandler.mock.calls[0][0];
      expect(message.kind).toBe('worker');
      expect(message.workerId).toBe('worker-456');
    });

    it('should assign unique message ids', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      controller.addMessage('user', 'msg1');
      controller.addMessage('user', 'msg2');
      controller.addMessage('user', 'msg3');

      const ids = messageHandler.mock.calls.map(call => call[0].id);
      expect(new Set(ids).size).toBe(3);
    });

    it('should include timestamp in messages', () => {
      const messageHandler = vi.fn();
      controller.on('message', messageHandler);

      const before = Date.now();
      controller.addMessage('user', 'test');
      const after = Date.now();

      const message = messageHandler.mock.calls[0][0];
      expect(message.timestamp).toBeGreaterThanOrEqual(before);
      expect(message.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
