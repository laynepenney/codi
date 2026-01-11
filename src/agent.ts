import type { Message, ContentBlock, ToolResult, ToolCall } from './types.js';
import type { BaseProvider } from './providers/base.js';
import { ToolRegistry } from './tools/registry.js';
import { generateWriteDiff, generateEditDiff, type DiffResult } from './diff.js';
import { recordUsage } from './usage.js';
import { AGENT_CONFIG, TOOL_CATEGORIES, type DangerousPattern } from './constants.js';
import {
  extractToolCallsFromText,
  countMessageTokens,
  getMessageText,
  findSafeStartIndex,
  truncateOldToolResults,
  parseImageResult,
  checkDangerousBash,
} from './utils/index.js';

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
}

/**
 * Result of a confirmation request.
 */
export type ConfirmationResult = 'approve' | 'deny' | 'abort';

export interface AgentOptions {
  provider: BaseProvider;
  toolRegistry: ToolRegistry;
  systemPrompt?: string;
  useTools?: boolean; // Set to false for models that don't support tool use
  extractToolsFromText?: boolean; // Extract tool calls from JSON in text (for models without native tool support)
  autoApprove?: boolean | string[]; // Skip confirmation: true = all tools, string[] = specific tools
  customDangerousPatterns?: Array<{ pattern: RegExp; description: string }>; // Additional patterns
  debug?: boolean; // Log messages sent to the model
  onText?: (text: string) => void;
  onReasoning?: (reasoning: string) => void; // Called with reasoning trace from reasoning models
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
  private toolRegistry: ToolRegistry;
  private systemPrompt: string;
  private useTools: boolean;
  private extractToolsFromText: boolean;
  private autoApproveAll: boolean;
  private autoApproveTools: Set<string>;
  private customDangerousPatterns: Array<{ pattern: RegExp; description: string }>;
  private debug: boolean;
  private messages: Message[] = [];
  private conversationSummary: string | null = null;
  private callbacks: {
    onText?: (text: string) => void;
    onReasoning?: (reasoning: string) => void;
    onToolCall?: (name: string, input: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string, isError: boolean) => void;
    onConfirm?: (confirmation: ToolConfirmation) => Promise<ConfirmationResult>;
  };

