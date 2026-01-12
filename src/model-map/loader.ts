/**
 * Model Map Loader
 *
 * Loads and validates codi-models.yaml configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type {
  ModelMapConfig,
  ModelDefinition,
  TaskDefinition,
  CommandConfig,
  PipelineDefinition,
  PipelineStep,
} from './types.js';

/** Config file name */
const MODEL_MAP_FILE = 'codi-models.yaml';

/** Alternative config file name */
const MODEL_MAP_FILE_ALT = 'codi-models.yml';

/**
 * Validation error for model map configuration.
 */
export class ModelMapValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = 'ModelMapValidationError';
  }
}

/**
 * Validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ModelMapValidationError[];
  warnings: string[];
}

/**
 * Load model map configuration from a directory.
 * Searches for codi-models.yaml or codi-models.yml
 */
export function loadModelMap(cwd: string = process.cwd()): {
  config: ModelMapConfig | null;
  configPath: string | null;
  error?: string;
} {
  // Try primary name first
  let configPath = path.join(cwd, MODEL_MAP_FILE);
  if (!fs.existsSync(configPath)) {
    // Try alternative name
    configPath = path.join(cwd, MODEL_MAP_FILE_ALT);
    if (!fs.existsSync(configPath)) {
      return { config: null, configPath: null };
    }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(content) as ModelMapConfig;

    // Set defaults
    if (!config.version) config.version = '1';
    if (!config.models) config.models = {};
    if (!config.tasks) config.tasks = {};
    if (!config.commands) config.commands = {};
    if (!config.fallbacks) config.fallbacks = {};
    if (!config.pipelines) config.pipelines = {};

    return { config, configPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: null, configPath, error: `Failed to parse ${configPath}: ${message}` };
  }
}

/**
 * Validate model map configuration.
 */
