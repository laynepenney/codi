// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Tier-based context configuration.
 * Provides dynamic configuration based on model context window size.
 */

import { logger } from './logger.js';

/**
 * Context tier configuration.
 * Each tier defines behavior for models with context windows in a given range.
 */
export interface ContextTier {
  /** Tier name for logging/debugging */
  name: string;
  /** Minimum context window size for this tier (inclusive) */
  minContext: number;
  /** Maximum context window size for this tier (exclusive, Infinity for largest) */
  maxContext: number;

  // Percentages of context window
  /** What percentage of context window to actually use (e.g., 0.85 = 85%) */
  contextUsagePercent: number;
  /** Safety buffer as percentage of context window */
  safetyBufferPercent: number;
  /** Minimum viable context as percentage of context window */
  minViablePercent: number;

  // Absolute values that scale with tier
  /** Number of recent messages to keep verbatim during compaction */
  recentMessagesToKeep: number;
  /** Truncate old tool results longer than this (characters) */
  toolResultTruncateThreshold: number;
  /** Number of recent tool results to keep untruncated */
  recentToolResultsToKeep: number;
  /** Maximum immediate tool result size (characters) */
  maxImmediateToolResult: number;
}

/**
 * Computed context configuration for a specific model.
 */
export interface ComputedContextConfig {
  /** The tier that was selected */
  tierName: string;
  /** Model's context window size */
  contextWindow: number;

  // Computed token limits
  /** Maximum tokens to use for context (after reservations) */
  maxContextTokens: number;
  /** Tokens reserved for model output */
  maxOutputTokens: number;
  /** Safety buffer in tokens */
  safetyBuffer: number;
  /** Minimum viable context in tokens (warn if below) */
  minViableContext: number;

  // Message management
  /** Recent messages to keep during compaction */
  recentMessagesToKeep: number;
  /** Tool result truncation threshold (characters) */
  toolResultTruncateThreshold: number;
  /** Recent tool results to keep untruncated */
  recentToolResultsToKeep: number;
  /** Maximum immediate tool result (characters) */
  maxImmediateToolResult: number;
}

/**
 * Fixed configuration values that don't change with tier.
 */
export const FIXED_CONFIG = {
  /** Maximum agent loop iterations (prevents infinite loops) */
  MAX_ITERATIONS: 2000,
  /** Stop after this many consecutive errors */
  MAX_CONSECUTIVE_ERRORS: 3,
  /** Tokens reserved for model output (applies to all tiers) */
  MAX_OUTPUT_TOKENS: 8192,
} as const;

/**
 * Context tiers ordered from smallest to largest.
 * Each tier is tailored for models with context windows in that range.
 */
export const CONTEXT_TIERS: ContextTier[] = [
  {
    name: 'small',
    minContext: 0,
    maxContext: 16_384, // Up to 16k
    contextUsagePercent: 0.75, // More conservative for small contexts
    safetyBufferPercent: 0.05, // 5% safety buffer
    minViablePercent: 0.15, // Need at least 15% of context
    recentMessagesToKeep: 4,
    toolResultTruncateThreshold: 50_000, // 50k chars
    recentToolResultsToKeep: 5,
    maxImmediateToolResult: 30_000, // 30k chars
  },
  {
    name: 'medium',
    minContext: 16_384,
    maxContext: 65_536, // 16k to 64k
    contextUsagePercent: 0.80, // Can use more
    safetyBufferPercent: 0.03, // 3% safety buffer
    minViablePercent: 0.10, // Need at least 10%
    recentMessagesToKeep: 8,
    toolResultTruncateThreshold: 100_000, // 100k chars
    recentToolResultsToKeep: 10,
    maxImmediateToolResult: 75_000, // 75k chars
  },
  {
    name: 'large',
    minContext: 65_536,
    maxContext: 200_000, // 64k to 200k
    contextUsagePercent: 0.85, // More aggressive
    safetyBufferPercent: 0.02, // 2% safety buffer
    minViablePercent: 0.05, // Need at least 5%
    recentMessagesToKeep: 15,
    toolResultTruncateThreshold: 300_000, // 300k chars
    recentToolResultsToKeep: 20,
    maxImmediateToolResult: 200_000, // 200k chars
  },
  {
    name: 'xlarge',
    minContext: 200_000,
    maxContext: Infinity, // 200k+
    contextUsagePercent: 0.90, // Very aggressive
    safetyBufferPercent: 0.015, // 1.5% safety buffer
    minViablePercent: 0.03, // Need at least 3%
    recentMessagesToKeep: 25,
    toolResultTruncateThreshold: 500_000, // 500k chars
    recentToolResultsToKeep: 30,
    maxImmediateToolResult: 500_000, // 500k chars
  },
];

