import type { ToolDefinition, ToolCall, ToolResult } from '../types.js';
import { BaseTool } from './base.js';

/**
 * Registry for managing available tools.
 * Tools are registered here and can be looked up by name.
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  /**
   * Register a tool with the registry.
   */
  register(tool: BaseTool): void {
    const name = tool.getName();
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    this.tools.set(name, tool);
  }

  /**
   * Register multiple tools at once.
   */
  registerAll(tools: BaseTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name.
   */
  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool definitions for sending to the AI model.
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.getDefinition());
  }

  /**
   * Execute a single tool call.
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      return {
        tool_use_id: toolCall.id,
        content: `Error: Unknown tool "${toolCall.name}"`,
        is_error: true,
      };
    }

    return tool.run(toolCall.id, toolCall.input);
  }

  /**
   * Execute multiple tool calls in parallel.
   */
  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((call) => this.execute(call)));
  }

  /**
   * List all registered tool names.
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

// Global registry instance
export const globalRegistry = new ToolRegistry();
