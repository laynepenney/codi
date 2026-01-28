// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Module
 *
 * This module provides configuration loading, validation, and merging for Codi.
 * The implementation is split across multiple files for better organization:
 *
 * - types.ts    - Type definitions (WorkspaceConfig, ResolvedConfig, etc.)
 * - loader.ts   - File I/O (load/save config files)
 * - validator.ts - Config validation
 * - merger.ts   - Config merging with priority handling
 * - utils.ts    - Utility functions
 *
 * Usage:
 *   import { WorkspaceConfig, ResolvedConfig, loadWorkspaceConfig, mergeConfig } from './config/index.js';
 *   // or import specific modules:
 *   import { WorkspaceConfig, ResolvedConfig } from './config/types.js';
 *   import { loadWorkspaceConfig } from './config/loader.js';
 */

// Re-export all types
export type {
  WorkspaceConfig,
  ApprovedPatternConfig,
  ApprovedPathPatternConfig,
  ToolsConfig,
  ResolvedConfig,
} from './types.js';

// Re-export from loader
export {
  CONFIG_FILES,
  LOCAL_CONFIG_FILE,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  loadGlobalConfig,
  getGlobalConfigDir,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  loadLocalConfig,
  initConfig,
} from './loader.js';

// Re-export from validator
export { validateConfig } from './validator.js';

// Re-export from merger
export { DEFAULT_CONFIG, mergeConfig } from './merger.js';
export type { CLIOptions } from './merger.js';

// Re-export from utils
export {
  shouldAutoApprove,
  getCustomDangerousPatterns,
  isToolDisabled,
  getToolDefaults,
  mergeToolInput,
  getExampleConfig,
} from './utils.js';
