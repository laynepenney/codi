/**
 * Model listing and switching commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OpenAICompatibleProvider, createOllamaProvider } from '../providers/openai-compatible.js';
import { createProvider, getProviderTypes } from '../providers/index.js';
import { getStaticModels } from '../models.js';
import type { ModelInfo } from '../providers/base.js';

/**
 * /models command - List available models for each provider.
 */
export const modelsCommand: Command = {
  name: 'models',
  aliases: ['model', 'list-models'],
  description: 'List available models for each provider',
  usage: '/models [provider] [--local]',
  execute: async (args: string, _context: CommandContext): Promise<string> => {
    const parts = args.trim().toLowerCase().split(/\s+/).filter(p => p);
    const providerFilter = parts.find(p => !p.startsWith('--'));
    const localOnly = parts.includes('--local');

    const allModels: ModelInfo[] = [];
    const errors: string[] = [];

    // Fetch from each provider
    if (!localOnly) {
      if (!providerFilter || providerFilter === 'anthropic') {
        const { models, error } = await fetchAnthropicModels();
        allModels.push(...models);
        if (error) errors.push(error);
      }

      if (!providerFilter || providerFilter === 'openai') {
        const { models, error } = await fetchOpenAIModels();
        allModels.push(...models);
        if (error) errors.push(error);
      }
    }

    if (!providerFilter || providerFilter === 'ollama' || localOnly) {
      const { models, error } = await fetchOllamaModels();
      allModels.push(...models);
      if (error) errors.push(error);
    }

    // Return serialized data for formatting by index.ts
    return formatModelsOutput(allModels, errors);
  },
};

/**
 * /switch command - Switch to a different model during a session.
 */
export const switchCommand: Command = {
  name: 'switch',
  aliases: ['use', 'model-switch'],
  description: 'Switch to a different model during a session',
  usage: '/switch <provider> [model]  or  /switch <model> (for current provider)',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/).filter(p => p);

    if (parts.length === 0) {
      // Show current model and available providers
      const agent = context.agent;
      if (!agent) {
        return '__SWITCH_ERROR__|No agent available';
      }
      const provider = agent.getProvider();
      const availableProviders = getProviderTypes().join(', ');
      return `__SWITCH_CURRENT__|${provider.getName()}|${provider.getModel()}|${availableProviders}`;
    }

    const agent = context.agent;
    if (!agent) {
      return '__SWITCH_ERROR__|No agent available';
    }

    let providerType: string;
    let modelName: string | undefined;

    // Check if first arg is a known provider
    const knownProviders = getProviderTypes();
    if (knownProviders.includes(parts[0].toLowerCase())) {
      providerType = parts[0].toLowerCase();
      modelName = parts[1]; // May be undefined
    } else {
      // Assume it's a model name for the current provider
      const currentProvider = agent.getProvider();
      providerType = currentProvider.getName().toLowerCase();
      modelName = parts[0];
    }

    try {
      const newProvider = createProvider({
        type: providerType,
        model: modelName,
      });

      agent.setProvider(newProvider);

      return `__SWITCH_SUCCESS__|${newProvider.getName()}|${newProvider.getModel()}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `__SWITCH_ERROR__|${message}`;
    }
  },
};

interface FetchResult {
  models: ModelInfo[];
  error?: string;
}

async function fetchAnthropicModels(): Promise<FetchResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { models: getStaticModels('Anthropic'), error: 'Anthropic: Using static list (no API key)' };
  }
  try {
    const provider = new AnthropicProvider();
    const models = await provider.listModels();
    return { models };
  } catch {
    return { models: getStaticModels('Anthropic'), error: 'Anthropic: Using static list (API error)' };
  }
}

async function fetchOpenAIModels(): Promise<FetchResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { models: getStaticModels('OpenAI'), error: 'OpenAI: Using static list (no API key)' };
  }
  try {
    const provider = new OpenAICompatibleProvider();
    const models = await provider.listModels();
    return { models };
  } catch {
    return { models: getStaticModels('OpenAI'), error: 'OpenAI: Using static list (API error)' };
  }
}

async function fetchOllamaModels(): Promise<FetchResult> {
  try {
    const provider = createOllamaProvider();
    const models = await provider.listModels();
    if (models.length === 0) {
      return { models: [], error: 'Ollama: No models found (is Ollama running?)' };
    }
    return { models };
  } catch {
    return { models: [], error: 'Ollama: Not available' };
  }
}

function formatModelsOutput(models: ModelInfo[], errors: string[]): string {
  const lines: string[] = ['__MODELS__'];

  // Group models by provider
  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const existing = byProvider.get(model.provider) || [];
    existing.push(model);
    byProvider.set(model.provider, existing);
  }

  // Format each provider's models
  // Use | as delimiter since model IDs can contain colons
  for (const [provider, providerModels] of byProvider) {
    lines.push(`provider|${provider}`);
    for (const model of providerModels) {
      const vision = model.capabilities.vision ? '1' : '0';
      const tools = model.capabilities.toolUse ? '1' : '0';
      const context = model.contextWindow ?? 0;
      const inputPrice = model.pricing?.input ?? 0;
      const outputPrice = model.pricing?.output ?? 0;
      lines.push(`model|${model.id}|${model.name}|${vision}|${tools}|${context}|${inputPrice}|${outputPrice}`);
    }
  }

  // Add errors/warnings
  for (const error of errors) {
    lines.push(`note|${error}`);
  }

  return lines.join('\n');
}

/**
 * Register all model commands.
 */
export function registerModelCommands(): void {
  registerCommand(modelsCommand);
  registerCommand(switchCommand);
}
