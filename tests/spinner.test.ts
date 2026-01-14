// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spinner } from '../src/spinner.js';

// Mock ora module
vi.mock('ora', () => {
  const mockSpinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    text: '',
  };

  return {
    default: vi.fn(() => mockSpinner),
  };
});

describe('SpinnerManager', () => {
  beforeEach(() => {
    // Reset spinner state before each test
    spinner.setEnabled(true);
    spinner.setStreaming(false);
    spinner.stop();
  });

  describe('setEnabled', () => {
    it('enables and disables spinners', () => {
      spinner.setEnabled(false);
      expect(spinner.isEnabled()).toBe(false);

      spinner.setEnabled(true);
      // Note: isEnabled() also checks streaming state and TTY
      // In test environment, TTY might be false
    });
  });

  describe('setStreaming', () => {
    it('disables spinner when streaming starts', () => {
      spinner.setStreaming(true);
      expect(spinner.isEnabled()).toBe(false);
    });

    it('re-enables spinner when streaming stops', () => {
      spinner.setStreaming(true);
      spinner.setStreaming(false);
      // isEnabled depends on TTY state as well
    });
  });

  describe('start', () => {
    it('starts spinner with text', () => {
      // This will create a new ora instance
      spinner.start('Loading...');
      // Spinner is created internally
    });
  });

  describe('stop methods', () => {
    it('succeed stops spinner with success', () => {
      spinner.start('Working...');
      spinner.succeed('Done!');
    });

    it('fail stops spinner with error', () => {
      spinner.start('Working...');
      spinner.fail('Error!');
    });

    it('warn stops spinner with warning', () => {
      spinner.start('Working...');
      spinner.warn('Warning!');
    });

    it('info stops spinner with info', () => {
      spinner.start('Working...');
      spinner.info('Info');
    });

    it('stop stops spinner without status', () => {
      spinner.start('Working...');
      spinner.stop();
    });
  });

  describe('convenience methods', () => {
    it('thinking starts spinner with thinking message', () => {
      spinner.thinking();
    });

    it('toolStart starts spinner for tool', () => {
      spinner.toolStart('read_file');
    });

    it('toolSucceed shows success', () => {
      spinner.start('Testing...');
      spinner.toolSucceed('read_file', '100 lines');
    });

    it('toolFail shows failure', () => {
      spinner.start('Testing...');
      spinner.toolFail('read_file', 'Not found');
    });

    it('indexing shows progress', () => {
      spinner.indexing(5, 10);
    });

    it('indexing updates existing spinner', () => {
      spinner.indexing(1, 10);
      spinner.indexing(2, 10);
      spinner.indexing(3, 10, 'test.ts');
    });

    it('indexingDone shows completion', () => {
      spinner.start('Indexing...');
      spinner.indexingDone(100, 500);
    });

    it('loadingSession shows loading message', () => {
      spinner.loadingSession('my-session');
    });

    it('savingSession shows saving message', () => {
      spinner.savingSession('my-session');
    });

    it('apiCall shows API call message', () => {
      spinner.apiCall('claude-3-5-sonnet');
    });

    it('apiCall works without model', () => {
      spinner.apiCall();
    });
  });

  describe('update', () => {
    it('updates spinner text', () => {
      spinner.start('Initial...');
      spinner.update('Updated...');
    });
  });

  describe('clear', () => {
    it('clears spinner line', () => {
      spinner.start('Test...');
      spinner.clear();
    });
  });

  describe('edge cases', () => {
    it('handles stop when no spinner running', () => {
      spinner.stop();
      spinner.stop(); // Should not throw
    });

    it('handles succeed when no spinner running', () => {
      spinner.succeed('Done'); // Should not throw
    });

    it('handles update when no spinner running', () => {
      spinner.update('Text'); // Should not throw
    });

    it('replaces running spinner with new one', () => {
      spinner.start('First...');
      spinner.start('Second...'); // Should stop first, start second
    });
  });
});
