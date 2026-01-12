/**
 * Task Router
 *
 * Routes tasks and commands to appropriate models.
 */

import type { BaseProvider } from '../providers/base.js';
import type {
  ModelMapConfig,
  TaskType,
  ResolvedModel,
  CommandConfig,
  PipelineDefinition,
  ProviderContext,
} from './types.js';
import { DEFAULT_COMMAND_TASKS } from './types.js';
import type { ModelRegistry } from './registry.js';

/**
 * Routing result - either a model or a pipeline.
 */
export type RoutingResult =
  | { type: 'model'; model: ResolvedModel }
  | { type: 'pipeline'; pipeline: PipelineDefinition; pipelineName: string };

/**
 * Task Router for determining which model handles what.
 *
 * Routing priority:
 * 1. Command-level override (from config)
 * 2. Task category (from config or default)
 * 3. Primary fallback chain
 */
export class TaskRouter {
  private config: ModelMapConfig;
  private registry: ModelRegistry;

  constructor(config: ModelMapConfig, registry: ModelRegistry) {
    this.config = config;
    this.registry = registry;
  }

  /**
   * Route a command to its designated model or pipeline.
   */
  routeCommand(commandName: string): RoutingResult {
    // 1. Check for command-level override
    const commandConfig = this.config.commands?.[commandName];
    if (commandConfig) {
      return this.resolveCommandConfig(commandName, commandConfig);
    }

    // 2. Check for default task assignment
    const defaultTask = DEFAULT_COMMAND_TASKS[commandName];
    if (defaultTask) {
      return this.routeTask(defaultTask);
    }

    // 3. Use 'code' task as fallback (most common)
    if (this.config.tasks?.code) {
      return this.routeTask('code');
    }

    // 4. Use primary fallback chain
    return this.getDefaultModel();
  }

  /**
   * Route a task category to its designated model.
   */
  routeTask(taskType: TaskType): RoutingResult {
    const taskDef = this.config.tasks?.[taskType];
    if (!taskDef) {
      // Task not defined, use primary fallback
      return this.getDefaultModel();
    }

    const model = this.registry.resolveModel(taskDef.model);
    return { type: 'model', model };
  }

  /**
   * Get a model for summarization tasks.
   */
  getSummarizeModel(): ResolvedModel {
    // Check for summarize task
    const summarizeTask = this.config.tasks?.summarize;
    if (summarizeTask) {
      return this.registry.resolveModel(summarizeTask.model);
    }

    // Check for 'fast' task as alternative
    const fastTask = this.config.tasks?.fast;
    if (fastTask) {
      return this.registry.resolveModel(fastTask.model);
    }

    // Use first model in primary fallback
    const primaryChain = this.config.fallbacks?.primary;
    if (primaryChain && primaryChain.length > 0) {
      return this.registry.resolveModel(primaryChain[0]);
    }

    // Use first defined model
    const modelNames = Object.keys(this.config.models);
    if (modelNames.length === 0) {
      throw new Error('No models defined in configuration');
    }
    return this.registry.resolveModel(modelNames[0]);
  }

  /**
   * Get the primary model (first in fallback chain or first defined).
   */
  getPrimaryModel(): ResolvedModel {
    const result = this.getDefaultModel();
    if (result.type === 'model') {
      return result.model;
    }
    throw new Error('Primary model returned a pipeline unexpectedly');
  }

  /**
   * Get a pipeline by name.
   */
  getPipeline(name: string): PipelineDefinition | undefined {
    return this.config.pipelines?.[name];
  }

  /**
   * Get all pipeline names.
   */
  getPipelineNames(): string[] {
    return Object.keys(this.config.pipelines || {});
  }

  /**
   * Check if a command has a pipeline override.
   */
  commandHasPipeline(commandName: string): boolean {
    const commandConfig = this.config.commands?.[commandName];
    return !!commandConfig?.pipeline;
  }

  /**
   * Get task type for a command.
   */
  getCommandTask(commandName: string): TaskType | undefined {
    // Check command config first
    const commandConfig = this.config.commands?.[commandName];
    if (commandConfig?.task) {
      return commandConfig.task;
    }

    // Check defaults
    return DEFAULT_COMMAND_TASKS[commandName];
  }

  /**
   * Resolve a role to a model name based on provider context.
   * @param role - The role name (e.g., 'fast', 'capable', 'reasoning')
   * @param providerContext - The provider context (e.g., 'anthropic', 'openai', 'ollama-local')
   * @returns The resolved model or undefined if not found
   */
  resolveRole(role: string, providerContext: ProviderContext): ResolvedModel | undefined {
    const roles = this.config['model-roles'];
    if (!roles) {
      return undefined;
    }

    const roleMapping = roles[role];
    if (!roleMapping) {
      return undefined;
    }

    const modelName = roleMapping[providerContext];
    if (!modelName) {
      return undefined;
    }

    try {
      return this.registry.resolveModel(modelName);
    } catch {
      return undefined;
    }
  }

  /**
   * Get available provider contexts for a role.
   * @param role - The role name
   * @returns Array of available provider contexts
   */
  getRoleProviders(role: string): ProviderContext[] {
    const roles = this.config['model-roles'];
    if (!roles || !roles[role]) {
      return [];
    }
    return Object.keys(roles[role]) as ProviderContext[];
  }

  /**
   * Get all defined roles.
   */
  getRoles(): string[] {
    return Object.keys(this.config['model-roles'] || {});
  }

  /**
   * Update configuration (for hot-reload).
   */
  updateConfig(config: ModelMapConfig): void {
    this.config = config;
  }

  // --- Private methods ---

  private resolveCommandConfig(
    commandName: string,
    config: CommandConfig
  ): RoutingResult {
    // Pipeline takes precedence
    if (config.pipeline) {
      const pipeline = this.config.pipelines?.[config.pipeline];
      if (pipeline) {
        return { type: 'pipeline', pipeline, pipelineName: config.pipeline };
      }
      throw new Error(
        `Command "${commandName}" references unknown pipeline "${config.pipeline}"`
      );
    }

    // Task reference
    if (config.task) {
      return this.routeTask(config.task);
    }

    // Direct model reference
    if (config.model) {
      const model = this.registry.resolveModel(config.model);
      return { type: 'model', model };
    }

    // Fallback
    return this.getDefaultModel();
  }

  private getDefaultModel(): RoutingResult {
    // Try primary fallback chain
    const primaryChain = this.config.fallbacks?.primary;
    if (primaryChain && primaryChain.length > 0) {
      const model = this.registry.resolveModel(primaryChain[0]);
      return { type: 'model', model };
    }

    // Use first defined model
    const modelNames = Object.keys(this.config.models);
    if (modelNames.length === 0) {
      throw new Error('No models defined in configuration');
    }

    const model = this.registry.resolveModel(modelNames[0]);
    return { type: 'model', model };
  }
}

/**
 * Create a task router from configuration and registry.
 */
export function createTaskRouter(
  config: ModelMapConfig,
  registry: ModelRegistry
): TaskRouter {
  return new TaskRouter(config, registry);
}
