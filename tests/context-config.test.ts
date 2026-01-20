// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  findTier,
  computeContextConfig,
  toLegacyConfig,
  CONTEXT_TIERS,
  FIXED_CONFIG,
} from '../src/context-config.js';

describe('context-config', () => {
  describe('CONTEXT_TIERS', () => {
    it('has tiers in ascending order', () => {
      for (let i = 1; i < CONTEXT_TIERS.length; i++) {
        expect(CONTEXT_TIERS[i].minContext).toBeGreaterThanOrEqual(CONTEXT_TIERS[i - 1].maxContext);
      }
    });

    it('covers all context sizes from 0 to infinity', () => {
      expect(CONTEXT_TIERS[0].minContext).toBe(0);
      expect(CONTEXT_TIERS[CONTEXT_TIERS.length - 1].maxContext).toBe(Infinity);
    });

    it('has reasonable percentages (0 < x <= 1)', () => {
      for (const tier of CONTEXT_TIERS) {
        expect(tier.contextUsagePercent).toBeGreaterThan(0);
        expect(tier.contextUsagePercent).toBeLessThanOrEqual(1);
        expect(tier.safetyBufferPercent).toBeGreaterThan(0);
        expect(tier.safetyBufferPercent).toBeLessThan(1);
        expect(tier.minViablePercent).toBeGreaterThan(0);
        expect(tier.minViablePercent).toBeLessThan(1);
      }
    });
  });

  describe('findTier', () => {
    it('returns small tier for 4k context', () => {
      const tier = findTier(4096);
      expect(tier.name).toBe('small');
    });

    it('returns small tier for 8k context', () => {
      const tier = findTier(8192);
      expect(tier.name).toBe('small');
    });

    it('returns medium tier for 32k context', () => {
      const tier = findTier(32768);
      expect(tier.name).toBe('medium');
    });

    it('returns large tier for 128k context', () => {
      const tier = findTier(131072);
      expect(tier.name).toBe('large');
    });

    it('returns xlarge tier for 200k+ context', () => {
      const tier = findTier(200000);
      expect(tier.name).toBe('xlarge');
    });

    it('returns xlarge tier for 1M context', () => {
      const tier = findTier(1000000);
      expect(tier.name).toBe('xlarge');
    });

    it('handles boundary values correctly', () => {
      // Just below medium boundary
      expect(findTier(16383).name).toBe('small');
      // At medium boundary
      expect(findTier(16384).name).toBe('medium');
      // Just below large boundary
      expect(findTier(65535).name).toBe('medium');
      // At large boundary
      expect(findTier(65536).name).toBe('large');
    });
  });

  describe('computeContextConfig', () => {
    it('computes config for small model (8k)', () => {
      const config = computeContextConfig(8192);

      expect(config.tierName).toBe('small');
      expect(config.contextWindow).toBe(8192);
      expect(config.maxOutputTokens).toBe(FIXED_CONFIG.MAX_OUTPUT_TOKENS);
      expect(config.safetyBuffer).toBeGreaterThan(0);
      expect(config.minViableContext).toBeGreaterThan(0);
      expect(config.maxContextTokens).toBeGreaterThan(0);
      expect(config.maxContextTokens).toBeLessThan(8192); // Less than full context
    });

    it('computes config for medium model (32k)', () => {
      const config = computeContextConfig(32768);

      expect(config.tierName).toBe('medium');
      expect(config.contextWindow).toBe(32768);
      expect(config.maxContextTokens).toBeGreaterThan(8192); // More than small
    });

    it('computes config for large model (128k)', () => {
      const config = computeContextConfig(131072);

      expect(config.tierName).toBe('large');
      expect(config.contextWindow).toBe(131072);
      expect(config.maxContextTokens).toBeGreaterThan(32768); // More than medium
    });

    it('computes config for xlarge model (200k)', () => {
      const config = computeContextConfig(200000);

      expect(config.tierName).toBe('xlarge');
      expect(config.contextWindow).toBe(200000);
    });

    it('reserves space for output tokens on larger models', () => {
      // Use a larger model where output reserve doesn't dominate
      const config = computeContextConfig(131072);
      // Max context should leave room for output
      expect(config.maxContextTokens).toBeLessThan(
        config.contextWindow - config.maxOutputTokens
      );
    });

    it('uses floor value for small models where output reserve dominates', () => {
      // For 8k model, output reserve (8192) would consume all context
      // So we fall back to minViableContext floor
      const config = computeContextConfig(8192);
      expect(config.maxContextTokens).toBe(config.minViableContext);
    });

    it('scales tool result limits with tier', () => {
      const small = computeContextConfig(8192);
      const large = computeContextConfig(131072);

      // Larger tiers should have larger limits
      expect(large.toolResultTruncateThreshold).toBeGreaterThan(small.toolResultTruncateThreshold);
      expect(large.recentToolResultsToKeep).toBeGreaterThan(small.recentToolResultsToKeep);
      expect(large.maxImmediateToolResult).toBeGreaterThan(small.maxImmediateToolResult);
    });

    it('ensures maxContextTokens is at least minViableContext', () => {
      // Even for tiny context, should be at least minimum
      const config = computeContextConfig(1000);
      expect(config.maxContextTokens).toBeGreaterThanOrEqual(config.minViableContext);
    });
  });

  describe('toLegacyConfig', () => {
    it('returns all expected AGENT_CONFIG keys', () => {
      const config = computeContextConfig(32768);
      const legacy = toLegacyConfig(config);

      expect(legacy).toHaveProperty('MAX_ITERATIONS');
      expect(legacy).toHaveProperty('MAX_CONSECUTIVE_ERRORS');
      expect(legacy).toHaveProperty('MAX_CONTEXT_TOKENS');
      expect(legacy).toHaveProperty('MAX_OUTPUT_TOKENS');
      expect(legacy).toHaveProperty('CONTEXT_SAFETY_BUFFER');
      expect(legacy).toHaveProperty('MIN_CONTEXT_PERCENT');
      expect(legacy).toHaveProperty('MIN_VIABLE_CONTEXT');
      expect(legacy).toHaveProperty('RECENT_MESSAGES_TO_KEEP');
      expect(legacy).toHaveProperty('TOOL_RESULT_TRUNCATE_THRESHOLD');
      expect(legacy).toHaveProperty('RECENT_TOOL_RESULTS_TO_KEEP');
      expect(legacy).toHaveProperty('MAX_IMMEDIATE_TOOL_RESULT');
    });

    it('uses fixed config for iterations and errors', () => {
      const config = computeContextConfig(32768);
      const legacy = toLegacyConfig(config);

      expect(legacy.MAX_ITERATIONS).toBe(FIXED_CONFIG.MAX_ITERATIONS);
      expect(legacy.MAX_CONSECUTIVE_ERRORS).toBe(FIXED_CONFIG.MAX_CONSECUTIVE_ERRORS);
    });

    it('uses computed values for context-related settings', () => {
      const config = computeContextConfig(32768);
      const legacy = toLegacyConfig(config);

      expect(legacy.MAX_CONTEXT_TOKENS).toBe(config.maxContextTokens);
      expect(legacy.MAX_OUTPUT_TOKENS).toBe(config.maxOutputTokens);
      expect(legacy.CONTEXT_SAFETY_BUFFER).toBe(config.safetyBuffer);
      expect(legacy.MIN_VIABLE_CONTEXT).toBe(config.minViableContext);
    });
  });

  describe('FIXED_CONFIG', () => {
    it('has expected fixed values', () => {
      expect(FIXED_CONFIG.MAX_ITERATIONS).toBe(2000);
      expect(FIXED_CONFIG.MAX_CONSECUTIVE_ERRORS).toBe(3);
      expect(FIXED_CONFIG.MAX_OUTPUT_TOKENS).toBe(8192);
    });
  });

  describe('tier scaling', () => {
    it('larger tiers use more context', () => {
      const tiers = ['small', 'medium', 'large', 'xlarge'];
      const usagePercents = CONTEXT_TIERS.map(t => t.contextUsagePercent);

      // Each tier should use >= the previous tier
      for (let i = 1; i < usagePercents.length; i++) {
        expect(usagePercents[i]).toBeGreaterThanOrEqual(usagePercents[i - 1]);
      }
    });

    it('larger tiers have smaller safety buffers (as %)' , () => {
      const safetyPercents = CONTEXT_TIERS.map(t => t.safetyBufferPercent);

      // Each tier should have smaller or equal safety buffer %
      for (let i = 1; i < safetyPercents.length; i++) {
        expect(safetyPercents[i]).toBeLessThanOrEqual(safetyPercents[i - 1]);
      }
    });

    it('larger tiers keep more recent messages', () => {
      const recentMessages = CONTEXT_TIERS.map(t => t.recentMessagesToKeep);

      for (let i = 1; i < recentMessages.length; i++) {
        expect(recentMessages[i]).toBeGreaterThanOrEqual(recentMessages[i - 1]);
      }
    });
  });
});
