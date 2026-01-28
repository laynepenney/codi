// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Module - Re-exports
 *
 * This file maintains backwards compatibility by re-exporting all config
 * functionality from the config/ directory. New code should import directly
 * from './config/index.js' or specific submodules.
 *
 * The implementation is split across:
 * - config/types.ts    - Type definitions
 * - config/loader.ts   - File I/O operations
 * - config/validator.ts - Config validation
 * - config/merger.ts   - Config merging
 * - config/utils.ts    - Utility functions
 */

// Re-export everything from the config module
export type {
  WorkspaceConfig,
  ApprovedPatternConfig,
  ApprovedPathPatternConfig,
  ToolsConfig,
  ResolvedConfig,
} from './config/index.js';

export {
  // Loader exports
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
  // Validator exports
  validateConfig,
  // Merger exports
  DEFAULT_CONFIG,
  mergeConfig,
  // Utility exports
  shouldAutoApprove,
  getCustomDangerousPatterns,
  isToolDisabled,
  getToolDefaults,
  mergeToolInput,
  getExampleConfig,
} from './config/index.js';

export type { CLIOptions } from './config/index.js';
