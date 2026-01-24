// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Message, ContentBlock, ToolResult, ToolCall } from './types.js';
import type { BaseProvider } from './providers/base.js';
import { ToolRegistry } from './tools/registry.js';
import { generateWriteDiff, generateEditDiff, type DiffResult } from './diff.js';
import { recordUsage } from './usage.js';
import { AGENT_CONFIG, TOOL_CATEGORIES, CONTEXT_OPTIMIZATION, type DangerousPattern } from './constants.js';
import { computeContextConfig, computeScaledContextConfig, FIXED_CONFIG, type ComputedContextConfig } from './context-config.js';
import type { ModelMap } from './model-map/index.js';
import {
  compressContext,
  generateEntityLegend,
  getCompressionStats,
  decompressText,
  decompressWithBuffer,
  type CompressedContext,
  type CompressionStats,
  type Entity,
} from './compression.js';
import { scoreMessages, extractFilePaths, type MessageScore } from './importance-scorer.js';
import {
  selectMessagesToKeep,
  updateWorkingSet,
  createWorkingSet,
  applySelection,
  type WorkingSet,
  type WindowingConfig,
} from './context-windowing.js';
import {
  extractToolCallsFromText,
  countMessageTokens,
  estimateTotalContextTokens,
  estimateSystemPromptTokens,
  estimateToolDefinitionTokens,
  getMessageText,
  findSafeStartIndex,
  truncateOldToolResults,
  parseImageResult,
  checkDangerousBash,
  groupBySimilarity,
  updateCalibration,
} from './utils/index.js';
import { logger, LogLevel } from './logger.js';
import type { AuditLogger } from './audit.js';
import {
  getDebugBridge,
  isDebugBridgeEnabled,
  type Breakpoint,
  type BreakpointContext,
  type BreakpointType,
  type Checkpoint,
  type FullCheckpoint,
  type Branch,
  type Timeline,
} from './debug-bridge.js';
import {
  checkCommandApproval,
  getApprovalSuggestions,
  addApprovedPattern,
  addApprovedCategory,
  checkPathApproval,
  getPathApprovalSuggestions,
  addApprovedPathPattern,
  addApprovedPathCategory,
  type ApprovedPattern,
  type ApprovedPathPattern,
} from './approvals.js';
import { batchToolCalls, getBatchStats, executeWithConcurrencyLimit } from './tool-executor.js';

/**
 * Information about a tool call for confirmation.
 */
export interface ToolConfirmation {
  toolName: string;
  input: Record<string, unknown>;
  isDangerous: boolean;
  dangerReason?: string;
  /** Diff preview for file operations */
  diffPreview?: DiffResult;
  /** Suggestions for approving similar commands (bash only) */
  approvalSuggestions?: {
    suggestedPattern: string;
    matchedCategories: Array<{ id: string; name: string; description: string }>;
  };
}

/**
 * Result of a confirmation request.
 * Extended to support "approve similar" responses.
 */
export type ConfirmationResult =
  | 'approve'
  | 'deny'
  | 'abort'
  | { type: 'approve_pattern'; pattern: string }
  | { type: 'approve_category'; categoryId: string };

export interface AgentOptions {
  provider: BaseProvider;
  toolRegistry: ToolRegistry;
  systemPrompt?: string;
  useTools?: boolean; // Set to false for models that don't support tool use
  extractToolsFromText?: boolean; // Extract tool calls from JSON in text (for models without native tool support)
  autoApprove?: boolean | string[]; // Skip confirmation: true = all tools, string[] = specific tools
  approvedPatterns?: ApprovedPattern[]; // Auto-approved bash command patterns
  approvedCategories?: string[]; // Auto-approved bash command categories
  approvedPathPatterns?: ApprovedPathPattern[]; // Auto-approved file path patterns
  approvedPathCategories?: string[]; // Auto-approved file path categories
  customDangerousPatterns?: Array<{ pattern: RegExp; description: string }>; // Additional patterns
  logLevel?: LogLevel; // Log level for debug output (replaces debug)
  debug?: boolean; // @deprecated Use logLevel instead
  enableCompression?: boolean; // Enable entity-reference compression for context
  maxContextTokens?: number; // Maximum context tokens before compaction
  contextOptimization?: {
    maxOutputReserveScale?: number;
  }; // Context optimization settings
  secondaryProvider?: BaseProvider | null; // Optional secondary provider for summarization
  modelMap?: ModelMap | null; // Optional model map for multi-model orchestration
  auditLogger?: AuditLogger | null; // Optional audit logger for session debugging
  onText?: (text: string) => void;
  onReasoning?: (reasoning: string) => void; // Called with reasoning trace from reasoning models
  onReasoningChunk?: (chunk: string) => void; // Streaming reasoning output
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, isError: boolean) => void;
  onConfirm?: (confirmation: ToolConfirmation) => Promise<ConfirmationResult>; // Confirm destructive tools
}

/**
 * The Agent orchestrates the conversation between the user, model, and tools.
 * It implements the agentic loop: send message -> receive response -> execute tools -> repeat.
 */
export class Agent {
  private provider: BaseProvider;
  private secondaryProvider: BaseProvider | null = null;
  private modelMap: ModelMap | null = null;
  private toolRegistry: ToolRegistry;
  private systemPrompt: string;
  private useTools: boolean;
  private extractToolsFromText: boolean;
  private autoApproveAll: boolean;
  private autoApproveTools: Set<string>;
  private approvedPatterns: ApprovedPattern[];
  private approvedCategories: string[];
  private approvedPathPatterns: ApprovedPathPattern[];
  private approvedPathCategories: string[];
  private customDangerousPatterns: Array<{ pattern: RegExp; description: string }>;
  private logLevel: LogLevel;
  private enableCompression: boolean;
  private maxContextTokens: number;
  private maxContextTokensExplicit: boolean; // True if user explicitly set maxContextTokens
  private contextConfig: ComputedContextConfig; // Tier-based context config
  private contextOptimization: AgentOptions['contextOptimization'];
  private auditLogger: AuditLogger | null = null;
  private messages: Message[] = [];
  private conversationSummary: string | null = null;
  private lastCompressionStats: CompressionStats | null = null;
  private lastCompressionEntities: Map<string, Entity> | null = null;
  private compressionBuffer = ''; // Buffer for streaming decompression
  private workingSet: WorkingSet = createWorkingSet();
  private indexedFiles: Set<string> | null = null; // RAG indexed files for code relevance scoring
  private embeddingProvider: import('./rag/embeddings/base.js').BaseEmbeddingProvider | null = null; // For semantic deduplication
  // Debug control (Phase 2)
  private debugPaused: boolean = false;
  private debugStepMode: boolean = false;
  private currentIteration: number = 0;
  // Phase 4: Breakpoints
  private breakpoints: Map<string, Breakpoint> = new Map();
  // Phase 4: Checkpoints
  private lastCheckpointIteration: number = 0;
  private checkpointInterval: number = 5; // Auto-checkpoint every 5 iterations
  // Phase 5: Time travel
  private currentBranch: string = 'main';
  private timeline: Timeline = {
    branches: [{
      name: 'main',
      created: new Date().toISOString(),
      checkpoints: [],
      current: true,
    }],
    activeBranch: 'main',
  };
  private callbacks: {
    onText?: (text: string) => void;
    onReasoning?: (reasoning: string) => void;
    onReasoningChunk?: (chunk: string) => void;
    onToolCall?: (name: string, input: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string, isError: boolean) => void;
    onConfirm?: (confirmation: ToolConfirmation) => Promise<ConfirmationResult>;
  };

  constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.secondaryProvider = options.secondaryProvider ?? null;
    this.modelMap = options.modelMap ?? null;
    this.toolRegistry = options.toolRegistry;
    this.useTools = options.useTools ?? true;
    this.extractToolsFromText = options.extractToolsFromText ?? true;

    // Handle autoApprove as boolean or string[]
    if (options.autoApprove === true) {
      this.autoApproveAll = true;
      this.autoApproveTools = new Set();
    } else if (Array.isArray(options.autoApprove)) {
      this.autoApproveAll = false;
      this.autoApproveTools = new Set(options.autoApprove);
    } else {
      this.autoApproveAll = false;
      this.autoApproveTools = new Set();
    }

    this.approvedPatterns = options.approvedPatterns ?? [];
    this.approvedCategories = options.approvedCategories ?? [];
    this.approvedPathPatterns = options.approvedPathPatterns ?? [];
    this.approvedPathCategories = options.approvedPathCategories ?? [];
    this.customDangerousPatterns = options.customDangerousPatterns ?? [];
    // Support both logLevel and deprecated debug option
    this.logLevel = options.logLevel ?? (options.debug ? LogLevel.DEBUG : LogLevel.NORMAL);
    this.enableCompression = options.enableCompression ?? false;
    // Track if user explicitly set maxContextTokens (so we preserve it on provider switch)
    this.maxContextTokensExplicit = options.maxContextTokens !== undefined;
    this.contextOptimization = options.contextOptimization;
    this.auditLogger = options.auditLogger ?? null;
    this.systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();

    // Compute tier-based context config from provider's context window
    this.contextConfig = computeContextConfig(this.provider.getContextWindow());

