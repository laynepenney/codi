/**
 * Model listing and switching commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OpenAICompatibleProvider, createOllamaProvider } from '../providers/openai-compatible.js';
import { createProvider, getProviderTypes } from '../providers/index.js';
import { getStaticModels } from '../models.js';
import type { ModelInfo } from '../providers/base.js';
import {
  loadModelMap,
  validateModelMap,
  initModelMapFile,
  getExampleModelMap,
  type ModelMapConfig,
} from '../model-map/index.js';

/**
 * /models command - List available models for each provider.
 */
export const modelsCommand: Command = {
  name: 'models',
  aliases: ['model', 'list-models'],
  description: 'List available models for each provider',
  usage: '/models [provider] [--local]',
  taskType: 'fast',
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
  taskType: 'fast',
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
 * /modelmap command - Show and manage model map configuration.
 */
export const modelMapCommand: Command = {
  name: 'modelmap',
  aliases: ['mm', 'models-map'],
  description: 'Show and manage model map configuration (codi-models.yaml)',
  usage: '/modelmap [init|show|example]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const action = args.trim().toLowerCase() || 'show';

    switch (action) {
      case 'init': {
        const result = initModelMapFile(process.cwd());
        if (result.success) {
          return `__MODELMAP_INIT__|${result.path}`;
        }
        return `__MODELMAP_ERROR__|${result.error}`;
      }

      case 'example': {
        const example = getExampleModelMap();
        return `__MODELMAP_EXAMPLE__|${example}`;
      }

      case 'show':
      default: {
        // Check if agent has a model map
        const agent = context.agent;
        const modelMap = agent?.getModelMap();

        if (modelMap) {
          // Model map is loaded, show its configuration
          return formatModelMapOutput(modelMap.config, modelMap.configPath);
        }

        // Try to load from disk
        const { config, configPath, error } = loadModelMap(process.cwd());
        if (error) {
          return `__MODELMAP_ERROR__|${error}`;
        }
        if (!config) {
          return '__MODELMAP_NOTFOUND__';
        }

        // Validate
        const validation = validateModelMap(config);
        if (!validation.valid) {
          return `__MODELMAP_INVALID__|${validation.errors.map(e => e.message).join('; ')}`;
        }

        return formatModelMapOutput(config, configPath);
      }
    }
  },
};

function formatModelMapOutput(config: ModelMapConfig, configPath: string | null): string {
  const lines: string[] = ['__MODELMAP_SHOW__'];
  lines.push(`path|${configPath || 'unknown'}`);
  lines.push(`version|${config.version}`);

  // Models
  const modelNames = Object.keys(config.models);
  lines.push(`models|${modelNames.length}`);
  for (const [name, model] of Object.entries(config.models)) {
    const desc = model.description || '';
    lines.push(`model|${name}|${model.provider}|${model.model}|${desc}`);
  }

  // Tasks
  const tasks = config.tasks || {};
  const taskNames = Object.keys(tasks);
  lines.push(`tasks|${taskNames.length}`);
  for (const [name, task] of Object.entries(tasks)) {
    const desc = task.description || '';
    lines.push(`task|${name}|${task.model}|${desc}`);
  }

  // Pipelines
  const pipelines = config.pipelines || {};
  const pipelineNames = Object.keys(pipelines);
  lines.push(`pipelines|${pipelineNames.length}`);
  for (const [name, pipeline] of Object.entries(pipelines)) {
    const stepCount = pipeline.steps.length;
    const desc = pipeline.description || '';
    lines.push(`pipeline|${name}|${stepCount}|${desc}`);
  }

  // Fallbacks
  const fallbacks = config.fallbacks || {};
  const fallbackNames = Object.keys(fallbacks);
  lines.push(`fallbacks|${fallbackNames.length}`);
  for (const [name, chain] of Object.entries(fallbacks)) {
    lines.push(`fallback|${name}|${chain.join(' → ')}`);
  }

  // Commands with overrides
  const commands = config.commands || {};
  const commandNames = Object.keys(commands);
  if (commandNames.length > 0) {
    lines.push(`commands|${commandNames.length}`);
    for (const [name, cmd] of Object.entries(commands)) {
      const target = cmd.pipeline || cmd.task || cmd.model || 'default';
      const type = cmd.pipeline ? 'pipeline' : cmd.task ? 'task' : 'model';
      lines.push(`command|${name}|${type}|${target}`);
    }
  }

  return lines.join('\n');
}

