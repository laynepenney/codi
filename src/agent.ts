import type { Message, ContentBlock, ToolResult } from './types.js';
import type { BaseProvider } from './providers/base.js';
import { ToolRegistry } from './tools/registry.js';

const MAX_ITERATIONS = 20; // Prevent infinite loops

export interface AgentOptions {
  provider: BaseProvider;
  toolRegistry: ToolRegistry;
  systemPrompt?: string;
  useTools?: boolean; // Set to false for models that don't support tool use
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
  private messages: Message[] = [];
  private callbacks: {
    onText?: (text: string) => void;
    onToolCall?: (name: string, input: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string, isError: boolean) => void;
  };

  constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.useTools = options.useTools ?? true;
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
   * Process a user message and return the final assistant response.
   * This runs the full agentic loop until the model stops calling tools.
   */
  async chat(userMessage: string): Promise<string> {
    // Add user message to history
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    let iterations = 0;
    let finalResponse = '';

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // Get tool definitions if provider supports them and tools are enabled
      const tools = (this.useTools && this.provider.supportsToolUse())
        ? this.toolRegistry.getDefinitions()
        : undefined;

      // Prepare messages with system prompt
      const messagesWithSystem: Message[] = [
        { role: 'user', content: this.systemPrompt },
        { role: 'assistant', content: 'I understand. I will help you with coding tasks using the available tools.' },
        ...this.messages,
      ];

      // Call the model with streaming
      const response = await this.provider.streamChat(
        messagesWithSystem,
        tools,
        this.callbacks.onText
      );

      // Store assistant response
      if (response.content || response.toolCalls.length > 0) {
        const contentBlocks: ContentBlock[] = [];

        if (response.content) {
          contentBlocks.push({ type: 'text', text: response.content });
          finalResponse = response.content;
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

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      const toolResults: ToolResult[] = [];

      for (const toolCall of response.toolCalls) {
        this.callbacks.onToolCall?.(toolCall.name, toolCall.input);

        const result = await this.toolRegistry.execute(toolCall);
        toolResults.push(result);

        this.callbacks.onToolResult?.(toolCall.name, result.content, !!result.is_error);
      }

      // Add tool results to messages
      const resultBlocks: ContentBlock[] = toolResults.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.tool_use_id,
        content: result.content,
      }));

      this.messages.push({
        role: 'user',
        content: resultBlocks,
      });
    }

    if (iterations >= MAX_ITERATIONS) {
      finalResponse += '\n\n(Reached maximum iterations, stopping)';
    }

    return finalResponse;
  }

  /**
   * Clear conversation history.
   */
  clearHistory(): void {
    this.messages = [];
  }

  /**
   * Get the conversation history.
   */
  getHistory(): Message[] {
    return [...this.messages];
  }
}
