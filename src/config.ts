// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENT_CONFIG } from './constants.js';
import { logger } from './logger.js';

// Re-export types from config/types.ts for backwards compatibility
export type {
  WorkspaceConfig,
  ApprovedPatternConfig,
  ApprovedPathPatternConfig,
  ToolsConfig,
  ResolvedConfig,
} from './config/types.js';

import type {
  WorkspaceConfig,
  ApprovedPatternConfig,
  ApprovedPathPatternConfig,
  ToolsConfig,
  ResolvedConfig,
} from './config/types.js';

/**
 * Configuration file names (checked in order).
 */
const CONFIG_FILES = ['.codi.json', '.codi/config.json', 'codi.config.json'];
const LOCAL_CONFIG_FILE = '.codi.local.json';

/**
 * Global config directory and file.
 */
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.codi');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'config.json');

/** Default configuration values */
const DEFAULT_CONFIG: ResolvedConfig = {
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
 * Validate workspace configuration.
 * Returns an array of warning messages for invalid options.
 */
export function validateConfig(config: WorkspaceConfig): string[] {
  const warnings: string[] = [];

  // Validate provider
  const validProviders = ['anthropic', 'openai', 'ollama', 'runpod', 'auto'];
  if (config.provider && !validProviders.includes(config.provider)) {
    warnings.push(`Unknown provider "${config.provider}". Valid: ${validProviders.join(', ')}`);
  }

  // Validate autoApprove tools
  const validTools = [
    'read_file', 'write_file', 'edit_file', 'patch_file', 'insert_line',
    'glob', 'grep', 'list_directory', 'bash',
  ];
  if (config.autoApprove) {
    for (const tool of config.autoApprove) {
      if (!validTools.includes(tool)) {
        warnings.push(`Unknown tool in autoApprove: "${tool}". Valid: ${validTools.join(', ')}`);
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

/**
 * Merge workspace config with CLI options and local config.
 * Priority: CLI options > local config (approvals only) > workspace config > global config
 */
export function mergeConfig(
  workspaceConfig: WorkspaceConfig | null,
  cliOptions: {
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
  },
  localConfig: WorkspaceConfig | null = null,
  globalConfig: WorkspaceConfig | null = null
): ResolvedConfig {
  const config: ResolvedConfig = { ...DEFAULT_CONFIG };

  // Apply global config (lowest priority, baseline for all projects)
  if (globalConfig) {
    if (globalConfig.provider) config.provider = globalConfig.provider;
    if (globalConfig.model) config.model = globalConfig.model;
    if (globalConfig.baseUrl) config.baseUrl = globalConfig.baseUrl;
    if (globalConfig.endpointId) config.endpointId = globalConfig.endpointId;
    if (globalConfig.autoApprove) config.autoApprove = globalConfig.autoApprove;
    if (globalConfig.approvedPatterns) config.approvedPatterns = [...globalConfig.approvedPatterns];
    if (globalConfig.approvedCategories) config.approvedCategories = [...globalConfig.approvedCategories];
    if (globalConfig.approvedPathPatterns) config.approvedPathPatterns = [...globalConfig.approvedPathPatterns];
    if (globalConfig.approvedPathCategories) config.approvedPathCategories = [...globalConfig.approvedPathCategories];
    if (globalConfig.dangerousPatterns) config.dangerousPatterns = globalConfig.dangerousPatterns;
    if (globalConfig.systemPromptAdditions) config.systemPromptAdditions = globalConfig.systemPromptAdditions;
    if (globalConfig.noTools) config.noTools = globalConfig.noTools;
    if (globalConfig.extractToolsFromText !== undefined) config.extractToolsFromText = globalConfig.extractToolsFromText;
    if (globalConfig.defaultSession) config.defaultSession = globalConfig.defaultSession;
    if (globalConfig.commandAliases) config.commandAliases = globalConfig.commandAliases;
    if (globalConfig.projectContext) config.projectContext = globalConfig.projectContext;
    if (globalConfig.enableCompression !== undefined) config.enableCompression = globalConfig.enableCompression;
    if (globalConfig.maxContextTokens !== undefined && Number.isFinite(globalConfig.maxContextTokens)) {
      config.maxContextTokens = globalConfig.maxContextTokens;
    }
    if (globalConfig.cleanHallucinatedTraces !== undefined) {
      config.cleanHallucinatedTraces = globalConfig.cleanHallucinatedTraces;
    }
    if (globalConfig.models?.summarize?.provider) config.summarizeProvider = globalConfig.models.summarize.provider;
    if (globalConfig.models?.summarize?.model) config.summarizeModel = globalConfig.models.summarize.model;
    if (globalConfig.tools?.disabled) config.toolsConfig.disabled = globalConfig.tools.disabled;
    if (globalConfig.tools?.defaults) config.toolsConfig.defaults = globalConfig.tools.defaults;
    if (globalConfig.webSearch) config.webSearch = {
      engines: ['brave', 'google', 'bing', 'duckduckgo'],
      cacheEnabled: true,
      cacheMaxSize: 1000,
      defaultTTL: 3600,
      maxResults: 15,
      ...globalConfig.webSearch,
    };
    if (globalConfig.securityModel) {
      config.securityModel = {
        enabled: globalConfig.securityModel.enabled ?? false,
        model: globalConfig.securityModel.model ?? 'llama3.2',
        blockThreshold: globalConfig.securityModel.blockThreshold ?? 8,
        warnThreshold: globalConfig.securityModel.warnThreshold ?? 5,
        tools: globalConfig.securityModel.tools ?? ['bash'],
        baseUrl: globalConfig.securityModel.baseUrl ?? 'http://localhost:11434',
        timeout: globalConfig.securityModel.timeout ?? 10000,
      };
    }
  }

  // Apply workspace config (overrides global)
  if (workspaceConfig) {
    if (workspaceConfig.provider) config.provider = workspaceConfig.provider;
    if (workspaceConfig.model) config.model = workspaceConfig.model;
    if (workspaceConfig.baseUrl) config.baseUrl = workspaceConfig.baseUrl;
    if (workspaceConfig.endpointId) config.endpointId = workspaceConfig.endpointId;
    if (workspaceConfig.autoApprove) config.autoApprove = workspaceConfig.autoApprove;
    // Note: approvals from workspace config are applied, but local config overrides below
    if (workspaceConfig.approvedPatterns) config.approvedPatterns = [...workspaceConfig.approvedPatterns];
    if (workspaceConfig.approvedCategories) config.approvedCategories = [...workspaceConfig.approvedCategories];
    if (workspaceConfig.approvedPathPatterns) config.approvedPathPatterns = [...workspaceConfig.approvedPathPatterns];
    if (workspaceConfig.approvedPathCategories) config.approvedPathCategories = [...workspaceConfig.approvedPathCategories];
    if (workspaceConfig.dangerousPatterns) config.dangerousPatterns = workspaceConfig.dangerousPatterns;
    if (workspaceConfig.systemPromptAdditions) config.systemPromptAdditions = workspaceConfig.systemPromptAdditions;
    if (workspaceConfig.noTools) config.noTools = workspaceConfig.noTools;
    if (workspaceConfig.extractToolsFromText !== undefined) config.extractToolsFromText = workspaceConfig.extractToolsFromText;
    if (workspaceConfig.defaultSession) config.defaultSession = workspaceConfig.defaultSession;
    if (workspaceConfig.commandAliases) config.commandAliases = workspaceConfig.commandAliases;
    if (workspaceConfig.projectContext) config.projectContext = workspaceConfig.projectContext;
    if (workspaceConfig.enableCompression !== undefined) config.enableCompression = workspaceConfig.enableCompression;
    if (workspaceConfig.maxContextTokens !== undefined && Number.isFinite(workspaceConfig.maxContextTokens)) {
      config.maxContextTokens = workspaceConfig.maxContextTokens;
    }
    if (workspaceConfig.cleanHallucinatedTraces !== undefined) {
      config.cleanHallucinatedTraces = workspaceConfig.cleanHallucinatedTraces;
    }
    if (workspaceConfig.models?.summarize?.provider) config.summarizeProvider = workspaceConfig.models.summarize.provider;
    if (workspaceConfig.models?.summarize?.model) config.summarizeModel = workspaceConfig.models.summarize.model;
    if (workspaceConfig.tools?.disabled) config.toolsConfig.disabled = workspaceConfig.tools.disabled;
    if (workspaceConfig.tools?.defaults) config.toolsConfig.defaults = workspaceConfig.tools.defaults;
    if (workspaceConfig.webSearch) config.webSearch = {
      engines: ['brave', 'google', 'bing', 'duckduckgo'],
      cacheEnabled: true,
      cacheMaxSize: 1000,
      defaultTTL: 3600,
      maxResults: 15,
      ...workspaceConfig.webSearch,
    };
    if (workspaceConfig.securityModel) {
      config.securityModel = {
        enabled: workspaceConfig.securityModel.enabled ?? config.securityModel?.enabled ?? false,
        model: workspaceConfig.securityModel.model ?? config.securityModel?.model ?? 'llama3.2',
        blockThreshold: workspaceConfig.securityModel.blockThreshold ?? config.securityModel?.blockThreshold ?? 8,
        warnThreshold: workspaceConfig.securityModel.warnThreshold ?? config.securityModel?.warnThreshold ?? 5,
        tools: workspaceConfig.securityModel.tools ?? config.securityModel?.tools ?? ['bash'],
        baseUrl: workspaceConfig.securityModel.baseUrl ?? config.securityModel?.baseUrl ?? 'http://localhost:11434',
        timeout: workspaceConfig.securityModel.timeout ?? config.securityModel?.timeout ?? 10000,
      };
    }
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
