// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import {
  getCachedResult,
  listCachedResults,
  hasCachedResult,
} from '../utils/tool-result-cache.js';

/**
 * Tool for retrieving cached tool results that were truncated for context management.
 * When tool results are too large, they are summarized and cached with an ID.
 * This tool allows retrieval of the full content when needed.
 */
export class RecallResultTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'recall_result',
      description:
        'Retrieve a previously truncated tool result by its cache ID. ' +
        'When tool results are large, they are summarized with a cache ID like ' +
        '"[read_file: 500 lines] (cached: read_file_abc123, ~2000 tokens)". ' +
        'Use this tool with the cache ID to retrieve the full content. ' +
        'You can also list available cached results.',
      input_schema: {
        type: 'object',
        properties: {
          cache_id: {
            type: 'string',
            description:
              'The cache ID to retrieve (e.g., "read_file_abc123"). ' +
              'Found in truncated result summaries after "cached:".',
          },
          action: {
            type: 'string',
            enum: ['get', 'list', 'check'],
            description:
              'Action to perform: "get" retrieves full content (default), ' +
              '"list" shows available cached results, ' +
              '"check" verifies if a cache ID exists.',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const action = (input.action as string) || 'get';
    const cacheId = input.cache_id as string | undefined;

    switch (action) {
      case 'list':
        return this.listCached();

      case 'check':
        if (!cacheId) {
          return 'Error: cache_id is required for check action';
        }
        return this.checkCached(cacheId);

      case 'get':
      default:
        if (!cacheId) {
          return 'Error: cache_id is required to retrieve a cached result. Use action="list" to see available results.';
        }
        return this.getCached(cacheId);
    }
  }

  private getCached(cacheId: string): string {
    const result = getCachedResult(cacheId);

    if (!result) {
      return `Error: No cached result found for ID "${cacheId}". It may have expired (24h limit) or been cleaned up.`;
    }

    const header = [
      `=== Cached Result: ${cacheId} ===`,
      `Tool: ${result.toolName}`,
      `Cached: ${new Date(result.cachedAt).toISOString()}`,
      `Tokens: ~${result.estimatedTokens}`,
      result.isError ? 'Status: ERROR' : '',
      '---',
    ]
      .filter(Boolean)
      .join('\n');

    return `${header}\n${result.content}`;
  }

  private listCached(): string {
    const results = listCachedResults();

    if (results.length === 0) {
      return 'No cached results available.';
    }

    const lines = ['Available cached results:', ''];

    for (const { id, metadata } of results.slice(0, 20)) {
      const age = this.formatAge(Date.now() - metadata.cachedAt);
      const size = this.formatSize(metadata.contentLength);
      lines.push(
        `  ${id}`,
        `    Tool: ${metadata.toolName}, Size: ${size}, Tokens: ~${metadata.estimatedTokens}, Age: ${age}`,
        `    Summary: ${metadata.summary.slice(0, 100)}${metadata.summary.length > 100 ? '...' : ''}`,
        ''
      );
    }

    if (results.length > 20) {
      lines.push(`  ... and ${results.length - 20} more`);
    }

    return lines.join('\n');
  }

  private checkCached(cacheId: string): string {
    if (hasCachedResult(cacheId)) {
      const result = getCachedResult(cacheId);
      if (result) {
        return (
          `Cache ID "${cacheId}" exists.\n` +
          `Tool: ${result.toolName}\n` +
          `Size: ${this.formatSize(result.content.length)}\n` +
          `Tokens: ~${result.estimatedTokens}\n` +
          `Age: ${this.formatAge(Date.now() - result.cachedAt)}`
        );
      }
    }
    return `Cache ID "${cacheId}" not found.`;
  }

  private formatAge(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
