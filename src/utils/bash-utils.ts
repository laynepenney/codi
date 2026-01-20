// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bash command safety utilities.
 * Extracted from agent.ts for reusability.
 */

import { DANGEROUS_BASH_PATTERNS, type DangerousPattern } from '../constants.js';

/**
 * Result of checking a bash command for dangerous patterns.
 */
export interface DangerousCheckResult {
  isDangerous: boolean;
  reason?: string;
  shouldBlock?: boolean;
}

/**
 * Check if a bash command matches any dangerous patterns.
 * Returns information about the match including whether it should be blocked.
 */
export function checkDangerousBash(
  command: string,
  additionalPatterns?: DangerousPattern[]
): DangerousCheckResult {
  const patterns = additionalPatterns
    ? [...DANGEROUS_BASH_PATTERNS, ...additionalPatterns]
    : DANGEROUS_BASH_PATTERNS;

  for (const { pattern, description, block } of patterns) {
    if (pattern.test(command)) {
      return {
        isDangerous: true,
        reason: description,
        shouldBlock: block,
      };
    }
  }
  return { isDangerous: false };
}

/**
 * Get only the blocking patterns (for tool-level safety).
 */
export function getBlockingPatterns(): DangerousPattern[] {
  return DANGEROUS_BASH_PATTERNS.filter(p => p.block);
}
