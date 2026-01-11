/**
 * Embedding Provider Factory
 *
 * Auto-detects and creates the appropriate embedding provider.
 */

import { BaseEmbeddingProvider } from './base.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import type { RAGConfig } from '../types.js';

export { BaseEmbeddingProvider } from './base.js';
export { OpenAIEmbeddingProvider } from './openai.js';
export { OllamaEmbeddingProvider } from './ollama.js';

/**
 * Create an embedding provider based on configuration.
 * @param config - RAG configuration
 * @returns Embedding provider instance
 */
export function createEmbeddingProvider(config: RAGConfig): BaseEmbeddingProvider {
  const provider = config.embeddingProvider;

  if (provider === 'openai') {
    return new OpenAIEmbeddingProvider(config.openaiModel);
  }

  if (provider === 'ollama') {
    return new OllamaEmbeddingProvider(config.ollamaModel, config.ollamaBaseUrl);
  }

  // Auto-detect: prefer OpenAI if API key is available, else Ollama
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIEmbeddingProvider(config.openaiModel);
  }

  return new OllamaEmbeddingProvider(config.ollamaModel, config.ollamaBaseUrl);
}

/**
 * Detect which embedding providers are available.
 * @param config - RAG configuration
 * @returns Object with availability status for each provider
 */
export async function detectAvailableProviders(config: RAGConfig): Promise<{
  openai: boolean;
  ollama: boolean;
}> {
  const openaiProvider = new OpenAIEmbeddingProvider(config.openaiModel);
  const ollamaProvider = new OllamaEmbeddingProvider(
    config.ollamaModel,
    config.ollamaBaseUrl
  );

  const [openai, ollama] = await Promise.all([
    openaiProvider.isAvailable(),
    ollamaProvider.isAvailable(),
  ]);

  return { openai, ollama };
}
