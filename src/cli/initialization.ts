// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Initialization Utilities
 *
 * Functions for initializing tools, commands, and providers during CLI startup.
 */

import chalk from 'chalk';
import { globalRegistry, registerDefaultTools } from '../tools/index.js';
import { registerCodeCommands } from '../commands/code-commands.js';
import { registerPromptCommands } from '../commands/prompt-commands.js';
import { registerGitCommands } from '../commands/git-commands.js';
import { registerSessionCommands } from '../commands/session-commands.js';
import { registerConfigCommands } from '../commands/config-commands.js';
import { registerCodiCommands } from '../commands/codi-commands.js';
import { registerHistoryCommands } from '../commands/history-commands.js';
import { registerPlanCommands } from '../commands/plan-commands.js';
import { registerUsageCommands } from '../commands/usage-commands.js';
import { registerPluginCommands } from '../commands/plugin-commands.js';
import { registerModelCommands } from '../commands/model-commands.js';
import { registerMemoryCommands } from '../commands/memory-commands.js';
import { registerCompactCommands } from '../commands/compact-commands.js';
import { registerRAGCommands, setRAGIndexer, setRAGConfig } from '../commands/rag-commands.js';
import { registerApprovalCommands } from '../commands/approval-commands.js';
import { registerSymbolCommands, setSymbolIndexService } from '../commands/symbol-commands.js';
import { registerMCPCommands } from '../commands/mcp-commands.js';
import { registerImageCommands } from '../commands/image-commands.js';
import { registerRAGSearchTool, registerSymbolIndexTools } from '../tools/index.js';
import { detectProvider, createProvider, createSecondaryProvider } from '../providers/index.js';
import type { BaseProvider } from '../providers/base.js';
import type { ResolvedConfig } from '../config.js';
import { MCPClientManager } from '../mcp/index.js';
import {
  BackgroundIndexer,
  Retriever,
  createEmbeddingProvider,
  DEFAULT_RAG_CONFIG,
  type RAGConfig,
} from '../rag/index.js';
import { SymbolIndexService } from '../symbol-index/index.js';
import { spinner } from '../spinner.js';
import { logger } from '../logger.js';
import type { ModelMap } from '../model-map/index.js';
import type { WorkspaceConfig } from '../config.js';

/**
 * Register all default tools and slash commands.
 */
export function registerToolsAndCommands(): void {
  registerDefaultTools();
  registerCodeCommands();
  registerPromptCommands();
  registerGitCommands();
  registerSessionCommands();
  registerConfigCommands();
  registerCodiCommands();
  registerHistoryCommands();
  registerPlanCommands();
  registerUsageCommands();
  registerPluginCommands();
  registerModelCommands();
  registerMemoryCommands();
  registerImageCommands();
  registerCompactCommands();
  registerRAGCommands();
  registerApprovalCommands();
  registerSymbolCommands();
  registerMCPCommands();
}

/**
 * Options for creating the primary provider.
 */
export interface CreatePrimaryProviderOptions {
  provider: string;
  model?: string;
  baseUrl?: string;
  endpointId?: string;
  cleanHallucinatedTraces?: boolean;
}

/**
 * Create the primary AI provider based on config.
 *
 * @param options Provider configuration options
 * @returns The created provider instance
 */
export function createPrimaryProvider(options: CreatePrimaryProviderOptions): BaseProvider {
  if (options.provider === 'auto') {
    return detectProvider();
  }
  return createProvider({
    type: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    endpointId: options.endpointId,
    cleanHallucinatedTraces: options.cleanHallucinatedTraces,
  });
}

/**
 * Options for creating a summarization provider.
 */
export interface CreateSummarizeProviderOptions {
  summarizeProvider?: string;
  summarizeModel?: string;
}

/**
 * Create a secondary provider for summarization if configured.
 *
 * @param options Summarization provider configuration
 * @returns The created provider instance or null if not configured
 */
