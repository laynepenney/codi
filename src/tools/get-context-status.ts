// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import type { CompressionStats } from '../compression.js';
import { listCachedResults } from '../utils/tool-result-cache.js';

/**
 * Context info provider interface.
 * Matches the return type of Agent.getContextInfo().
 */
export interface ContextInfoProvider {
  getContextInfo(): {
    tokens: number;
    messageTokens: number;
    systemPromptTokens: number;
    toolDefinitionTokens: number;
    maxTokens: number;
    contextWindow: number;
    outputReserve: number;
    safetyBuffer: number;
    tierName: string;
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolResultMessages: number;
    hasSummary: boolean;
    compression: CompressionStats | null;
    compressionEnabled: boolean;
    workingSetFiles: number;
  };
}

/**
 * Tool for checking current context usage and token budget status.
 * Helps the model understand its resource constraints and make efficient decisions.
 */
export class GetContextStatusTool extends BaseTool {
  private contextProvider: ContextInfoProvider | null = null;

  /**
   * Set the context info provider (usually the Agent instance).
   */
  setContextProvider(provider: ContextInfoProvider): void {
    this.contextProvider = provider;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'get_context_status',
      description:
        'Check current context usage and token budget status. ' +
        'Use this to understand how much of your token budget is consumed, ' +
        'whether context compaction is imminent, and what cached results are available. ' +
        'Call this periodically during long sessions or when planning multiple tool operations.',
      input_schema: {
        type: 'object',
        properties: {
          include_cached: {
            type: 'boolean',
            description:
              'Include list of cached tool result IDs (default: false). ' +
              'Use this to see what truncated results can be retrieved via recall_result.',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    if (!this.contextProvider) {
      return 'Error: Context provider not initialized. This is a configuration issue.';
    }

    const includeCached = input.include_cached === true;
    const info = this.contextProvider.getContextInfo();

    // Calculate usage percentage
    const usagePercent = (info.tokens / info.maxTokens) * 100;
    const contextPercent = (info.tokens / info.contextWindow) * 100;
    
    // Calculate available tokens
    const availableTokens = Math.max(0, info.maxTokens - info.tokens);
    const availablePercent = (availableTokens / info.maxTokens) * 100;

    // Determine status level
    const status = this.getStatusLevel(usagePercent);

    // Build output
    const lines: string[] = [];

    lines.push('Context Status:');
    lines.push(`  Tokens used: ${info.tokens.toLocaleString()} / ${info.maxTokens.toLocaleString()} (${usagePercent.toFixed(1)}% of budget)`);
    lines.push(`  Available window: ${availableTokens.toLocaleString()} tokens (${availablePercent.toFixed(1)}% remaining)`);
    
    // Show context window if different from maxTokens (override in effect)
    if (info.contextWindow !== info.maxTokens) {
      lines.push(`  Context window: ${info.contextWindow.toLocaleString()} tokens (original ${info.tierName} tier, override in effect)`);
    } else {
      lines.push(`  Context window: ${info.contextWindow.toLocaleString()} tokens (${info.tierName} tier)`);
    }
    lines.push(`  Status: ${status.label}`);
    lines.push('');

    lines.push('Token Breakdown:');
    lines.push(`  Messages: ${info.messageTokens.toLocaleString()} tokens`);
    lines.push(`  System prompt: ${info.systemPromptTokens.toLocaleString()} tokens`);
    lines.push(`  Tool definitions: ${info.toolDefinitionTokens.toLocaleString()} tokens`);
    lines.push('');

    lines.push(`Messages: ${info.messages} total`);
    lines.push(`  User: ${info.userMessages}, Assistant: ${info.assistantMessages}, Tool results: ${info.toolResultMessages}`);
    if (info.hasSummary) {
      lines.push('  (Conversation summary active from previous compaction)');
    }
    lines.push('');

    // Compression status
    if (info.compressionEnabled && info.compression) {
      lines.push(`Compression: Enabled (${info.compression.savingsPercent.toFixed(0)}% savings)`);
    } else if (info.compressionEnabled) {
      lines.push('Compression: Enabled (not yet applied)');
    } else {
      lines.push('Compression: Disabled');
    }
    lines.push(`Working set: ${info.workingSetFiles} recent files tracked`);
    lines.push('');

    // Cached results
    const cachedResults = listCachedResults();
    if (cachedResults.length > 0) {
      lines.push(`Cached Results: ${cachedResults.length} available`);
      if (includeCached) {
        for (const { id, metadata } of cachedResults.slice(0, 10)) {
          lines.push(`  - ${id}: ${metadata.toolName} (~${metadata.estimatedTokens} tokens)`);
        }
        if (cachedResults.length > 10) {
          lines.push(`  ... and ${cachedResults.length - 10} more`);
        }
        lines.push('  [Use recall_result with cache_id to retrieve full content]');
      } else {
        lines.push('  (Use include_cached: true to see IDs)');
      }
    } else {
      lines.push('Cached Results: None available');
    }
    lines.push('');

    // Recommendations
    lines.push('Recommendations:');
    for (const rec of status.recommendations) {
      lines.push(`  - ${rec}`);
    }

    return lines.join('\n');
  }

  private getStatusLevel(usagePercent: number): {
    label: string;
    recommendations: string[];
  } {
    if (usagePercent < 50) {
      return {
        label: 'HEALTHY',
        recommendations: [
          'Context usage is low, normal tool usage is appropriate',
          'Can read full files if needed',
        ],
      };
    }

    if (usagePercent < 75) {
      return {
        label: 'MODERATE',
        recommendations: [
          'Consider using search_codebase or grep over full file reads',
          'Use offset/limit for large files',
        ],
      };
    }

    if (usagePercent < 90) {
      return {
        label: 'HIGH',
        recommendations: [
          'Prefer targeted searches (grep, glob, search_codebase) over read_file',
          'Use recall_result for previously read content instead of re-reading',
          'Consider completing current task before starting new ones',
        ],
      };
    }

    return {
      label: 'CRITICAL',
      recommendations: [
        'Compaction is imminent - minimize new tool calls',
        'Use recall_result for any needed cached content',
        'Avoid reading new files unless absolutely essential',
        'Focus on completing the current task',
      ],
    };
  }
}
