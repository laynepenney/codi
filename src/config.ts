import * as fs from 'fs';
import * as path from 'path';

/**
 * Workspace configuration for Codi.
 * Can be defined in .codi.json or .codi/config.json in the project root.
 */
export interface WorkspaceConfig {
  /** Provider to use (anthropic, openai, ollama, ollama-native, runpod) */
  provider?: string;

  /** Model name to use */
  model?: string;

  /** Custom base URL for API */
  baseUrl?: string;

  /** Endpoint ID for RunPod serverless */
  endpointId?: string;

  /** Tools that don't require confirmation (e.g., ["read_file", "glob", "grep"]) */
  autoApprove?: string[];

  /** Auto-approved bash command patterns (glob-like, e.g., "npm test*") */
  approvedPatterns?: Array<{
    pattern: string;
    approvedAt: string;
    description?: string;
  }>;

  /** Auto-approved bash command categories (e.g., ["run-tests", "build-project"]) */
  approvedCategories?: string[];

  /** Auto-approved file path patterns (glob-like) */
  approvedPathPatterns?: Array<{
    pattern: string;
    toolName: string;
    approvedAt: string;
    description?: string;
  }>;

  /** Auto-approved file path categories */
  approvedPathCategories?: string[];

  /** Additional dangerous patterns for bash commands */
  dangerousPatterns?: string[];

  /** Additional text to append to the system prompt */
  systemPromptAdditions?: string;

  /** Whether to disable tools entirely */
  noTools?: boolean;

  /** Whether to extract tool calls from text (for models without native tool support) */
  extractToolsFromText?: boolean;

  /** Default session to load on startup */
  defaultSession?: string;

  /** Custom command aliases (e.g., { "t": "/test src/" }) */
  commandAliases?: Record<string, string>;

  /** Project-specific context to include in system prompt */
  projectContext?: string;

  /** Enable context compression (reduces token usage) */
  enableCompression?: boolean;

  /** Context optimization settings */
  contextOptimization?: {
    /** Enable semantic deduplication (merge case variants) */
    mergeCaseVariants?: boolean;
    /** Enable merging similar names (auth -> authentication) */
    mergeSimilarNames?: boolean;
    /** Minimum messages to always keep during compaction */
    minRecentMessages?: number;
    /** Importance score threshold for keeping messages (0-1) */
    importanceThreshold?: number;
    /** Custom importance weights */
    weights?: {
      recency?: number;
      referenceCount?: number;
      userEmphasis?: number;
      actionRelevance?: number;
    };
  };

  /** Multi-model orchestration settings */
  models?: {
    /** Primary model configuration (optional - uses CLI/env if not set) */
    primary?: {
      provider?: string;
      model?: string;
    };
    /** Model to use for summarization (cheaper model recommended) */
    summarize?: {
      provider?: string;
      model?: string;
    };
  };

  /** RAG (Retrieval-Augmented Generation) settings */
  rag?: {
    /** Enable RAG code indexing and search */
    enabled?: boolean;
    /** Embedding provider: 'openai', 'ollama', or 'auto' */
    embeddingProvider?: 'openai' | 'ollama' | 'auto';
    /** OpenAI embedding model (default: text-embedding-3-small) */
    openaiModel?: string;
    /** Ollama embedding model (default: nomic-embed-text) */
    ollamaModel?: string;
    /** Ollama base URL (default: http://localhost:11434) */
    ollamaBaseUrl?: string;
    /** Number of results to return (default: 5) */
    topK?: number;
    /** Minimum similarity score 0-1 (default: 0.7) */
    minScore?: number;
    /** File patterns to include */
    includePatterns?: string[];
    /** File patterns to exclude */
    excludePatterns?: string[];
    /** Auto-index on startup (default: true) */
    autoIndex?: boolean;
    /** Watch for file changes (default: true) */
    watchFiles?: boolean;
    /** Number of parallel indexing jobs (default: 4, max: 16) */
    parallelJobs?: number;
  };

  /** MCP (Model Context Protocol) server configurations */
  mcpServers?: {
    [name: string]: {
      /** Command to start the MCP server (e.g., "npx", "python") */
      command: string;
      /** Arguments to pass to the command */
      args?: string[];
      /** Environment variables (supports ${VAR} syntax for env substitution) */
      env?: Record<string, string>;
      /** Working directory for the server process */
      cwd?: string;
      /** Whether this server is enabled (default: true) */
      enabled?: boolean;
    };
  };
}

/**
 * Resolved configuration with all values set.
 */
/** Approved pattern stored in config */
export interface ApprovedPatternConfig {
  pattern: string;
  approvedAt: string;
  description?: string;
}

/** Approved path pattern stored in config */
export interface ApprovedPathPatternConfig {
  pattern: string;
  toolName: string;
  approvedAt: string;
  description?: string;
}