    // Calculate adaptive context limit based on actual overhead
    this.maxContextTokens = options.maxContextTokens ??
      this.calculateAdaptiveContextLimit(this.provider);
    this.callbacks = {
      onText: options.onText,
      onReasoning: options.onReasoning,
      onReasoningChunk: options.onReasoningChunk,
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
      onConfirm: options.onConfirm,
    };
  }

  /**
   * Check if a tool should be auto-approved.
   */
  private shouldAutoApprove(toolName: string): boolean {
    return this.autoApproveAll || this.autoApproveTools.has(toolName);
  }

  /**
   * Check if a bash command should be auto-approved via patterns/categories.
   */
  private shouldAutoApproveBash(command: string): boolean {
    const result = checkCommandApproval(
      command,
      this.approvedPatterns,
      this.approvedCategories
    );
    return result.approved;
  }

  /**
   * File tools that support path-based auto-approval.
   */
  private static readonly FILE_TOOLS = new Set(['write_file', 'edit_file', 'insert_line', 'patch_file']);

  /**
   * Check if a file operation should be auto-approved via path patterns/categories.
   */
  private shouldAutoApproveFilePath(toolName: string, filePath: string): boolean {
    const result = checkPathApproval(
      toolName,
      filePath,
      this.approvedPathPatterns,
      this.approvedPathCategories
    );
    return result.approved;
  }

  /**
   * Calculate adaptive context limit based on actual overhead.
   * Uses: contextWindow - systemPrompt - tools - maxOutput - buffer
   * Falls back to minimum viable context as floor.
   */
  private calculateAdaptiveContextLimit(provider: BaseProvider): number {
    const contextWindow = provider.getContextWindow();

    // Use tier-based config values
    const cfg = this.contextConfig;

    // Calculate overhead components
    const systemPromptTokens = estimateSystemPromptTokens(this.systemPrompt);
    const toolDefinitions = this.useTools ? this.toolRegistry.getDefinitions() : [];
    const toolDefinitionTokens = estimateToolDefinitionTokens(toolDefinitions);
    const outputReserve = cfg.maxOutputTokens;
    const safetyBuffer = cfg.safetyBuffer;

    const totalOverhead = systemPromptTokens + toolDefinitionTokens + outputReserve + safetyBuffer;

    // Calculate available context for messages
    const adaptiveLimit = contextWindow - totalOverhead;

    // Use the larger of adaptive calculation or minimum viable
    const finalLimit = Math.max(adaptiveLimit, cfg.minViableContext);

    // Warn if context budget is very tight
    if (finalLimit < cfg.minViableContext) {
      logger.warn(
        `Tight context budget: ${finalLimit} tokens for messages. ` +
        `Model has ${contextWindow} context, overhead is ${totalOverhead} tokens. ` +
        `Consider using a model with larger context window.`
      );
    }

    logger.debug(
      `Adaptive context (${cfg.tierName} tier): ${finalLimit} tokens ` +
      `(window: ${contextWindow}, system: ${systemPromptTokens}, tools: ${toolDefinitionTokens}, ` +
      `output: ${outputReserve}, buffer: ${safetyBuffer})`
    );

    return finalLimit;
  }

  /**
   * Get the provider to use for summarization.
   * Returns secondary provider if configured, otherwise falls back to primary.
   */
  private getSummaryProvider(): BaseProvider {
    // Try model map first
    if (this.modelMap) {
      try {
        const summarizeModel = this.modelMap.router.getSummarizeModel();
        return this.modelMap.registry.getProvider(summarizeModel.name);
      } catch {
        // Fall through to secondary/primary
      }
    }
    return this.secondaryProvider ?? this.provider;
  }

  /**
   * Get a provider for a specific task type using model map.
   * Falls back to primary provider if model map is not configured or task not found.
   */
  getProviderForTask(taskType: string): BaseProvider {
    if (this.modelMap) {
      try {
        const result = this.modelMap.router.routeTask(taskType);
        if (result.type === 'model') {
          return this.modelMap.registry.getProvider(result.model.name);
        }
      } catch {
        // Fall through to primary
      }
    }
    return this.provider;
  }

  /**
   * Get a provider for a specific command using model map.
   * Falls back to primary provider if model map is not configured or command not found.
   */
  getProviderForCommand(commandName: string): BaseProvider {
    if (this.modelMap) {
      try {
        const result = this.modelMap.router.routeCommand(commandName);
        if (result.type === 'model') {
          return this.modelMap.registry.getProvider(result.model.name);
        }
      } catch {
        // Fall through to primary
      }
    }
    return this.provider;
  }

  /**
   * Check if a command should use a pipeline.
   */
  commandHasPipeline(commandName: string): boolean {
    return this.modelMap?.router.commandHasPipeline(commandName) ?? false;
  }

  /**
   * Get the model map instance.
   */
  getModelMap(): ModelMap | null {
    return this.modelMap;
  }

  /**
   * Get the provider to use for a chat, potentially routing via model map.
   * @param taskType - Optional task type for routing (e.g., 'fast', 'code', 'complex')
   */
  private getProviderForChat(taskType?: string): BaseProvider {
    if (taskType && this.modelMap) {
      try {
        const result = this.modelMap.router.routeTask(taskType);
        if (result.type === 'model') {
          const provider = this.modelMap.registry.getProvider(result.model.name);
          logger.debug(`Using ${provider.getName()} (${provider.getModel()}) for task type "${taskType}"`);
          return provider;
        }
      } catch (error) {
        logger.debug(`Failed to route task type "${taskType}", using primary provider: ${error}`);
      }
    }
    return this.provider;
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful AI coding assistant. You have access to tools that allow you to read and write files, execute bash commands, and navigate code by symbols.

When helping with coding tasks:
- Read relevant files to understand the codebase before making changes
- Make targeted, minimal changes to accomplish the task
- Explain what you're doing and why

Available tools:
- read_file: Read contents of a file
- write_file: Write content to a file
- bash: Execute bash commands
- glob: Find files by pattern
- grep: Search file contents

Symbol navigation tools (use these to understand code structure):
- find_symbol: Find symbol definitions by name (functions, classes, interfaces, etc.)
- goto_definition: Navigate to where a symbol is defined
- find_references: Find all files that import/use a symbol
- get_dependency_graph: Show what files a file imports or is imported by
- get_inheritance: Show class/interface inheritance hierarchy
- get_call_graph: Show potential callers of a function

When exploring code:
- Use find_symbol to locate functions, classes, or interfaces by name
- Use goto_definition to jump to where something is defined
- Use find_references to see where a symbol is used across the codebase
- Use get_dependency_graph to understand file relationships
- Use get_inheritance to understand class hierarchies

Always use tools to interact with the filesystem rather than asking the user to do it.`;
  }

  /**
   * Compact the conversation history using smart windowing.
   * Uses importance scoring to determine what to keep vs summarize.
   */
  private async compactContext(): Promise<void> {
    const totalTokens = countMessageTokens(this.messages);

    if (totalTokens <= this.maxContextTokens) {
      return; // No compaction needed
    }

    logger.debug(`Compacting: ${totalTokens} tokens exceeds ${this.maxContextTokens} limit`);

    // Score messages by importance (pass indexed files for RAG-enhanced scoring)
    const scores = scoreMessages(
      this.messages,
      CONTEXT_OPTIMIZATION.WEIGHTS,
      undefined, // entities
      this.indexedFiles ?? undefined
    );

    // Configure windowing
    const windowConfig: WindowingConfig = {
      minRecentMessages: CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES,
      maxMessages: CONTEXT_OPTIMIZATION.MAX_MESSAGES,
      importanceThreshold: CONTEXT_OPTIMIZATION.IMPORTANCE_THRESHOLD,
      preserveToolPairs: CONTEXT_OPTIMIZATION.PRESERVE_TOOL_PAIRS,
      preserveWorkingSet: CONTEXT_OPTIMIZATION.PRESERVE_WORKING_SET,
    };

    // Select what to keep using smart windowing
    const selection = selectMessagesToKeep(this.messages, scores, this.workingSet, windowConfig);

    logger.debug(`Smart windowing: keeping ${selection.keep.length}/${this.messages.length} messages, summarizing ${selection.summarize.length}`);

    // If nothing to summarize, just apply selection
    if (selection.summarize.length === 0) {
      this.messages = applySelection(this.messages, selection);
      return;
    }

    // Get messages to summarize
    const messagesToSummarize = selection.summarize.map(i => this.messages[i]);

    // Extract file paths from messages for better context preservation
    const discussedFiles = new Set<string>();
    for (const msg of messagesToSummarize) {
      const text = getMessageText(msg);
      const paths = extractFilePaths(text);
      paths.forEach(p => discussedFiles.add(p));
    }

    // Try semantic deduplication if embedding provider is available
    let oldContent: string;
    if (this.embeddingProvider && messagesToSummarize.length > 2) {
      try {
        // Generate embeddings for messages
        const messageTexts = messagesToSummarize.map(m => getMessageText(m).slice(0, 1000));
        const embeddings = await this.embeddingProvider.embed(messageTexts);

        // Group similar messages
        const groups = groupBySimilarity(embeddings, 0.85);
        logger.debug(`Semantic dedup: ${messagesToSummarize.length} messages → ${groups.length} groups`);

        // Format grouped content
        oldContent = groups.map((group, i) => {
          if (group.length === 1) {
            const msg = messagesToSummarize[group[0]];
            return `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`;
          } else {
            // Multiple similar messages - show as a group
            const groupMessages = group.map(idx => {
              const msg = messagesToSummarize[idx];
              return `  - [${msg.role}]: ${getMessageText(msg).slice(0, 200)}`;
            }).join('\n');
            return `[Similar discussion #${i + 1}, ${group.length} messages]:\n${groupMessages}`;
          }
        }).join('\n\n');
      } catch (err) {
        // Fall back to standard formatting
        logger.debug(`Semantic dedup failed: ${err instanceof Error ? err.message : err}`);
        oldContent = messagesToSummarize
          .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
          .join('\n\n');
      }
    } else {
      // Standard formatting without semantic deduplication
      oldContent = messagesToSummarize
        .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
        .join('\n\n');
    }

    // Include existing summary if present
    const contextToSummarize = this.conversationSummary
      ? `Previous summary:\n${this.conversationSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    // Build enhanced summary prompt with file context
    const filesContext = discussedFiles.size > 0
      ? `\n\nFiles discussed: ${[...discussedFiles].join(', ')}`
      : '';

    try {
      // Ask the model to create a summary (use secondary provider if configured)
      const summaryProvider = this.getSummaryProvider();
      logger.debug(`Using ${summaryProvider.getName()} (${summaryProvider.getModel()}) for summarization`);
      logger.debug(`Files context for summary: ${discussedFiles.size} files`);

      const summaryResponse = await summaryProvider.streamChat(
        [
          {
            role: 'user',
            content: `Create a concise summary of this conversation for context preservation.

