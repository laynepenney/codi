// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration Types
 *
 * Type definitions for workspace and resolved configuration.
 * Extracted from config.ts for better separation of concerns.
 */

/**
 * Workspace configuration for Codi.
 * Can be defined in .codi.json or .codi/config.json in the project root.
 */
export interface WorkspaceConfig {
  /** Provider to use (anthropic, openai, ollama, runpod) */
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

  /** Maximum context tokens before compaction */
  maxContextTokens?: number;

  /** Strip hallucinated tool traces from provider content (provider-specific) */
  cleanHallucinatedTraces?: boolean;

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
    /** Maximum multiplier for output reserve scaling (default: 3) */
    maxOutputReserveScale?: number;
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

  /** Enhanced web search settings */
  webSearch?: {
    /** Search engines to use (order indicates priority) */
    engines?: Array<'brave' | 'google' | 'bing' | 'duckduckgo'>;
    /** Whether to cache search results */
    cacheEnabled?: boolean;
    /** Maximum cache size (number of entries) */
    cacheMaxSize?: number;
    /** Default TTL for cached results (seconds) */
    defaultTTL?: number;
    /** Maximum results per search */
    maxResults?: number;
    /** Search templates for domain-specific optimization */
    templates?: {
      /** Documentation search template */
      docs?: {
        /** Preferred sites for documentation */
        sites?: string[];
        /** Sort by relevance or date */
        sort?: 'relevance' | 'date';
      };
      /** Pricing information search template */
      pricing?: {
        /** Preferred sites for pricing info */
        sites?: string[];
        /** Sort by relevance or date */
        sort?: 'relevance' | 'date';
      };
      /** Error resolution search template */
      errors?: {
        /** Preferred sites for error solutions */
        sites?: string[];
        /** Sort by relevance or date */
        sort?: 'relevance' | 'date';
      };
      /** General search template */
      general?: {
        /** Preferred sites */
        sites?: string[];
        /** Sort by relevance or date */
        sort?: 'relevance' | 'date';
      };
    };
  };

  /** RAG (Retrieval-Augmented Generation) settings */
  rag?: {
    /** Enable RAG code indexing and search */
    enabled?: boolean;
    /** Embedding provider: 'openai', 'ollama', 'modelmap', or 'auto' */
    embeddingProvider?: 'openai' | 'ollama' | 'modelmap' | 'auto';
    /** Task name from model map for embeddings (default: "embeddings") */
    embeddingTask?: string;
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

  /** Per-tool configuration */
  tools?: {
    /** Tools to disable (e.g., ["web_search", "bash"]) */
    disabled?: string[];
    /** Default settings per tool */
    defaults?: {
      [toolName: string]: Record<string, unknown>;
    };
  };

  /** Tool fallback settings for handling unknown tools and parameter aliases */
  toolFallback?: {
    /** Enable semantic tool fallback (default: true) */
    enabled?: boolean;
    /** Threshold for auto-correcting tool names (0-1, default: 0.85) */
    autoCorrectThreshold?: number;
    /** Threshold for suggesting similar tools (0-1, default: 0.6) */
    suggestionThreshold?: number;
    /** Auto-execute corrected tools without confirmation (default: false) */
    autoExecute?: boolean;
    /** Enable parameter aliasing (default: true) */
    parameterAliasing?: boolean;
  };

  /** Security model validation settings */
  securityModel?: {
    /** Enable security model validation (default: false) */
    enabled?: boolean;
    /** Ollama model to use for validation (default: llama3.2) */
    model?: string;
    /** Risk score threshold for blocking (7-10, default: 8) */
    blockThreshold?: number;
    /** Risk score threshold for warning (4-6, default: 5) */
    warnThreshold?: number;
    /** Tools to validate (default: ['bash']) */
    tools?: string[];
    /** Ollama base URL (default: http://localhost:11434) */
    baseUrl?: string;
    /** Timeout for validation in milliseconds (default: 10000) */
    timeout?: number;
  };
}

/**
 * Approved pattern stored in config.
 */
export interface ApprovedPatternConfig {
  pattern: string;
  approvedAt: string;
  description?: string;
}

/**
 * Approved path pattern stored in config.
 */
export interface ApprovedPathPatternConfig {
  pattern: string;
  toolName: string;
  approvedAt: string;
  description?: string;
}

/**
 * Tool-specific configuration.
 */
export interface ToolsConfig {
  /** Tools to disable */
  disabled: string[];
  /** Default settings per tool */
  defaults: Record<string, Record<string, unknown>>;
}

/**
 * Resolved configuration with all values set.
 * This is the merged result of global, workspace, local, and CLI configs.
 */
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
  maxContextTokens: number;
  cleanHallucinatedTraces: boolean;
  /** Secondary model for summarization */
  summarizeProvider?: string;
  summarizeModel?: string;
  /** Per-tool configuration */
  toolsConfig: ToolsConfig;
  contextOptimization: WorkspaceConfig['contextOptimization'];
  /** Enhanced web search settings */
  webSearch?: {
    /** Search engines priority */
    engines: Array<string>;
    /** Whether to cache search results */
    cacheEnabled: boolean;
    /** Maximum cache size */
    cacheMaxSize: number;
    /** Default TTL for cached results */
    defaultTTL: number;
    /** Maximum results per search */
    maxResults: number;
  };
  /** Security model validation settings */
  securityModel?: {
    enabled: boolean;
    model: string;
    blockThreshold: number;
    warnThreshold: number;
    tools: string[];
    baseUrl: string;
    timeout: number;
  };
}
