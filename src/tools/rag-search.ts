/**
 * RAG Search Tool
 *
 * Allows the AI to search the indexed codebase for relevant code snippets.
 */

import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import type { Retriever } from '../rag/retriever.js';

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

This tool returns actual code snippets from the project that are semantically
similar to your query, along with file paths and line numbers.`,
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
              'Maximum number of results to return (default: 5, max: 10)',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = input.query as string;
    let maxResults = (input.max_results as number) || 5;

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

    // Clamp max results
    maxResults = Math.min(Math.max(maxResults, 1), 10);

    try {
      const results = await this.retriever.search(query, maxResults);

      if (results.length === 0) {
        return `No relevant code found for: "${query}"

This could mean:
- The index doesn't contain code matching your query
- The query is too specific or uses different terminology
- The index needs to be rebuilt (/index --clear)

Try:
1. Using different keywords or phrasing
2. Using the grep tool for exact text matching
3. Running /index --clear to rebuild the index`;
      }

      return this.retriever.formatAsToolOutput(results);
    } catch (error) {
      throw new Error(
        `RAG search failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }
}
