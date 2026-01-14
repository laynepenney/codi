// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * MCP Client Manager
 *
 * Manages connections to MCP servers and provides access to their tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type ChildProcess } from 'child_process';
import type { BaseTool } from '../tools/base.js';
import { MCPToolWrapper } from './tool-wrapper.js';

/**
 * Configuration for an MCP server connection.
 */
export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Connected MCP server state.
 */
interface ConnectedServer {
  client: Client;
  transport: StdioClientTransport;
  process: ChildProcess;
  config: MCPServerConfig;
}

/**
 * Manages multiple MCP server connections.
 */
export class MCPClientManager {
  private servers: Map<string, ConnectedServer> = new Map();

  /**
   * Connect to an MCP server.
   */
  async connect(config: MCPServerConfig): Promise<Client> {
    if (this.servers.has(config.name)) {
      throw new Error(`MCP server '${config.name}' is already connected`);
    }

    // Resolve environment variables in env config
    const resolvedEnv: Record<string, string> = {};
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        // Replace ${VAR} with process.env.VAR
        resolvedEnv[key] = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
          return process.env[varName] || '';
        });
      }
    }

    // Spawn the server process
    const serverProcess = spawn(config.command, config.args || [], {
      cwd: config.cwd || process.cwd(),
      env: { ...process.env, ...resolvedEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle process errors
    serverProcess.on('error', (err) => {
      console.error(`MCP server '${config.name}' error:`, err.message);
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      // Log stderr but don't fail - some servers use stderr for logging
      const message = data.toString().trim();
      if (message) {
        console.error(`[${config.name}] ${message}`);
      }
    });

    // Create transport - filter out undefined values from env
    const envWithResolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        envWithResolved[key] = value;
      }
    }
    Object.assign(envWithResolved, resolvedEnv);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: envWithResolved,
      cwd: config.cwd,
    });

    // Create client
    const client = new Client({
      name: 'codi',
      version: '1.0.0',
    }, {
      capabilities: {},
    });

    try {
      // Connect
      await client.connect(transport);

      // Store connection
      this.servers.set(config.name, {
        client,
        transport,
        process: serverProcess,
        config,
      });

      return client;
    } catch (error) {
      // Clean up on failure
      serverProcess.kill();
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      return;
    }

    try {
      await server.client.close();
    } catch {
      // Ignore close errors
    }

    server.process.kill();
    this.servers.delete(name);
  }

  /**
   * Disconnect from all MCP servers.
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.servers.keys());
    await Promise.all(names.map((name) => this.disconnect(name)));
  }

  /**
   * Get a connected client by name.
   */
  getClient(name: string): Client | undefined {
    return this.servers.get(name)?.client;
  }

  /**
   * Get all connected server names.
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get all tools from all connected MCP servers as BaseTool instances.
   */
  async getAllTools(): Promise<BaseTool[]> {
    const tools: BaseTool[] = [];

    for (const [serverName, server] of this.servers) {
      try {
        const result = await server.client.listTools();

        for (const tool of result.tools) {
          tools.push(new MCPToolWrapper(server.client, tool, serverName));
        }
      } catch (error) {
        console.error(`Failed to get tools from MCP server '${serverName}':`, error);
      }
    }

    return tools;
  }

  /**
   * Check if any servers are connected.
   */
  hasConnections(): boolean {
    return this.servers.size > 0;
  }
}