export function createSummarizeProvider(options: CreateSummarizeProviderOptions): BaseProvider | null {
  if (!options.summarizeProvider && !options.summarizeModel) {
    return null;
  }
  return createSecondaryProvider({
    provider: options.summarizeProvider,
    model: options.summarizeModel,
  });
}

/**
 * Result of MCP initialization.
 */
export interface MCPInitResult {
  manager: MCPClientManager | null;
  connectedCount: number;
  toolCount: number;
}

/**
 * Initialize MCP (Model Context Protocol) clients if configured.
 *
 * @param workspaceConfig The workspace configuration
 * @param mcpEnabled Whether MCP is enabled (not --no-mcp)
 * @returns MCP initialization result
 */
export async function initializeMCP(
  workspaceConfig: WorkspaceConfig | null,
  mcpEnabled: boolean
): Promise<MCPInitResult> {
  if (!mcpEnabled || !workspaceConfig?.mcpServers) {
    return { manager: null, connectedCount: 0, toolCount: 0 };
  }

  const serverConfigs = Object.entries(workspaceConfig.mcpServers)
    .filter(([_, config]) => config.enabled !== false);

  if (serverConfigs.length === 0) {
    return { manager: null, connectedCount: 0, toolCount: 0 };
  }

  const manager = new MCPClientManager();
  let connectedCount = 0;

  for (const [name, config] of serverConfigs) {
    try {
      await manager.connect({
        name,
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });
      connectedCount++;
    } catch (err) {
      logger.warn(`MCP '${name}': ${err instanceof Error ? err.message : err}`);
    }
  }

  let toolCount = 0;
  if (connectedCount > 0) {
    const mcpTools = await manager.getAllTools();
    for (const tool of mcpTools) {
      globalRegistry.register(tool);
    }
    toolCount = mcpTools.length;
    console.log(chalk.dim(`MCP: ${connectedCount} server(s), ${toolCount} tool(s)`));
  }

  return { manager, connectedCount, toolCount };
}

/**
 * Result of RAG initialization.
 */
export interface RAGInitResult {
  indexer: BackgroundIndexer | null;
  retriever: Retriever | null;
  embeddingProvider: import('../rag/embeddings/base.js').BaseEmbeddingProvider | null;
}

/**
 * Initialize the RAG (Retrieval-Augmented Generation) system.
 *
 * @param cwd Current working directory
 * @param workspaceConfig The workspace configuration
 * @param modelMap Optional model map for provider selection
 * @returns RAG initialization result
 */
