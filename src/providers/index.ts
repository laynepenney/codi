import { BaseProvider } from './base.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider, createOllamaProvider } from './openai-compatible.js';
import type { ProviderConfig } from '../types.js';

export { BaseProvider } from './base.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAICompatibleProvider, createOllamaProvider } from './openai-compatible.js';

export type ProviderType = 'anthropic' | 'openai' | 'ollama';

export interface CreateProviderOptions extends ProviderConfig {
  type: ProviderType;
}

/**
 * Factory function to create a provider based on type.
 */
export function createProvider(options: CreateProviderOptions): BaseProvider {
  switch (options.type) {
    case 'anthropic':
      return new AnthropicProvider(options);

    case 'openai':
      return new OpenAICompatibleProvider(options);

    case 'ollama':
      return createOllamaProvider(options.model);

    default:
      throw new Error(`Unknown provider type: ${options.type}`);
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

  // Default to Ollama for local usage
  console.log('Using Ollama provider (no API keys found, assuming local)');
  return createOllamaProvider();
}
