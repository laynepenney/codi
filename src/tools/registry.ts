// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ToolDefinition, ToolCall, ToolResult } from '../types.js';
import { BaseTool } from './base.js';
import {
  findBestToolMatch,
  mapParameters,
  formatFallbackError,
  formatMappingInfo,
  type ToolFallbackConfig,
  DEFAULT_FALLBACK_CONFIG,
} from './tool-fallback.js';

/**
 * Registry for managing available tools.
 * Tools are registered here and can be looked up by name.
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  private fallbackConfig: ToolFallbackConfig = DEFAULT_FALLBACK_CONFIG;

  /**
   * Set fallback configuration.
   */
  setFallbackConfig(config: Partial<ToolFallbackConfig>): void {
    this.fallbackConfig = { ...DEFAULT_FALLBACK_CONFIG, ...config };
  }

  /**
   * Get current fallback configuration.
   */
  getFallbackConfig(): ToolFallbackConfig {
    return { ...this.fallbackConfig };
  }

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
   * Execute a single tool call with semantic fallback support.
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    let tool = this.tools.get(toolCall.name);
    let mappedInput = toolCall.input;
    let toolCorrection: { from: string; to: string } | null = null;
    let paramMappings: Array<{ from: string; to: string }> = [];

    // If tool not found, try fallback matching
    if (!tool && this.fallbackConfig.enabled) {
      const definitions = this.getDefinitions();
      const matchResult = findBestToolMatch(toolCall.name, definitions, this.fallbackConfig);

      if (matchResult.shouldAutoCorrect && matchResult.matchedName) {
        // Auto-correct to matched tool
        tool = this.tools.get(matchResult.matchedName);
        toolCorrection = { from: toolCall.name, to: matchResult.matchedName };
      } else if (!matchResult.exactMatch) {
        // Return error with suggestions
        return {
          tool_use_id: toolCall.id,
          content: formatFallbackError(toolCall.name, matchResult),
          is_error: true,
        };
      }
    }

    if (!tool) {
      return {
        tool_use_id: toolCall.id,
        content: `Error: Unknown tool "${toolCall.name}"`,
        is_error: true,
      };
    }

    // Apply parameter mapping
    if (this.fallbackConfig.parameterAliasing) {
      const mapResult = mapParameters(
        toolCall.input,
        tool.getDefinition().input_schema,
        this.fallbackConfig
      );
      mappedInput = mapResult.mappedInput;
      paramMappings = mapResult.mappings;
    }

    // Execute the tool
    const result = await tool.run(toolCall.id, mappedInput);

    // Prepend mapping info to result if any corrections were made
    const mappingInfo = formatMappingInfo(toolCorrection, paramMappings);
    if (mappingInfo && !result.is_error) {
      result.content = `${mappingInfo}\n\n${result.content}`;
    }

    return result;
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
