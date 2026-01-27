// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static model registry with pricing and capabilities.
 * Used as fallback when API model listing is unavailable.
 */
import type { ModelInfo } from './providers/base.js';
import { MODEL_PRICING, getModelPricing } from './pricing.js';

/**
 * Static list of known models with their capabilities.
 */
export const STATIC_MODELS: ModelInfo[] = [
  // Anthropic Claude 4.5 models
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-opus-4-5-20251101'],
  },

  // Anthropic Claude 4 models
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-opus-4-20250514'],
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-sonnet-4-20250514'],
  },

  // Anthropic Claude 3.5 models
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-3-5-sonnet-20241022'],
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-3-5-haiku-20241022'],
  },

  // Anthropic Claude 3 models
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-3-opus-20240229'],
  },
  {
    id: 'claude-3-sonnet-20240229',
    name: 'Claude 3 Sonnet',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-3-sonnet-20240229'],
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    provider: 'Anthropic',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['claude-3-haiku-20240307'],
  },

  // OpenAI GPT-4o models
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 128000,
    pricing: MODEL_PRICING['gpt-4o'],
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 128000,
    pricing: MODEL_PRICING['gpt-4o-mini'],
  },

  // OpenAI GPT-4 models
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'OpenAI',
    capabilities: { vision: true, toolUse: true },
    contextWindow: 128000,
    pricing: MODEL_PRICING['gpt-4-turbo'],
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'OpenAI',
    capabilities: { vision: false, toolUse: true },
    contextWindow: 8192,
    pricing: MODEL_PRICING['gpt-4'],
  },

  // OpenAI GPT-3.5
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'OpenAI',
    capabilities: { vision: false, toolUse: true },
    contextWindow: 16385,
    pricing: MODEL_PRICING['gpt-3.5-turbo'],
  },

  // OpenAI O-series (reasoning models)
  {
    id: 'o1',
    name: 'O1',
    provider: 'OpenAI',
    capabilities: { vision: false, toolUse: false },
    contextWindow: 128000,
    pricing: MODEL_PRICING['o1'],
  },
  {
    id: 'o1-mini',
    name: 'O1 Mini',
    provider: 'OpenAI',
    capabilities: { vision: false, toolUse: false },
    contextWindow: 128000,
    pricing: MODEL_PRICING['o1-mini'],
  },
  {
    id: 'o3-mini',
    name: 'O3 Mini',
    provider: 'OpenAI',
    capabilities: { vision: false, toolUse: true },
    contextWindow: 200000,
    pricing: MODEL_PRICING['o3-mini'],
  },
];

/**
 * Get static models, optionally filtered by provider.
 */
export function getStaticModels(provider?: string): ModelInfo[] {
  if (provider) {
    return STATIC_MODELS.filter(m =>
      m.provider.toLowerCase() === provider.toLowerCase()
    );
  }
  return STATIC_MODELS;
}

// Re-export getModelPricing from shared pricing module
export { getModelPricing } from './pricing.js';

/**
 * Get context window size for a specific model.
 * Returns undefined if model is not found in registry.
 */
export function getModelContextWindow(modelId: string): number | undefined {
  // Try exact match first
  const exactMatch = STATIC_MODELS.find(m => m.id === modelId);
  if (exactMatch?.contextWindow) {
    return exactMatch.contextWindow;
  }

  // Try prefix match for versioned models (e.g., claude-sonnet-4-20250514 → claude-sonnet-4)
  // Only match if the next character after the prefix is a version separator (-) or end of string
  // This prevents "gpt-4" from matching "gpt-4o"
  for (const model of STATIC_MODELS) {
    // Case 1: modelId is a versioned extension of registry model
    // e.g., modelId="claude-sonnet-4-20250514" matches model.id="claude-sonnet-4"
    if (modelId.startsWith(model.id)) {
      const nextChar = modelId[model.id.length];
      if (nextChar === undefined || nextChar === '-') {
        return model.contextWindow;
      }
    }
    // Case 2: modelId is a base name matching registry model
    // e.g., modelId="claude-sonnet-4" matches model.id="claude-sonnet-4-20250514"
    if (model.id.startsWith(modelId)) {
      const nextChar = model.id[modelId.length];
      if (nextChar === undefined || nextChar === '-') {
        return model.contextWindow;
      }
    }
  }

  return undefined;
}
