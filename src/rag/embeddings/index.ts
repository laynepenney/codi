// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Embedding Provider Factory
 *
 * Auto-detects and creates the appropriate embedding provider.
 */

import { BaseEmbeddingProvider } from './base.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import type { RAGConfig } from '../types.js';
import type { ModelDefinition, ModelMapConfig, TaskDefinition } from '../../model-map/types.js';

export { BaseEmbeddingProvider } from './base.js';
export { OpenAIEmbeddingProvider } from './openai.js';
export { OllamaEmbeddingProvider } from './ollama.js';

/**
 * Create an embedding provider from a model definition.
 * @param modelDef - Model definition from model map
 * @returns Embedding provider instance
 */
export function createEmbeddingProviderFromModelDef(
  modelDef: ModelDefinition
): BaseEmbeddingProvider {
  switch (modelDef.provider) {
    case 'openai':
      return new OpenAIEmbeddingProvider(modelDef.model);

    case 'ollama':
    case 'ollama-cloud':
      return new OllamaEmbeddingProvider(
        modelDef.model,
        modelDef.baseUrl || 'http://localhost:11434'
      );

    default:
      throw new Error(
        `Unsupported embedding provider: ${modelDef.provider}. ` +
        `Supported providers: openai, ollama, ollama-cloud`
      );
  }
}

/**
 * Create an embedding provider based on configuration.
 * @param config - RAG configuration
 * @param modelMap - Optional model map configuration for 'modelmap' provider
 * @returns Embedding provider instance
 */
export function createEmbeddingProvider(
  config: RAGConfig,
  modelMap?: ModelMapConfig | null
): BaseEmbeddingProvider {
  const provider = config.embeddingProvider;

  // Model map provider
  if (provider === 'modelmap' && modelMap) {
    return createEmbeddingProviderFromModelMap(config, modelMap);
  }

  // Direct provider selection
  if (provider === 'openai') {
    return new OpenAIEmbeddingProvider(config.openaiModel);
  }

  if (provider === 'ollama') {
    return new OllamaEmbeddingProvider(config.ollamaModel, config.ollamaBaseUrl);
  }

  // Auto-detect: prefer Ollama (free/local), fall back to OpenAI if key is available
  const ollamaUrl = config.ollamaBaseUrl || 'http://localhost:11434';
  return new OllamaEmbeddingProvider(config.ollamaModel, ollamaUrl);
}

/**
 * Create an embedding provider from model map configuration.
 * @param config - RAG configuration
 * @param modelMap - Model map configuration
 * @returns Embedding provider instance
 * @throws Error if embedding task or model not found in model map
 */
function createEmbeddingProviderFromModelMap(
  config: RAGConfig,
  modelMap: ModelMapConfig
): BaseEmbeddingProvider {
  const taskName = config.embeddingTask || 'embeddings';
  const task: TaskDefinition | undefined = modelMap.tasks?.[taskName];

  if (!task || !task.model) {
    throw new Error(
      `Embedding task '${taskName}' not found in model map. ` +
      `Available tasks: ${Object.keys(modelMap.tasks || {}).join(', ')}`
    );
  }

  const modelDef = modelMap.models[task.model];
  if (!modelDef) {
    throw new Error(
      `Model '${task.model}' not found in model map. ` +
      `Referenced by task '${taskName}'`
    );
  }

  return createEmbeddingProviderFromModelDef(modelDef);
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
