// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

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
  getMessageText,
  countMessageTokens,
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
} from './tool-result-utils.js';

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
