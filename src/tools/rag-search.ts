// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * RAG Search Tool
 *
 * Allows the AI to search the indexed codebase for relevant code snippets.
 */

import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import type { Retriever } from '../rag/retriever.js';
import { minimatch } from 'minimatch';

/**
 * Tool for searching the indexed codebase using semantic similarity.
 */
export class RAGSearchTool extends BaseTool {
  private retriever: Retriever | null = null;

  /**
   * Set the retriever instance.
   */
  setRetriever(retriever: Retriever): void {
    this.retriever = retriever;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'search_codebase',
      description: `Search the indexed codebase for relevant code snippets using semantic similarity.
Use this when you need to find code related to a concept, function, or feature.
The search uses vector embeddings to find semantically similar code, not just text matching.

Examples of good queries:
- "authentication middleware implementation"
- "database connection setup and configuration"
- "error handling patterns"
- "user validation logic"
- "API endpoint for creating users"

Filtering options:
- Use 'dir' to restrict search to a specific directory (e.g., "src/commands")
- Use 'file_pattern' to filter by file type (e.g., "*.test.ts" for tests only)
- Use 'min_score' to adjust relevance threshold (lower = more results, less relevant)

This tool returns actual code snippets from the project that are semantically
similar to your query, along with file paths, line numbers, and match scores.`,
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Natural language description of what code you are looking for',
          },
          max_results: {
            type: 'number',
            description:
              'Maximum number of results to return (default: 5, max: 20)',
          },
          min_score: {
            type: 'number',
            description:
              'Minimum similarity score threshold (0-1, default: 0.7). Lower values return more results but may be less relevant.',
          },
          dir: {
            type: 'string',
            description:
              'Restrict search to a specific directory (e.g., "src/commands" or "tests/"). Paths are relative to project root.',
          },
          file_pattern: {
            type: 'string',
            description:
              'Filter results by file pattern (e.g., "*.ts", "*.test.ts", "**/*.tsx"). Uses glob syntax.',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = input.query as string;
    let maxResults = (input.max_results as number) || 5;
    const minScore = (input.min_score as number) ?? 0.7;
    const dir = input.dir as string | undefined;
    const filePattern = input.file_pattern as string | undefined;

    if (!query) {
      throw new Error('Query is required');
    }

    if (!this.retriever) {
      return `RAG index is not available.

To enable semantic code search:
1. Ensure RAG is enabled in your configuration
2. Run /index to build the code index
3. Wait for indexing to complete

Alternatively, you can use the grep tool for text-based search.`;
    }

    // Clamp max results (increased max to 20 to allow more filtering)
    maxResults = Math.min(Math.max(maxResults, 1), 20);

    // Validate min_score
    const validMinScore = Math.min(Math.max(minScore, 0), 1);

    try {
      // Fetch more results if filtering, then apply filters
      const fetchCount = (dir || filePattern) ? maxResults * 3 : maxResults;
      let results = await this.retriever.search(query, fetchCount, validMinScore);

      // Apply directory filter
      if (dir) {
        const normalizedDir = dir.replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
        results = results.filter(r => {
          const relativePath = r.chunk.relativePath;
          return relativePath.startsWith(normalizedDir + '/') || relativePath.startsWith(normalizedDir);
        });
      }

      // Apply file pattern filter
      if (filePattern) {
        results = results.filter(r => {
          return minimatch(r.chunk.relativePath, filePattern, { matchBase: true });
        });
      }

      // Limit to requested max after filtering
      results = results.slice(0, maxResults);

      if (results.length === 0) {
        let message = `No relevant code found for: "${query}"`;
        if (dir) message += `\n  (filtered to directory: ${dir})`;
        if (filePattern) message += `\n  (filtered to pattern: ${filePattern})`;
        if (minScore !== 0.7) message += `\n  (min score: ${minScore})`;

        message += `

This could mean:
- The index doesn't contain code matching your query
- The query is too specific or uses different terminology
- The filters are too restrictive
- The index needs to be rebuilt (/index --clear)

Try:
1. Using different keywords or phrasing
2. Removing or relaxing the dir/file_pattern filters
3. Lowering the min_score threshold
4. Using the grep tool for exact text matching`;

        return message;
      }

      return this.retriever.formatAsToolOutput(results);
    } catch (error) {
      throw new Error(
        `RAG search failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }
}
