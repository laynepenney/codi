// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Loader
 *
 * Functions for loading and saving configuration files from disk.
 * Handles global, workspace, and local configuration files.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../logger.js';
import type { WorkspaceConfig } from './types.js';
import { getExampleConfig } from './utils.js';

/**
 * Configuration file names (checked in order).
 */
export const CONFIG_FILES = ['.codi.json', '.codi/config.json', 'codi.config.json'];

/**
 * Local config file name (gitignored, user-specific approvals).
 */
export const LOCAL_CONFIG_FILE = '.codi.local.json';

/**
 * Global config directory path.
 */
export const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.codi');

/**
 * Global config file path.
 */
export const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'config.json');

/**
 * Find and load global configuration from ~/.codi/config.json.
 * This applies to all projects unless overridden by project-specific config.
 * @param overrideDir - Optional directory override for testing
 */
export function loadGlobalConfig(overrideDir?: string): {
  config: WorkspaceConfig | null;
  configPath: string | null;
} {
  const configPath = overrideDir
    ? path.join(overrideDir, 'config.json')
    : GLOBAL_CONFIG_FILE;

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content) as WorkspaceConfig;
      return { config, configPath };
    } catch (error) {
      logger.warn(`Failed to parse ${configPath}: ${error instanceof Error ? error.message : error}`);
      return { config: null, configPath };
    }
  }
  return { config: null, configPath: null };
}

/**
 * Get global config directory path.
 */
export function getGlobalConfigDir(): string {
  return GLOBAL_CONFIG_DIR;
}

/**
 * Find and load workspace configuration from the current directory.
 * Searches for .codi.json, .codi/config.json, or codi.config.json
 */
export function loadWorkspaceConfig(cwd: string = process.cwd()): {
  config: WorkspaceConfig | null;
  configPath: string | null;
} {
  for (const fileName of CONFIG_FILES) {
    const configPath = path.join(cwd, fileName);
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content) as WorkspaceConfig;
        return { config, configPath };
      } catch (error) {
        logger.warn(`Failed to parse ${configPath}: ${error instanceof Error ? error.message : error}`);
        return { config: null, configPath };
      }
    }
  }
  return { config: null, configPath: null };
}

/**
 * Save workspace configuration to .codi.json.
 * Creates the file if it doesn't exist.
 */
export async function saveWorkspaceConfig(
  config: WorkspaceConfig,
  cwd: string = process.cwd()
): Promise<void> {
  const configPath = path.join(cwd, '.codi.json');
  const content = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configPath, content, 'utf-8');
}

/**
 * Load local config file containing user-specific approvals.
 * This file is gitignored and stores approved patterns/categories.
 */
export function loadLocalConfig(cwd: string = process.cwd()): WorkspaceConfig | null {
  const localPath = path.join(cwd, LOCAL_CONFIG_FILE);
  if (fs.existsSync(localPath)) {
    try {
      const content = fs.readFileSync(localPath, 'utf-8');
      return JSON.parse(content) as WorkspaceConfig;
    } catch {
      // Ignore parse errors for local config
    }
  }
  return null;
}

/**
 * Initialize a new .codi.json file in the current directory.
 */
export function initConfig(cwd: string = process.cwd()): {
  success: boolean;
  path: string;
  error?: string;
} {
  const configPath = path.join(cwd, '.codi.json');

  if (fs.existsSync(configPath)) {
    return {
      success: false,
      path: configPath,
      error: 'Config file already exists',
    };
  }

  try {
    fs.writeFileSync(configPath, getExampleConfig());
    return { success: true, path: configPath };
  } catch (error) {
    return {
      success: false,
      path: configPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
