// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Utilities
 *
 * Helper functions for working with resolved configuration.
 */

import { AGENT_CONFIG } from '../constants.js';
import type { WorkspaceConfig, ResolvedConfig } from './types.js';

/**
 * Check if a tool should be auto-approved based on config.
 */
export function shouldAutoApprove(toolName: string, config: ResolvedConfig): boolean {
  return config.autoApprove.includes(toolName);
}

/**
 * Get additional dangerous patterns from config as RegExp objects.
 */
export function getCustomDangerousPatterns(config: ResolvedConfig): Array<{
  pattern: RegExp;
  description: string;
}> {
  return config.dangerousPatterns.map((pattern) => ({
    pattern: new RegExp(pattern),
    description: `matches custom pattern: ${pattern}`,
  }));
}

/**
 * Check if a tool is disabled in the config.
 */
export function isToolDisabled(toolName: string, config: ResolvedConfig): boolean {
  return config.toolsConfig.disabled.includes(toolName);
}

/**
 * Get default configuration for a specific tool.
 */
export function getToolDefaults(toolName: string, config: ResolvedConfig): Record<string, unknown> {
  return config.toolsConfig.defaults[toolName] || {};
}

/**
 * Merge tool input with configured defaults.
 * User-provided values take precedence over defaults.
 */
export function mergeToolInput(
  toolName: string,
  input: Record<string, unknown>,
  config: ResolvedConfig
): Record<string, unknown> {
  const defaults = getToolDefaults(toolName, config);
  return { ...defaults, ...input };
}

/**
 * Create an example configuration file content.
 */
export function getExampleConfig(): string {
  const example: WorkspaceConfig = {
    provider: 'ollama',
    model: 'gpt-oss:120b-cloud',
    autoApprove: ['read_file', 'glob', 'grep', 'list_directory'],
    approvedPatterns: [],
    approvedCategories: [],
    dangerousPatterns: [],
    systemPromptAdditions: '',
    commandAliases: {
      t: '/test src/',
      b: '/build',
    },
    projectContext: '',
    enableCompression: true,
    maxContextTokens: AGENT_CONFIG.MAX_CONTEXT_TOKENS,
    cleanHallucinatedTraces: false,
    models: {
      summarize: {
        provider: 'ollama',
        model: 'llama3.2',
      },
    },
    webSearch: {
      engines: ['brave', 'google', 'bing'],
      cacheEnabled: true,
      cacheMaxSize: 1000,
      defaultTTL: 3600,
      maxResults: 15,
    },
    contextOptimization: {
      mergeCaseVariants: true,
      mergeSimilarNames: true,
      minRecentMessages: 3,
      importanceThreshold: 0.4,
      maxOutputReserveScale: 3,
    },
    rag: {
      enabled: true,
      embeddingProvider: 'auto',
      topK: 5,
      minScore: 0.7,
      autoIndex: true,
      watchFiles: true,
    },
    mcpServers: {
      // Example: filesystem server for enhanced file operations
      // filesystem: {
      //   command: 'npx',
      //   args: ['@modelcontextprotocol/server-filesystem', '.'],
      //   enabled: true,
      // },
      // Example: GitHub server for repo operations
      // github: {
      //   command: 'npx',
      //   args: ['@modelcontextprotocol/server-github'],
      //   env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
      //   enabled: true,
      // },
    },
    tools: {
      disabled: [],
      defaults: {
        search_codebase: {
          max_results: 10,
          min_score: 0.7,
        },
        run_tests: {
          timeout: 120,
        },
      },
    },
    securityModel: {
      enabled: false,
      model: 'llama3.2',
      blockThreshold: 8,
      warnThreshold: 5,
      tools: ['bash'],
      // baseUrl: 'http://localhost:11434',
      // timeout: 10000,
    },
  };

  return JSON.stringify(example, null, 2);
}
