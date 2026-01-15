// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import type { Message, ContentBlock, ToolResult, ToolCall } from './types.js';
import type { BaseProvider } from './providers/base.js';
import { ToolRegistry } from './tools/registry.js';
import { generateWriteDiff, generateEditDiff, type DiffResult } from './diff.js';
import { recordUsage } from './usage.js';
import { AGENT_CONFIG, TOOL_CATEGORIES, CONTEXT_OPTIMIZATION, type DangerousPattern } from './constants.js';
import type { ModelMap } from './model-map/index.js';
import {
  compressContext,
  generateEntityLegend,
  getCompressionStats,
  type CompressedContext,
  type CompressionStats,
} from './compression.js';
import { scoreMessages, type MessageScore } from './importance-scorer.js';
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
  getMessageText,
  findSafeStartIndex,
  truncateOldToolResults,
  parseImageResult,
  checkDangerousBash,
} from './utils/index.js';
import { logger, LogLevel } from './logger.js';
import type { AuditLogger } from './audit.js';
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
  private auditLogger: AuditLogger | null = null;
  private messages: Message[] = [];
  private conversationSummary: string | null = null;
  private lastCompressionStats: CompressionStats | null = null;
  private workingSet: WorkingSet = createWorkingSet();
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
    this.auditLogger = options.auditLogger ?? null;
    this.systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
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

    if (totalTokens <= AGENT_CONFIG.MAX_CONTEXT_TOKENS) {
      return; // No compaction needed
    }

    logger.debug(`Compacting: ${totalTokens} tokens exceeds ${AGENT_CONFIG.MAX_CONTEXT_TOKENS} limit`);

    // Score messages by importance
    const scores = scoreMessages(this.messages, CONTEXT_OPTIMIZATION.WEIGHTS);

    // Configure windowing
    const windowConfig: WindowingConfig = {
      minRecentMessages: CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES,
      maxMessages: CONTEXT_OPTIMIZATION.MAX_MESSAGES,
      importanceThreshold: CONTEXT_OPTIMIZATION.IMPORTANCE_THRESHOLD,
      preserveToolPairs: CONTEXT_OPTIMIZATION.PRESERVE_TOOL_PAIRS,
      preserveWorkingSet: CONTEXT_OPTIMIZATION.PRESERVE_WORKING_SET,
      maxWorkingSetFiles: CONTEXT_OPTIMIZATION.MAX_WORKING_SET_FILES,
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

    // Format older messages for summarization
    const oldContent = messagesToSummarize
      .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
      .join('\n\n');

    // Include existing summary if present
    const contextToSummarize = this.conversationSummary
      ? `Previous summary:\n${this.conversationSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    try {
      // Ask the model to create a summary (use secondary provider if configured)
      const summaryProvider = this.getSummaryProvider();
      logger.debug(`Using ${summaryProvider.getName()} (${summaryProvider.getModel()}) for summarization`);

      const summaryResponse = await summaryProvider.streamChat(
        [
          {
            role: 'user',
            content: `Summarize this conversation history concisely, preserving key details about what was discussed, what files were modified, and any important decisions made. Be brief but complete.\n\n${contextToSummarize}`,
          },
        ],
        undefined, // No tools for summary
        undefined  // No streaming callback
      );

      this.conversationSummary = summaryResponse.content;
      this.messages = applySelection(this.messages, selection);

      const newTokens = countMessageTokens(this.messages);
      logger.debug(`Compacted to ${newTokens} tokens. Summary: ${this.conversationSummary?.slice(0, 100)}...`);
    } catch (error) {
      // If summarization fails, fall back to simple selection without summary
      logger.debug(`Summarization failed, using selection only: ${error}`);
      this.messages = applySelection(this.messages, selection);
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
   * Helps smaller models process large outputs.
   */
  private truncateToolResult(content: string): string {
    if (content.length <= AGENT_CONFIG.MAX_IMMEDIATE_TOOL_RESULT) {
      return content;
    }
    const halfLimit = Math.floor(AGENT_CONFIG.MAX_IMMEDIATE_TOOL_RESULT / 2);
    const truncated = content.slice(0, halfLimit) +
      `\n\n... [${content.length - AGENT_CONFIG.MAX_IMMEDIATE_TOOL_RESULT} characters truncated] ...\n\n` +
      content.slice(-halfLimit);
    return truncated;
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

    // Determine which provider to use for this chat
    const chatProvider = this.getProviderForChat(options?.taskType);

    // Add user message to history
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    // Check if context needs compaction
    await this.compactContext();

    let iterations = 0;
    let consecutiveErrors = 0;
    let finalResponse = '';

    while (iterations < AGENT_CONFIG.MAX_ITERATIONS) {
      iterations++;

      // Get tool definitions if provider supports them and tools are enabled
      const tools = (this.useTools && chatProvider.supportsToolUse())
        ? this.toolRegistry.getDefinitions()
        : undefined;

      // Build system context including any conversation summary
      let systemContext = this.systemPrompt;
      if (this.conversationSummary) {
        systemContext += `\n\n## Previous Conversation Summary\n${this.conversationSummary}`;
      }

      // Apply compression if enabled
      let messagesToSend = this.messages;
      if (this.enableCompression && this.messages.length > 2) {
        const compressed = compressContext(this.messages);
        if (compressed.entities.size > 0) {
          messagesToSend = compressed.messages;
          this.lastCompressionStats = getCompressionStats(compressed);

          // Add entity legend to system context
          const legend = generateEntityLegend(compressed.entities);
          systemContext += `\n\n${legend}\n\nNote: The conversation uses entity references (E1, E2, etc.) to reduce context size. Refer to the legend above when you see these references.`;

          logger.compressionStats(
            this.lastCompressionStats.savings,
            this.lastCompressionStats.savingsPercent,
            this.lastCompressionStats.entityCount
          );
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

      // Call the model with streaming (using native system prompt support)
      const apiStartTime = Date.now();
      let streamedChars = 0;
      const onChunk = (chunk: string): void => {
        if (chunk) {
          streamedChars += chunk.length;
        }
        this.callbacks.onText?.(chunk);
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

      // Record usage for cost tracking
      if (response.usage) {
        recordUsage(chatProvider.getName(), chatProvider.getModel(), response.usage);
      }

      // Call reasoning callback if reasoning content is present (e.g., from DeepSeek-R1)
      if (response.reasoningContent && this.callbacks.onReasoning && streamedReasoningChars === 0) {
        this.callbacks.onReasoning(response.reasoningContent);
      }

      // If no tool calls were detected via API but tools are enabled,
      // try to extract tool calls from the text (for models that output JSON as text)
      if (response.toolCalls.length === 0 && this.useTools && this.extractToolsFromText) {
        const availableTools = this.toolRegistry.listTools();
        const extractionText = [response.content, response.reasoningContent].filter(Boolean).join('\n');
        if (extractionText) {
          const extractedCalls = extractToolCallsFromText(extractionText, availableTools);
          if (extractedCalls.length > 0) {
            response.toolCalls = extractedCalls;
            response.stopReason = 'tool_use';
          }
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
          ? `${response.content || ''}${response.content ? '\n\n' : ''}[Thinking]:\n${thinkingText}`
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

      // Execute tool calls
      const toolResults: ToolResult[] = [];
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
          }
        }

        this.callbacks.onToolCall?.(toolCall.name, toolCall.input);

        // Update working set with file operations
        updateWorkingSet(this.workingSet, toolCall.name, toolCall.input);

        const result = await this.toolRegistry.execute(toolCall);
        toolResults.push(result);

        if (result.is_error) {
          hasError = true;
        }

        this.callbacks.onToolResult?.(toolCall.name, result.content, !!result.is_error);
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
        if (consecutiveErrors >= AGENT_CONFIG.MAX_CONSECUTIVE_ERRORS) {
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
        resultText += this.buildContinuationPrompt(originalTask);

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

      // Truncate old tool results to save context
      truncateOldToolResults(this.messages);
    }

    if (iterations >= AGENT_CONFIG.MAX_ITERATIONS) {
      const maxIterMsg = '\n\n(Reached maximum iterations, stopping)';
      finalResponse += maxIterMsg;
      // Also output via callback so user sees the message
      this.callbacks.onText?.(maxIterMsg);
      // Audit log
      this.auditLogger?.maxIterations(iterations, AGENT_CONFIG.MAX_ITERATIONS);
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
  }

  /**
   * Get current context size information.
   */
  getContextInfo(): {
    tokens: number;
    messages: number;
    hasSummary: boolean;
    compression: CompressionStats | null;
    compressionEnabled: boolean;
    workingSetFiles: number;
  } {
    return {
      tokens: countMessageTokens(this.messages),
      messages: this.messages.length,
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

  /**
   * Force context compaction regardless of current size.
   * Returns info about what was compacted.
   */
  async forceCompact(): Promise<{ before: number; after: number; summary: string | null }> {
    const before = countMessageTokens(this.messages);

    if (this.messages.length <= CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES) {
      return { before, after: before, summary: this.conversationSummary };
    }

    // Score messages and use smart windowing
    const scores = scoreMessages(this.messages, CONTEXT_OPTIMIZATION.WEIGHTS);
    const windowConfig: WindowingConfig = {
      minRecentMessages: CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES,
      maxMessages: Math.min(CONTEXT_OPTIMIZATION.MAX_MESSAGES, Math.ceil(this.messages.length / 2)),
      importanceThreshold: CONTEXT_OPTIMIZATION.IMPORTANCE_THRESHOLD,
      preserveToolPairs: CONTEXT_OPTIMIZATION.PRESERVE_TOOL_PAIRS,
      preserveWorkingSet: CONTEXT_OPTIMIZATION.PRESERVE_WORKING_SET,
      maxWorkingSetFiles: CONTEXT_OPTIMIZATION.MAX_WORKING_SET_FILES,
    };

    const selection = selectMessagesToKeep(this.messages, scores, this.workingSet, windowConfig);

    if (selection.summarize.length === 0) {
      this.messages = applySelection(this.messages, selection);
      const after = countMessageTokens(this.messages);
      return { before, after, summary: this.conversationSummary };
    }

    const messagesToSummarize = selection.summarize.map(i => this.messages[i]);
    const oldContent = messagesToSummarize
      .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
      .join('\n\n');

    const contextToSummarize = this.conversationSummary
      ? `Previous summary:\n${this.conversationSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    try {
      // Use secondary provider for summarization if configured
      const summaryProvider = this.getSummaryProvider();
      const summaryResponse = await summaryProvider.streamChat(
        [{
          role: 'user',
          content: `Summarize this conversation history concisely, preserving key details about what was discussed, what files were modified, and any important decisions made. Be brief but complete.\n\n${contextToSummarize}`,
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
