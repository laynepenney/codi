/**
 * RAG Retriever
 *
 * Queries the vector index for relevant code snippets.
 */

import type { RAGConfig, RetrievalResult } from './types.js';
import type { BaseEmbeddingProvider } from './embeddings/base.js';
import { VectorStore } from './vector-store.js';

/**
 * Retriever for querying the code index.
 */
export class Retriever {
  private embeddingProvider: BaseEmbeddingProvider;
  private vectorStore: VectorStore;
  private config: RAGConfig;
  private initialized: boolean = false;

  constructor(
    projectPath: string,
    embeddingProvider: BaseEmbeddingProvider,
    config: RAGConfig
  ) {
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = new VectorStore(projectPath);
    this.config = config;
  }

  /**
   * Initialize the retriever.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.vectorStore.initialize();
    this.initialized = true;
  }

  /**
   * Set the vector store (to share with indexer).
   */
  setVectorStore(store: VectorStore): void {
    this.vectorStore = store;
    this.initialized = true;
  }

  /**
   * Search for relevant code chunks.
   */
  async search(
    query: string,
    topK?: number,
    minScore?: number
  ): Promise<RetrievalResult[]> {
    if (!this.initialized) {
      throw new Error('Retriever not initialized');
    }

    // Generate embedding for the query
    const embedding = await this.embeddingProvider.embedOne(query);

    // Query the vector store
    return this.vectorStore.query(
      embedding,
      topK ?? this.config.topK,
      minScore ?? this.config.minScore
    );
  }

  /**
   * Format results for context injection.
   */
  formatForContext(results: RetrievalResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const lines: string[] = ['## Relevant Code Context'];
    lines.push('');
    lines.push(
      '_The following code snippets were found to be relevant to the current query:_'
    );

    for (const result of results) {
      const { chunk, score } = result;
      const matchPercent = Math.round(score * 100);

      lines.push('');
      lines.push(
        `### ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine} (${matchPercent}% match)`
      );

      if (chunk.name) {
        lines.push(`**${chunk.type}:** \`${chunk.name}\``);
      }

      lines.push('```' + chunk.language);
      // Truncate very long chunks for context display
      const content =
        chunk.content.length > 2000
          ? chunk.content.slice(0, 2000) + '\n// ... (truncated)'
          : chunk.content;
      lines.push(content);
      lines.push('```');
    }

    return lines.join('\n');
  }

  /**
   * Format results as a simple list (for tool output).
   */
  formatAsToolOutput(results: RetrievalResult[]): string {
    if (results.length === 0) {
      return 'No relevant code found.';
    }

    const lines: string[] = [`Found ${results.length} relevant code snippets:\n`];

    for (let i = 0; i < results.length; i++) {
      const { chunk, score } = results[i];
      const matchPercent = Math.round(score * 100);

      lines.push(`${i + 1}. ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`);
      lines.push(`   Match: ${matchPercent}%`);

      if (chunk.name) {
        lines.push(`   ${chunk.type}: ${chunk.name}`);
      }

      lines.push('');
      lines.push('```' + chunk.language);

      // Include full content for tool output (AI needs to see it)
      const content =
        chunk.content.length > 3000
          ? chunk.content.slice(0, 3000) + '\n// ... (truncated)'
          : chunk.content;
      lines.push(content);
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get indexed files from the vector store.
   */
  async getIndexedFiles(): Promise<string[]> {
    if (!this.initialized) {
      throw new Error('Retriever not initialized');
    }
    return this.vectorStore.getIndexedFiles();
  }
}
