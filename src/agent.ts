import type { Message, ContentBlock, ToolResult, ToolCall } from './types.js';
import type { BaseProvider } from './providers/base.js';
import { ToolRegistry } from './tools/registry.js';

const MAX_ITERATIONS = 20; // Prevent infinite loops
const MAX_CONSECUTIVE_ERRORS = 3; // Stop after repeated failures
const MAX_CONTEXT_TOKENS = 8000; // Trigger compaction when exceeded
const RECENT_MESSAGES_TO_KEEP = 6; // Keep recent messages verbatim during compaction

/**
 * Attempt to fix common JSON issues from LLM output:
 * - Single quotes instead of double quotes
 */
function tryFixJson(jsonStr: string): string {
  let fixed = jsonStr;

  // Replace single-quoted strings after colons (handles multi-line)
  // Match: : 'content' and replace with : "content"
  fixed = fixed.replace(/:(\s*)'((?:[^'\\]|\\.)*)'/gs, ':$1"$2"');

  return fixed;
}

/**
 * Try to parse JSON, attempting to fix common issues if standard parse fails.
 */
function tryParseJson(jsonStr: string): unknown | null {
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Try to fix common issues
    try {
      return JSON.parse(tryFixJson(jsonStr));
    } catch {
      return null;
    }
  }
}

/**
 * Try to extract tool calls from text when models output JSON instead of using
 * proper function calling (common with Ollama models).
 */
function extractToolCallsFromText(text: string, availableTools: string[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  // Pattern 1: {"name": "tool_name", "arguments": {...}} or {"name": "tool_name", "parameters": {...}}
  const jsonPattern = /\{[\s\S]*?"name"\s*:\s*"(\w+)"[\s\S]*?(?:"arguments"|"parameters"|"input")\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})[\s\S]*?\}/g;

  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    const toolName = match[1];
    if (availableTools.includes(toolName)) {
      const args = tryParseJson(match[2]);
      if (args && typeof args === 'object') {
        toolCalls.push({
          id: `extracted_${Date.now()}_${toolCalls.length}`,
          name: toolName,
          input: args as Record<string, unknown>,
        });
      }
    }
  }

  // Pattern 2: Look for JSON in code blocks (objects or arrays)
  if (toolCalls.length === 0) {
    const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    while ((match = codeBlockPattern.exec(text)) !== null) {
      const content = match[1].trim();
      if (!content.startsWith('{') && !content.startsWith('[')) continue;

      const parsed = tryParseJson(content);
      if (!parsed) continue;

      // Handle array of tool calls
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.name && availableTools.includes(item.name as string)) {
            toolCalls.push({
              id: `extracted_${Date.now()}_${toolCalls.length}`,
              name: item.name as string,
              input: (item.arguments || item.parameters || item.input || {}) as Record<string, unknown>,
            });
          }
        }
      }
      // Handle single object
      else {
        const obj = parsed as Record<string, unknown>;
        if (obj.name && availableTools.includes(obj.name as string)) {
          toolCalls.push({
            id: `extracted_${Date.now()}_${toolCalls.length}`,
            name: obj.name as string,
            input: (obj.arguments || obj.parameters || obj.input || {}) as Record<string, unknown>,
          });
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Estimate token count for a string (rough approximation: ~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get the text content of a message for token counting.
 */
function getMessageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text || '';
      if (block.type === 'tool_use') return JSON.stringify(block.input || {});
      if (block.type === 'tool_result') return block.content || '';
      return '';
    })
    .join('\n');
}

/**
 * Count total tokens in a message array.
 */
function countMessageTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => total + estimateTokens(getMessageText(msg)), 0);
}