## What to Include
- **Goal**: What task is the user trying to accomplish?
- **Progress**: What has been done so far?
- **Files Modified**: List any files that were created, edited, or deleted
- **Key Decisions**: Any important choices made during the conversation
- **Current State**: Where did the conversation leave off?

## Format
Write 3-5 short paragraphs. Use bullet points for file lists. Be factual and specific.
${filesContext}

## Conversation to Summarize
${contextToSummarize}`,
          },
        ],
        undefined, // No tools for summary
        undefined  // No streaming callback
      );

      this.conversationSummary = summaryResponse.content;
      const messagesBefore = this.messages.length;
      this.messages = applySelection(this.messages, selection);

      const newTokens = countMessageTokens(this.messages);
      logger.debug(`Compacted to ${newTokens} tokens. Summary: ${this.conversationSummary?.slice(0, 100)}...`);

      // Debug bridge: context compaction
      if (isDebugBridgeEnabled()) {
        getDebugBridge().contextCompaction(totalTokens, newTokens, messagesBefore, this.messages.length);
      }
    } catch (error) {
      // If summarization fails, fall back to simple selection without summary
      logger.debug(`Summarization failed, using selection only: ${error}`);
      const messagesBefore = this.messages.length;
      this.messages = applySelection(this.messages, selection);

      // Debug bridge: context compaction (fallback)
      if (isDebugBridgeEnabled()) {
        const newTokens = countMessageTokens(this.messages);
        getDebugBridge().contextCompaction(totalTokens, newTokens, messagesBefore, this.messages.length);
      }
    }
  }

  /**
   * Build a continuation prompt that reminds the model of the original task.
   * Helps smaller models stay on track during multi-turn tool use.
   */
  private buildContinuationPrompt(originalTask: string): string {
    const taskPreview = originalTask.length > 150
      ? originalTask.slice(0, 150) + '...'
      : originalTask;
    return `\n\nOriginal request: "${taskPreview}"\n\nIf you have completed the user's request, respond with your final answer. Do NOT continue calling tools unless the task is incomplete.`;
  }

  /**
   * Truncate a tool result if it exceeds the maximum size.
   * Uses tier-based config to scale with model's context window.
   */
  private truncateToolResult(content: string): string {
    const maxSize = this.contextConfig.maxImmediateToolResult;
    if (content.length <= maxSize) {
      return content;
    }
    const halfLimit = Math.floor(maxSize / 2);
    const truncated = content.slice(0, halfLimit) +
      `\n\n... [${content.length - maxSize} characters truncated] ...\n\n` +
      content.slice(-halfLimit);
    return truncated;
  }

  /**
   * Enforce the message limit to prevent unbounded memory growth.
   * Uses smart pruning: keeps recent messages and removes old ones.
   */
  private enforceMessageLimit(): void {
    if (this.messages.length <= FIXED_CONFIG.MAX_MESSAGES) {
      return;
    }

    logger.debug(`Enforcing message limit: ${this.messages.length} > ${FIXED_CONFIG.MAX_MESSAGES}`);

    // Calculate how many to remove (keep some buffer below the limit)
    const targetSize = Math.floor(FIXED_CONFIG.MAX_MESSAGES * 0.8); // Keep 80% of limit
    const removeCount = this.messages.length - targetSize;

    // Find a safe start point in the messages to remove
    // We need to slice from the beginning, not break tool call/result pairs
    const recentMessages = this.messages.slice(removeCount);
    const safeStart = findSafeStartIndex(recentMessages);

    // Adjust the actual slice point to respect tool pairs
    const actualRemoveCount = removeCount + safeStart;
    const pruned = actualRemoveCount;

    if (pruned <= 0) {
      return; // Nothing safe to prune
    }

    // Update summary to note that messages were pruned
    const pruneNote = `[Note: ${pruned} older messages were automatically pruned to stay within memory limits]`;
    if (this.conversationSummary) {
      this.conversationSummary = `${pruneNote}\n\n${this.conversationSummary}`;
    } else {
      this.conversationSummary = pruneNote;
    }

    // Apply pruning
    this.messages = this.messages.slice(actualRemoveCount);
    logger.debug(`Pruned ${pruned} messages, now have ${this.messages.length}`);
  }

  /**
   * Process a user message and return the final assistant response.
   * This runs the full agentic loop until the model stops calling tools.
   *
   * @param userMessage - The user's message
   * @param options - Optional settings including taskType for model routing
   */
  async chat(userMessage: string, options?: { taskType?: string }): Promise<string> {
    // Store original task for continuation prompts
    const originalTask = userMessage;

    // Record start time for timeout check
    const startTime = Date.now();

    // Determine which provider to use for this chat
    const chatProvider = this.getProviderForChat(options?.taskType);

    // Add user message to history
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    // Enforce message limit
    this.enforceMessageLimit();

    // Check if context needs compaction
    await this.compactContext();

    let iterations = 0;
    let consecutiveErrors = 0;
    let finalResponse = '';

    while (iterations < FIXED_CONFIG.MAX_ITERATIONS) {
      iterations++;
      this.currentIteration = iterations;

      // Phase 4: Maybe create automatic checkpoint
      this.maybeCreateCheckpoint();

      // Check iteration breakpoints (Phase 4)
      const iterBp = this.checkBreakpoints({
        type: 'iteration',
        iteration: this.currentIteration,
      });
      if (iterBp) {
        this.debugPaused = true;
        if (isDebugBridgeEnabled()) {
          getDebugBridge().breakpointHit(iterBp, {
            type: 'iteration',
            iteration: this.currentIteration,
          });
        }
      }

      // Wait for debug resume if paused (Phase 2)
      await this.waitForDebugResume();

      // Check wall-clock timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > FIXED_CONFIG.MAX_CHAT_DURATION_MS) {
        const elapsedMinutes = Math.round(elapsed / 60000);
        const timeoutMsg = `\n\n(Reached time limit of ${elapsedMinutes} minutes, stopping)`;
        finalResponse += timeoutMsg;
        this.callbacks.onText?.(timeoutMsg);
        logger.warn(`Chat timeout after ${elapsedMinutes} minutes and ${iterations} iterations`);
        break;
      }

      // Get tool definitions if provider supports them and tools are enabled
      const tools = (this.useTools && chatProvider.supportsToolUse())
        ? this.toolRegistry.getDefinitions()
        : undefined;

      // Build system context including any conversation summary
      let systemContext = this.systemPrompt;
      if (this.conversationSummary) {
        systemContext += `\n\n## Previous Conversation Summary\n${this.conversationSummary}`;
      }

      // Add dynamic context alert when usage is high
      const contextInfo = this.getContextInfo();
      const usagePercent = (contextInfo.tokens / contextInfo.maxTokens) * 100;
      if (usagePercent >= 75) {
        const statusLabel = usagePercent >= 90 ? 'CRITICAL' : 'HIGH';
        const alert = `\n\n## Context Alert\n${statusLabel} usage (${usagePercent.toFixed(0)}%). Prefer grep/search_codebase over read_file. Use recall_result for previously read content.`;
        systemContext += alert;
        logger.debug(`Context alert: ${statusLabel} usage at ${usagePercent.toFixed(1)}%`);
      }

      // Apply compression if enabled and it actually saves space
      let messagesToSend = this.messages;
      this.lastCompressionEntities = null; // Reset for this iteration
      this.compressionBuffer = '';
      if (this.enableCompression && this.messages.length > 2) {
        const compressed = compressContext(this.messages);
        if (compressed.entities.size > 0) {
          const legend = generateEntityLegend(compressed.entities);
          const stats = getCompressionStats(compressed);

          // Calculate actual sizes to ensure compression is beneficial
          const originalSize = this.messages.reduce((sum, m) =>
            sum + JSON.stringify(m.content).length, 0);
          const compressedSize = compressed.messages.reduce((sum, m) =>
            sum + JSON.stringify(m.content).length, 0) + legend.length;

          // Only use compression if it actually reduces size
          if (compressedSize < originalSize) {
            messagesToSend = compressed.messages;
            this.lastCompressionEntities = compressed.entities;
            this.lastCompressionStats = stats;

            // Add entity legend to system context
            systemContext += `\n\n${legend}\n\nNote: The conversation uses entity references (E1, E2, etc.) to reduce context size. Refer to the legend above when you see these references.`;

            logger.compressionStats(stats.savings, stats.savingsPercent, stats.entityCount);
            logger.debug(`Compression saved ${originalSize - compressedSize} chars`);
          } else {
            logger.debug(`Compression skipped - no savings (${compressedSize} >= ${originalSize})`);
          }
        }
      }

      // Log API request at appropriate level
      logger.apiRequest(chatProvider.getModel(), messagesToSend.length, !!tools);
      logger.apiRequestFull(chatProvider.getModel(), messagesToSend, tools, systemContext);

      // Audit log API request
      this.auditLogger?.setIteration(iterations);
      this.auditLogger?.apiRequest(
        chatProvider.getName(),
        chatProvider.getModel(),
        messagesToSend,
        tools,
        systemContext
      );

      // Debug bridge: API request
      if (isDebugBridgeEnabled()) {
        getDebugBridge().apiRequest(
          chatProvider.getName(),
          chatProvider.getModel(),
          messagesToSend.length,
          !!tools
        );
      }

      // Call the model with streaming (using native system prompt support)
      const apiStartTime = Date.now();
      let streamedChars = 0;
      const onChunk = (chunk: string): void => {
        if (chunk) {
          streamedChars += chunk.length;
        }
        // Decompress streaming output if compression is active
        if (this.lastCompressionEntities?.size) {
          this.compressionBuffer += chunk;
          const { decompressed, remaining } = decompressWithBuffer(
            this.compressionBuffer,
            this.lastCompressionEntities
          );
          this.compressionBuffer = remaining;
          if (decompressed) {
            this.callbacks.onText?.(decompressed);
          }
        } else {
          this.callbacks.onText?.(chunk);
        }
      };
      let streamedReasoningChars = 0;
      const onReasoningChunk = (chunk: string): void => {
        if (chunk) {
          streamedReasoningChars += chunk.length;
        }
        this.callbacks.onReasoningChunk?.(chunk);
      };
      const response = await chatProvider.streamChat(
        messagesToSend,
        tools,
        onChunk,
        systemContext,
        onReasoningChunk
      );
      const apiDuration = (Date.now() - apiStartTime) / 1000;

      // Log API response
      logger.apiResponse(
        response.usage?.outputTokens || 0,
        response.stopReason,
        apiDuration,
        response.toolCalls.length
      );
      logger.apiResponseFull(
        response.stopReason,
        response.usage?.inputTokens || 0,
        response.usage?.outputTokens || 0,
        response.content || response.toolCalls,
        response.toolCalls.map(tc => ({ name: tc.name, input: tc.input }))
      );

      // Audit log API response
      this.auditLogger?.apiResponse(
        response.stopReason,
        response.content,
        response.toolCalls,
        response.usage,
        Date.now() - apiStartTime,
        response.rawResponse
      );

      // Debug bridge: API response
      if (isDebugBridgeEnabled()) {
        getDebugBridge().apiResponse(
          response.stopReason,
          response.usage?.inputTokens || 0,
          response.usage?.outputTokens || 0,
          Date.now() - apiStartTime,
          response.toolCalls.length
        );
      }

      // Record usage for cost tracking
      if (response.usage) {
        recordUsage(chatProvider.getName(), chatProvider.getModel(), response.usage);

        // Update token calibration with actual usage data
        if (response.usage.inputTokens && response.usage.inputTokens > 0) {
          const messagesText = messagesToSend.reduce(
            (acc, m) => acc + getMessageText(m).length,
            0
          );
          const totalTextLength = messagesText + systemContext.length;
          updateCalibration(totalTextLength, response.usage.inputTokens);
        }
      }

      // Call reasoning callback if reasoning content is present (e.g., from DeepSeek-R1)
      if (response.reasoningContent && this.callbacks.onReasoning && streamedReasoningChars === 0) {
        this.callbacks.onReasoning(response.reasoningContent);
      }

      // If no tool calls were detected via API but tools are enabled,
      // try to extract tool calls from the text (for models that output JSON as text)
      if (response.toolCalls.length === 0 && this.useTools && this.extractToolsFromText) {
        const toolDefinitions = this.toolRegistry.getDefinitions();
        const fallbackConfig = this.toolRegistry.getFallbackConfig();
        const contentText = response.content?.trim() || '';
        const reasoningText = response.reasoningContent?.trim() || '';
        const contentMatchesReasoning = Boolean(
          contentText &&
          reasoningText &&
          contentText === reasoningText
        );
        const toolTracePattern = /\[(?:Calling|Running)\s+[a-z_][a-z0-9_]*\]|\{\s*"name"\s*:\s*"[a-z_][a-z0-9_]*"|```(?:bash|sh|shell|zsh)\s*\n/i;
        const hasToolTrace = (text: string): boolean => toolTracePattern.test(text);

        let extractedCalls: ToolCall[] = [];

        if (contentText && (!contentMatchesReasoning || hasToolTrace(contentText))) {
          extractedCalls = extractToolCallsFromText(contentText, toolDefinitions, fallbackConfig);
        }

        if (
          extractedCalls.length === 0 &&
          !contentText &&
          reasoningText &&
          hasToolTrace(reasoningText)
        ) {
          extractedCalls = extractToolCallsFromText(reasoningText, toolDefinitions, fallbackConfig);
        }

        if (extractedCalls.length > 0) {
          response.toolCalls = extractedCalls;
          response.stopReason = 'tool_use';
        }
      }

      // Check if tool calls are extracted (non-native) vs native API calls
      const isExtractedToolCall = response.toolCalls.length > 0 &&
        response.toolCalls[0].id.startsWith('extracted_');

      // Store assistant response (always add to prevent consecutive user messages)
      if (response.content) {
        finalResponse = response.content;
      }

      const thinkingText = response.reasoningContent?.trim();
      const shouldAddThinkingBlock = !!thinkingText &&
        (!response.content || response.content.trim() !== thinkingText);

      const shouldEmitFallback = !response.content &&
        response.toolCalls.length === 0 &&
        streamedChars === 0;

      if (shouldEmitFallback) {
        const fallbackMessage = response.reasoningContent
          ? 'Model returned reasoning without a final answer. Try again or check --audit for the raw response.'
          : 'Model returned an empty response. Try again or check --audit for the raw response.';

        finalResponse = fallbackMessage;
        this.messages.push({
          role: 'assistant',
          content: fallbackMessage,
        });
        this.callbacks.onText?.(fallbackMessage);
      } else if (isExtractedToolCall) {
        // For extracted tool calls, store as plain text (model doesn't understand tool_use blocks)
        const combinedContent = thinkingText
          ? `[Thinking]:\n${thinkingText}${response.content ? `\n\n${response.content}` : ''}`
          : (response.content || '');
        this.messages.push({
          role: 'assistant',
          content: combinedContent,
        });
      } else if (response.content || response.toolCalls.length > 0) {
        // For native tool calls, use content blocks
        const contentBlocks: ContentBlock[] = [];

        if (shouldAddThinkingBlock && thinkingText) {
          contentBlocks.push({ type: 'thinking', text: thinkingText });
        }

        if (response.content) {
          contentBlocks.push({ type: 'text', text: response.content });
        }

        for (const toolCall of response.toolCalls) {
          contentBlocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          });
        }

        this.messages.push({
          role: 'assistant',
          content: contentBlocks,
        });
      } else {
        // Empty response - still add assistant message to prevent consecutive user messages
        this.messages.push({
          role: 'assistant',
          content: '',
        });

        // Warn if tokens were generated but no content received (likely a parsing issue)
        if (response.usage?.outputTokens && response.usage.outputTokens > 0) {
          logger.debug(
            `Warning: Model generated ${response.usage.outputTokens} tokens but returned no content. ` +
            `This may indicate a parsing issue with the provider response.`
          );
        }
      }

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        break;
      }

      // =================================================================
      // PHASE 1: Pre-process and confirm all tool calls
      // Confirmations must be sequential (diffs depend on current state)
      // =================================================================
      const toolResults: ToolResult[] = [];
      const approvedTools: ToolCall[] = [];
      let hasError = false;
      let aborted = false;

      for (const toolCall of response.toolCalls) {
        // Normalize bash command input early (before any checks)
        // Models may send { cmd: [...] } or { cmd: "..." } instead of { command: "..." }
        if (toolCall.name === 'bash' && !toolCall.input.command && toolCall.input.cmd) {
          const cmd = toolCall.input.cmd;
          if (Array.isArray(cmd)) {
            // Format: {"cmd": ["bash", "-lc", "actual command"]}
            const command = cmd.find((c: string) => !c.startsWith('-') && c !== 'bash' && c !== 'sh');
            if (command) toolCall.input.command = command;
          } else if (typeof cmd === 'string') {
            toolCall.input.command = cmd;
          }
        }

        // Check if this tool requires confirmation
        let needsConfirmation = !this.shouldAutoApprove(toolCall.name) &&
          TOOL_CATEGORIES.DESTRUCTIVE.has(toolCall.name) &&
          this.callbacks.onConfirm;

        // For bash commands, also check approved patterns/categories
        if (needsConfirmation && toolCall.name === 'bash') {
          const command = toolCall.input.command as string;
          if (command && this.shouldAutoApproveBash(command)) {
            needsConfirmation = false;
          }
        }

        // For file tools, also check approved path patterns/categories
        if (needsConfirmation && Agent.FILE_TOOLS.has(toolCall.name)) {
          const filePath = toolCall.input.path as string;
          if (filePath && this.shouldAutoApproveFilePath(toolCall.name, filePath)) {
            needsConfirmation = false;
          }
        }

        if (needsConfirmation) {
          // Check for dangerous bash commands (including custom patterns)
          let isDangerous = false;
          let dangerReason: string | undefined;

          if (toolCall.name === 'bash') {
            const command = toolCall.input.command as string | undefined;
            if (command) {
              // Check built-in dangerous patterns
              const danger = checkDangerousBash(command);
              isDangerous = danger.isDangerous;
              dangerReason = danger.reason;

              // Check custom dangerous patterns if not already flagged
              if (!isDangerous && this.customDangerousPatterns.length > 0) {
                for (const { pattern, description } of this.customDangerousPatterns) {
                  if (pattern.test(command)) {
                    isDangerous = true;
                    dangerReason = description;
                    break;
                  }
                }
              }
            }
          }

          // Generate diff preview for file operations
          let diffPreview: DiffResult | undefined;
          try {
            if (toolCall.name === 'write_file') {
              const path = toolCall.input.path as string;
              const content = toolCall.input.content as string;
              if (path && content !== undefined) {
                diffPreview = await generateWriteDiff(path, content);
              }
            } else if (toolCall.name === 'edit_file') {
              const path = toolCall.input.path as string;
              const oldString = toolCall.input.old_string as string;
              const newString = toolCall.input.new_string as string;
              const replaceAll = (toolCall.input.replace_all as boolean) || false;
              if (path && oldString !== undefined && newString !== undefined) {
                diffPreview = await generateEditDiff(path, oldString, newString, replaceAll);
              }
            }
          } catch {
            // If diff generation fails, continue without preview
          }

          // Get approval suggestions for bash commands (unless dangerous)
          let approvalSuggestions: ToolConfirmation['approvalSuggestions'];
          if (toolCall.name === 'bash' && !isDangerous) {
            const command = toolCall.input.command as string | undefined;
            if (command) {
              const suggestions = getApprovalSuggestions(command);
              approvalSuggestions = {
                suggestedPattern: suggestions.suggestedPattern,
                matchedCategories: suggestions.matchedCategories.map((c) => ({
                  id: c.id,
                  name: c.name,
                  description: c.description,
                })),
              };
            }
          }

          // Get approval suggestions for file tools
          if (Agent.FILE_TOOLS.has(toolCall.name)) {
            const filePath = toolCall.input.path as string;
            if (filePath) {
              const suggestions = getPathApprovalSuggestions(filePath);
              approvalSuggestions = {
                suggestedPattern: suggestions.suggestedPattern,
                matchedCategories: suggestions.matchedCategories.map((c) => ({
                  id: c.id,
                  name: c.name,
                  description: c.description,
                })),
              };
            }
          }

          const confirmation: ToolConfirmation = {
            toolName: toolCall.name,
            input: toolCall.input,
            isDangerous,
            dangerReason,
            diffPreview,
            approvalSuggestions,
          };

          const result = await this.callbacks.onConfirm!(confirmation);

          // Handle "approve similar" responses
          if (typeof result === 'object') {
            if (result.type === 'approve_pattern') {
              // Determine if this is a bash command or file tool
              if (Agent.FILE_TOOLS.has(toolCall.name)) {
                // Save as path pattern
                const saveResult = addApprovedPathPattern(result.pattern, toolCall.name);
                if (saveResult.success) {
                  this.approvedPathPatterns.push({
                    pattern: result.pattern,
                    toolName: toolCall.name,
                    approvedAt: new Date().toISOString(),
                  });
                }
              } else {
                // Save as bash command pattern
                const saveResult = addApprovedPattern(result.pattern);
                if (saveResult.success) {
                  this.approvedPatterns.push({
                    pattern: result.pattern,
                    approvedAt: new Date().toISOString(),
                  });
                }
              }
              // Continue with approval (execute the tool)
              approvedTools.push(toolCall);
            } else if (result.type === 'approve_category') {
              // Determine if this is a bash command or file tool
              if (Agent.FILE_TOOLS.has(toolCall.name)) {
                // Save as path category
                const saveResult = addApprovedPathCategory(result.categoryId);
                if (saveResult.success) {
                  this.approvedPathCategories.push(result.categoryId);
                }
              } else {
                // Save as bash command category
                const saveResult = addApprovedCategory(result.categoryId);
                if (saveResult.success) {
                  this.approvedCategories.push(result.categoryId);
                }
              }
              // Continue with approval (execute the tool)
              approvedTools.push(toolCall);
            }
          } else {
            // Handle simple string results
            if (result === 'abort') {
              aborted = true;
              toolResults.push({
                tool_use_id: toolCall.id,
                content: 'User aborted the operation.',
                is_error: true,
              });
              break;
            }

            if (result === 'deny') {
              toolResults.push({
                tool_use_id: toolCall.id,
                content: 'User denied this operation. Please try a different approach or ask for clarification.',
                is_error: true,
              });
              hasError = true;
              continue;
            }

            // result === 'approve'
            approvedTools.push(toolCall);
          }
        } else {
          // No confirmation needed, add to approved list
          approvedTools.push(toolCall);
        }
      }

      // =================================================================
      // PHASE 2: Batch and execute approved tools
      // Read-only tools on different files can run in parallel
      // =================================================================
      if (!aborted && approvedTools.length > 0) {
        const batches = batchToolCalls(approvedTools);
        const stats = getBatchStats(batches);

        if (stats.parallelBatches > 0) {
          logger.debug(
            `Tool batching: ${stats.totalCalls} calls → ${batches.length} batches ` +
            `(${stats.parallelBatches} parallel, max ${stats.maxParallelism} concurrent)`
          );
        }

        for (const batch of batches) {
          // Phase 4: Check breakpoints before each batch
          for (const toolCall of batch.calls) {
            const bp = this.checkBreakpoints({
              type: 'tool_call',
              toolName: toolCall.name,
              toolInput: toolCall.input,
              iteration: this.currentIteration,
            });

            if (bp) {
              this.debugPaused = true;
              if (isDebugBridgeEnabled()) {
                getDebugBridge().breakpointHit(bp, {
                  type: 'tool_call',
                  toolName: toolCall.name,
                  toolInput: toolCall.input,
                  iteration: this.currentIteration,
                });
              }
              await this.waitForDebugResume();
            }
          }

          if (batch.parallel && batch.calls.length > 1) {
            // Execute batch in parallel
            logger.debug(`Executing ${batch.calls.length} tools in parallel: ${batch.calls.map(c => c.name).join(', ')}`);

            // Notify all tool calls are starting
            for (const toolCall of batch.calls) {
              this.callbacks.onToolCall?.(toolCall.name, toolCall.input);
              updateWorkingSet(this.workingSet, toolCall.name, toolCall.input);
              // Debug bridge: tool call start
              if (isDebugBridgeEnabled()) {
                getDebugBridge().toolCallStart(toolCall.name, toolCall.input, toolCall.id);
              }
            }

            // Execute all in parallel with concurrency limit (max 8 concurrent)
            const parallelStartTime = Date.now();
            const parallelResults = await executeWithConcurrencyLimit(
              batch.calls,
              (toolCall) => this.toolRegistry.execute(toolCall)
            ) as Awaited<ReturnType<typeof this.toolRegistry.execute>>[];
            const parallelDuration = Date.now() - parallelStartTime;

            // Process results
            for (let i = 0; i < parallelResults.length; i++) {
              const result = parallelResults[i];
              const toolCall = batch.calls[i];
              toolResults.push(result);
              if (result.is_error) {
                hasError = true;
                // Phase 4: Check error breakpoints
                const errBp = this.checkBreakpoints({
                  type: 'error',
                  toolName: toolCall.name,
                  iteration: this.currentIteration,
                  error: result.content,
                });
                if (errBp) {
                  this.debugPaused = true;
                  if (isDebugBridgeEnabled()) {
                    getDebugBridge().breakpointHit(errBp, {
                      type: 'error',
                      toolName: toolCall.name,
                      iteration: this.currentIteration,
                      error: result.content,
                    });
                  }
                }
              }

              // Debug bridge: tool call end and result
              if (isDebugBridgeEnabled()) {
                getDebugBridge().toolCallEnd(toolCall.name, toolCall.id, parallelDuration, !!result.is_error);
                getDebugBridge().toolResult(toolCall.name, toolCall.id, result.content, !!result.is_error);
              }

              this.callbacks.onToolResult?.(toolCall.name, result.content, !!result.is_error);
            }
          } else {
            // Execute sequentially
            for (const toolCall of batch.calls) {
              this.callbacks.onToolCall?.(toolCall.name, toolCall.input);
              updateWorkingSet(this.workingSet, toolCall.name, toolCall.input);

              // Debug bridge: tool call start
              const toolStartTime = Date.now();
              if (isDebugBridgeEnabled()) {
                getDebugBridge().toolCallStart(toolCall.name, toolCall.input, toolCall.id);
              }

              const result = await this.toolRegistry.execute(toolCall);
              toolResults.push(result);
              if (result.is_error) {
                hasError = true;
                // Phase 4: Check error breakpoints
                const errBp = this.checkBreakpoints({
                  type: 'error',
                  toolName: toolCall.name,
                  iteration: this.currentIteration,
                  error: result.content,
                });
                if (errBp) {
                  this.debugPaused = true;
                  if (isDebugBridgeEnabled()) {
                    getDebugBridge().breakpointHit(errBp, {
                      type: 'error',
                      toolName: toolCall.name,
                      iteration: this.currentIteration,
                      error: result.content,
                    });
                  }
                  await this.waitForDebugResume();
                }
              }

              // Debug bridge: tool call end and result
              if (isDebugBridgeEnabled()) {
                const durationMs = Date.now() - toolStartTime;
                getDebugBridge().toolCallEnd(toolCall.name, toolCall.id, durationMs, !!result.is_error);
                getDebugBridge().toolResult(toolCall.name, toolCall.id, result.content, !!result.is_error);
              }

              this.callbacks.onToolResult?.(toolCall.name, result.content, !!result.is_error);
            }
          }
        }
      }

      // If user aborted, stop the loop
      if (aborted) {
        finalResponse += '\n\n(Operation aborted by user)';
        this.auditLogger?.userAbort(undefined, 'User declined tool confirmation');
        break;
      }

      // Track consecutive errors
      if (hasError) {
        consecutiveErrors++;
        if (consecutiveErrors >= FIXED_CONFIG.MAX_CONSECUTIVE_ERRORS) {
          finalResponse += '\n\n(Stopping due to repeated errors. Please check the issue and try again.)';
          break;
        }
      } else {
        consecutiveErrors = 0; // Reset on success
      }

      // Add tool results to messages
      if (isExtractedToolCall) {
        // For extracted tool calls, format results as plain text
        let resultText = '';
        for (let i = 0; i < toolResults.length; i++) {
          const result = toolResults[i];
          const toolName = response.toolCalls[i].name;
          // Truncate large results to help smaller models
          const content = this.truncateToolResult(result.content);
          if (result.is_error) {
            resultText += `ERROR from ${toolName}: ${content}\n\n`;
          } else {
            resultText += `Result from ${toolName}:\n${content}\n\n`;
          }
        }
        // lp 1/16/26: skip this for now. I believe it is causing issues
        // resultText += this.buildContinuationPrompt(originalTask);

        this.messages.push({
          role: 'user',
          content: resultText,
        });
      } else {
        // For native tool calls, use content blocks
        const resultBlocks: ContentBlock[] = [];

        for (let i = 0; i < toolResults.length; i++) {
          const result = toolResults[i];
          const toolName = response.toolCalls[i].name;

          // Check if this is an image result from analyze_image
          const imageResult = !result.is_error ? parseImageResult(result.content) : null;

          if (imageResult) {
            // Add a tool_result indicating the image was loaded
            resultBlocks.push({
              type: 'tool_result' as const,
              tool_use_id: result.tool_use_id,
              name: toolName,
              content: 'Image loaded successfully. Analyzing...',
              is_error: false,
            });

            // Add the question as text if provided
            if (imageResult.question) {
              resultBlocks.push({
                type: 'text' as const,
                text: `Please analyze this image: ${imageResult.question}`,
              });
            } else {
              resultBlocks.push({
                type: 'text' as const,
                text: 'Please analyze this image and describe what you see.',
              });
            }

            // Add the image block
            resultBlocks.push({
              type: 'image' as const,
              image: {
                type: 'base64',
                media_type: imageResult.mediaType,
                data: imageResult.data,
              },
            });
          } else {
            // Normal tool result - truncate large results to help smaller models
            const truncatedContent = this.truncateToolResult(result.content);
            resultBlocks.push({
              type: 'tool_result' as const,
              tool_use_id: result.tool_use_id,
              name: toolName,
              content: result.is_error
                ? `ERROR: ${truncatedContent}\n\nPlease read the error message carefully and adjust your approach.`
                : truncatedContent,
              is_error: result.is_error,
            });
          }
        }

        resultBlocks.push({
          type: 'text' as const,
          text: this.buildContinuationPrompt(originalTask),
        });

        this.messages.push({
          role: 'user',
          content: resultBlocks,
        });
      }

      // Truncate old tool results to save context (using tier-based token budget)
      truncateOldToolResults(this.messages, {
        toolResultsTokenBudget: this.contextConfig.toolResultsTokenBudget,
        toolResultTruncateThreshold: this.contextConfig.toolResultTruncateThreshold,
      });

      // Check step mode after iteration completes (Phase 2)
      if (this.debugStepMode && isDebugBridgeEnabled()) {
        this.debugPaused = true;
        this.debugStepMode = false;
        getDebugBridge().emit('step_complete', { iteration: this.currentIteration });
      }
    }

    if (iterations >= FIXED_CONFIG.MAX_ITERATIONS) {
      const maxIterMsg = '\n\n(Reached maximum iterations, stopping)';
      finalResponse += maxIterMsg;
      // Also output via callback so user sees the message
      this.callbacks.onText?.(maxIterMsg);
      // Audit log
      this.auditLogger?.maxIterations(iterations, FIXED_CONFIG.MAX_ITERATIONS);
    }

    // Decompress final response if compression was used
    if (this.lastCompressionEntities?.size) {
      // Flush any remaining buffer
      if (this.compressionBuffer) {
        const flushed = decompressText(this.compressionBuffer, this.lastCompressionEntities);
        this.callbacks.onText?.(flushed);
        this.compressionBuffer = '';
      }
      finalResponse = decompressText(finalResponse, this.lastCompressionEntities);
    }

    return finalResponse;
  }

  /**
   * Clear conversation history, summary, and working set.
   */
  clearHistory(): void {
    this.messages = [];
    this.conversationSummary = null;
    this.workingSet = createWorkingSet();
  }

  /**
   * Clear only the conversation context (messages and summary), keeping the working set.
   */
  clearContext(): void {
    this.messages = [];
    this.conversationSummary = null;
  }

  /**
   * Clear only the working set (tracked files and entities), keeping conversation history.
   */
  clearWorkingSet(): void {
    this.workingSet = createWorkingSet();
  }

  /**
   * Get the conversation history.
   */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /**
   * Get the conversation summary.
   */
  getSummary(): string | null {
    return this.conversationSummary;
  }

  /**
   * Set the conversation history (for loading sessions).
   */
  setHistory(messages: Message[]): void {
    this.messages = [...messages];
  }

  /**
   * Set the conversation summary (for loading sessions).
   */
  setSummary(summary: string | null): void {
    this.conversationSummary = summary;
  }

  /**
   * Load a full session state.
   */
  loadSession(messages: Message[], summary: string | null): void {
    this.messages = [...messages];
    this.conversationSummary = summary;
  }

  /**
   * Inject background context into the conversation.
   * This adds a user message with context that the agent can reference.
   */
  injectContext(context: string): void {
    if (!context) return;

    // Add as a user message so it appears in conversation history
    this.messages.push({
      role: 'user',
      content: `## Background Context\n\nThe following context may be helpful for your task:\n\n${context}\n\n---\nPlease consider this context when working on the assigned task.`,
    });

    // Add acknowledgment so conversation flow is natural
    this.messages.push({
      role: 'assistant',
      content: 'I understand. I\'ll consider this background context while working on the task.',
    });
  }

  /**
   * Get the current provider.
   */
  getProvider(): BaseProvider {
    return this.provider;
  }

  /**
   * Switch to a different provider.
   * Preserves conversation history.
   */
  setProvider(provider: BaseProvider): void {
    this.provider = provider;
    // Update useTools based on new provider's capabilities
    this.useTools = provider.supportsToolUse();
    // Recompute tier-based context config for new provider
    this.contextConfig = computeContextConfig(provider.getContextWindow());
    // Recalculate maxContextTokens if not explicitly set by user
    if (!this.maxContextTokensExplicit) {
      this.maxContextTokens = this.calculateAdaptiveContextLimit(provider);
    }
  }

  /**
   * Set indexed files from RAG for code relevance scoring.
   * Messages discussing indexed files get higher importance during compaction.
   */
  setIndexedFiles(files: string[]): void {
    this.indexedFiles = new Set(files);
  }

  /**
   * Set embedding provider for semantic message deduplication.
   * When set, similar messages are grouped together during compaction.
   */
  setEmbeddingProvider(provider: import('./rag/embeddings/base.js').BaseEmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Get current context size information.
   */
  getContextInfo(): {
    // Token counts
    tokens: number;
    messageTokens: number;
    systemPromptTokens: number;
    toolDefinitionTokens: number;
    // Limits and budget
    maxTokens: number;
    contextWindow: number;
    effectiveLimit: number; // The actual limit to use (maxTokens if set, otherwise contextWindow)
    outputReserve: number;
    safetyBuffer: number;
    tierName: string;
    // Message breakdown
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolResultMessages: number;
    // State
    hasSummary: boolean;
    compression: CompressionStats | null;
    compressionEnabled: boolean;
    workingSetFiles: number;
  } {
    const toolDefinitions = this.useTools ? this.toolRegistry.getDefinitions() : [];
    const systemPromptWithSummary = this.conversationSummary
      ? `${this.systemPrompt}\n\n## Previous Conversation Summary\n${this.conversationSummary}`
      : this.systemPrompt;

    const messageTokens = countMessageTokens(this.messages);
    const systemPromptTokens = estimateSystemPromptTokens(systemPromptWithSummary);
    const toolDefinitionTokens = estimateToolDefinitionTokens(toolDefinitions);

    // Count messages by role
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResultMessages = 0;
    for (const msg of this.messages) {
      if (msg.role === 'user') {
        // Check if it contains tool results
        if (typeof msg.content !== 'string' &&
            msg.content.some(b => b.type === 'tool_result')) {
          toolResultMessages++;
        } else {
          userMessages++;
        }
      } else if (msg.role === 'assistant') {
        assistantMessages++;
      }
    }

    // Compute scaled config based on effective limit
    const scaledConfig = computeScaledContextConfig(this.contextConfig, this.maxContextTokens, this.contextOptimization);

    return {
      tokens: messageTokens + systemPromptTokens + toolDefinitionTokens,
      messageTokens,
      systemPromptTokens,
      toolDefinitionTokens,
      maxTokens: this.maxContextTokens,
      contextWindow: this.provider.getContextWindow(),
      effectiveLimit: this.maxContextTokens, // Always use the configured maxContextTokens
      outputReserve: scaledConfig.maxOutputTokens,
      safetyBuffer: scaledConfig.safetyBuffer,
      tierName: scaledConfig.tierName,
      messages: this.messages.length,
      userMessages,
      assistantMessages,
      toolResultMessages,
      hasSummary: this.conversationSummary !== null,
      compression: this.lastCompressionStats,
      compressionEnabled: this.enableCompression,
      workingSetFiles: this.workingSet.recentFiles.size,
    };
  }

  /**
   * Get a copy of the current messages for analysis.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Enable or disable context compression.
   */
  setCompression(enabled: boolean): void {
    this.enableCompression = enabled;
    if (!enabled) {
      this.lastCompressionStats = null;
    }
  }

  /**
   * Check if compression is enabled.
   */
  isCompressionEnabled(): boolean {
    return this.enableCompression;
  }

  // ============================================
  // Debug control (Phase 2)
  // ============================================

  /**
   * Set the debug paused state.
   */
  setDebugPaused(paused: boolean): void {
    this.debugPaused = paused;
    if (isDebugBridgeEnabled()) {
      getDebugBridge().emit(paused ? 'paused' : 'resumed', {
        iteration: this.currentIteration,
      });
    }
  }

  /**
   * Check if the agent is paused.
   */
  isDebugPaused(): boolean {
    return this.debugPaused;
  }

  /**
   * Enable step mode - execute one iteration then pause.
   */
  setDebugStep(): void {
    this.debugStepMode = true;
    this.debugPaused = false; // Resume to execute one step
  }

  /**
   * Wait for debug resume if paused.
   * Called before each API request in the chat loop.
   */
  private async waitForDebugResume(): Promise<void> {
    if (!isDebugBridgeEnabled() || !this.debugPaused) return;

    // Emit paused state periodically while waiting
    while (this.debugPaused) {
      getDebugBridge().emit('state_snapshot', {
        paused: true,
        waiting: 'resume',
        iteration: this.currentIteration,
        messageCount: this.messages.length,
      });
      await new Promise(r => setTimeout(r, 500)); // Check every 500ms
    }
  }

  /**
   * Get a snapshot of the agent state for debugging.
   */
  getStateSnapshot(what: 'messages' | 'context' | 'tools' | 'all' = 'all'): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      sessionId: isDebugBridgeEnabled() ? getDebugBridge().getSessionId() : null,
      iteration: this.currentIteration,
      paused: this.debugPaused,
    };

    if (what === 'messages' || what === 'all') {
      const roleCount = { user: 0, assistant: 0, tool: 0 };
      for (const msg of this.messages) {
        if (msg.role === 'user') {
          if (typeof msg.content !== 'string' &&
              msg.content.some(b => b.type === 'tool_result')) {
            roleCount.tool++;
          } else {
            roleCount.user++;
          }
        } else if (msg.role === 'assistant') {
          roleCount.assistant++;
        }
      }

      snapshot.messages = {
        count: this.messages.length,
        roles: roleCount,
        recent: this.messages.slice(-3).map(m => ({
          role: m.role,
          preview: getMessageText(m).slice(0, 200),
        })),
      };
    }

    if (what === 'context' || what === 'all') {
      snapshot.context = {
        tokenEstimate: countMessageTokens(this.messages),
        maxTokens: this.maxContextTokens,
        hasSummary: !!this.conversationSummary,
        summaryPreview: this.conversationSummary?.slice(0, 200),
      };
    }

    if (what === 'tools' || what === 'all') {
      snapshot.tools = {
        enabled: this.toolRegistry.getDefinitions().map(d => d.name),
        count: this.toolRegistry.getDefinitions().length,
      };
    }

    snapshot.provider = {
      name: this.provider.getName(),
      model: this.provider.getModel(),
    };

    snapshot.workingSet = [...this.workingSet.recentFiles];

    return snapshot;
  }

  /**
   * Inject a message into the conversation history.
   * Used for debugging/testing purposes.
   */
  injectMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });
    if (isDebugBridgeEnabled()) {
      getDebugBridge().emit('state_snapshot', {
        injectedMessage: true,
        role,
        contentPreview: content.slice(0, 200),
        messageCount: this.messages.length,
      });
    }
  }

  // ============================================
  // Breakpoints (Phase 4)
  // ============================================

  /**
   * Add a breakpoint.
   */
  addBreakpoint(type: BreakpointType, condition?: string | number): string {
    const id = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.breakpoints.set(id, {
      id,
      type,
      condition,
      enabled: true,
      hitCount: 0,
    });
    return id;
  }

  /**
   * Remove a breakpoint by ID.
   */
  removeBreakpoint(id: string): boolean {
    return this.breakpoints.delete(id);
  }

  /**
   * Clear all breakpoints.
   */
  clearBreakpoints(): void {
    this.breakpoints.clear();
  }

  /**
   * List all breakpoints.
   */
  listBreakpoints(): Breakpoint[] {
    return [...this.breakpoints.values()];
  }

  /**
   * Check if any breakpoint should trigger.
   * Returns the first matching breakpoint or null.
   */
  private checkBreakpoints(context: BreakpointContext): Breakpoint | null {
    for (const bp of this.breakpoints.values()) {
      if (!bp.enabled) continue;

      switch (bp.type) {
        case 'tool':
          if (context.type === 'tool_call' && context.toolName === bp.condition) {
            bp.hitCount++;
            return bp;
          }
          break;

        case 'iteration':
          if (context.iteration === bp.condition) {
            bp.hitCount++;
            return bp;
          }
          break;

        case 'pattern':
          if (context.toolInput && typeof bp.condition === 'string') {
            const inputStr = JSON.stringify(context.toolInput);
            const regex = new RegExp(bp.condition, 'i');
            if (regex.test(inputStr)) {
              bp.hitCount++;
              return bp;
            }
          }
          break;

        case 'error':
          if (context.type === 'error') {
            bp.hitCount++;
            return bp;
          }
          break;
      }
    }
    return null;
  }

  // ============================================
  // Checkpoints (Phase 4)
  // ============================================

  /**
   * Create a checkpoint with current state.
   * In Phase 5, this also saves full state to disk.
   */
  createCheckpoint(label?: string): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `cp_${this.currentIteration}_${Date.now()}`,
      label,
      iteration: this.currentIteration,
      timestamp: new Date().toISOString(),
      messageCount: this.messages.length,
      tokenCount: countMessageTokens(this.messages),
    };

    this.lastCheckpointIteration = this.currentIteration;

    // Phase 5: Save full checkpoint to disk if debug bridge enabled
    if (isDebugBridgeEnabled()) {
      const fullCheckpoint: FullCheckpoint = {
        ...checkpoint,
        branch: this.currentBranch,
        state: {
          messages: structuredClone(this.messages),
          summary: this.conversationSummary,
          workingSet: {
            recentFiles: [...this.workingSet.recentFiles],
            activeEntities: [...this.workingSet.activeEntities],
          },
        },
      };
      this.saveCheckpoint(fullCheckpoint);
      getDebugBridge().checkpoint(checkpoint);
    }

    return checkpoint;
  }

  /**
   * Automatically create checkpoint if interval has passed.
   */
  private maybeCreateCheckpoint(): void {
    if (!isDebugBridgeEnabled()) return;

    if (this.currentIteration - this.lastCheckpointIteration >= this.checkpointInterval) {
      this.createCheckpoint();
    }
  }

  /**
   * Set the auto-checkpoint interval.
   */
  setCheckpointInterval(interval: number): void {
    this.checkpointInterval = interval;
  }

  // ============================================
  // Time Travel (Phase 5)
  // ============================================

  /**
   * Save a full checkpoint to disk.
   */
  private saveCheckpoint(checkpoint: FullCheckpoint): void {
    if (!isDebugBridgeEnabled()) return;

    const { mkdirSync, writeFileSync } = require('fs');
    const { join } = require('path');

    const checkpointsDir = join(getDebugBridge().getSessionDir(), 'checkpoints');
    mkdirSync(checkpointsDir, { recursive: true });

    const filePath = join(checkpointsDir, `${checkpoint.id}.json`);
    writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));

    // Add to branch's checkpoint list
    const branch = this.timeline.branches.find(b => b.name === this.currentBranch);
    if (branch && !branch.checkpoints.includes(checkpoint.id)) {
      branch.checkpoints.push(checkpoint.id);
      this.saveTimeline();
    }
  }

  /**
   * Load a checkpoint from disk.
   */
  loadCheckpoint(checkpointId: string): FullCheckpoint | null {
    if (!isDebugBridgeEnabled()) return null;

    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');

    const filePath = join(getDebugBridge().getSessionDir(), 'checkpoints', `${checkpointId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * List all checkpoints in the current session.
   */
  listCheckpoints(): Checkpoint[] {
    if (!isDebugBridgeEnabled()) return [];

    const { existsSync, readdirSync, readFileSync } = require('fs');
    const { join } = require('path');

    const checkpointsDir = join(getDebugBridge().getSessionDir(), 'checkpoints');
    if (!existsSync(checkpointsDir)) return [];

    const checkpoints: Checkpoint[] = [];
    const files = readdirSync(checkpointsDir).filter((f: string) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = readFileSync(join(checkpointsDir, file), 'utf8');
        const cp = JSON.parse(content) as FullCheckpoint;
        checkpoints.push({
          id: cp.id,
          label: cp.label,
          iteration: cp.iteration,
          timestamp: cp.timestamp,
          messageCount: cp.messageCount,
          tokenCount: cp.tokenCount,
        });
      } catch {
        // Skip invalid checkpoint files
      }
    }

    return checkpoints.sort((a, b) => a.iteration - b.iteration);
  }

  /**
   * Rewind to a checkpoint (destructive - loses subsequent state).
   */
  rewind(checkpointId: string): boolean {
    const checkpoint = this.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      return false;
    }

    // Restore state
    this.messages = structuredClone(checkpoint.state.messages) as Message[];
    this.conversationSummary = checkpoint.state.summary;
    // Restore working set
    this.workingSet = createWorkingSet();
    if (checkpoint.state.workingSet) {
      for (const file of checkpoint.state.workingSet.recentFiles || []) {
        this.workingSet.recentFiles.add(file);
      }
      for (const entity of checkpoint.state.workingSet.activeEntities || []) {
        this.workingSet.activeEntities.add(entity);
      }
    }
    this.currentIteration = checkpoint.iteration;
    this.lastCheckpointIteration = checkpoint.iteration;

    if (isDebugBridgeEnabled()) {
      getDebugBridge().rewind(checkpointId, checkpoint.iteration, this.messages.length);
    }

    return true;
  }

  /**
   * Create a branch from a checkpoint.
   */
  createBranch(checkpointId: string, branchName: string): boolean {
    const checkpoint = this.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      return false;
    }

    // Check if branch already exists
    if (this.timeline.branches.some(b => b.name === branchName)) {
      return false;
    }

    const branch: Branch = {
      name: branchName,
      parentBranch: checkpoint.branch,
      forkPoint: checkpointId,
      created: new Date().toISOString(),
      checkpoints: [],
      current: false,
    };

    this.timeline.branches.push(branch);
    this.saveTimeline();

    if (isDebugBridgeEnabled()) {
      getDebugBridge().branchCreated(branchName, checkpointId, checkpoint.branch);
    }

    return true;
  }

  /**
   * Switch to a different branch.
   */
  switchBranch(branchName: string): boolean {
    const branch = this.timeline.branches.find(b => b.name === branchName);
    if (!branch) {
      return false;
    }

    // Find the latest checkpoint in the branch to restore from
    let checkpointId: string | undefined;
    if (branch.checkpoints.length > 0) {
      checkpointId = branch.checkpoints[branch.checkpoints.length - 1];
    } else if (branch.forkPoint) {
      checkpointId = branch.forkPoint;
    }

    if (checkpointId) {
      const rewound = this.rewind(checkpointId);
      if (!rewound) {
        return false;
      }
    }

    // Update current branch
    this.timeline.branches.forEach(b => b.current = false);
    branch.current = true;
    this.currentBranch = branchName;
    this.timeline.activeBranch = branchName;
    this.saveTimeline();

    if (isDebugBridgeEnabled()) {
      getDebugBridge().branchSwitched(branchName, this.currentIteration);
    }

    return true;
  }

  /**
   * List all branches.
   */
  listBranches(): Branch[] {
    return this.timeline.branches;
  }

  /**
   * Get the current branch name.
   */
  getCurrentBranch(): string {
    return this.currentBranch;
  }

  /**
   * Get the timeline.
   */
  getTimeline(): Timeline {
    return this.timeline;
  }

  /**
   * Save the timeline to disk.
   */
  private saveTimeline(): void {
    if (!isDebugBridgeEnabled()) return;

    const { writeFileSync } = require('fs');
    const { join } = require('path');

    const filePath = join(getDebugBridge().getSessionDir(), 'timeline.json');
    writeFileSync(filePath, JSON.stringify(this.timeline, null, 2));
  }

  /**
   * Load the timeline from disk.
   */
  loadTimeline(): void {
    if (!isDebugBridgeEnabled()) return;

    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');

    const filePath = join(getDebugBridge().getSessionDir(), 'timeline.json');
    if (!existsSync(filePath)) return;

    try {
      this.timeline = JSON.parse(readFileSync(filePath, 'utf8'));
      this.currentBranch = this.timeline.activeBranch;
    } catch {
      // Keep default timeline
    }
  }

  /**
   * Force context compaction regardless of current size.
   * Returns info about what was compacted.
   */
  async forceCompact(): Promise<{ before: number; after: number; summary: string | null }> {
    const before = countMessageTokens(this.messages);

    if (this.messages.length <= CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES) {
      return { before, after: before, summary: this.conversationSummary };
    }

    // Score messages and use smart windowing (pass indexed files for RAG-enhanced scoring)
    const scores = scoreMessages(
      this.messages,
      CONTEXT_OPTIMIZATION.WEIGHTS,
      undefined, // entities
      this.indexedFiles ?? undefined
    );
    const windowConfig: WindowingConfig = {
      minRecentMessages: CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES,
      maxMessages: Math.min(CONTEXT_OPTIMIZATION.MAX_MESSAGES, Math.ceil(this.messages.length / 2)),
      importanceThreshold: CONTEXT_OPTIMIZATION.IMPORTANCE_THRESHOLD,
      preserveToolPairs: CONTEXT_OPTIMIZATION.PRESERVE_TOOL_PAIRS,
      preserveWorkingSet: CONTEXT_OPTIMIZATION.PRESERVE_WORKING_SET,
    };

    const selection = selectMessagesToKeep(this.messages, scores, this.workingSet, windowConfig);

    if (selection.summarize.length === 0) {
      this.messages = applySelection(this.messages, selection);
      const after = countMessageTokens(this.messages);
      return { before, after, summary: this.conversationSummary };
    }

    const messagesToSummarize = selection.summarize.map(i => this.messages[i]);

    // Extract file paths from messages for better context preservation
    const discussedFiles = new Set<string>();
    for (const msg of messagesToSummarize) {
      const text = getMessageText(msg);
      const paths = extractFilePaths(text);
      paths.forEach(p => discussedFiles.add(p));
    }

    const oldContent = messagesToSummarize
      .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
      .join('\n\n');

    const contextToSummarize = this.conversationSummary
      ? `Previous summary:\n${this.conversationSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    // Build enhanced summary prompt with file context
    const filesContext = discussedFiles.size > 0
      ? `\n\nFiles discussed: ${[...discussedFiles].join(', ')}`
      : '';

    try {
      // Use secondary provider for summarization if configured
      const summaryProvider = this.getSummaryProvider();
      const summaryResponse = await summaryProvider.streamChat(
        [{
          role: 'user',
          content: `Create a concise summary of this conversation for context preservation.

## What to Include
- **Goal**: What task is the user trying to accomplish?
- **Progress**: What has been done so far?
- **Files Modified**: List any files that were created, edited, or deleted
- **Key Decisions**: Any important choices made during the conversation
- **Current State**: Where did the conversation leave off?

## Format
Write 3-5 short paragraphs. Use bullet points for file lists. Be factual and specific.
${filesContext}

## Conversation to Summarize
${contextToSummarize}`,
        }],
        undefined,
        undefined
      );
      this.conversationSummary = summaryResponse.content;
      this.messages = applySelection(this.messages, selection);
    } catch {
      this.messages = applySelection(this.messages, selection);
    }

    const after = countMessageTokens(this.messages);
    return { before, after, summary: this.conversationSummary };
  }
}
