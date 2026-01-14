// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * RAG System Exports
 *
 * Main entry point for the RAG (Retrieval-Augmented Generation) system.
 */

// Types
export type {
  CodeChunk,
  RetrievalResult,
  IndexStats,
  RAGConfig,
  IndexProgressCallback,
  IndexCompleteCallback,
  IndexErrorCallback,
} from './types.js';

export { DEFAULT_RAG_CONFIG } from './types.js';

// Embedding providers
export {
  BaseEmbeddingProvider,
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  createEmbeddingProvider,
  detectAvailableProviders,
} from './embeddings/index.js';

// Core components
export { VectorStore } from './vector-store.js';
export { CodeChunker, DEFAULT_CHUNKER_CONFIG } from './chunker.js';
export type { ChunkerConfig } from './chunker.js';
export { BackgroundIndexer } from './indexer.js';
export { Retriever } from './retriever.js';
