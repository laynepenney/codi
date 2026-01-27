// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Command history management for the CLI.
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger.js';

export const HISTORY_FILE = process.env.CODI_HISTORY_FILE || join(homedir(), '.codi_history');
export const MAX_HISTORY_SIZE = 1000;

/**
 * Patterns that indicate sensitive data which should not be saved to history.
 * These match common patterns for API keys, tokens, passwords, and credentials.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // API keys and tokens
  /api[_-]?key\s*[=:]/i,
  /auth[_-]?token\s*[=:]/i,
  /bearer\s+[a-z0-9_-]+/i,
  /--key[=\s]/i,
  /--token[=\s]/i,
  /--api-key[=\s]/i,
  /--auth[=\s]/i,

  // Passwords and secrets
  /password\s*[=:]/i,
  /passwd\s*[=:]/i,
  /secret\s*[=:]/i,
  /--password[=\s]/i,
  /--passwd[=\s]/i,
  /--secret[=\s]/i,

  // Common API key formats (long alphanumeric strings that look like keys)
  /sk-[a-zA-Z0-9]{20,}/,  // OpenAI format
  /sk-ant-[a-zA-Z0-9-]+/, // Anthropic format
  /xoxb-[a-zA-Z0-9-]+/,   // Slack bot token format
  /ghp_[a-zA-Z0-9]+/,     // GitHub personal access token

  // Environment variable assignments with sensitive names
  /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|API_KEY|SECRET_KEY|AUTH_TOKEN)\s*=/i,
];

/**
 * Check if a command contains sensitive patterns that should not be saved.
 */
export function containsSensitivePattern(command: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Load command history from file.
 * Node.js readline shows index 0 first when pressing UP, so newest must be first.
 */
export function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const content = readFileSync(HISTORY_FILE, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      // File has oldest first, newest last. Reverse so newest is at index 0.
      return lines.slice(-MAX_HISTORY_SIZE).reverse();
    }
  } catch {
    // Ignore errors reading history
  }
  return [];
}

/**
 * Append a command to history file.
 * Commands containing sensitive patterns (API keys, passwords, etc.) are skipped.
 */
export function saveToHistory(command: string): void {
  if (containsSensitivePattern(command)) {
    logger.debug('Skipping command with sensitive pattern from history');
    return;
  }

  try {
    appendFileSync(HISTORY_FILE, command + '\n');
  } catch {
    // Ignore errors writing history
  }
}