/**
 * /pipeline command - Execute a multi-model pipeline.
 */
export const pipelineCommand: Command = {
  name: 'pipeline',
  aliases: ['pipe', 'run-pipeline'],
  description: 'Execute a multi-model pipeline',
  usage: '/pipeline [--provider <context>] [name] [input]',
  taskType: 'complex',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const agent = context.agent;
    const modelMap = agent?.getModelMap();

    if (!modelMap) {
      return '__PIPELINE_ERROR__|No model map loaded. Create a codi-models.yaml file with pipelines defined.';
    }

    const pipelines = modelMap.config.pipelines || {};
    const pipelineNames = Object.keys(pipelines);

    if (pipelineNames.length === 0) {
      return '__PIPELINE_ERROR__|No pipelines defined in codi-models.yaml. Add a "pipelines" section.';
    }

    // Parse --provider flag
    let providerContext: string | undefined;
    let remainingArgs = args.trim();

    const providerMatch = remainingArgs.match(/^--provider\s+(\S+)\s*/);
    if (providerMatch) {
      providerContext = providerMatch[1];
      remainingArgs = remainingArgs.slice(providerMatch[0].length);
    }

    const parts = remainingArgs.split(/\s+/).filter(p => p);
    const pipelineName = parts[0];

    if (!pipelineName) {
      // List available pipelines
      const lines: string[] = ['__PIPELINE_LIST__'];
      const roles = modelMap.router.getRoles();
      for (const [name, pipeline] of Object.entries(pipelines)) {
        const stepCount = pipeline.steps.length;
        // Show models or roles
        const modelsOrRoles = [...new Set(pipeline.steps.map(s => s.role || s.model))].filter(Boolean).join(', ');
        const desc = pipeline.description || '';
        const defaultProvider = pipeline.provider || 'openai';
        lines.push(`pipeline|${name}|${stepCount}|${modelsOrRoles}|${desc}|${defaultProvider}`);
      }
      if (roles.length > 0) {
        lines.push(`roles|${roles.join(', ')}`);
      }
      return lines.join('\n');
    }

    // Execute specified pipeline
    const pipeline = pipelines[pipelineName];
    if (!pipeline) {
      return `__PIPELINE_ERROR__|Unknown pipeline: "${pipelineName}". Available: ${pipelineNames.join(', ')}`;
    }

    const input = parts.slice(1).join(' ') || '';
    if (!input) {
      // Show pipeline info
      const lines: string[] = [`__PIPELINE_INFO__|${pipelineName}`];
      lines.push(`description|${pipeline.description || 'No description'}`);
      lines.push(`provider|${pipeline.provider || 'openai (default)'}`);
      lines.push(`steps|${pipeline.steps.length}`);
      for (const step of pipeline.steps) {
        const cond = step.condition ? ` (if ${step.condition})` : '';
        const modelOrRole = step.role ? `role:${step.role}` : step.model;
        lines.push(`step|${step.name}|${modelOrRole}|${step.output}${cond}`);
      }
      if (pipeline.result) {
        lines.push(`result|${pipeline.result}`);
      }
      lines.push('usage|/pipeline ' + pipelineName + ' <input>');
      lines.push('usage|/pipeline --provider anthropic ' + pipelineName + ' <input>');
      return lines.join('\n');
    }

    // Execute the pipeline with optional provider context
    const providerPart = providerContext ? `|provider:${providerContext}` : '';
    return `__PIPELINE_EXECUTE__|${pipelineName}${providerPart}|${input}`;
  },
};

/**
 * Register all model commands.
 */
export function registerModelCommands(): void {
  registerCommand(modelsCommand);
  registerCommand(switchCommand);
  registerCommand(modelMapCommand);
  registerCommand(pipelineCommand);
}