export interface AgentOptions {
  provider: BaseProvider;
  toolRegistry: ToolRegistry;
  systemPrompt?: string;
  useTools?: boolean; // Set to false for models that don't support tool use
  debug?: boolean; // Log messages sent to the model
  onText?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, isError: boolean) => void;
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
  private debug: boolean;
  private messages: Message[] = [];
  private conversationSummary: string | null = null;
  private callbacks: {
    onText?: (text: string) => void;
    onToolCall?: (name: string, input: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string, isError: boolean) => void;
  };

  constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.useTools = options.useTools ?? true;
    this.debug = options.debug ?? false;
    this.systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    this.callbacks = {
      onText: options.onText,
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
    };
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

    if (totalTokens <= MAX_CONTEXT_TOKENS) {
      return; // No compaction needed
    }

    if (this.debug) {
      console.log(`\n[Context] Compacting: ${totalTokens} tokens exceeds ${MAX_CONTEXT_TOKENS} limit`);
    }

    // Split messages: older ones to summarize, recent ones to keep
    const messagesToSummarize = this.messages.slice(0, -RECENT_MESSAGES_TO_KEEP);
    const recentMessages = this.messages.slice(-RECENT_MESSAGES_TO_KEEP);

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
   * Process a user message and return the final assistant response.
   * This runs the full agentic loop until the model stops calling tools.
   */
  async chat(userMessage: string): Promise<string> {
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

    while (iterations < MAX_ITERATIONS) {
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

      // Prepare messages with system prompt
      const messagesWithSystem: Message[] = [
        { role: 'user', content: systemContext },
        { role: 'assistant', content: 'I understand. I will help you with coding tasks using the available tools.' },
        ...this.messages,
      ];

      // Debug: log messages being sent
      if (this.debug) {
        console.log('\n' + '='.repeat(60));
        console.log('DEBUG: Messages being sent to model:');
        console.log('='.repeat(60));
        for (const msg of messagesWithSystem) {
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

      // Call the model with streaming
      const response = await this.provider.streamChat(
        messagesWithSystem,
        tools,
        this.callbacks.onText
      );

      // If no tool calls were detected via API but tools are enabled,
      // try to extract tool calls from the text (for models that output JSON as text)
      if (response.toolCalls.length === 0 && this.useTools && response.content) {
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

      for (const toolCall of response.toolCalls) {
        this.callbacks.onToolCall?.(toolCall.name, toolCall.input);

        const result = await this.toolRegistry.execute(toolCall);
        toolResults.push(result);

        if (result.is_error) {
          hasError = true;
        }

        this.callbacks.onToolResult?.(toolCall.name, result.content, !!result.is_error);
      }

      // Track consecutive errors
      if (hasError) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
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
          if (result.is_error) {
            resultText += `ERROR from ${toolName}: ${result.content}\n\n`;
          } else {
            resultText += `Result from ${toolName}:\n${result.content}\n\n`;
          }
        }
        resultText += 'Continue with your task - use more tools if needed, or provide your final response if done.';

        this.messages.push({
          role: 'user',
          content: resultText,
        });
      } else {
        // For native tool calls, use content blocks
        const resultBlocks: ContentBlock[] = toolResults.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.tool_use_id,
          content: result.is_error
            ? `ERROR: ${result.content}\n\nPlease read the error message carefully and adjust your approach.`
            : result.content,
          is_error: result.is_error,
        }));

        resultBlocks.push({
          type: 'text' as const,
          text: '\n\nContinue with your task - use more tools if needed, or provide your final response if done.',
        });

        this.messages.push({
          role: 'user',
          content: resultBlocks,
        });
      }
    }

    if (iterations >= MAX_ITERATIONS) {
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

    if (this.messages.length <= RECENT_MESSAGES_TO_KEEP) {
      return { before, after: before, summary: this.conversationSummary };
    }

    // Temporarily lower threshold to force compaction
    const originalMessages = [...this.messages];
    await this.compactContext();

    // If compactContext didn't run (tokens were under limit), force it
    if (this.messages.length === originalMessages.length) {
      const messagesToSummarize = this.messages.slice(0, -RECENT_MESSAGES_TO_KEEP);
      const recentMessages = this.messages.slice(-RECENT_MESSAGES_TO_KEEP);

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
