// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Static model registry with pricing and capabilities.
 * Used as fallback when API model listing is unavailable.
 */
import type { ModelInfo } from './providers/base.js';

/**
 * Pricing per 1M tokens (in USD) for various models.
 * Keep in sync with usage.ts MODEL_PRICING.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic Claude models
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

  // OpenAI GPT models
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o3-mini': { input: 1.1, output: 4.4 },
};

/**
 * Static list of known models with their capabilities.
 */
export const STATIC_MODELS: ModelInfo[] = [
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

/**
 * Get pricing for a specific model.
 */
export function getModelPricing(modelId: string): { input: number; output: number } | undefined {
  // Try exact match first
  if (MODEL_PRICING[modelId]) {
    return MODEL_PRICING[modelId];
  }

  // Try prefix match
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(key) || key.startsWith(modelId)) {
      return pricing;
    }
  }

  return undefined;
}

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