/**
 * Find the appropriate tier for a given context window size.
 */
export function findTier(contextWindow: number): ContextTier {
  for (const tier of CONTEXT_TIERS) {
    if (contextWindow >= tier.minContext && contextWindow < tier.maxContext) {
      return tier;
    }
  }
  // Fallback to largest tier (should never happen due to Infinity)
  return CONTEXT_TIERS[CONTEXT_TIERS.length - 1];
}

/**
 * Compute context configuration for a specific model context window.
 */
export function computeContextConfig(contextWindow: number): ComputedContextConfig {
  const tier = findTier(contextWindow);

  // Calculate derived values
  const safetyBuffer = Math.ceil(contextWindow * tier.safetyBufferPercent);
  const outputReserve = FIXED_CONFIG.MAX_OUTPUT_TOKENS;
  const usableContext = Math.floor(contextWindow * tier.contextUsagePercent);
  const maxContextTokens = usableContext - outputReserve - safetyBuffer;
  const minViableContext = Math.ceil(contextWindow * tier.minViablePercent);

  const config: ComputedContextConfig = {
    tierName: tier.name,
    contextWindow,
    maxContextTokens: Math.max(maxContextTokens, minViableContext), // At least minViable
    maxOutputTokens: outputReserve,
    safetyBuffer,
    minViableContext,
    recentMessagesToKeep: tier.recentMessagesToKeep,
    toolResultTruncateThreshold: tier.toolResultTruncateThreshold,
    recentToolResultsToKeep: tier.recentToolResultsToKeep,
    maxImmediateToolResult: tier.maxImmediateToolResult,
  };

  logger.debug(
    `Context config for ${contextWindow} tokens (${tier.name} tier): ` +
    `maxContext=${config.maxContextTokens}, safety=${config.safetyBuffer}, minViable=${config.minViableContext}`
  );

  return config;
}

/**
 * Get a legacy-compatible AGENT_CONFIG object from computed config.
 * This allows gradual migration from the old static config.
 */
export function toLegacyConfig(config: ComputedContextConfig): {
  MAX_ITERATIONS: number;
  MAX_CONSECUTIVE_ERRORS: number;
  MAX_CONTEXT_TOKENS: number;
  MAX_OUTPUT_TOKENS: number;
  CONTEXT_SAFETY_BUFFER: number;
  MIN_CONTEXT_PERCENT: number;
  MIN_VIABLE_CONTEXT: number;
  RECENT_MESSAGES_TO_KEEP: number;
  TOOL_RESULT_TRUNCATE_THRESHOLD: number;
  RECENT_TOOL_RESULTS_TO_KEEP: number;
  MAX_IMMEDIATE_TOOL_RESULT: number;
} {
  // Find the tier to get the percentage
  const tier = findTier(config.contextWindow);

  return {
    MAX_ITERATIONS: FIXED_CONFIG.MAX_ITERATIONS,
    MAX_CONSECUTIVE_ERRORS: FIXED_CONFIG.MAX_CONSECUTIVE_ERRORS,
    MAX_CONTEXT_TOKENS: config.maxContextTokens,
    MAX_OUTPUT_TOKENS: config.maxOutputTokens,
    CONTEXT_SAFETY_BUFFER: config.safetyBuffer,
    MIN_CONTEXT_PERCENT: tier.minViablePercent,
    MIN_VIABLE_CONTEXT: config.minViableContext,
    RECENT_MESSAGES_TO_KEEP: config.recentMessagesToKeep,
    TOOL_RESULT_TRUNCATE_THRESHOLD: config.toolResultTruncateThreshold,
    RECENT_TOOL_RESULTS_TO_KEEP: config.recentToolResultsToKeep,
    MAX_IMMEDIATE_TOOL_RESULT: config.maxImmediateToolResult,
  };
}