export interface ResolvedConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  endpointId?: string;
  autoApprove: string[];
  approvedPatterns: ApprovedPatternConfig[];
  approvedCategories: string[];
  approvedPathPatterns: ApprovedPathPatternConfig[];
  approvedPathCategories: string[];
  dangerousPatterns: string[];
  systemPromptAdditions?: string;
  noTools: boolean;
  extractToolsFromText: boolean;
  defaultSession?: string;
  commandAliases: Record<string, string>;
  projectContext?: string;
  enableCompression: boolean;
  /** Secondary model for summarization */
  summarizeProvider?: string;
  summarizeModel?: string;
}

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
  enableCompression: false,
};

/** Config file names to search for, in order of priority */
const CONFIG_FILES = [
  '.codi.json',
  '.codi/config.json',
  'codi.config.json',
];

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
        console.warn(`Warning: Failed to parse ${configPath}: ${error instanceof Error ? error.message : error}`);
        return { config: null, configPath };
      }
    }
  }
  return { config: null, configPath: null };
}

/**
 * Validate workspace configuration.
 * Returns an array of warning messages for invalid options.
 */
export function validateConfig(config: WorkspaceConfig): string[] {
  const warnings: string[] = [];

  // Validate provider
  const validProviders = ['anthropic', 'openai', 'ollama', 'ollama-native', 'runpod', 'auto'];
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

  return warnings;
}

/**
 * Merge workspace config with CLI options.
 * CLI options take precedence over workspace config.
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
  }
): ResolvedConfig {
  const config: ResolvedConfig = { ...DEFAULT_CONFIG };

  // Apply workspace config
  if (workspaceConfig) {
    if (workspaceConfig.provider) config.provider = workspaceConfig.provider;
    if (workspaceConfig.model) config.model = workspaceConfig.model;
    if (workspaceConfig.baseUrl) config.baseUrl = workspaceConfig.baseUrl;
    if (workspaceConfig.endpointId) config.endpointId = workspaceConfig.endpointId;
    if (workspaceConfig.autoApprove) config.autoApprove = workspaceConfig.autoApprove;
    if (workspaceConfig.approvedPatterns) config.approvedPatterns = workspaceConfig.approvedPatterns;
    if (workspaceConfig.approvedCategories) config.approvedCategories = workspaceConfig.approvedCategories;
    if (workspaceConfig.approvedPathPatterns) config.approvedPathPatterns = workspaceConfig.approvedPathPatterns;
    if (workspaceConfig.approvedPathCategories) config.approvedPathCategories = workspaceConfig.approvedPathCategories;
    if (workspaceConfig.dangerousPatterns) config.dangerousPatterns = workspaceConfig.dangerousPatterns;
    if (workspaceConfig.systemPromptAdditions) config.systemPromptAdditions = workspaceConfig.systemPromptAdditions;
    if (workspaceConfig.noTools) config.noTools = workspaceConfig.noTools;
    if (workspaceConfig.extractToolsFromText !== undefined) config.extractToolsFromText = workspaceConfig.extractToolsFromText;
    if (workspaceConfig.defaultSession) config.defaultSession = workspaceConfig.defaultSession;
    if (workspaceConfig.commandAliases) config.commandAliases = workspaceConfig.commandAliases;
    if (workspaceConfig.projectContext) config.projectContext = workspaceConfig.projectContext;
    if (workspaceConfig.enableCompression !== undefined) config.enableCompression = workspaceConfig.enableCompression;
    // Summarize model from workspace config
    if (workspaceConfig.models?.summarize?.provider) config.summarizeProvider = workspaceConfig.models.summarize.provider;
    if (workspaceConfig.models?.summarize?.model) config.summarizeModel = workspaceConfig.models.summarize.model;
  }

  // CLI options override workspace config
  if (cliOptions.provider && cliOptions.provider !== 'auto') {
    config.provider = cliOptions.provider;
  }
  if (cliOptions.model) config.model = cliOptions.model;
  if (cliOptions.baseUrl) config.baseUrl = cliOptions.baseUrl;
  if (cliOptions.endpointId) config.endpointId = cliOptions.endpointId;
  if (cliOptions.session) config.defaultSession = cliOptions.session;

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
 * Create an example configuration file content.
 */
export function getExampleConfig(): string {
  const example: WorkspaceConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
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
    enableCompression: false,
    models: {
      summarize: {
        provider: 'ollama',
        model: 'llama3.2',
      },
    },
    contextOptimization: {
      mergeCaseVariants: true,
      mergeSimilarNames: true,
      minRecentMessages: 3,
      importanceThreshold: 0.4,
    },
    rag: {
      enabled: false,
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
