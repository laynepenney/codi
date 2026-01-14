/**
 * MCP Tool Wrapper
 *
 * Wraps MCP server tools as Codi BaseTool instances so they can be used
 * alongside native tools.
 */

import { BaseTool } from '../tools/base.js';
import type { ToolDefinition } from '../types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * MCP tool definition from server.
 */
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/**
 * Wraps an MCP tool as a BaseTool instance.
 */
export class MCPToolWrapper extends BaseTool {
  private client: Client;
  private mcpTool: MCPToolDefinition;
  private serverName: string;

  constructor(client: Client, mcpTool: MCPToolDefinition, serverName: string) {
    super();
    this.client = client;
    this.mcpTool = mcpTool;
    this.serverName = serverName;
  }

  /**
   * Get the tool definition for the AI model.
   * Prefixes the tool name with the server name to avoid conflicts.
   */
  getDefinition(): ToolDefinition {
    // Prefix tool name with server name to avoid conflicts with native tools
    const prefixedName = `mcp_${this.serverName}_${this.mcpTool.name}`;

    // Add server context to description
    const description = this.mcpTool.description
      ? `[MCP:${this.serverName}] ${this.mcpTool.description}`
      : `[MCP:${this.serverName}] ${this.mcpTool.name}`;

    return {
      name: prefixedName,
      description,
      input_schema: {
        type: 'object',
        properties: this.mcpTool.inputSchema.properties || {},
        required: this.mcpTool.inputSchema.required,
      },
    };
  }

  /**
   * Execute the MCP tool by calling the remote server.
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    try {
      const result = await this.client.callTool({
        name: this.mcpTool.name,  // Use original name when calling server
        arguments: input,
      });

      // Handle different content types
      // MCP SDK types content as unknown, so we need to handle it carefully
      const content = result.content as Array<{ type: string; text?: string; mimeType?: string; resource?: { uri?: string } }> | undefined;

      if (!content || !Array.isArray(content) || content.length === 0) {
        return 'Tool executed successfully (no output)';
      }

      // Concatenate all content parts
      const parts: string[] = [];
      for (const item of content) {
        if (item.type === 'text' && item.text) {
          parts.push(item.text);
        } else if (item.type === 'image') {
          parts.push(`[Image: ${item.mimeType || 'unknown type'}]`);
        } else if (item.type === 'resource') {
          parts.push(`[Resource: ${item.resource?.uri || 'unknown'}]`);
        } else {
          // Unknown content type, serialize as JSON
          parts.push(JSON.stringify(item));
        }
      }

      return parts.join('\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP tool '${this.mcpTool.name}' failed: ${message}`);
    }
  }

  /**
   * Get the original MCP tool name (without server prefix).
   */
  getMCPToolName(): string {
    return this.mcpTool.name;
  }

  /**
   * Get the server name this tool belongs to.
   */
  getServerName(): string {
    return this.serverName;
  }
}
