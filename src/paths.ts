// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Centralized path management for Codi.
 *
 * All .codi directory paths are defined here as a single source of truth.
 * This makes it easier to:
 * - Find all paths used by Codi
 * - Support test overrides via environment variables
 * - Ensure consistent directory structure
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/**
 * Check if we're running in a test environment.
 */
function isTestEnvironment(): boolean {
  return Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
}

/**
 * Get the base Codi directory.
 * Supports test override via CODI_HOME environment variable.
 */
export function getCodiHome(): string {
  if (process.env.CODI_HOME) {
    return process.env.CODI_HOME;
  }
  return join(homedir(), '.codi');
}

/**
 * Get a test-specific base directory for isolation.
 * Uses process PID to avoid conflicts between parallel tests.
 */
function getTestCodiHome(): string {
  return join(tmpdir(), `.codi-test-${process.pid}`);
}

/**
 * Centralized path definitions for all Codi directories and files.
 *
 * Each path getter is a function that computes the path at call time,
 * allowing for test overrides via environment variables.
 */
export const CodiPaths = {
  /**
   * Base Codi directory (~/.codi)
   */
  home: (): string => getCodiHome(),

  // ============================================
  // Session Management
  // ============================================

  /**
   * Sessions directory for saved conversations
   */
  sessions: (): string => join(getCodiHome(), 'sessions'),

  /**
   * Get path for a specific session file
   */
  sessionFile: (name: string): string => {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(CodiPaths.sessions(), `${safeName}.json`);
  },

  // ============================================
  // History (Undo/Redo)
  // ============================================

  /**
   * History directory for file change tracking.
   * Supports test override via CODI_HISTORY_DIR.
   */
  history: (): string => {
    if (process.env.CODI_HISTORY_DIR) {
      return process.env.CODI_HISTORY_DIR;
    }
    if (isTestEnvironment()) {
      return join(getTestCodiHome(), 'history');
    }
    return join(getCodiHome(), 'history');
  },

  /**
   * History index file
   */
  historyIndex: (): string => join(CodiPaths.history(), 'index.json'),

  /**
   * History backups directory
   */
  historyBackups: (): string => join(CodiPaths.history(), 'backups'),

  /**
   * Get path for a specific history backup file
   */
  historyBackupFile: (id: string): string => join(CodiPaths.historyBackups(), `${id}.backup`),

  // ============================================
  // Audit Logging
  // ============================================

  /**
   * Audit logs directory
   */
  audit: (): string => join(getCodiHome(), 'audit'),

  /**
   * Get path for a specific audit log file
   */
  auditFile: (sessionId: string): string => join(CodiPaths.audit(), `${sessionId}.jsonl`),

  // ============================================
  // Plugins
  // ============================================

  /**
   * Plugins directory for third-party extensions
   */
  plugins: (): string => join(getCodiHome(), 'plugins'),

  // ============================================
  // Usage Tracking
  // ============================================

  /**
   * Usage data file for cost tracking
   */
  usageFile: (): string => join(getCodiHome(), 'usage.json'),

  // ============================================
  // Debug Bridge
  // ============================================

  /**
   * Debug bridge directory
   */
  debug: (): string => join(getCodiHome(), 'debug'),

  /**
   * Debug sessions directory
   */
  debugSessions: (): string => join(CodiPaths.debug(), 'sessions'),

  /**
   * Symlink to current debug session
   */
  debugCurrentSession: (): string => join(CodiPaths.debug(), 'current'),

  /**
   * Debug session index file
   */
  debugIndex: (): string => join(CodiPaths.debug(), 'index.json'),

  /**
   * Get path for a specific debug session directory
   */
  debugSessionDir: (sessionId: string): string => join(CodiPaths.debugSessions(), sessionId),

  // ============================================
  // Cache Directories
  // ============================================

  /**
   * Base cache directory
   */
  cache: (): string => join(getCodiHome(), 'cache'),

  /**
   * Pipeline result cache directory
   */
  pipelineCache: (): string => join(CodiPaths.cache(), 'pipeline'),

  /**
   * Tool result cache directory
   */
  toolCache: (): string => join(getCodiHome(), 'tool-cache'),

  // ============================================
  // Memory System
  // ============================================

  /**
   * User profile file (YAML)
   */
  profile: (): string => join(getCodiHome(), 'profile.yaml'),

  /**
   * Persistent memories file (Markdown)
   */
  memories: (): string => join(getCodiHome(), 'memories.md'),

  /**
   * Session notes file (temporary, for consolidation)
   */
  sessionNotes: (): string => join(getCodiHome(), 'session-notes.md'),

  // ============================================
  // Custom Commands
  // ============================================

  /**
   * Custom commands directory
   */
  commands: (): string => join(getCodiHome(), 'commands'),

  // ============================================
  // Model Map Configuration
  // ============================================

  /**
   * Global model map config file
   */
  globalModelMap: (): string => join(getCodiHome(), 'models.yaml'),

  /**
   * Alternative global model map config file
   */
  globalModelMapAlt: (): string => join(getCodiHome(), 'models.yml'),

  // ============================================
  // Orchestration
  // ============================================

  /**
   * Orchestrator socket file path
   */
  orchestratorSocket: (): string => join(getCodiHome(), 'orchestrator.sock'),

  // ============================================
  // Transcripts
  // ============================================

  /**
   * Transcripts directory for conversation exports
   */
  transcripts: (): string => join(getCodiHome(), 'transcripts'),
} as const;

/**
 * Ensure the base Codi directory exists.
 * This is a convenience function for modules that need to create files.
 */
export function ensureCodiHome(): void {
  const home = getCodiHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }
}

/**
 * Ensure a specific directory exists.
 * Creates parent directories as needed.
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
