/**
 * Pipeline Executor
 *
 * Executes multi-model pipelines with variable substitution.
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { BaseProvider } from '../providers/base.js';
import type {
  PipelineDefinition,
  PipelineStep,
  PipelineContext,
  PipelineResult,
  PipelineCallbacks,
  ProviderContext,
  IterativeCallbacks,
  IterativeOptions,
  IterativeResult,
  AggregationOptions,
} from './types.js';
import type { ModelRegistry } from './registry.js';
import type { TaskRouter } from './router.js';
import { logger } from '../logger.js';

/** Maximum file size for iterative processing (50KB) */
const MAX_FILE_SIZE = 50000;

/** Default batch size for batched aggregation */
const DEFAULT_BATCH_SIZE = 15;

// Re-export PipelineCallbacks from types for backwards compatibility
export type { PipelineCallbacks } from './types.js';

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
   * Execute a pipeline iteratively over multiple files.
   * Processes each file individually and aggregates results.
   * Supports batched aggregation to handle large file sets within token limits.
   *
   * @param pipeline - The pipeline definition
   * @param files - Array of file paths to process
   * @param options - Iterative execution options
   */
  async executeIterative(
    pipeline: PipelineDefinition,
    files: string[],
    options?: IterativeOptions
  ): Promise<IterativeResult> {
    const callbacks = options?.callbacks;
    const providerContext = options?.providerContext || pipeline.provider || 'openai';
    const batchSize = options?.aggregation?.batchSize ?? DEFAULT_BATCH_SIZE;
    const useBatching = batchSize > 0 && files.length > batchSize;

    const fileResults = new Map<string, PipelineResult>();
    const skippedFiles: Array<{ file: string; reason: string }> = [];
    const allModelsUsed = new Set<string>();
    const batchSummaries: string[] = [];
    let filesProcessed = 0;

    // Track current batch for batched aggregation
    let currentBatchFiles: string[] = [];
    let currentBatchResults = new Map<string, PipelineResult>();
    const totalBatches = useBatching ? Math.ceil(files.length / batchSize) : 1;

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      callbacks?.onFileStart?.(file, i, files.length);

      try {
        // Read file content
        const content = this.readFileContent(file);
        if (!content) {
          skippedFiles.push({ file, reason: 'File not found or empty' });
          continue;
        }

        // Format as single-file input
        const ext = extname(file).slice(1) || 'txt';
        const formattedInput = `### File: ${file}\n\`\`\`${ext}\n${content}\n\`\`\``;

        // Execute pipeline on this file
        const result = await this.execute(pipeline, formattedInput, {
          providerContext,
          callbacks: {
            onStepStart: callbacks?.onStepStart,
            onStepComplete: callbacks?.onStepComplete,
            onStepText: callbacks?.onStepText,
            onError: callbacks?.onError,
          },
        });

        fileResults.set(file, result);
        result.modelsUsed.forEach((m) => allModelsUsed.add(m));
        filesProcessed++;

        // Track for batch aggregation
        if (useBatching) {
          currentBatchFiles.push(file);
          currentBatchResults.set(file, result);
        }

        callbacks?.onFileComplete?.(file, result.output);

        // Check if we've completed a batch
        if (useBatching && currentBatchResults.size >= batchSize) {
          const batchIndex = batchSummaries.length;
          callbacks?.onBatchStart?.(batchIndex, totalBatches, currentBatchResults.size);

          try {
            const batchSummary = await this.aggregateBatch(
              currentBatchResults,
              batchIndex,
              totalBatches,
              providerContext,
              options?.aggregation,
              callbacks
            );
            batchSummaries.push(batchSummary);
            callbacks?.onBatchComplete?.(batchIndex, batchSummary);
          } catch (error) {
            logger.error(`Batch ${batchIndex + 1} aggregation failed:`, error instanceof Error ? error : new Error(String(error)));
            // Store concatenated results as fallback
            batchSummaries.push(this.formatConcatenatedResults(currentBatchResults));
          }

          // Reset batch tracking
          currentBatchFiles = [];
          currentBatchResults = new Map();
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        skippedFiles.push({ file, reason });
        logger.warn(`Skipped file ${file}: ${reason}`);
      }
    }

    // Handle remaining files in the last batch
    if (useBatching && currentBatchResults.size > 0) {
      const batchIndex = batchSummaries.length;
      callbacks?.onBatchStart?.(batchIndex, totalBatches, currentBatchResults.size);

      try {
        const batchSummary = await this.aggregateBatch(
          currentBatchResults,
          batchIndex,
          totalBatches,
          providerContext,
          options?.aggregation,
          callbacks
        );
        batchSummaries.push(batchSummary);
        callbacks?.onBatchComplete?.(batchIndex, batchSummary);
      } catch (error) {
        logger.error(`Batch ${batchIndex + 1} aggregation failed:`, error instanceof Error ? error : new Error(String(error)));
        batchSummaries.push(this.formatConcatenatedResults(currentBatchResults));
      }
    }

    // Aggregate results
    let aggregatedOutput: string | undefined;

    if (options?.aggregation?.enabled !== false && fileResults.size > 0) {
      callbacks?.onAggregationStart?.();

      try {
        if (useBatching && batchSummaries.length > 0) {
          // Meta-aggregate batch summaries
          callbacks?.onMetaAggregationStart?.(batchSummaries.length);
          aggregatedOutput = await this.metaAggregate(
            batchSummaries,
            filesProcessed,
            providerContext,
            options?.aggregation,
            callbacks
          );
        } else {
          // Standard aggregation for small file sets
          aggregatedOutput = await this.aggregateResults(
            fileResults,
            providerContext,
            options?.aggregation,
            callbacks
          );
        }
      } catch (error) {
        logger.error('Aggregation failed:', error instanceof Error ? error : new Error(String(error)));
        // Fall back to concatenated results or batch summaries
        aggregatedOutput = useBatching && batchSummaries.length > 0
          ? batchSummaries.join('\n\n---\n\n')
          : this.formatConcatenatedResults(fileResults);
      }
    } else if (fileResults.size > 0) {
      // No aggregation, just concatenate
      aggregatedOutput = this.formatConcatenatedResults(fileResults);
    }

    return {
      fileResults,
      aggregatedOutput,
      filesProcessed,
      totalFiles: files.length,
      modelsUsed: Array.from(allModelsUsed),
      skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
      batchSummaries: useBatching && batchSummaries.length > 0 ? batchSummaries : undefined,
    };
  }

  /**
   * Read file content with size checks.
   */
  private readFileContent(file: string): string | null {
    const cwd = process.cwd();
    const fullPath = file.startsWith('/') ? file : join(cwd, file);

    if (!existsSync(fullPath)) {
      return null;
    }

    const stat = statSync(fullPath);
    if (!stat.isFile()) {
      return null;
    }

    if (stat.size > MAX_FILE_SIZE) {
      logger.warn(`File ${file} too large (${(stat.size / 1024).toFixed(1)}KB), skipping`);
      return null;
    }

    return readFileSync(fullPath, 'utf-8');
  }

  /**
   * Aggregate results from multiple files using a model.
   * Used for small file sets that don't require batching.
   */
  private async aggregateResults(
    fileResults: Map<string, PipelineResult>,
    providerContext: ProviderContext,
    aggregationOpts?: AggregationOptions,
    callbacks?: IterativeCallbacks
  ): Promise<string> {
    const role = aggregationOpts?.role || 'capable';

    // Build aggregation prompt
    const resultsText = Array.from(fileResults.entries())
      .map(([file, result]) => `### ${file}\n${result.output}`)
      .join('\n\n---\n\n');

    const defaultPrompt = `You received code review results for ${fileResults.size} files.
Synthesize these findings into a consolidated report.

${resultsText}

Provide:
1. **Critical Issues** - Most important problems found (prioritized)
2. **Common Patterns** - Recurring issues or anti-patterns across files
3. **Top Recommendations** - 5 most impactful improvements
4. **Files Requiring Attention** - Which files need immediate work`;

    const prompt = aggregationOpts?.prompt
      ? aggregationOpts.prompt
          .replace('{results}', resultsText)
          .replace('{fileCount}', String(fileResults.size))
      : defaultPrompt;

    // Resolve the aggregation model
    const modelName = this.resolveAggregationModel(role, providerContext, fileResults);

    callbacks?.onStepStart?.('aggregate', modelName);

    const provider = this.registry.getProvider(modelName);
    let output = '';

    const response = await provider.streamChat(
      [{ role: 'user', content: prompt }],
      undefined,
      (text: string) => {
        output += text;
        callbacks?.onStepText?.('aggregate', text);
      }
    );

    const finalOutput = output || response.content;
    callbacks?.onStepComplete?.('aggregate', finalOutput);

    return finalOutput;
  }

  /**
   * Aggregate a single batch of results.
   */
  private async aggregateBatch(
    batchResults: Map<string, PipelineResult>,
    batchIndex: number,
    totalBatches: number,
    providerContext: ProviderContext,
    aggregationOpts?: AggregationOptions,
    callbacks?: IterativeCallbacks
  ): Promise<string> {
    const role = aggregationOpts?.role || 'capable';

    // Build batch aggregation prompt
    const resultsText = Array.from(batchResults.entries())
      .map(([file, result]) => `### ${file}\n${result.output}`)
      .join('\n\n---\n\n');

    const defaultBatchPrompt = `You are summarizing batch ${batchIndex + 1} of ${totalBatches} from a code review.
This batch contains ${batchResults.size} files.

${resultsText}

Provide a concise summary of this batch:
1. **Key Issues Found** - Most important problems in this batch
2. **Patterns** - Any recurring issues
3. **Files Needing Attention** - Which files have the most critical issues

Keep the summary focused and under 1000 words - this will be combined with other batch summaries.`;

    const prompt = aggregationOpts?.batchPrompt
      ? aggregationOpts.batchPrompt
          .replace('{results}', resultsText)
          .replace('{fileCount}', String(batchResults.size))
          .replace('{batchIndex}', String(batchIndex + 1))
          .replace('{totalBatches}', String(totalBatches))
      : defaultBatchPrompt;

    // Resolve the aggregation model
    const modelName = this.resolveAggregationModel(role, providerContext, batchResults);

    callbacks?.onStepStart?.(`batch-${batchIndex + 1}`, modelName);

    const provider = this.registry.getProvider(modelName);
    let output = '';

    const response = await provider.streamChat(
      [{ role: 'user', content: prompt }],
      undefined,
      (text: string) => {
        output += text;
        callbacks?.onStepText?.(`batch-${batchIndex + 1}`, text);
      }
    );

    const finalOutput = output || response.content;
    callbacks?.onStepComplete?.(`batch-${batchIndex + 1}`, finalOutput);

    return finalOutput;
  }

  /**
   * Meta-aggregate batch summaries into a final report.
   */
  private async metaAggregate(
    batchSummaries: string[],
    totalFilesProcessed: number,
    providerContext: ProviderContext,
    aggregationOpts?: AggregationOptions,
    callbacks?: IterativeCallbacks
  ): Promise<string> {
    const role = aggregationOpts?.role || 'capable';

    // Build meta-aggregation prompt
    const summariesText = batchSummaries
      .map((summary, i) => `## Batch ${i + 1} Summary\n\n${summary}`)
      .join('\n\n---\n\n');

    const defaultMetaPrompt = `You received ${batchSummaries.length} batch summaries from a code review of ${totalFilesProcessed} files.
Synthesize these batch summaries into a final consolidated report.

${summariesText}

Provide a comprehensive final report:
1. **Critical Issues** - Most important problems found across all batches (prioritized)
2. **Common Patterns** - Recurring issues or anti-patterns across the codebase
3. **Top Recommendations** - 5 most impactful improvements
4. **Files Requiring Immediate Attention** - Which files need immediate work
5. **Overall Assessment** - Brief summary of codebase health`;

    const prompt = aggregationOpts?.metaPrompt
      ? aggregationOpts.metaPrompt
          .replace('{summaries}', summariesText)
          .replace('{batchCount}', String(batchSummaries.length))
          .replace('{fileCount}', String(totalFilesProcessed))
      : defaultMetaPrompt;

    // Resolve the aggregation model
    const modelName = this.resolveAggregationModel(role, providerContext);

    callbacks?.onStepStart?.('meta-aggregate', modelName);

    const provider = this.registry.getProvider(modelName);
    let output = '';

    const response = await provider.streamChat(
      [{ role: 'user', content: prompt }],
      undefined,
      (text: string) => {
        output += text;
        callbacks?.onStepText?.('meta-aggregate', text);
      }
    );

    const finalOutput = output || response.content;
    callbacks?.onStepComplete?.('meta-aggregate', finalOutput);

    return finalOutput;
  }

  /**
   * Resolve the model to use for aggregation.
   */
  private resolveAggregationModel(
    role: string,
    providerContext: ProviderContext,
    fallbackResults?: Map<string, PipelineResult>
  ): string {
    if (this.router) {
      const resolved = this.router.resolveRole(role, providerContext);
      if (resolved) {
        return resolved.name;
      }
    }
    // Fallback to first available model from results
    if (fallbackResults) {
      return Array.from(fallbackResults.values())[0]?.modelsUsed[0] || 'default';
    }
    return 'default';
  }

  /**
   * Format results as concatenated output (fallback when aggregation disabled/fails).
   */
  private formatConcatenatedResults(fileResults: Map<string, PipelineResult>): string {
    const sections = Array.from(fileResults.entries()).map(
      ([file, result]) => `## ${file}\n\n${result.output}`
    );
    return sections.join('\n\n---\n\n');
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
