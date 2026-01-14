// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { BaseProvider } from './base.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider, createOllamaProvider, createRunPodProvider } from './openai-compatible.js';
import { OllamaCloudProvider } from './ollama-cloud.js';
import type { ProviderConfig } from '../types.js';

export { BaseProvider } from './base.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAICompatibleProvider, createOllamaProvider, createRunPodProvider } from './openai-compatible.js';
export { OllamaCloudProvider } from './ollama-cloud.js';

export interface CreateProviderOptions extends ProviderConfig {
  type: string;
  endpointId?: string; // For RunPod serverless
}

/** Provider factory function type */
export type ProviderFactory = (options: CreateProviderOptions) => BaseProvider;

/** Registry of provider factories */
const providerFactories = new Map<string, ProviderFactory>();

// Register built-in providers
providerFactories.set('anthropic', (options) => new AnthropicProvider(options));
providerFactories.set('openai', (options) => new OpenAICompatibleProvider(options));
providerFactories.set('ollama', (options) => createOllamaProvider(options.model));
providerFactories.set('runpod', (options) => createRunPodProvider(
  options.endpointId || process.env.RUNPOD_ENDPOINT_ID || '',
  options.model || 'default',
  options.apiKey
));
providerFactories.set('ollama-cloud', (options) => new OllamaCloudProvider(options));

/**
 * Register a new provider factory.
 * Used by plugins to add custom providers.
 */
export function registerProviderFactory(type: string, factory: ProviderFactory): void {
  if (providerFactories.has(type)) {
    throw new Error(`Provider type '${type}' is already registered`);
  }
  providerFactories.set(type, factory);
}

/**
 * Get list of registered provider types.
 */
export function getProviderTypes(): string[] {
  return Array.from(providerFactories.keys());
}

/**
 * Check if a provider type is registered.
 */
export function hasProviderType(type: string): boolean {
  return providerFactories.has(type);
}

/**
 * Factory function to create a provider based on type.
 */
export function createProvider(options: CreateProviderOptions): BaseProvider {
  const factory = providerFactories.get(options.type);

  if (!factory) {
    const available = getProviderTypes().join(', ');
    throw new Error(`Unknown provider type: ${options.type}. Available: ${available}`);
  }

  return factory(options);
}

/**
 * Configuration for creating a secondary provider (e.g., for summarization).
 */
export interface SecondaryProviderConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Create a secondary provider for auxiliary tasks like summarization.
 * Returns null if no secondary configuration is provided, allowing fallback to primary.
 */
export function createSecondaryProvider(config: SecondaryProviderConfig | undefined): BaseProvider | null {
  if (!config?.provider && !config?.model) {
    return null; // No secondary config, use primary
  }

  // If only model is specified, try to detect provider
  const providerType = config.provider || 'auto';

  if (providerType === 'auto') {
    // Try to create with auto-detection
    return detectProvider();
  }

  try {
    return createProvider({
      type: providerType,
      model: config.model,
      baseUrl: config.baseUrl,
    });
  } catch (error) {
    console.warn(`Failed to create secondary provider (${providerType}): ${error instanceof Error ? error.message : error}`);
    return null; // Fallback to primary
  }
}

/**
 * Detect the best available provider based on environment.
 */
export function detectProvider(): BaseProvider {
  // Check for API keys in environment
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Using Anthropic provider (found ANTHROPIC_API_KEY)');
    return new AnthropicProvider();
  }

  if (process.env.OPENAI_API_KEY) {
    console.log('Using OpenAI provider (found OPENAI_API_KEY)');
    return new OpenAICompatibleProvider();
  }

  if (process.env.RUNPOD_API_KEY && process.env.RUNPOD_ENDPOINT_ID) {
    console.log('Using RunPod provider (found RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID)');
    return createRunPodProvider(
      process.env.RUNPOD_ENDPOINT_ID,
      process.env.RUNPOD_MODEL || 'default'
    );
  }

  // Check if user wants to use Ollama Cloud
  const useOllamaCloud = process.env.OLLAMA_CLOUD === 'true' || process.env.CODI_PROVIDER === 'ollama-cloud';

  if (useOllamaCloud) {
    console.log('Using Ollama Cloud provider');
    return new OllamaCloudProvider();
  }

  // Default to Ollama for local usage
  console.log('Using Ollama provider (no API keys found, assuming local)');
  return createOllamaProvider();
}