export async function initializeRAG(
  cwd: string,
  workspaceConfig: WorkspaceConfig | null,
  modelMap: ModelMap | null
): Promise<RAGInitResult> {
  // RAG is enabled by default - only skip if explicitly disabled
  const ragEnabled = workspaceConfig?.rag?.enabled !== false;

  if (!ragEnabled) {
    return { indexer: null, retriever: null, embeddingProvider: null };
  }

  try {
    // Build RAG config from workspace config (or use defaults)
    const ragConfig: RAGConfig = {
      ...DEFAULT_RAG_CONFIG,
      enabled: true,
      embeddingProvider: workspaceConfig?.rag?.embeddingProvider ?? DEFAULT_RAG_CONFIG.embeddingProvider,
      embeddingTask: workspaceConfig?.rag?.embeddingTask ?? DEFAULT_RAG_CONFIG.embeddingTask,
      openaiModel: workspaceConfig?.rag?.openaiModel ?? DEFAULT_RAG_CONFIG.openaiModel,
      ollamaModel: workspaceConfig?.rag?.ollamaModel ?? DEFAULT_RAG_CONFIG.ollamaModel,
      ollamaBaseUrl: workspaceConfig?.rag?.ollamaBaseUrl ?? DEFAULT_RAG_CONFIG.ollamaBaseUrl,
      topK: workspaceConfig?.rag?.topK ?? DEFAULT_RAG_CONFIG.topK,
      minScore: workspaceConfig?.rag?.minScore ?? DEFAULT_RAG_CONFIG.minScore,
      includePatterns: workspaceConfig?.rag?.includePatterns ?? DEFAULT_RAG_CONFIG.includePatterns,
      excludePatterns: workspaceConfig?.rag?.excludePatterns ?? DEFAULT_RAG_CONFIG.excludePatterns,
      autoIndex: workspaceConfig?.rag?.autoIndex ?? DEFAULT_RAG_CONFIG.autoIndex,
      watchFiles: workspaceConfig?.rag?.watchFiles ?? DEFAULT_RAG_CONFIG.watchFiles,
      parallelJobs: workspaceConfig?.rag?.parallelJobs,
    };

    const embeddingProvider = createEmbeddingProvider(ragConfig, modelMap?.config ?? null);
    console.log(chalk.dim(`RAG: ${embeddingProvider.getName()} (${embeddingProvider.getModel()})`));

    const indexer = new BackgroundIndexer(cwd, embeddingProvider, ragConfig);
    const retriever = new Retriever(cwd, embeddingProvider, ragConfig);

    // Share vector store between indexer and retriever
    retriever.setVectorStore(indexer.getVectorStore());

    // Initialize asynchronously
    indexer.initialize().catch((err) => {
      logger.error(`RAG indexer error: ${err.message}`);
    });

    // Set up progress callback using spinner for clean single-line output
    indexer.onProgress = (current, total, file) => {
      if (current === 1 || current === total || current % 10 === 0) {
        spinner.indexing(current, total, file.slice(0, 40));
      }
    };
    indexer.onComplete = (stats) => {
      spinner.indexingDone(stats.totalFiles, stats.totalChunks);
    };
    indexer.onError = (error) => {
      spinner.fail(chalk.red(`RAG indexer: ${error.message}`));
    };

    // Register with commands and tool
    setRAGIndexer(indexer);
    setRAGConfig(ragConfig);
    registerRAGSearchTool(retriever);

    return { indexer, retriever, embeddingProvider };
  } catch (err) {
    // Gracefully handle missing embedding provider
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('No embedding provider') || errMsg.includes('OPENAI_API_KEY') || errMsg.includes('Ollama')) {
      console.log(chalk.dim(`RAG: disabled (no embedding provider available)`));
    } else {
      logger.error(`Failed to initialize RAG: ${errMsg}`);
    }
    return { indexer: null, retriever: null, embeddingProvider: null };
  }
}

/**
 * Result of symbol index initialization.
 */
export interface SymbolIndexInitResult {
  service: SymbolIndexService | null;
}

/**
 * Initialize the Symbol Index for AST-based navigation tools.
 *
 * @param cwd Current working directory
 * @returns Symbol index initialization result
 */
export async function initializeSymbolIndex(cwd: string): Promise<SymbolIndexInitResult> {
  try {
    const symbolIndexService = new SymbolIndexService(cwd);
    await symbolIndexService.initialize();
    setSymbolIndexService(symbolIndexService);
    registerSymbolIndexTools(symbolIndexService);

    // Show status if index exists
    if (symbolIndexService.hasIndex()) {
      const stats = symbolIndexService.getStats();
      console.log(chalk.dim(`Symbol index: ${stats.totalSymbols} symbols in ${stats.totalFiles} files`));
    }

    return { service: symbolIndexService };
  } catch (err) {
    // Non-fatal - symbol tools just won't be available
    logger.warn(`Symbol index: ${err instanceof Error ? err.message : err}`);
    return { service: null };
  }
}

/**
 * Log the initialization summary for tools.
 *
 * @param resolvedConfig The resolved configuration
 */
export function logToolSummary(resolvedConfig: ResolvedConfig): void {
  const useTools = !resolvedConfig.noTools;

  if (useTools) {
    console.log(chalk.dim(`Tools: ${globalRegistry.listTools().length} registered`));
    if (resolvedConfig.autoApprove.length > 0) {
      console.log(chalk.dim(`Auto-approve: ${resolvedConfig.autoApprove.join(', ')}`));
    }
  } else {
    console.log(chalk.yellow('Tools: disabled (--no-tools mode)'));
  }
}
