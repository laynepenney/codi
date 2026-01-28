// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Module
 *
 * This module provides configuration loading, validation, and merging for Codi.
 * Types are separated into types.ts for better organization.
 *
 * Usage:
 *   import { WorkspaceConfig, ResolvedConfig, loadWorkspaceConfig, mergeConfig } from './config/index.js';
 *   // or
 *   import { WorkspaceConfig, ResolvedConfig } from './config/types.js';
 */

// Re-export all types
export type {
  WorkspaceConfig,
  ApprovedPatternConfig,
  ApprovedPathPatternConfig,
  ToolsConfig,
  ResolvedConfig,
} from './types.js';

// Re-export functions from main config module
// Note: The main config.ts will be updated to import types from here
export {
  loadGlobalConfig,
  getGlobalConfigDir,
  loadWorkspaceConfig,
  loadLocalConfig,
  validateConfig,
  mergeConfig,
  shouldAutoApprove,
  getCustomDangerousPatterns,
  isToolDisabled,
  getToolDefaults,
  mergeToolInput,
  getExampleConfig,
  initConfig,
} from '../config.js';
