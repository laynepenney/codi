// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Centralized constants for the Codi application.
 * Extracted from agent.ts and bash.ts to provide a single source of truth.
 */

/**
 * Model-specific context window overrides.
 * For models where the API reports incorrect context window values.
 * Map of model name pattern -> true context window size.
 */
export const MODEL_CONTEXT_OVERRIDES: Record<string, number> = {
  // GLM models from Ollama Cloud report incorrect values
  // These models claim 120K but actually have 8K-32K context
  'glm-4': 8192,
  'glm-4.7': 8192,
  'glm-4-air': 32768,
  'glm-4-flash': 32768,
  // Add other models with incorrect API values here
};

/**
 * Agent loop configuration.
 */
export const AGENT_CONFIG = {
  /** Maximum iterations before stopping (prevents infinite loops) */
  MAX_ITERATIONS: 2000,
  /** Stop after this many consecutive errors */
  MAX_CONSECUTIVE_ERRORS: 3,
  /** Fallback context token limit (used when adaptive calculation unavailable) */
  MAX_CONTEXT_TOKENS: 120000,
  /** Maximum output tokens to reserve for model response */
  MAX_OUTPUT_TOKENS: 8192,
  /** Safety buffer for context calculations (tokens) */
  CONTEXT_SAFETY_BUFFER: 2000,
  /** Minimum percentage of context window to use (floor for adaptive calculation) */
  MIN_CONTEXT_PERCENT: 0.3,
  /** Warn when message budget falls below this threshold */
  MIN_VIABLE_CONTEXT: 5000,
  /** Keep this many recent messages verbatim during compaction */
  RECENT_MESSAGES_TO_KEEP: 600,
  /** Truncate old tool results longer than this (characters) */
  TOOL_RESULT_TRUNCATE_THRESHOLD: 500000,
  /**
   * Tool result token budget is now tier-based (see context-config.ts).
   * Small: 20%, Medium: 25%, Large: 30%, XLarge: 35% of context window.
   * Truncated results are cached for retrieval via recall_result tool.
   */
  TOOL_RESULTS_TOKEN_BUDGET_PERCENT: 0.25,
  /** Truncate immediate tool results longer than this (characters) - helps smaller models */
  MAX_IMMEDIATE_TOOL_RESULT: 500000,
} as const;

/**
 * Tool safety categories.
 */
export const TOOL_CATEGORIES = {
  /** Tools that only read data and are safe to auto-approve */
  SAFE: new Set(['read_file', 'glob', 'grep', 'list_directory']),
  /** Tools that modify the filesystem and need confirmation */
  DESTRUCTIVE: new Set(['write_file', 'edit_file', 'insert_line', 'patch_file', 'bash']),
} as const;

/**
 * Dangerous bash command patterns.
 * Used for both warning (agent-level) and blocking (tool-level).
 */
export interface DangerousPattern {
  pattern: RegExp;
  description: string;
  /** If true, the command should be blocked entirely */
  block?: boolean;
}

export const DANGEROUS_BASH_PATTERNS: DangerousPattern[] = [
  // Blocking patterns (extremely dangerous, blocked at tool level)
  { pattern: /rm\s+-rf\s+\/(?!\w)/, description: 'removes root filesystem', block: true },
  { pattern: /mkfs\./, description: 'formats filesystem', block: true },
  { pattern: /dd\s+.*of=\/dev/, description: 'direct disk write', block: true },
  { pattern: />\s*\/dev\/sd[a-z]/, description: 'overwrites disk device', block: true },

  // Warning patterns (dangerous, but may be intentional)
  { pattern: /\brm\s+(-[rf]+\s+)*[\/~]/, description: 'removes files/directories' },
  { pattern: /\brm\s+-[rf]*\s/, description: 'force/recursive delete' },
  { pattern: /\bsudo\b/, description: 'runs as superuser' },
  { pattern: /\bchmod\s+777\b/, description: 'sets insecure permissions' },
  { pattern: /\b(mkfs|dd\s+if=)/, description: 'disk/filesystem operation' },
  { pattern: />\s*\/dev\//, description: 'writes to device' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh/, description: 'pipes remote script to shell' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh/, description: 'pipes remote script to shell' },
  { pattern: /\bgit\s+push\s+.*--force/, description: 'force pushes to remote' },
  { pattern: /\bgit\s+reset\s+--hard/, description: 'hard reset (loses changes)' },
];

/**
 * Bash tool configuration.
 */
export const BASH_CONFIG = {
  /** Command execution timeout in milliseconds */
  TIMEOUT_MS: 30000,
  /** Maximum output length before truncation */
  MAX_OUTPUT_LENGTH: 50000,
} as const;

/**
 * CLI history configuration.
 */
export const CLI_CONFIG = {
  /** Maximum number of history entries to keep */
  MAX_HISTORY_SIZE: 1000,
} as const;

/**
 * Context optimization configuration.
 */
export const CONTEXT_OPTIMIZATION = {
  // Semantic deduplication
  /** Merge case variants (UserService, userService -> UserService) */
  MERGE_CASE_VARIANTS: true,
  /** Merge semantic synonyms (auth, authentication -> authentication) */
  MERGE_SIMILAR_NAMES: true,
  /** Minimum similarity score for Levenshtein-based merging (0-1) */
  MIN_SIMILARITY_SCORE: 0.8,

  // Importance scoring weights (should sum to ~1.0)
  WEIGHTS: {
    recency: 0.25,          // Recent messages are important
    referenceCount: 0.15,   // Often-referenced content is important
    userEmphasis: 0.25,     // User messages and emphasis markers
    actionRelevance: 0.2,   // Tool calls and results
    codeRelevance: 0.15,    // Messages about indexed code (RAG-enhanced)
  },

  // Smart windowing
  /** Minimum recent messages to always keep */
  MIN_RECENT_MESSAGES: 3,
  /** Maximum messages to keep (hard cap) */
  MAX_MESSAGES: 20,
  /** Keep messages with importance score >= this threshold */
  IMPORTANCE_THRESHOLD: 0.4,
  /** Never split tool_use from tool_result */
  PRESERVE_TOOL_PAIRS: true,
  /** Keep messages referencing recently accessed files */
  PRESERVE_WORKING_SET: true,
} as const;
