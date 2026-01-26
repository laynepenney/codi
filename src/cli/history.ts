// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Command history management for the CLI.
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HISTORY_FILE = process.env.CODI_HISTORY_FILE || join(homedir(), '.codi_history');
export const MAX_HISTORY_SIZE = 1000;

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
 */
export function saveToHistory(command: string): void {
  try {
    appendFileSync(HISTORY_FILE, command + '\n');
  } catch {
    // Ignore errors writing history
  }
}
