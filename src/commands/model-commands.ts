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
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim();

    // Handle help flag locally without API call
    if (trimmed === '-h' || trimmed === '--help') {
      console.log('\nUsage: /models [provider] [--local]');
      console.log('\nList available models for each provider.');
      console.log('\nOptions:');
      console.log('  provider    Filter by provider: anthropic, openai, ollama');
      console.log('  --local     Show only local Ollama models');
      console.log('\nExamples:');
      console.log('  /models              List all available models');
      console.log('  /models anthropic    List only Anthropic models');
      console.log('  /models --local      List only local Ollama models');
      console.log();
      return null;
    }

    const parts = trimmed.toLowerCase().split(/\s+/).filter(p => p);
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
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim();

    // Handle help flag locally without API call
    if (trimmed === '-h' || trimmed === '--help') {
      console.log('\nUsage: /switch <provider> [model]  or  /switch <model>');
      console.log('\nSwitch to a different model during a session.');
      console.log('\nExamples:');
      console.log('  /switch                      Show current model and available providers');
      console.log('  /switch openai gpt-4o        Switch to OpenAI GPT-4o');
      console.log('  /switch anthropic            Switch to Anthropic (default model)');
      console.log('  /switch claude-3-5-haiku     Switch model within current provider');
      console.log('  /switch ollama llama3.2      Switch to local Ollama model');
      console.log();
      return null;
    }

    const parts = trimmed.split(/\s+/).filter(p => p);

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
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim().toLowerCase();

    // Handle help flag locally without API call
    if (trimmed === '-h' || trimmed === '--help') {
      console.log('\nUsage: /modelmap [init|show|example]');
      console.log('\nShow and manage model map configuration (codi-models.yaml).');
      console.log('\nActions:');
      console.log('  show      Show current model map configuration (default)');
      console.log('  init      Create a new codi-models.yaml file');
      console.log('  example   Show example configuration');
      console.log('\nExamples:');
      console.log('  /modelmap          Show current configuration');
      console.log('  /modelmap init     Create codi-models.yaml');
      console.log('  /modelmap example  Show example YAML');
      console.log();
      return null;
    }

    const action = trimmed || 'show';

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
  usage: '/pipeline [--provider <context>] [--all] [--v2] [--v3] [--v4] [--triage] [--concurrency N] [name] [input]',
  taskType: 'complex',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim();

    // Handle help flag locally without API call
    if (trimmed === '-h' || trimmed === '--help') {
      console.log('\nUsage: /pipeline [options] [name] [input]');
      console.log('\nExecute a multi-model pipeline defined in codi-models.yaml.');
      console.log('\nOptions:');
      console.log('  --provider <ctx>   Use models from specified provider context');
      console.log('  --all, --iterative Process all files in iterative mode');
      console.log('  --v2               Use intelligent grouping + parallel processing');
      console.log('  --v3               Use triage + adaptive processing + agentic steps');
      console.log('  --v4               Use symbolication + enhanced triage');
      console.log('  --triage           Enable file triage scoring');
      console.log('  --triage-only      Show triage scores without running pipeline');
      console.log('  --concurrency N    Set parallel processing concurrency (default: 4)');
      console.log('\nExamples:');
      console.log('  /pipeline                        List available pipelines');
      console.log('  /pipeline code-review            Show pipeline info');
      console.log('  /pipeline code-review src/       Execute pipeline on src/');
      console.log('  /pipeline --provider anthropic code-review src/');
      console.log();
      return null;
    }

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

    // Parse flags
    let providerContext: string | undefined;
    let iterativeMode = false;
    let useV2 = false;
    let useV3 = false;
    let useV4 = false;
    let useTriage = false;
    let triageOnly = false;
    let concurrency = 4;
    let remainingArgs = args.trim();

    // Parse all flags (can appear in any order)
    let foundFlag = true;
    while (foundFlag) {
      foundFlag = false;

      // Parse --provider flag
      const providerMatch = remainingArgs.match(/^--provider\s+(\S+)\s*/);
      if (providerMatch) {
        providerContext = providerMatch[1];
        remainingArgs = remainingArgs.slice(providerMatch[0].length);
        foundFlag = true;
        continue;
      }

      // Parse --all or --iterative flag
      const allMatch = remainingArgs.match(/^(--all|--iterative)\s*/);
      if (allMatch) {
        iterativeMode = true;
        remainingArgs = remainingArgs.slice(allMatch[0].length);
        foundFlag = true;
        continue;
      }

      // Parse --v2 flag (use intelligent grouping + parallel processing)
      const v2Match = remainingArgs.match(/^--v2\s*/);
      if (v2Match) {
        useV2 = true;
        iterativeMode = true; // V2 implies iterative mode
        remainingArgs = remainingArgs.slice(v2Match[0].length);
        foundFlag = true;
        continue;
      }

      // Parse --v3 flag (triage + adaptive processing + agentic steps)
      const v3Match = remainingArgs.match(/^--v3\s*/);
      if (v3Match) {
        useV3 = true;
        iterativeMode = true; // V3 implies iterative mode
        remainingArgs = remainingArgs.slice(v3Match[0].length);
        foundFlag = true;
        continue;
      }

      // Parse --v4 flag (symbolication + enhanced triage + contextual processing)
      const v4Match = remainingArgs.match(/^--v4\s*/);
      if (v4Match) {
        useV4 = true;
        iterativeMode = true; // V4 implies iterative mode
        remainingArgs = remainingArgs.slice(v4Match[0].length);
        foundFlag = true;
        continue;
      }

      // Parse --triage flag (enable triage, works with V2 or V3)
      const triageMatch = remainingArgs.match(/^--triage\s*/);
      if (triageMatch) {
        useTriage = true;
        remainingArgs = remainingArgs.slice(triageMatch[0].length);
        foundFlag = true;
        continue;
      }

      // Parse --triage-only flag (show triage scores without running pipeline)
      const triageOnlyMatch = remainingArgs.match(/^--triage-only\s*/);
      if (triageOnlyMatch) {
        triageOnly = true;
        useTriage = true;
        remainingArgs = remainingArgs.slice(triageOnlyMatch[0].length);
        foundFlag = true;
        continue;
      }

      // Parse --concurrency flag
      const concurrencyMatch = remainingArgs.match(/^--concurrency\s+(\d+)\s*/);
      if (concurrencyMatch) {
        concurrency = parseInt(concurrencyMatch[1], 10);
        remainingArgs = remainingArgs.slice(concurrencyMatch[0].length);
        foundFlag = true;
        continue;
      }
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

    // Execute the pipeline with optional provider context and iterative mode
    const providerPart = providerContext ? `|provider:${providerContext}` : '';
    const iterativePart = iterativeMode ? '|iterative:true' : '';
    const v2Part = useV2 ? '|v2:true' : '';
    const v3Part = useV3 ? '|v3:true' : '';
    const v4Part = useV4 ? '|v4:true' : '';
    const triagePart = useTriage ? '|triage:true' : '';
    const triageOnlyPart = triageOnly ? '|triageOnly:true' : '';
    const concurrencyPart = concurrency !== 4 ? `|concurrency:${concurrency}` : '';
    return `__PIPELINE_EXECUTE__|${pipelineName}${providerPart}${iterativePart}${v2Part}${v3Part}${v4Part}${triagePart}${triageOnlyPart}${concurrencyPart}|${input}`;
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
