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
} from './types.js';
import type { ModelRegistry } from './registry.js';
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
 * Pipeline Executor for running multi-model workflows.
 *
 * Features:
 * - Sequential step execution
 * - Variable substitution between steps
 * - Conditional step execution (optional)
 * - Result aggregation
 */
export class PipelineExecutor {
  private registry: ModelRegistry;

  constructor(registry: ModelRegistry) {
    this.registry = registry;
  }

  /**
   * Execute a pipeline with the given input.
   */
  async execute(
    pipeline: PipelineDefinition,
    input: string,
    callbacks?: PipelineCallbacks
  ): Promise<PipelineResult> {
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

      callbacks?.onStepStart?.(step.name, step.model);

      try {
        const output = await this.executeStep(step, context, callbacks);

        // Store output in context
        context.variables[step.output] = output;
        stepOutputs[step.name] = output;

        if (!modelsUsed.includes(step.model)) {
          modelsUsed.push(step.model);
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
   * Execute a single pipeline step.
   */
  private async executeStep(
    step: PipelineStep,
    context: PipelineContext,
    callbacks?: PipelineCallbacks
  ): Promise<string> {
    const provider = this.registry.getProvider(step.model);
    const prompt = this.substituteVariables(step.prompt, context);

    logger.debug(`Pipeline step "${step.name}" using model "${step.model}"`);
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
export function createPipelineExecutor(registry: ModelRegistry): PipelineExecutor {
  return new PipelineExecutor(registry);
}
