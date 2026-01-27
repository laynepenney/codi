// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import {
  execSuccess,
  execError,
  createExecMock,
  createSimpleExecMock,
  createPatternExecMock,
  type ExecResult,
  type ExecError as ExecErrorType,
} from './exec-mock.js';

describe('exec-mock helpers', () => {
  describe('execSuccess', () => {
    it('creates a success result with stdout', () => {
      const result = execSuccess('hello world');
      expect(result).toEqual({ stdout: 'hello world', stderr: '' });
    });

    it('creates a success result with stdout and stderr', () => {
      const result = execSuccess('output', 'warnings');
      expect(result).toEqual({ stdout: 'output', stderr: 'warnings' });
    });
  });

  describe('execError', () => {
    it('creates an error result with message', () => {
      const result = execError('Command not found');
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('Command not found');
      expect(result.error.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it('creates an error result with stdout and stderr', () => {
      const result = execError('Failed', 'partial output', 'error details');
      expect(result.error.message).toBe('Failed');
      expect(result.stdout).toBe('partial output');
      expect(result.stderr).toBe('error details');
    });
  });

  describe('createExecMock', () => {
    it('returns success result for matching command', () => {
      const mockFn = createExecMock(
        new Map([
          ['node -v', execSuccess('v20.0.0')],
        ])
      );

      const callback = vi.fn();
      mockFn('node -v', null, callback);

      expect(callback).toHaveBeenCalledWith(null, { stdout: 'v20.0.0', stderr: '' });
    });

    it('returns error result for matching command', () => {
      const mockFn = createExecMock(
        new Map([
          ['bad-cmd', execError('Not found')],
        ])
      );

      const callback = vi.fn();
      mockFn('bad-cmd', null, callback);

      expect(callback).toHaveBeenCalledTimes(1);
      const [error, result] = callback.mock.calls[0];
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Not found');
      expect(result).toEqual({ stdout: '', stderr: '' });
    });

    it('returns error for unmatched command without default', () => {
      const mockFn = createExecMock(new Map());

      const callback = vi.fn();
      mockFn('unknown-cmd', null, callback);

      expect(callback).toHaveBeenCalledTimes(1);
      const [error] = callback.mock.calls[0];
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('No mock result for command');
    });

    it('uses default result for unmatched command', () => {
      const mockFn = createExecMock(
        new Map(),
        execSuccess('default output')
      );

      const callback = vi.fn();
      mockFn('any-command', null, callback);

      expect(callback).toHaveBeenCalledWith(null, { stdout: 'default output', stderr: '' });
    });

    it('returns ChildProcess-like object', () => {
      const mockFn = createExecMock(new Map());
      const result = mockFn('cmd', null, vi.fn());

      expect(result).toHaveProperty('pid');
      expect(result).toHaveProperty('stdin');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
    });

    it('handles missing callback gracefully', () => {
      const mockFn = createExecMock(new Map());

      // Should not throw when callback is undefined
      expect(() => mockFn('cmd', null, undefined)).not.toThrow();
    });
  });

  describe('createSimpleExecMock', () => {
    it('returns same success result for all commands', () => {
      const mockFn = createSimpleExecMock(execSuccess('always this'));

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockFn('cmd1', null, callback1);
      mockFn('cmd2', null, callback2);

      expect(callback1).toHaveBeenCalledWith(null, { stdout: 'always this', stderr: '' });
      expect(callback2).toHaveBeenCalledWith(null, { stdout: 'always this', stderr: '' });
    });

    it('returns same error result for all commands', () => {
      const mockFn = createSimpleExecMock(execError('always fails'));

      const callback = vi.fn();
      mockFn('any-cmd', null, callback);

      const [error] = callback.mock.calls[0];
      expect(error.message).toBe('always fails');
    });
  });

  describe('createPatternExecMock', () => {
    it('matches exact string patterns', () => {
      const mockFn = createPatternExecMock([
        ['exact-match', execSuccess('matched')],
      ]);

      const callback = vi.fn();
      mockFn('exact-match', null, callback);

      expect(callback).toHaveBeenCalledWith(null, { stdout: 'matched', stderr: '' });
    });

    it('matches regex patterns', () => {
      const mockFn = createPatternExecMock([
        [/node.*-v/, execSuccess('v20.0.0')],
        [/npm/, execSuccess('10.0.0')],
      ]);

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockFn('node -v', null, callback1);
      mockFn('npm --version', null, callback2);

      expect(callback1).toHaveBeenCalledWith(null, { stdout: 'v20.0.0', stderr: '' });
      expect(callback2).toHaveBeenCalledWith(null, { stdout: '10.0.0', stderr: '' });
    });

    it('uses first matching pattern', () => {
      const mockFn = createPatternExecMock([
        [/node/, execSuccess('first')],
        [/node -v/, execSuccess('second')],
      ]);

      const callback = vi.fn();
      mockFn('node -v', null, callback);

      // First pattern matches, so 'first' is returned
      expect(callback).toHaveBeenCalledWith(null, { stdout: 'first', stderr: '' });
    });

    it('uses default result when no pattern matches', () => {
      const mockFn = createPatternExecMock(
        [[/specific/, execSuccess('specific')]],
        execSuccess('default')
      );

      const callback = vi.fn();
      mockFn('other-command', null, callback);

      expect(callback).toHaveBeenCalledWith(null, { stdout: 'default', stderr: '' });
    });

    it('returns error when no pattern matches and no default', () => {
      const mockFn = createPatternExecMock([
        [/specific/, execSuccess('specific')],
      ]);

      const callback = vi.fn();
      mockFn('other-command', null, callback);

      const [error] = callback.mock.calls[0];
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('No mock result');
    });

    it('handles error results in patterns', () => {
      const mockFn = createPatternExecMock([
        [/good/, execSuccess('ok')],
        [/bad/, execError('failed')],
      ]);

      const goodCallback = vi.fn();
      const badCallback = vi.fn();

      mockFn('good-cmd', null, goodCallback);
      mockFn('bad-cmd', null, badCallback);

      expect(goodCallback).toHaveBeenCalledWith(null, { stdout: 'ok', stderr: '' });

      const [error] = badCallback.mock.calls[0];
      expect(error.message).toBe('failed');
    });
  });
});
