import type { ToolDefinition, ToolResult } from '../types.js';

/**
 * Abstract base class for tools.
 * Each tool can be called by the AI model to perform actions.
 */
export abstract class BaseTool {
  /**
   * Get the tool definition for the AI model.
   * This includes the name, description, and input schema.
   */
  abstract getDefinition(): ToolDefinition;

  /**
   * Execute the tool with the given input.
   * @param input - The input parameters from the AI model
   * @returns The result to send back to the model
   */
  abstract execute(input: Record<string, unknown>): Promise<string>;

  /**
   * Get the name of this tool.
   */
  getName(): string {
    return this.getDefinition().name;
  }

  /**
   * Wrap the execution result in a ToolResult object.
   */
  async run(toolUseId: string, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.execute(input);
      return {
        tool_use_id: toolUseId,
        content: result,
        is_error: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        tool_use_id: toolUseId,
        content: `Error: ${errorMessage}`,
        is_error: true,
      };
    }
  }
}
