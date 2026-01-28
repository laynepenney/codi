// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Merger
 *
 * Functions for merging configuration from multiple sources.
 * Priority: CLI options > local config > workspace config > global config > defaults
 */

import { AGENT_CONFIG } from '../constants.js';
import type { WorkspaceConfig, ResolvedConfig } from './types.js';

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: ResolvedConfig = {
  provider: 'auto',
  autoApprove: [],
  approvedPatterns: [],
  approvedCategories: [],
  approvedPathPatterns: [],
  approvedPathCategories: [],
  dangerousPatterns: [],
  noTools: false,
  extractToolsFromText: true,
  commandAliases: {},
  enableCompression: true, // Enabled by default - reduces token usage
  maxContextTokens: AGENT_CONFIG.MAX_CONTEXT_TOKENS,
  cleanHallucinatedTraces: false,
  toolsConfig: {
    disabled: [],
    defaults: {},
  },
  contextOptimization: {
    mergeCaseVariants: true,
    mergeSimilarNames: true,
    minRecentMessages: 3,
    importanceThreshold: 0.4,
    maxOutputReserveScale: 3,
  },
  webSearch: {
    engines: ['brave', 'google', 'bing', 'duckduckgo'],
    cacheEnabled: true,
    cacheMaxSize: 1000,
    defaultTTL: 3600,
    maxResults: 15,
  },
};

/**
 * CLI options that can override configuration.
 */
export interface CLIOptions {
  provider?: string;
  model?: string;
  baseUrl?: string;
  endpointId?: string;
  yes?: boolean;
  tools?: boolean;
  session?: string;
  summarizeProvider?: string;
  summarizeModel?: string;
  maxContextTokens?: number;
}

/**
 * Apply a workspace config layer to the resolved config.
 * Helper function to reduce code duplication.
 */
function applyWorkspaceConfig(config: ResolvedConfig, source: WorkspaceConfig): void {
  if (source.provider) config.provider = source.provider;
  if (source.model) config.model = source.model;
  if (source.baseUrl) config.baseUrl = source.baseUrl;
  if (source.endpointId) config.endpointId = source.endpointId;
  if (source.autoApprove) config.autoApprove = source.autoApprove;
  if (source.approvedPatterns) config.approvedPatterns = [...source.approvedPatterns];
  if (source.approvedCategories) config.approvedCategories = [...source.approvedCategories];
  if (source.approvedPathPatterns) config.approvedPathPatterns = [...source.approvedPathPatterns];
  if (source.approvedPathCategories) config.approvedPathCategories = [...source.approvedPathCategories];
  if (source.dangerousPatterns) config.dangerousPatterns = source.dangerousPatterns;
  if (source.systemPromptAdditions) config.systemPromptAdditions = source.systemPromptAdditions;
  if (source.noTools) config.noTools = source.noTools;
  if (source.extractToolsFromText !== undefined) config.extractToolsFromText = source.extractToolsFromText;
  if (source.defaultSession) config.defaultSession = source.defaultSession;
  if (source.commandAliases) config.commandAliases = source.commandAliases;
  if (source.projectContext) config.projectContext = source.projectContext;
  if (source.enableCompression !== undefined) config.enableCompression = source.enableCompression;
  if (source.maxContextTokens !== undefined && Number.isFinite(source.maxContextTokens)) {
    config.maxContextTokens = source.maxContextTokens;
  }
  if (source.cleanHallucinatedTraces !== undefined) {
    config.cleanHallucinatedTraces = source.cleanHallucinatedTraces;
  }
  if (source.models?.summarize?.provider) config.summarizeProvider = source.models.summarize.provider;
  if (source.models?.summarize?.model) config.summarizeModel = source.models.summarize.model;
  if (source.tools?.disabled) config.toolsConfig.disabled = source.tools.disabled;
  if (source.tools?.defaults) config.toolsConfig.defaults = source.tools.defaults;
  if (source.webSearch) {
    config.webSearch = {
      engines: ['brave', 'google', 'bing', 'duckduckgo'],
      cacheEnabled: true,
      cacheMaxSize: 1000,
      defaultTTL: 3600,
      maxResults: 15,
      ...source.webSearch,
    };
  }
}

