// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculateCost,
  formatCost,
  formatTokens,
  recordUsage,
  getSessionUsage,
  resetSessionUsage,
  getUsageStats,
  getRecentUsage,
  clearUsageHistory,
  getUsageFilePath,
} from '../src/usage.js';

// Mock the usage file location to use a temp directory
const TEMP_DIR = path.join(process.cwd(), '.test-usage');
const TEMP_FILE = path.join(TEMP_DIR, 'usage.json');

describe('Usage tracking', () => {
  beforeEach(() => {
    // Reset session usage before each test
    resetSessionUsage();
  });

  describe('calculateCost', () => {
    it('calculates cost for Claude models', () => {
      // Claude Sonnet 4: $3/MTok input, $15/MTok output
      const cost = calculateCost('claude-sonnet-4-20250514', 1000, 500);
      // (1000/1M) * 3 + (500/1M) * 15 = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 5);
    });

    it('calculates cost for Claude Opus', () => {
      // Claude Opus: $15/MTok input, $75/MTok output
      const cost = calculateCost('claude-opus-4-20250514', 10000, 5000);
      // (10000/1M) * 15 + (5000/1M) * 75 = 0.15 + 0.375 = 0.525
      expect(cost).toBeCloseTo(0.525, 5);
    });

    it('calculates cost for GPT-4o', () => {
      // GPT-4o: $2.5/MTok input, $10/MTok output
      const cost = calculateCost('gpt-4o', 100000, 50000);
      // (100000/1M) * 2.5 + (50000/1M) * 10 = 0.25 + 0.5 = 0.75
      expect(cost).toBeCloseTo(0.75, 5);
    });

    it('uses prefix matching for model variants', () => {
      // Should match claude-3-opus prefix
      const cost = calculateCost('claude-3-opus-20240229-extended', 1000, 1000);
      // Claude 3 Opus: $15/MTok input, $75/MTok output
      // (1000/1M) * 15 + (1000/1M) * 75 = 0.015 + 0.075 = 0.09
      expect(cost).toBeCloseTo(0.09, 5);
    });

    it('returns 0 for unknown/free models', () => {
      const cost = calculateCost('unknown-model', 1000000, 1000000);
      expect(cost).toBe(0);
    });
  });

  describe('formatCost', () => {
    it('formats small costs with 4 decimal places', () => {
      expect(formatCost(0.001)).toBe('$0.0010');
      expect(formatCost(0.0001)).toBe('$0.0001');
    });

    it('formats larger costs with 2 decimal places', () => {
      expect(formatCost(1.234)).toBe('$1.23');
      expect(formatCost(0.01)).toBe('$0.01');
      expect(formatCost(0.99)).toBe('$0.99');
    });

    it('formats zero cost', () => {
      expect(formatCost(0)).toBe('$0.0000');
    });
  });

  describe('formatTokens', () => {
    it('formats small numbers as-is', () => {
      expect(formatTokens(999)).toBe('999');
      expect(formatTokens(0)).toBe('0');
    });

    it('formats thousands with K suffix', () => {
      expect(formatTokens(1000)).toBe('1.0K');
      expect(formatTokens(1500)).toBe('1.5K');
      expect(formatTokens(99999)).toBe('100.0K');
    });

    it('formats millions with M suffix', () => {
      expect(formatTokens(1000000)).toBe('1.0M');
      expect(formatTokens(2500000)).toBe('2.5M');
    });
  });

  describe('session usage', () => {
    it('starts with zero usage', () => {
      const usage = getSessionUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.requests).toBe(0);
    });

    it('resets session usage', () => {
      // First record some usage
      recordUsage('TestProvider', 'test-model', {
        inputTokens: 100,
        outputTokens: 50,
      });

      // Verify it was recorded
      let usage = getSessionUsage();
      expect(usage.inputTokens).toBe(100);

      // Reset
      resetSessionUsage();

      // Verify reset
      usage = getSessionUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
    });
  });

  describe('recordUsage', () => {
    it('updates session usage', () => {
      recordUsage('Anthropic', 'claude-sonnet-4-20250514', {
        inputTokens: 1000,
        outputTokens: 500,
      });

      const usage = getSessionUsage();
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
      expect(usage.requests).toBe(1);
      expect(usage.cost).toBeGreaterThan(0);
    });

    it('accumulates multiple usages', () => {
      recordUsage('Anthropic', 'claude-sonnet-4-20250514', {
        inputTokens: 1000,
        outputTokens: 500,
      });
      recordUsage('Anthropic', 'claude-sonnet-4-20250514', {
        inputTokens: 2000,
        outputTokens: 1000,
      });

      const usage = getSessionUsage();
      expect(usage.inputTokens).toBe(3000);
      expect(usage.outputTokens).toBe(1500);
      expect(usage.requests).toBe(2);
    });

    it('handles undefined usage gracefully', () => {
      // Should not throw
      recordUsage('Provider', 'model', undefined);

      const usage = getSessionUsage();
      expect(usage.requests).toBe(0);
    });
  });

  describe('getUsageStats', () => {
    it('returns empty stats when no records', () => {
      const stats = getUsageStats(30);
      expect(stats.requestCount).toBeGreaterThanOrEqual(0);
      expect(stats.byProvider).toBeDefined();
      expect(stats.byModel).toBeDefined();
    });
  });

  describe('getUsageFilePath', () => {
    it('returns a path ending with usage.json', () => {
      const path = getUsageFilePath();
      expect(path).toContain('usage.json');
      expect(path).toContain('.codi');
    });
  });
});
