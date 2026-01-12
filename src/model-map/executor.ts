/**
 * Pipeline Executor
 *
 * Executes multi-model pipelines with variable substitution.
 */

import type { BaseProvider } from '../providers/base.js';
import type {
  PipelineDefinition,
  PipelineStep,
  PipelineContext,
  PipelineResult,
  ProviderContext,
} from './types.js';
import type { ModelRegistry } from './registry.js';
import type { TaskRouter } from './router.js';
import { logger } from '../logger.js';

/**
 * Callback for pipeline step progress.
 */
export interface PipelineCallbacks {
  /** Called when a step starts */
  onStepStart?: (stepName: string, modelName: string) => void;
  /** Called when a step completes */
  onStepComplete?: (stepName: string, output: string) => void;
  /** Called when text is streamed from a step */
  onStepText?: (stepName: string, text: string) => void;
  /** Called on error */
  onError?: (stepName: string, error: Error) => void;
}

/**
 * Options for pipeline execution.
 */
export interface PipelineExecuteOptions {
  /** Provider context for role resolution (e.g., 'anthropic', 'openai', 'ollama-local') */
  providerContext?: ProviderContext;
  /** Callbacks for progress reporting */
  callbacks?: PipelineCallbacks;
}

/**
 * Pipeline Executor for running multi-model workflows.
 *
 * Features:
 * - Sequential step execution
 * - Variable substitution between steps
 * - Conditional step execution (optional)
 * - Result aggregation
 * - Role-based model resolution for provider-agnostic pipelines
 */
export class PipelineExecutor {
  private registry: ModelRegistry;
  private router?: TaskRouter;

  constructor(registry: ModelRegistry, router?: TaskRouter) {
    this.registry = registry;
    this.router = router;
  }

  /**
   * Set the router for role resolution.
   */
  setRouter(router: TaskRouter): void {
    this.router = router;
  }

  /**
   * Execute a pipeline with the given input.
   * @param pipeline - The pipeline definition
   * @param input - The input string
   * @param optionsOrCallbacks - Either PipelineExecuteOptions or legacy PipelineCallbacks
   */
  async execute(
    pipeline: PipelineDefinition,
    input: string,
    optionsOrCallbacks?: PipelineExecuteOptions | PipelineCallbacks
  ): Promise<PipelineResult> {
    // Handle legacy callback-only signature
    const options: PipelineExecuteOptions = optionsOrCallbacks && 'onStepStart' in optionsOrCallbacks
      ? { callbacks: optionsOrCallbacks }
      : (optionsOrCallbacks as PipelineExecuteOptions) || {};

    const { callbacks } = options;
    // Use provided context, pipeline default, or 'openai' as fallback
    const providerContext = options.providerContext || pipeline.provider || 'openai';

    const context: PipelineContext = {
      input,
      variables: { input },
    };

    const modelsUsed: string[] = [];
    const stepOutputs: Record<string, string> = {};

    for (const step of pipeline.steps) {
      // Check condition if specified
      if (step.condition && !this.evaluateCondition(step.condition, context)) {
        logger.verbose(`Skipping step "${step.name}" (condition not met)`);
        continue;
      }

      // Resolve the model name (from role or direct model reference)
      const modelName = this.resolveStepModel(step, providerContext);

      callbacks?.onStepStart?.(step.name, modelName);

      try {
        const output = await this.executeStep(step, modelName, context, callbacks);

        // Store output in context
        context.variables[step.output] = output;
        stepOutputs[step.name] = output;

        if (!modelsUsed.includes(modelName)) {
          modelsUsed.push(modelName);
        }

        callbacks?.onStepComplete?.(step.name, output);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        callbacks?.onError?.(step.name, err);
        throw err;
      }
    }

    // Generate final result
    const output = pipeline.result
      ? this.substituteVariables(pipeline.result, context)
      : context.variables[pipeline.steps[pipeline.steps.length - 1].output];

    return {
      output,
      steps: stepOutputs,
      modelsUsed,
    };
  }

  /**
   * Resolve a step's model name from either role or direct model reference.
   */
  private resolveStepModel(step: PipelineStep, providerContext: ProviderContext): string {
    // Direct model reference takes precedence
    if (step.model) {
      return step.model;
    }

    // Try to resolve role
    if (step.role && this.router) {
      const resolved = this.router.resolveRole(step.role, providerContext);
      if (resolved) {
        logger.debug(`Resolved role "${step.role}" to model "${resolved.name}" for provider "${providerContext}"`);
        return resolved.name;
      }
      logger.warn(`Failed to resolve role "${step.role}" for provider "${providerContext}", no fallback available`);
    }

    throw new Error(`Step "${step.name}" has no model and role could not be resolved`);
  }

  /**
   * Execute a single pipeline step.
   */
  private async executeStep(
    step: PipelineStep,
    modelName: string,
    context: PipelineContext,
    callbacks?: PipelineCallbacks
  ): Promise<string> {
    const provider = this.registry.getProvider(modelName);
    const prompt = this.substituteVariables(step.prompt, context);

    logger.debug(`Pipeline step "${step.name}" using model "${modelName}"`);
    logger.verbose(`Prompt: ${prompt.substring(0, 200)}...`);

    let output = '';

    // Use streaming for better UX
    const response = await provider.streamChat(
      [{ role: 'user', content: prompt }],
      undefined, // no tools
      (text: string) => {
        output += text;
        callbacks?.onStepText?.(step.name, text);
      }
    );

    // Use response content if no streaming output accumulated
    return output || response.content;
  }

  /**
   * Substitute variables in a template string.
   * Variables are in the format {varName}.
   */
  private substituteVariables(template: string, context: PipelineContext): string {
    return template.replace(/\{(\w+)\}/g, (match, varName) => {
      if (varName in context.variables) {
        return context.variables[varName];
      }
      // Leave unmatched variables as-is (will be caught by validation)
      return match;
    });
  }

  /**
   * Evaluate a condition expression.
   * Simple implementation - checks if a variable is truthy.
   * Future: Could support more complex expressions.
   */
  private evaluateCondition(condition: string, context: PipelineContext): boolean {
    // Simple variable check: "varName" or "!varName"
    const negated = condition.startsWith('!');
    const varName = negated ? condition.slice(1) : condition;

    const value = context.variables[varName];
    const result = !!value && value.trim().length > 0;

    return negated ? !result : result;
  }
}

/**
 * Create a pipeline executor.
 */
export function createPipelineExecutor(registry: ModelRegistry, router?: TaskRouter): PipelineExecutor {
  return new PipelineExecutor(registry, router);
}