/**
 * Apply security model config from a workspace config.
 */
function applySecurityModel(
  config: ResolvedConfig,
  source: WorkspaceConfig,
  existing?: ResolvedConfig['securityModel']
): void {
  if (source.securityModel) {
    config.securityModel = {
      enabled: source.securityModel.enabled ?? existing?.enabled ?? false,
      model: source.securityModel.model ?? existing?.model ?? 'llama3.2',
      blockThreshold: source.securityModel.blockThreshold ?? existing?.blockThreshold ?? 8,
      warnThreshold: source.securityModel.warnThreshold ?? existing?.warnThreshold ?? 5,
      tools: source.securityModel.tools ?? existing?.tools ?? ['bash'],
      baseUrl: source.securityModel.baseUrl ?? existing?.baseUrl ?? 'http://localhost:11434',
      timeout: source.securityModel.timeout ?? existing?.timeout ?? 10000,
    };
  }
}

/**
 * Merge workspace config with CLI options and local config.
 * Priority: CLI options > local config (approvals only) > workspace config > global config
 */
export function mergeConfig(
  workspaceConfig: WorkspaceConfig | null,
  cliOptions: CLIOptions,
  localConfig: WorkspaceConfig | null = null,
  globalConfig: WorkspaceConfig | null = null
): ResolvedConfig {
  const config: ResolvedConfig = { ...DEFAULT_CONFIG };

  // Apply global config (lowest priority, baseline for all projects)
  if (globalConfig) {
    applyWorkspaceConfig(config, globalConfig);
    applySecurityModel(config, globalConfig);
  }

  // Apply workspace config (overrides global)
  if (workspaceConfig) {
    applyWorkspaceConfig(config, workspaceConfig);
    applySecurityModel(config, workspaceConfig, config.securityModel);
  }

  // Merge local config approvals (adds to workspace config approvals)
  if (localConfig) {
    if (localConfig.autoApprove) {
      config.autoApprove = [...new Set([...config.autoApprove, ...localConfig.autoApprove])];
    }
    if (localConfig.approvedPatterns) {
      config.approvedPatterns = [...config.approvedPatterns, ...localConfig.approvedPatterns];
    }
    if (localConfig.approvedCategories) {
      config.approvedCategories = [...new Set([...config.approvedCategories, ...localConfig.approvedCategories])];
    }
    if (localConfig.approvedPathPatterns) {
      config.approvedPathPatterns = [...config.approvedPathPatterns, ...localConfig.approvedPathPatterns];
    }
    if (localConfig.approvedPathCategories) {
      config.approvedPathCategories = [...new Set([...config.approvedPathCategories, ...localConfig.approvedPathCategories])];
    }
  }

  // CLI options override workspace config
  if (cliOptions.provider && cliOptions.provider !== 'auto') {
    config.provider = cliOptions.provider;
  }
  if (cliOptions.model) config.model = cliOptions.model;
  if (cliOptions.baseUrl) config.baseUrl = cliOptions.baseUrl;
  if (cliOptions.endpointId) config.endpointId = cliOptions.endpointId;
  if (cliOptions.session) config.defaultSession = cliOptions.session;
  if (cliOptions.maxContextTokens !== undefined && Number.isFinite(cliOptions.maxContextTokens)) {
    config.maxContextTokens = cliOptions.maxContextTokens;
  }

  // CLI --yes flag adds all tools to autoApprove
  if (cliOptions.yes) {
    config.autoApprove = [
      'read_file', 'write_file', 'edit_file', 'patch_file', 'insert_line',
      'glob', 'grep', 'list_directory', 'bash',
    ];
  }

  // CLI --no-tools disables tools
  if (cliOptions.tools === false) {
    config.noTools = true;
  }

  // CLI summarize model options
  if (cliOptions.summarizeProvider) config.summarizeProvider = cliOptions.summarizeProvider;
  if (cliOptions.summarizeModel) config.summarizeModel = cliOptions.summarizeModel;

  return config;
}