  constructor(options: AgentOptions) {
    this.provider = options.provider;
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

    this.customDangerousPatterns = options.customDangerousPatterns ?? [];
    this.debug = options.debug ?? false;
    this.systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    this.callbacks = {
      onText: options.onText,
      onReasoning: options.onReasoning,
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

  private getDefaultSystemPrompt(): string {
    return `You are a helpful AI coding assistant. You have access to tools that allow you to read and write files, and execute bash commands.

When helping with coding tasks:
- Read relevant files to understand the codebase before making changes
- Make targeted, minimal changes to accomplish the task
- Explain what you're doing and why

Available tools:
- read_file: Read contents of a file
- write_file: Write content to a file
- bash: Execute bash commands

Always use tools to interact with the filesystem rather than asking the user to do it.`;
  }

  /**
   * Compact the conversation history by summarizing older messages.
   * Keeps recent messages verbatim and replaces older ones with a summary.
   */
  private async compactContext(): Promise<void> {
    const totalTokens = countMessageTokens(this.messages);

    if (totalTokens <= AGENT_CONFIG.MAX_CONTEXT_TOKENS) {
      return; // No compaction needed
    }

    if (this.debug) {
      console.log(`\n[Context] Compacting: ${totalTokens} tokens exceeds ${AGENT_CONFIG.MAX_CONTEXT_TOKENS} limit`);
    }

    // Split messages: older ones to summarize, recent ones to keep
    let recentMessages = this.messages.slice(-AGENT_CONFIG.RECENT_MESSAGES_TO_KEEP);

    // Ensure recent messages don't start with orphaned tool_result
    // (OpenAI requires tool_result to follow assistant with tool_calls)
    const safeStartIdx = findSafeStartIndex(recentMessages);
    if (safeStartIdx > 0) {
      recentMessages = recentMessages.slice(safeStartIdx);
    }

    const messagesToSummarize = this.messages.slice(0, this.messages.length - recentMessages.length);

    if (messagesToSummarize.length === 0) {
      // All messages are "recent", just truncate the oldest
      this.messages = recentMessages;
      return;
    }

    // Format older messages for summarization
    const oldContent = messagesToSummarize
      .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
      .join('\n\n');

    // Include existing summary if present
    const contextToSummarize = this.conversationSummary
      ? `Previous summary:\n${this.conversationSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    try {
      // Ask the model to create a summary
      const summaryResponse = await this.provider.streamChat(
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
      this.messages = recentMessages;

      if (this.debug) {
        const newTokens = countMessageTokens(this.messages);
        console.log(`[Context] Compacted to ${newTokens} tokens. Summary: ${this.conversationSummary?.slice(0, 100)}...`);
      }
    } catch (error) {
      // If summarization fails, fall back to simple truncation
      if (this.debug) {
        console.log(`[Context] Summarization failed, using simple truncation: ${error}`);
      }
      this.messages = recentMessages;
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
    return `\n\nContinue working on your task. Remember, the user asked: "${taskPreview}"\n\nUse more tools if needed, or provide your final response when done.`;
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
   */
  async chat(userMessage: string): Promise<string> {
    // Store original task for continuation prompts
    const originalTask = userMessage;

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
      const tools = (this.useTools && this.provider.supportsToolUse())
        ? this.toolRegistry.getDefinitions()
        : undefined;

      // Build system context including any conversation summary
      let systemContext = this.systemPrompt;
      if (this.conversationSummary) {
        systemContext += `\n\n## Previous Conversation Summary\n${this.conversationSummary}`;
      }

      // Debug: log messages being sent
      if (this.debug) {
        console.log('\n' + '='.repeat(60));
        console.log('DEBUG: Messages being sent to model:');
        console.log('='.repeat(60));
        console.log('\n[SYSTEM]:');
        const systemPreview = systemContext.length > 500
          ? systemContext.slice(0, 500) + `\n... (${systemContext.length} chars total)`
          : systemContext;
        console.log(systemPreview);
        for (const msg of this.messages) {
          console.log(`\n[${msg.role.toUpperCase()}]:`);
          if (typeof msg.content === 'string') {
            // Truncate long messages
            const preview = msg.content.length > 500
              ? msg.content.slice(0, 500) + `\n... (${msg.content.length} chars total)`
              : msg.content;
            console.log(preview);
          } else {
            console.log(JSON.stringify(msg.content, null, 2).slice(0, 500));
          }
        }
        if (tools) {
          console.log(`\nTools: ${tools.map(t => t.name).join(', ')}`);
        }
        console.log('='.repeat(60) + '\n');
      }

      // Call the model with streaming (using native system prompt support)
      const response = await this.provider.streamChat(
        this.messages,
        tools,
        this.callbacks.onText,
        systemContext
      );

      // Record usage for cost tracking
      if (response.usage) {
        recordUsage(this.provider.getName(), this.provider.getModel(), response.usage);
      }

      // Call reasoning callback if reasoning content is present (e.g., from DeepSeek-R1)
      if (response.reasoningContent && this.callbacks.onReasoning) {
        this.callbacks.onReasoning(response.reasoningContent);
      }

      // If no tool calls were detected via API but tools are enabled,
      // try to extract tool calls from the text (for models that output JSON as text)
      if (response.toolCalls.length === 0 && this.useTools && this.extractToolsFromText && response.content) {
        const availableTools = this.toolRegistry.listTools();
        const extractedCalls = extractToolCallsFromText(response.content, availableTools);
        if (extractedCalls.length > 0) {
          response.toolCalls = extractedCalls;
          response.stopReason = 'tool_use';
        }
      }

      // Check if tool calls are extracted (non-native) vs native API calls
      const isExtractedToolCall = response.toolCalls.length > 0 &&
        response.toolCalls[0].id.startsWith('extracted_');

      // Store assistant response
      if (response.content || response.toolCalls.length > 0) {
        if (response.content) {
          finalResponse = response.content;
        }

        if (isExtractedToolCall) {
          // For extracted tool calls, store as plain text (model doesn't understand tool_use blocks)
          this.messages.push({
            role: 'assistant',
            content: response.content || '',
          });
        } else {
          // For native tool calls, use content blocks
          const contentBlocks: ContentBlock[] = [];

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
        // Check if this tool requires confirmation
        const needsConfirmation = !this.shouldAutoApprove(toolCall.name) &&
          TOOL_CATEGORIES.DESTRUCTIVE.has(toolCall.name) &&
          this.callbacks.onConfirm;

        if (needsConfirmation) {
          // Check for dangerous bash commands (including custom patterns)
          let isDangerous = false;
          let dangerReason: string | undefined;

          if (toolCall.name === 'bash') {
            const command = toolCall.input.command as string;
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

          // Generate diff preview for file operations
          let diffPreview: DiffResult | undefined;
          try {
            if (toolCall.name === 'write_file') {
              const path = toolCall.input.path as string;
              const content = toolCall.input.content as string;
              diffPreview = await generateWriteDiff(path, content);
            } else if (toolCall.name === 'edit_file') {
              const path = toolCall.input.path as string;
              const oldString = toolCall.input.old_string as string;
              const newString = toolCall.input.new_string as string;
              const replaceAll = (toolCall.input.replace_all as boolean) || false;
              diffPreview = await generateEditDiff(path, oldString, newString, replaceAll);
            }
          } catch {
            // If diff generation fails, continue without preview
          }

          const confirmation: ToolConfirmation = {
            toolName: toolCall.name,
            input: toolCall.input,
            isDangerous,
            dangerReason,
            diffPreview,
          };

          const result = await this.callbacks.onConfirm!(confirmation);

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

        this.callbacks.onToolCall?.(toolCall.name, toolCall.input);

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
      finalResponse += '\n\n(Reached maximum iterations, stopping)';
    }

    return finalResponse;
  }

  /**
   * Clear conversation history and summary.
   */
  clearHistory(): void {
    this.messages = [];
    this.conversationSummary = null;
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
  getContextInfo(): { tokens: number; messages: number; hasSummary: boolean } {
    return {
      tokens: countMessageTokens(this.messages),
      messages: this.messages.length,
      hasSummary: this.conversationSummary !== null,
    };
  }

  /**
   * Force context compaction regardless of current size.
   * Returns info about what was compacted.
   */
  async forceCompact(): Promise<{ before: number; after: number; summary: string | null }> {
    const before = countMessageTokens(this.messages);

    if (this.messages.length <= AGENT_CONFIG.RECENT_MESSAGES_TO_KEEP) {
      return { before, after: before, summary: this.conversationSummary };
    }

    // Temporarily lower threshold to force compaction
    const originalMessages = [...this.messages];
    await this.compactContext();

    // If compactContext didn't run (tokens were under limit), force it
    if (this.messages.length === originalMessages.length) {
      let recentMessages = this.messages.slice(-AGENT_CONFIG.RECENT_MESSAGES_TO_KEEP);

      // Ensure recent messages don't start with orphaned tool_result
      const safeStartIdx = findSafeStartIndex(recentMessages);
      if (safeStartIdx > 0) {
        recentMessages = recentMessages.slice(safeStartIdx);
      }

      const messagesToSummarize = this.messages.slice(0, this.messages.length - recentMessages.length);

      const oldContent = messagesToSummarize
        .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
        .join('\n\n');

      const contextToSummarize = this.conversationSummary
        ? `Previous summary:\n${this.conversationSummary}\n\nNew messages:\n${oldContent}`
        : oldContent;

      try {
        const summaryResponse = await this.provider.streamChat(
          [{
            role: 'user',
            content: `Summarize this conversation history concisely, preserving key details about what was discussed, what files were modified, and any important decisions made. Be brief but complete.\n\n${contextToSummarize}`,
          }],
          undefined,
          undefined
        );
        this.conversationSummary = summaryResponse.content;
        this.messages = recentMessages;
      } catch {
        this.messages = recentMessages;
      }
    }

    const after = countMessageTokens(this.messages);
    return { before, after, summary: this.conversationSummary };
  }
}
