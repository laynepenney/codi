// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Model pricing constants - single source of truth.
 *
 * Pricing per 1M tokens (in USD) for various models.
 * Used by both models.ts and usage.ts.
 */

export interface ModelPricing {
  input: number;
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude models
  'claude-opus-4-5-20251101': { input: 15.0, output: 75.0 },
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

  // Default for unknown models (free/local)
  'default': { input: 0, output: 0 },
};

/**
 * Get pricing for a model with prefix matching fallback.
 * Returns default pricing if model is not found.
 */
export function getModelPricing(model: string): ModelPricing {
  // Try exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try prefix match (e.g., "claude-3-sonnet" matches "claude-3-sonnet-20240229")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (key !== 'default' && (model.startsWith(key) || key.startsWith(model))) {
      return pricing;
    }
  }

  // Default (free/local models)
  return MODEL_PRICING['default'];
}
