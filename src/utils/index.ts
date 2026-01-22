// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Utility functions extracted from agent.ts and other modules.
 * Re-exports all utilities for convenient importing.
 */

// JSON parsing utilities
export {
  tryFixJson,
  tryParseJson,
  extractToolCallsFromText,
} from './json-parser.js';

// Token counting utilities
export {
  estimateTokens,
  estimateSystemPromptTokens,
  estimateToolDefinitionTokens,
  estimateTotalContextTokens,
  getMessageText,
  countMessageTokens,
  updateCalibration,
  getCalibrationData,
  resetCalibration,
} from './token-counter.js';

// Message analysis utilities
export {
  hasToolResultBlocks,
  hasToolUseBlocks,
  findSafeStartIndex,
} from './message-utils.js';

// Tool result processing utilities
export {
  summarizeToolResult,
  truncateOldToolResults,
  isToolResultTruncated,
  extractCacheId,
  type ToolResultConfig,
} from './tool-result-utils.js';

// Tool result caching for RAG-like retrieval
export {
  generateCacheId,
  cacheToolResult,
  getCachedResult,
  hasCachedResult,
  listCachedResults,
  cleanupCache,
  clearCache,
  type CachedToolResult,
} from './tool-result-cache.js';

// Image parsing utilities
export {
  parseImageResult,
  type ParsedImageResult,
} from './image-parser.js';

// Bash safety utilities
export {
  checkDangerousBash,
  getBlockingPatterns,
  type DangerousCheckResult,
} from './bash-utils.js';

// Vector utilities for embeddings
export {
  cosineSimilarity,
  groupBySimilarity,
} from './vector.js';
