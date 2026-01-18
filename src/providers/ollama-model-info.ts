// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Ollama model info utilities.
 * Queries Ollama's /api/show endpoint to get model metadata including context window.
 */

import { logger, LogLevel } from '../logger.js';

/**
 * Cached model info from Ollama /api/show
 */
export interface OllamaModelDetails {
  contextWindow: number;
  capabilities: string[];
  architecture: string;
  parameterSize?: string;
  quantization?: string;
}

/** Cache for model info to avoid repeated API calls */
const modelInfoCache = new Map<string, OllamaModelDetails>();

/** Cache for failed lookups to avoid retrying */
const failedLookups = new Set<string>();

/**
 * Response from Ollama /api/show endpoint
 */
interface OllamaShowResponse {
  model_info?: Record<string, unknown>;
  capabilities?: string[];
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

/**
 * Query Ollama's /api/show endpoint for model metadata.
 * Results are cached to avoid repeated API calls.
 *
 * @param modelName - The model name (e.g., "llama3.2", "qwen3:8b")
 * @param baseUrl - Ollama API base URL (default: http://localhost:11434)
 * @returns Model details or null if unavailable
 */
export async function getOllamaModelInfo(
  modelName: string,
  baseUrl: string = 'http://localhost:11434'
): Promise<OllamaModelDetails | null> {
  // Check cache first
  const cacheKey = `${baseUrl}:${modelName}`;
  if (modelInfoCache.has(cacheKey)) {
    return modelInfoCache.get(cacheKey)!;
  }

  // Skip if we already failed to look this up
  if (failedLookups.has(cacheKey)) {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      logger.debug(`Ollama /api/show failed for ${modelName}: ${response.status}`);
      failedLookups.add(cacheKey);
      return null;
    }

    const data = (await response.json()) as OllamaShowResponse;

    // Extract context length from model_info
    // The key format is "{architecture}.context_length"
    let contextWindow = 0;
    let architecture = 'unknown';

    if (data.model_info) {
      for (const [key, value] of Object.entries(data.model_info)) {
        if (key.endsWith('.context_length') && typeof value === 'number') {
          contextWindow = value;
          architecture = key.replace('.context_length', '');
          break;
        }
      }
    }

    const modelDetails: OllamaModelDetails = {
      contextWindow: contextWindow || 8192, // Default to 8k if not found
      capabilities: data.capabilities || [],
      architecture,
      parameterSize: data.details?.parameter_size,
      quantization: data.details?.quantization_level,
    };

    // Cache the result
    modelInfoCache.set(cacheKey, modelDetails);

    logger.debug(
      `Ollama model ${modelName}: context=${modelDetails.contextWindow}, ` +
        `arch=${architecture}, capabilities=${modelDetails.capabilities.join(',')}`
    );

    return modelDetails;
  } catch (error) {
    logger.debug(`Failed to query Ollama model info for ${modelName}: ${error}`);
    failedLookups.add(cacheKey);
    return null;
  }
}

/**
 * Get context window for an Ollama model.
 * Convenience wrapper around getOllamaModelInfo.
 *
 * @param modelName - The model name
 * @param baseUrl - Ollama API base URL
 * @param defaultValue - Default value if lookup fails (default: 8192)
 * @returns Context window in tokens
 */
export async function getOllamaContextWindow(
  modelName: string,
  baseUrl: string = 'http://localhost:11434',
  defaultValue: number = 8192
): Promise<number> {
  const info = await getOllamaModelInfo(modelName, baseUrl);
  return info?.contextWindow || defaultValue;
}

/**
 * Check if an Ollama model supports tool use.
 *
 * @param modelName - The model name
 * @param baseUrl - Ollama API base URL
 * @returns True if model supports tools
 */
export async function ollamaSupportsTools(
  modelName: string,
  baseUrl: string = 'http://localhost:11434'
): Promise<boolean> {
  const info = await getOllamaModelInfo(modelName, baseUrl);
  return info?.capabilities.includes('tools') || false;
}

/**
 * Clear the model info cache.
 * Useful for testing or when models are updated.
 */
export function clearOllamaModelInfoCache(): void {
  modelInfoCache.clear();
  failedLookups.clear();
}
