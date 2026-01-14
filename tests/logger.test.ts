// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, LogLevel, parseLogLevel } from '../src/logger.js';

describe('Logger', () => {
  beforeEach(() => {
    // Reset logger to NORMAL level before each test
    logger.setLevel(LogLevel.NORMAL);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseLogLevel', () => {
    it('returns NORMAL when no flags set', () => {
      expect(parseLogLevel({})).toBe(LogLevel.NORMAL);
    });

    it('returns VERBOSE when verbose flag set', () => {
      expect(parseLogLevel({ verbose: true })).toBe(LogLevel.VERBOSE);
    });

    it('returns DEBUG when debug flag set', () => {
      expect(parseLogLevel({ debug: true })).toBe(LogLevel.DEBUG);
    });

    it('returns TRACE when trace flag set', () => {
      expect(parseLogLevel({ trace: true })).toBe(LogLevel.TRACE);
    });

    it('trace takes precedence over debug and verbose', () => {
      expect(parseLogLevel({ trace: true, debug: true, verbose: true })).toBe(LogLevel.TRACE);
    });

    it('debug takes precedence over verbose', () => {
      expect(parseLogLevel({ debug: true, verbose: true })).toBe(LogLevel.DEBUG);
    });
  });

  describe('setLevel and getLevel', () => {
    it('sets and gets log level', () => {
      logger.setLevel(LogLevel.DEBUG);
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });
  });

  describe('isLevelEnabled', () => {
    it('NORMAL level only enables NORMAL', () => {
      logger.setLevel(LogLevel.NORMAL);
      expect(logger.isLevelEnabled(LogLevel.NORMAL)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.VERBOSE)).toBe(false);
      expect(logger.isLevelEnabled(LogLevel.DEBUG)).toBe(false);
      expect(logger.isLevelEnabled(LogLevel.TRACE)).toBe(false);
    });

    it('VERBOSE level enables NORMAL and VERBOSE', () => {
      logger.setLevel(LogLevel.VERBOSE);
      expect(logger.isLevelEnabled(LogLevel.NORMAL)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.VERBOSE)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.DEBUG)).toBe(false);
      expect(logger.isLevelEnabled(LogLevel.TRACE)).toBe(false);
    });

    it('TRACE level enables all levels', () => {
      logger.setLevel(LogLevel.TRACE);
      expect(logger.isLevelEnabled(LogLevel.NORMAL)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.VERBOSE)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.DEBUG)).toBe(true);
      expect(logger.isLevelEnabled(LogLevel.TRACE)).toBe(true);
    });
  });

  describe('verbose', () => {
    it('logs at VERBOSE level', () => {
      logger.setLevel(LogLevel.VERBOSE);
      logger.verbose('test message');
      expect(console.log).toHaveBeenCalled();
    });

    it('does not log at NORMAL level', () => {
      logger.setLevel(LogLevel.NORMAL);
      logger.verbose('test message');
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('debug', () => {
    it('logs at DEBUG level', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('test message');
      expect(console.log).toHaveBeenCalled();
    });

    it('does not log at VERBOSE level', () => {
      logger.setLevel(LogLevel.VERBOSE);
      logger.debug('test message');
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('trace', () => {
    it('logs at TRACE level', () => {
      logger.setLevel(LogLevel.TRACE);
      logger.trace('test message');
      expect(console.log).toHaveBeenCalled();
    });

    it('does not log at DEBUG level', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.trace('test message');
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('toolInput', () => {
    it('logs tool input at VERBOSE level', () => {
      logger.setLevel(LogLevel.VERBOSE);
      logger.toolInput('read_file', { path: '/test/file.ts' });
      expect(console.log).toHaveBeenCalled();
    });

    it('does not log at NORMAL level', () => {
      logger.setLevel(LogLevel.NORMAL);
      logger.toolInput('read_file', { path: '/test/file.ts' });
      expect(console.log).not.toHaveBeenCalled();
    });

    it('truncates long string values', () => {
      logger.setLevel(LogLevel.VERBOSE);
      const longPath = 'a'.repeat(100);
      logger.toolInput('read_file', { path: longPath });
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('toolOutput', () => {
    it('logs tool output at VERBOSE level', () => {
      logger.setLevel(LogLevel.VERBOSE);
      logger.toolOutput('read_file', 'file contents\nline2\nline3', 0.5, false);
      expect(console.log).toHaveBeenCalled();
    });

    it('logs errors differently', () => {
      logger.setLevel(LogLevel.VERBOSE);
      logger.toolOutput('read_file', 'File not found', 0.1, true);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('contextState', () => {
    it('logs at DEBUG level', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.contextState(10, 5000);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('apiRequest', () => {
    it('logs at DEBUG level', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.apiRequest('claude-3-5-sonnet', 5, true);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('apiResponse', () => {
    it('logs at DEBUG level', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.apiResponse(100, 'end_turn', 1.5, 0);
      expect(console.log).toHaveBeenCalled();
    });

    it('includes tool call count when present', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.apiResponse(100, 'tool_use', 1.5, 3);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('always logs errors', () => {
      logger.setLevel(LogLevel.NORMAL);
      logger.error('test error');
      expect(console.error).toHaveBeenCalled();
    });

    it('includes stack trace at DEBUG level', () => {
      logger.setLevel(LogLevel.DEBUG);
      const error = new Error('test');
      logger.error('test error', error);
      expect(console.error).toHaveBeenCalledTimes(2);
    });
  });

  describe('warn', () => {
    it('always logs warnings', () => {
      logger.setLevel(LogLevel.NORMAL);
      logger.warn('test warning');
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('info', () => {
    it('always logs info', () => {
      logger.setLevel(LogLevel.NORMAL);
      logger.info('test info');
      expect(console.log).toHaveBeenCalled();
    });
  });
});