export function validateModelMap(config: ModelMapConfig): ValidationResult {
  const errors: ModelMapValidationError[] = [];
  const warnings: string[] = [];

  // Validate version
  if (!config.version) {
    warnings.push('No version specified, assuming version "1"');
  }

  // Validate models section
  if (!config.models || Object.keys(config.models).length === 0) {
    errors.push(new ModelMapValidationError('At least one model must be defined', 'models'));
  } else {
    for (const [name, model] of Object.entries(config.models)) {
      if (!model.provider) {
        errors.push(new ModelMapValidationError(`Model "${name}" is missing provider`, `models.${name}.provider`));
      }
      if (!model.model) {
        errors.push(new ModelMapValidationError(`Model "${name}" is missing model name`, `models.${name}.model`));
      }
      if (model.temperature !== undefined && (model.temperature < 0 || model.temperature > 1)) {
        warnings.push(`Model "${name}" has temperature outside 0-1 range: ${model.temperature}`);
      }
    }
  }

  // Validate tasks section - ensure referenced models exist
  if (config.tasks) {
    for (const [name, task] of Object.entries(config.tasks)) {
      if (!task.model) {
        errors.push(new ModelMapValidationError(`Task "${name}" is missing model reference`, `tasks.${name}.model`));
      } else if (!config.models[task.model]) {
        errors.push(
          new ModelMapValidationError(
            `Task "${name}" references unknown model "${task.model}"`,
            `tasks.${name}.model`
          )
        );
      }
    }
  }

  // Validate commands section
  if (config.commands) {
    for (const [name, cmd] of Object.entries(config.commands)) {
      // Each command must have exactly one of: model, task, or pipeline
      const hasModel = !!cmd.model;
      const hasTask = !!cmd.task;
      const hasPipeline = !!cmd.pipeline;
      const count = [hasModel, hasTask, hasPipeline].filter(Boolean).length;

      if (count === 0) {
        errors.push(
          new ModelMapValidationError(
            `Command "${name}" must specify model, task, or pipeline`,
            `commands.${name}`
          )
        );
      } else if (count > 1) {
        warnings.push(`Command "${name}" has multiple routing options; only one will be used`);
      }

      // Validate references
      if (cmd.model && !config.models[cmd.model]) {
        errors.push(
          new ModelMapValidationError(
            `Command "${name}" references unknown model "${cmd.model}"`,
            `commands.${name}.model`
          )
        );
      }
      if (cmd.task && config.tasks && !config.tasks[cmd.task]) {
        errors.push(
          new ModelMapValidationError(
            `Command "${name}" references unknown task "${cmd.task}"`,
            `commands.${name}.task`
          )
        );
      }
      if (cmd.pipeline && config.pipelines && !config.pipelines[cmd.pipeline]) {
        errors.push(
          new ModelMapValidationError(
            `Command "${name}" references unknown pipeline "${cmd.pipeline}"`,
            `commands.${name}.pipeline`
          )
        );
      }
    }
  }

  // Validate fallbacks section
  if (config.fallbacks) {
    for (const [name, chain] of Object.entries(config.fallbacks)) {
      if (!Array.isArray(chain) || chain.length === 0) {
        errors.push(
          new ModelMapValidationError(
            `Fallback chain "${name}" must be a non-empty array`,
            `fallbacks.${name}`
          )
        );
        continue;
      }
      for (const modelName of chain) {
        if (!config.models[modelName]) {
          errors.push(
            new ModelMapValidationError(
              `Fallback chain "${name}" references unknown model "${modelName}"`,
              `fallbacks.${name}`
            )
          );
        }
      }
    }
  }

  // Validate pipelines section
  if (config.pipelines) {
    for (const [name, pipeline] of Object.entries(config.pipelines)) {
      if (!pipeline.steps || pipeline.steps.length === 0) {
        errors.push(
          new ModelMapValidationError(
            `Pipeline "${name}" must have at least one step`,
            `pipelines.${name}.steps`
          )
        );
        continue;
      }

      const outputs = new Set<string>(['input']); // 'input' is always available

      for (let i = 0; i < pipeline.steps.length; i++) {
        const step = pipeline.steps[i];

        if (!step.name) {
          errors.push(
            new ModelMapValidationError(
              `Pipeline "${name}" step ${i + 1} is missing name`,
              `pipelines.${name}.steps[${i}].name`
            )
          );
        }

        if (!step.model) {
          errors.push(
            new ModelMapValidationError(
              `Pipeline "${name}" step "${step.name || i + 1}" is missing model`,
              `pipelines.${name}.steps[${i}].model`
            )
          );
        } else if (!config.models[step.model]) {
          errors.push(
            new ModelMapValidationError(
              `Pipeline "${name}" step "${step.name || i + 1}" references unknown model "${step.model}"`,
              `pipelines.${name}.steps[${i}].model`
            )
          );
        }

        if (!step.prompt) {
          errors.push(
            new ModelMapValidationError(
              `Pipeline "${name}" step "${step.name || i + 1}" is missing prompt`,
              `pipelines.${name}.steps[${i}].prompt`
            )
          );
        } else {
          // Check for undefined variable references
          const varRefs = step.prompt.match(/\{(\w+)\}/g) || [];
          for (const ref of varRefs) {
            const varName = ref.slice(1, -1);
            if (!outputs.has(varName)) {
              warnings.push(
                `Pipeline "${name}" step "${step.name}" references variable "${varName}" not yet defined`
              );
            }
          }
        }

        if (!step.output) {
          errors.push(
            new ModelMapValidationError(
              `Pipeline "${name}" step "${step.name || i + 1}" is missing output name`,
              `pipelines.${name}.steps[${i}].output`
            )
          );
        } else {
          outputs.add(step.output);
        }
      }

      // Check result template variable references
      if (pipeline.result) {
        const varRefs = pipeline.result.match(/\{(\w+)\}/g) || [];
        for (const ref of varRefs) {
          const varName = ref.slice(1, -1);
          if (!outputs.has(varName)) {
            errors.push(
              new ModelMapValidationError(
                `Pipeline "${name}" result references undefined variable "${varName}"`,
                `pipelines.${name}.result`
              )
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Watch model map file for changes.
 * Returns a function to stop watching.
 */
export function watchModelMap(
  cwd: string,
  onChange: (config: ModelMapConfig | null, error?: string) => void
): () => void {
  let configPath = path.join(cwd, MODEL_MAP_FILE);
  if (!fs.existsSync(configPath)) {
    configPath = path.join(cwd, MODEL_MAP_FILE_ALT);
    if (!fs.existsSync(configPath)) {
      return () => {}; // No file to watch
    }
  }

  const watcher = fs.watch(configPath, (eventType) => {
    if (eventType === 'change') {
      const result = loadModelMap(cwd);
      if (result.error) {
        onChange(null, result.error);
      } else {
        onChange(result.config);
      }
    }
  });

  return () => watcher.close();
}

/**
 * Create an example model map configuration.
 */
export function getExampleModelMap(): string {
  const example: ModelMapConfig = {
    version: '1',
    models: {
      haiku: {
        provider: 'anthropic',
        model: 'claude-3-5-haiku-latest',
        description: 'Fast, cheap model for quick tasks',
      },
      sonnet: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        description: 'Balanced model for coding tasks',
      },
      opus: {
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        description: 'Most capable for complex reasoning',
      },
      local: {
        provider: 'ollama',
        model: 'llama3.2',
        description: 'Free local model',
      },
    },
    tasks: {
      fast: {
        model: 'haiku',
        description: 'Quick tasks (commits, summaries)',
      },
      code: {
        model: 'sonnet',
        description: 'Standard coding tasks',
      },
      complex: {
        model: 'opus',
        description: 'Architecture, debugging',
      },
      summarize: {
        model: 'local',
        description: 'Context summarization',
      },
    },
    commands: {
      commit: { task: 'fast' },
      fix: { task: 'complex' },
    },
    fallbacks: {
      primary: ['sonnet', 'haiku', 'local'],
    },
    pipelines: {
      'smart-refactor': {
        description: 'Analyze, plan, implement, review',
        steps: [
          {
            name: 'analyze',
            model: 'haiku',
            prompt: 'Analyze refactoring opportunities: {input}',
            output: 'analysis',
          },
          {
            name: 'plan',
            model: 'sonnet',
            prompt: 'Create refactoring plan based on: {analysis}',
            output: 'plan',
          },
          {
            name: 'implement',
            model: 'sonnet',
            prompt: 'Implement the plan: {plan}',
            output: 'implementation',
          },
          {
            name: 'review',
            model: 'haiku',
            prompt: 'Quick review: {implementation}',
            output: 'review',
          },
        ],
        result: '{implementation}\n\n## Review\n{review}',
      },
    },
  };

  return yaml.dump(example, { lineWidth: 100, noRefs: true });
}

/**
 * Initialize a new codi-models.yaml file.
 */
export function initModelMap(cwd: string = process.cwd()): {
  success: boolean;
  path: string;
  error?: string;
} {
  const configPath = path.join(cwd, MODEL_MAP_FILE);

  if (fs.existsSync(configPath)) {
    return {
      success: false,
      path: configPath,
      error: 'Model map file already exists',
    };
  }

  // Also check alternate name
  const altPath = path.join(cwd, MODEL_MAP_FILE_ALT);
  if (fs.existsSync(altPath)) {
    return {
      success: false,
      path: altPath,
      error: 'Model map file already exists',
    };
  }

  try {
    fs.writeFileSync(configPath, getExampleModelMap());
    return { success: true, path: configPath };
  } catch (error) {
    return {
      success: false,
      path: configPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
