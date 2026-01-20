// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuditLogger } from '../src/audit.js';

describe('AuditLogger', () => {
  const testDir = join(tmpdir(), 'codi-audit-test');
  const testLogFile = join(testDir, 'test.jsonl');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('disabled mode', () => {
    it('does not write to file when disabled', () => {
      const logger = new AuditLogger({ enabled: false, logFile: testLogFile });
      logger.sessionStart('Test', 'test-model', '/test', []);
      logger.userInput('hello');
      expect(existsSync(testLogFile)).toBe(false);
    });

    it('reports as disabled', () => {
      const logger = new AuditLogger({ enabled: false });
      expect(logger.isEnabled()).toBe(false);
    });
  });

  describe('enabled mode', () => {
    it('creates log file when enabled', () => {
      const logger = new AuditLogger({ enabled: true, logFile: testLogFile });
      expect(existsSync(testLogFile)).toBe(true);
    });

    it('reports as enabled', () => {
      const logger = new AuditLogger({ enabled: true, logFile: testLogFile });
      expect(logger.isEnabled()).toBe(true);
    });

    it('returns log file path', () => {
      const logger = new AuditLogger({ enabled: true, logFile: testLogFile });
      expect(logger.getLogFile()).toBe(testLogFile);
    });
  });

  describe('logging events', () => {
    let logger: AuditLogger;

    beforeEach(() => {
      logger = new AuditLogger({ enabled: true, logFile: testLogFile });
    });

    it('logs session start', () => {
      logger.sessionStart('Anthropic', 'claude-3', '/home/user', ['--verbose']);
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('session_start');
      expect(event.provider).toBe('Anthropic');
      expect(event.model).toBe('claude-3');
      expect(event.cwd).toBe('/home/user');
      expect(event.args).toEqual(['--verbose']);
    });

    it('logs user input', () => {
      logger.userInput('hello world');
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('user_input');
      expect(event.input).toBe('hello world');
    });

    it('logs API request', () => {
      logger.apiRequest(
        'Test',
        'test-model',
        [{ role: 'user', content: 'hello' }],
        [{ name: 'bash', description: 'test', input_schema: { type: 'object', properties: {} } }],
        'System prompt'
      );
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('api_request');
      expect(event.provider).toBe('Test');
      expect(event.model).toBe('test-model');
      expect(event.messages).toHaveLength(1);
      expect(event.tools).toHaveLength(1);
      expect(event.systemPrompt).toBe('System prompt');
    });

    it('logs API response', () => {
      logger.apiResponse(
        'end_turn',
        'Hello!',
        [{ id: '1', name: 'bash', input: { command: 'ls' } }],
        { inputTokens: 100, outputTokens: 50 },
        1234
      );
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('api_response');
      expect(event.stopReason).toBe('end_turn');
      expect(event.content).toBe('Hello!');
      expect(event.toolCalls).toHaveLength(1);
      expect(event.usage?.inputTokens).toBe(100);
      expect(event.durationMs).toBe(1234);
    });

    it('logs tool call', () => {
      logger.toolCall('bash', { command: 'ls -la' }, 'tool_123');
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('tool_call');
      expect(event.toolName).toBe('bash');
      expect(event.toolInput.command).toBe('ls -la');
      expect(event.toolId).toBe('tool_123');
    });

    it('logs tool result', () => {
      logger.toolResult('bash', 'tool_123', 'file1.txt\nfile2.txt', false, 150);
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('tool_result');
      expect(event.toolName).toBe('bash');
      expect(event.toolId).toBe('tool_123');
      expect(event.result).toBe('file1.txt\nfile2.txt');
      expect(event.isError).toBe(false);
      expect(event.durationMs).toBe(150);
    });

    it('logs max iterations', () => {
      logger.maxIterations(20, 20);
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('max_iterations');
      expect(event.iterations).toBe(20);
      expect(event.maxIterations).toBe(20);
    });

    it('logs user abort', () => {
      logger.userAbort('bash', 'User declined');
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('user_abort');
      expect(event.toolName).toBe('bash');
      expect(event.reason).toBe('User declined');
    });

    it('logs error', () => {
      logger.error('Something went wrong', 'Error: Stack trace', 'api_call');
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.type).toBe('error');
      expect(event.errorMessage).toBe('Something went wrong');
      expect(event.errorStack).toBe('Error: Stack trace');
      expect(event.context).toBe('api_call');
    });

    it('logs session end with totals', () => {
      logger.setIteration(5);
      // Need to call apiRequest to increment apiCallCount
      logger.apiRequest('Test', 'model', [{ role: 'user', content: 'test1' }]);
      logger.apiResponse('end_turn', 'Hello', [], { inputTokens: 100, outputTokens: 50 }, 100);
      logger.apiRequest('Test', 'model', [{ role: 'user', content: 'test2' }]);
      logger.apiResponse('end_turn', 'World', [], { inputTokens: 200, outputTokens: 100 }, 100);
      logger.sessionEnd();
      
      const content = readFileSync(testLogFile, 'utf-8');
      const lines = content.trim().split('\n');
      const lastEvent = JSON.parse(lines[lines.length - 1]);
      
      expect(lastEvent.type).toBe('session_end');
      expect(lastEvent.totalApiCalls).toBe(2);
      expect(lastEvent.totalTokens.input).toBe(300);
      expect(lastEvent.totalTokens.output).toBe(150);
    });
  });

  describe('iteration tracking', () => {
    it('includes iteration in events', () => {
      const logger = new AuditLogger({ enabled: true, logFile: testLogFile });
      
      logger.setIteration(3);
      logger.userInput('test');
      
      const content = readFileSync(testLogFile, 'utf-8');
      const event = JSON.parse(content.trim());
      
      expect(event.iteration).toBe(3);
    });
  });

  describe('JSONL format', () => {
    it('writes one JSON object per line', () => {
      const logger = new AuditLogger({ enabled: true, logFile: testLogFile });
      
      logger.userInput('first');
      logger.userInput('second');
      logger.userInput('third');
      
      const content = readFileSync(testLogFile, 'utf-8');
      const lines = content.trim().split('\n');
      
      expect(lines).toHaveLength(3);
      
      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });
});
