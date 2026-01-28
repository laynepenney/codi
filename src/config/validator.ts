// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Validator
 *
 * Functions for validating workspace configuration.
 */

import type { WorkspaceConfig } from './types.js';

/**
 * Valid provider names.
 */
const VALID_PROVIDERS = ['anthropic', 'openai', 'ollama', 'runpod', 'auto'];

/**
 * Valid tool names for auto-approval.
 */
const VALID_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'patch_file', 'insert_line',
  'glob', 'grep', 'list_directory', 'bash',
];

/**
 * Validate workspace configuration.
 * Returns an array of warning messages for invalid options.
 */
export function validateConfig(config: WorkspaceConfig): string[] {
  const warnings: string[] = [];

  // Validate provider
  if (config.provider && !VALID_PROVIDERS.includes(config.provider)) {
    warnings.push(`Unknown provider "${config.provider}". Valid: ${VALID_PROVIDERS.join(', ')}`);
  }

  // Validate autoApprove tools
  if (config.autoApprove) {
    for (const tool of config.autoApprove) {
      if (!VALID_TOOLS.includes(tool)) {
        warnings.push(`Unknown tool in autoApprove: "${tool}". Valid: ${VALID_TOOLS.join(', ')}`);
      }
    }
  }

  // Validate dangerousPatterns are valid regex
  if (config.dangerousPatterns) {
    for (const pattern of config.dangerousPatterns) {
      try {
        new RegExp(pattern);
      } catch {
        warnings.push(`Invalid regex in dangerousPatterns: "${pattern}"`);
      }
    }
  }

  // Validate commandAliases
  if (config.commandAliases) {
    for (const [alias, command] of Object.entries(config.commandAliases)) {
      if (!command.startsWith('/')) {
        warnings.push(`Command alias "${alias}" should start with "/": "${command}"`);
      }
    }
  }

  if (config.maxContextTokens !== undefined) {
    if (!Number.isFinite(config.maxContextTokens) || config.maxContextTokens <= 0) {
      warnings.push('maxContextTokens must be a positive number');
    }
  }

  return warnings;
}
