/**
 * MCP Server
 *
 * Exposes Codi's tools as an MCP server so other MCP clients can use them.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { globalRegistry } from '../tools/registry.js';
import { VERSION } from '../version.js';

/**
 * Start Codi as an MCP server.
 * This runs in stdio mode and exposes all registered tools.
 */
export async function startMCPServer(): Promise<void> {
  const server = new Server(
    {
      name: 'codi',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tools/list request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const definitions = globalRegistry.getDefinitions();

    return {
      tools: definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      })),
    };
  });

  // Handle tools/call request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await globalRegistry.execute({
        id: `mcp-${Date.now()}`,
        name,
        input: args || {},
      });

      if (result.is_error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${result.content}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: result.content,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error executing tool '${name}': ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Handle errors
  server.onerror = (error) => {
    console.error('[MCP Server Error]', error);
  };

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio communication
  console.error(`Codi MCP Server v${VERSION} started`);
  console.error(`Exposing ${globalRegistry.getDefinitions().length} tools`);
}
