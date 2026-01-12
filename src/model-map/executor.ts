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
  FileGroup,
  GroupingOptions,
  V3Options,
  V3Callbacks,
  TriageResult,
} from './types.js';
import type { ToolDefinition, Message, ContentBlock } from '../types.js';
import { triageFiles, getSuggestedModel } from './triage.js';
import { globalRegistry } from '../tools/index.js';
import { groupFiles, processInParallel } from './grouping.js';
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
  /** Override model role for this execution (from triage suggestion) */
  modelOverride?: string;
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

      // Resolve the model name (from role or direct model reference, with optional override)
      const modelName = this.resolveStepModel(step, providerContext, options.modelOverride);

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
   * Execute a pipeline iteratively with intelligent grouping and parallel processing.
   *
   * This is an improved version that:
   * 1. Groups files by directory hierarchy or AI classification
   * 2. Processes files in parallel within groups
   * 3. Aggregates per-group, then meta-aggregates groups
   *
   * @param pipeline - The pipeline definition
   * @param files - Array of file paths to process
   * @param options - Iterative execution options
   */
  async executeIterativeV2(
    pipeline: PipelineDefinition,
    files: string[],
    options?: IterativeOptions
  ): Promise<IterativeResult> {
    const startTime = Date.now();
    const callbacks = options?.callbacks;
    const providerContext = options?.providerContext || pipeline.provider || 'openai';
    const concurrency = options?.concurrency ?? 4;

    const fileResults = new Map<string, PipelineResult>();
    const skippedFiles: Array<{ file: string; reason: string }> = [];
    const allModelsUsed = new Set<string>();
    const groupSummaries = new Map<string, string>();
    let filesProcessed = 0;

    // Phase 1: Group files intelligently
    callbacks?.onGroupingStart?.(files.length);
    const groupingStartTime = Date.now();

    const groupingOptions: GroupingOptions = options?.grouping ?? {
      strategy: 'hierarchy',
      maxGroupSize: 15,
    };

    const groupingResult = await groupFiles(
      files,
      groupingOptions,
      this.registry,
      this.router
    );

    const groups = groupingResult.groups;
    const groupingTime = Date.now() - groupingStartTime;
    callbacks?.onGroupingComplete?.(groups);

    logger.info(`Grouped ${files.length} files into ${groups.length} groups in ${groupingTime}ms`);

    // Phase 2: Process each group (with parallel file processing within groups)
    const processingStartTime = Date.now();

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      callbacks?.onGroupStart?.(group, groupIndex, groups.length);

      // Process files in this group in parallel
      const groupResults = await processInParallel(
        group.files,
        async (file, fileIndex) => {
          const globalIndex = files.indexOf(file);
          callbacks?.onFileStart?.(file, globalIndex, files.length);

          try {
            const content = this.readFileContent(file);
            if (!content) {
              skippedFiles.push({ file, reason: 'File not found or empty' });
              return null;
            }

            const ext = extname(file).slice(1) || 'txt';
            const formattedInput = `### File: ${file}\n\`\`\`${ext}\n${content}\n\`\`\``;

            const result = await this.execute(pipeline, formattedInput, {
              providerContext,
              callbacks: {
                onStepStart: callbacks?.onStepStart,
                onStepComplete: callbacks?.onStepComplete,
                onStepText: callbacks?.onStepText,
                onError: callbacks?.onError,
              },
            });

            callbacks?.onFileComplete?.(file, result.output);
            return { file, result };
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            skippedFiles.push({ file, reason });
            logger.warn(`Skipped file ${file}: ${reason}`);
            return null;
          }
        },
        concurrency
      );

      // Collect results from this group
      const groupFileResults = new Map<string, PipelineResult>();
      for (const item of groupResults) {
        if (item) {
          fileResults.set(item.file, item.result);
          groupFileResults.set(item.file, item.result);
          item.result.modelsUsed.forEach(m => allModelsUsed.add(m));
          filesProcessed++;
        }
      }

      // Aggregate this group's results
      if (groupFileResults.size > 0 && options?.aggregation?.enabled !== false) {
        try {
          const groupSummary = await this.aggregateGroup(
            group,
            groupFileResults,
            groupIndex,
            groups.length,
            providerContext,
            options?.aggregation,
            callbacks
          );
          groupSummaries.set(group.name, groupSummary);
          callbacks?.onGroupComplete?.(group, groupSummary);
        } catch (error) {
          logger.error(`Group ${group.name} aggregation failed:`, error instanceof Error ? error : new Error(String(error)));
          groupSummaries.set(group.name, this.formatConcatenatedResults(groupFileResults));
        }
      }
    }

    const processingTime = Date.now() - processingStartTime;

    // Phase 3: Meta-aggregate group summaries
    let aggregatedOutput: string | undefined;
    let aggregationTime = 0;

    if (options?.aggregation?.enabled !== false && groupSummaries.size > 0) {
      callbacks?.onAggregationStart?.();
      const aggStartTime = Date.now();

      try {
        callbacks?.onMetaAggregationStart?.(groupSummaries.size);
        aggregatedOutput = await this.metaAggregateGroups(
          groups,
          groupSummaries,
          filesProcessed,
          providerContext,
          options?.aggregation,
          callbacks
        );
      } catch (error) {
        logger.error('Meta-aggregation failed:', error instanceof Error ? error : new Error(String(error)));
        // Fall back to concatenated group summaries
        aggregatedOutput = Array.from(groupSummaries.entries())
          .map(([name, summary]) => `## ${name}\n\n${summary}`)
          .join('\n\n---\n\n');
      }

      aggregationTime = Date.now() - aggStartTime;
    } else if (fileResults.size > 0) {
      aggregatedOutput = this.formatConcatenatedResults(fileResults);
    }

    const totalTime = Date.now() - startTime;

    return {
      fileResults,
      aggregatedOutput,
      filesProcessed,
      totalFiles: files.length,
      modelsUsed: Array.from(allModelsUsed),
      skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
      groups,
      groupSummaries,
      timing: {
        total: totalTime,
        grouping: groupingTime,
        processing: processingTime,
        aggregation: aggregationTime,
      },
    };
  }

  /**
   * Execute a pipeline iteratively with intelligent triage and adaptive processing (V3).
   *
   * This version adds:
   * 1. Fast model triage to score files by risk/complexity/importance
   * 2. Adaptive processing based on triage scores (deep/normal/quick)
   * 3. Dynamic model selection per file based on triage suggestions
   * 4. Agentic steps with tool access for critical files
   *
   * @param pipeline - The pipeline definition
   * @param files - Array of file paths to process
   * @param options - V3 execution options
   */
  async executeIterativeV3(
    pipeline: PipelineDefinition,
    files: string[],
    options?: V3Options
  ): Promise<IterativeResult> {
    const startTime = Date.now();
    const callbacks = options?.callbacks;
    const providerContext = options?.providerContext || pipeline.provider || 'openai';
    const concurrency = options?.concurrency ?? 4;
    const enableTriage = options?.enableTriage !== false;

    const fileResults = new Map<string, PipelineResult>();
    const skippedFiles: Array<{ file: string; reason: string }> = [];
    const allModelsUsed = new Set<string>();
    let filesProcessed = 0;

    // Phase 1: Triage (if enabled)
    let triageResult: TriageResult | undefined;
    let triageTime = 0;

    if (enableTriage && files.length > 1 && this.router) {
      callbacks?.onTriageStart?.(files.length);
      const triageStartTime = Date.now();

      try {
        triageResult = await triageFiles(
          files,
          this.registry,
          this.router,
          {
            role: options?.triage?.role || 'fast',
            criteria: options?.triage?.criteria,
            deepThreshold: options?.triage?.deepThreshold,
            skipThreshold: options?.triage?.skipThreshold,
            providerContext,
          }
        );
        triageTime = Date.now() - triageStartTime;
        callbacks?.onTriageComplete?.(triageResult);

        logger.info(`Triage: ${triageResult.criticalPaths.length} critical, ${triageResult.normalPaths.length} normal, ${triageResult.skipPaths.length} skip (${triageTime}ms)`);
      } catch (error) {
        logger.warn(`Triage failed: ${error}, proceeding without triage`);
      }
    }

    // Build model override map from triage results
    const modelOverrides = new Map<string, string>();
    if (triageResult) {
      for (const score of triageResult.scores) {
        if (score.suggestedModel) {
          modelOverrides.set(score.file, score.suggestedModel);
        }
      }
    }

    // Merge with provided overrides
    if (options?.modelOverrides) {
      for (const [file, role] of options.modelOverrides) {
        modelOverrides.set(file, role);
      }
    }

    // Phase 2: Adaptive Processing
    const processingStartTime = Date.now();

    // Categorize files based on triage
    const criticalFiles = triageResult?.criticalPaths || [];
    const normalFiles = triageResult?.normalPaths || files.filter(f => !criticalFiles.includes(f));
    const skipFiles = triageResult?.skipPaths || [];

    // Process file with appropriate depth
    const processFile = async (
      file: string,
      depth: 'deep' | 'normal' | 'quick'
    ): Promise<{ file: string; result: PipelineResult } | null> => {
      const globalIndex = files.indexOf(file);
      callbacks?.onFileStart?.(file, globalIndex, files.length);

      try {
        const content = this.readFileContent(file);
        if (!content) {
          skippedFiles.push({ file, reason: 'File not found or empty' });
          return null;
        }

        const ext = extname(file).slice(1) || 'txt';
        const formattedInput = `### File: ${file}\n\`\`\`${ext}\n${content}\n\`\`\``;

        // Get model override for this file
        const modelOverride = modelOverrides.get(file);

        let result: PipelineResult;

        if (depth === 'quick') {
          // Quick scan: use fast model, minimal processing
          result = await this.execute(pipeline, formattedInput, {
            providerContext,
            modelOverride: modelOverride || 'fast',
            callbacks: {
              onStepStart: callbacks?.onStepStart,
              onStepComplete: callbacks?.onStepComplete,
              onStepText: callbacks?.onStepText,
              onError: callbacks?.onError,
            },
          });
        } else if (depth === 'deep' && options?.enableAgenticSteps) {
          // Deep analysis: use capable model with agentic steps
          result = await this.execute(pipeline, formattedInput, {
            providerContext,
            modelOverride: modelOverride || 'capable',
            callbacks: {
              onStepStart: callbacks?.onStepStart,
              onStepComplete: callbacks?.onStepComplete,
              onStepText: callbacks?.onStepText,
              onError: callbacks?.onError,
            },
          });
        } else {
          // Normal processing
          result = await this.execute(pipeline, formattedInput, {
            providerContext,
            modelOverride,
            callbacks: {
              onStepStart: callbacks?.onStepStart,
              onStepComplete: callbacks?.onStepComplete,
              onStepText: callbacks?.onStepText,
              onError: callbacks?.onError,
            },
          });
        }

        callbacks?.onFileComplete?.(file, result.output);
        return { file, result };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        skippedFiles.push({ file, reason });
        logger.warn(`Skipped file ${file}: ${reason}`);
        return null;
      }
    };

    // Process critical files first (with tool access if enabled)
    if (criticalFiles.length > 0) {
      logger.info(`Processing ${criticalFiles.length} critical files with deep analysis`);
      const criticalResults = await processInParallel(
        criticalFiles,
        async (file) => processFile(file, 'deep'),
        Math.min(concurrency, 2) // Lower concurrency for deep analysis
      );

      for (const item of criticalResults) {
        if (item) {
          fileResults.set(item.file, item.result);
          item.result.modelsUsed.forEach(m => allModelsUsed.add(m));
          filesProcessed++;
        }
      }
    }

    // Process normal files
    if (normalFiles.length > 0) {
      logger.info(`Processing ${normalFiles.length} normal files`);
      const normalResults = await processInParallel(
        normalFiles,
        async (file) => processFile(file, 'normal'),
        concurrency
      );

      for (const item of normalResults) {
        if (item) {
          fileResults.set(item.file, item.result);
          item.result.modelsUsed.forEach(m => allModelsUsed.add(m));
          filesProcessed++;
        }
      }
    }

    // Quick scan skip files
    if (skipFiles.length > 0) {
      logger.info(`Quick scanning ${skipFiles.length} low-priority files`);
      const skipResults = await processInParallel(
        skipFiles,
        async (file) => processFile(file, 'quick'),
        concurrency * 2 // Higher concurrency for quick scans
      );

      for (const item of skipResults) {
        if (item) {
          fileResults.set(item.file, item.result);
          item.result.modelsUsed.forEach(m => allModelsUsed.add(m));
          filesProcessed++;
        }
      }
    }

    const processingTime = Date.now() - processingStartTime;

    // Phase 3: Synthesis (meta-aggregation)
    let aggregatedOutput: string | undefined;
    let aggregationTime = 0;

    if (options?.aggregation?.enabled !== false && fileResults.size > 0) {
      callbacks?.onAggregationStart?.();
      const aggStartTime = Date.now();

      try {
        // Use triage summary as additional context
        const triageContext = triageResult
          ? `\n\n## Triage Summary\n${triageResult.summary}\n\nCritical files: ${triageResult.criticalPaths.length}\nNormal files: ${triageResult.normalPaths.length}\nQuick scan files: ${triageResult.skipPaths.length}`
          : '';

        aggregatedOutput = await this.metaAggregateV3(
          fileResults,
          triageResult,
          filesProcessed,
          providerContext,
          options?.aggregation,
          callbacks
        );
      } catch (error) {
        logger.error('V3 aggregation failed:', error instanceof Error ? error : new Error(String(error)));
        aggregatedOutput = this.formatConcatenatedResults(fileResults);
      }

      aggregationTime = Date.now() - aggStartTime;
    } else if (fileResults.size > 0) {
      aggregatedOutput = this.formatConcatenatedResults(fileResults);
    }

    const totalTime = Date.now() - startTime;

    return {
      fileResults,
      aggregatedOutput,
      filesProcessed,
      totalFiles: files.length,
      modelsUsed: Array.from(allModelsUsed),
      skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
      triageResult,
      timing: {
        total: totalTime,
        triage: triageTime,
        processing: processingTime,
        aggregation: aggregationTime,
      },
    };
  }

  /**
   * Meta-aggregate V3 results with triage context.
   */
  private async metaAggregateV3(
    fileResults: Map<string, PipelineResult>,
    triageResult: TriageResult | undefined,
    totalFilesProcessed: number,
    providerContext: ProviderContext,
    aggregationOpts?: AggregationOptions,
    callbacks?: V3Callbacks
  ): Promise<string> {
    const role = aggregationOpts?.role || 'capable';

    // Build results text, ordered by priority
    const orderedFiles = triageResult
      ? triageResult.scores.map(s => s.file).filter(f => fileResults.has(f))
      : Array.from(fileResults.keys());

    const resultsText = orderedFiles
      .map(file => {
        const result = fileResults.get(file)!;
        const score = triageResult?.scores.find(s => s.file === file);
        const priority = score ? ` [${score.risk}, complexity: ${score.complexity}]` : '';
        return `### ${file}${priority}\n${result.output}`;
      })
      .join('\n\n---\n\n');

    const triageContext = triageResult
      ? `\n\n## Triage Analysis\n${triageResult.summary}\n\n**File Distribution:**\n- Critical (deep analysis): ${triageResult.criticalPaths.length}\n- Normal (standard review): ${triageResult.normalPaths.length}\n- Quick scan: ${triageResult.skipPaths.length}`
      : '';

    const prompt = `You are synthesizing code review results from ${totalFilesProcessed} files, processed with adaptive analysis depth.
${triageContext}

## Individual File Results

${resultsText}

## Synthesis Instructions

Provide a comprehensive final report:
1. **Critical Issues** - Most important problems found, prioritized by risk level
2. **Security Concerns** - Any security-related issues (especially from critical files)
3. **Cross-Cutting Patterns** - Issues that appear across multiple files
4. **Top 5 Recommendations** - Most impactful improvements
5. **Priority Files** - Which files need immediate attention (with reasons)
6. **Architecture Assessment** - Overall codebase health

Note: Critical files received deeper analysis, so weight their findings appropriately.`;

    const modelName = this.resolveAggregationModel(role, providerContext, fileResults);
    callbacks?.onStepStart?.('v3-synthesis', modelName);

    const provider = this.registry.getProvider(modelName);
    let output = '';

    const response = await provider.streamChat(
      [{ role: 'user', content: prompt }],
      undefined,
      (text: string) => {
        output += text;
        callbacks?.onStepText?.('v3-synthesis', text);
      }
    );

    const finalOutput = output || response.content;
    callbacks?.onStepComplete?.('v3-synthesis', finalOutput);

    return finalOutput;
  }

  /**
   * Aggregate results for a single group of related files.
   */
  private async aggregateGroup(
    group: FileGroup,
    groupResults: Map<string, PipelineResult>,
    groupIndex: number,
    totalGroups: number,
    providerContext: ProviderContext,
    aggregationOpts?: AggregationOptions,
    callbacks?: IterativeCallbacks
  ): Promise<string> {
    const role = aggregationOpts?.role || 'capable';

    const resultsText = Array.from(groupResults.entries())
      .map(([file, result]) => `### ${file}\n${result.output}`)
      .join('\n\n---\n\n');

    const prompt = `You are summarizing code review results for the "${group.name}" group (${groupIndex + 1}/${totalGroups}).
This group contains ${groupResults.size} related files${group.description ? `: ${group.description}` : ''}.

${resultsText}

Provide a focused summary for this group:
1. **Key Issues** - Most important problems in this group
2. **Patterns** - Recurring issues specific to this area
3. **Files Needing Attention** - Priority files

Keep the summary under 800 words.`;

    const modelName = this.resolveAggregationModel(role, providerContext, groupResults);
    callbacks?.onStepStart?.(`group-${group.name}`, modelName);

    const provider = this.registry.getProvider(modelName);
    let output = '';

    const response = await provider.streamChat(
      [{ role: 'user', content: prompt }],
      undefined,
      (text: string) => {
        output += text;
        callbacks?.onStepText?.(`group-${group.name}`, text);
      }
    );

    const finalOutput = output || response.content;
    callbacks?.onStepComplete?.(`group-${group.name}`, finalOutput);

    return finalOutput;
  }

  /**
   * Meta-aggregate group summaries into final report.
   */
  private async metaAggregateGroups(
    groups: FileGroup[],
    groupSummaries: Map<string, string>,
    totalFilesProcessed: number,
    providerContext: ProviderContext,
    aggregationOpts?: AggregationOptions,
    callbacks?: IterativeCallbacks
  ): Promise<string> {
    const role = aggregationOpts?.role || 'capable';

    const summariesText = groups
      .filter(g => groupSummaries.has(g.name))
      .map(g => `## ${g.name} (${g.files.length} files)\n\n${groupSummaries.get(g.name)}`)
      .join('\n\n---\n\n');

    const prompt = `You received code review summaries from ${groups.length} logical groups covering ${totalFilesProcessed} files.

${summariesText}

Synthesize these into a final comprehensive report:
1. **Critical Issues** - Most important problems across all groups (prioritized)
2. **Cross-Cutting Patterns** - Issues that appear in multiple groups
3. **Top 5 Recommendations** - Most impactful improvements
4. **Priority Areas** - Which groups/files need immediate attention
5. **Architecture Assessment** - Overall codebase health summary`;

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
   * @param step - The pipeline step
   * @param providerContext - Provider context for role resolution
   * @param modelOverride - Optional model role override (from triage suggestion)
   */
  private resolveStepModel(
    step: PipelineStep,
    providerContext: ProviderContext,
    modelOverride?: string
  ): string {
    // Direct model reference takes precedence
    if (step.model) {
      return step.model;
    }

    // Use model override if provided (from triage suggestion)
    const roleToResolve = modelOverride || step.role;

    // Try to resolve role
    if (roleToResolve && this.router) {
      const resolved = this.router.resolveRole(roleToResolve, providerContext);
      if (resolved) {
        const source = modelOverride ? `override "${modelOverride}"` : `role "${step.role}"`;
        logger.debug(`Resolved ${source} to model "${resolved.name}" for provider "${providerContext}"`);
        return resolved.name;
      }
      logger.warn(`Failed to resolve role "${roleToResolve}" for provider "${providerContext}", no fallback available`);
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
    callbacks?: PipelineCallbacks | V3Callbacks
  ): Promise<string> {
    const provider = this.registry.getProvider(modelName);
    const prompt = this.substituteVariables(step.prompt, context);

    logger.debug(`Pipeline step "${step.name}" using model "${modelName}"`);
    logger.verbose(`Prompt: ${prompt.substring(0, 200)}...`);

    // Check if this step has agentic capabilities (V3)
    if (step.allowToolUse && step.tools?.length) {
      return this.executeAgenticStep(step, provider, prompt, callbacks as V3Callbacks);
    }

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
   * Execute an agentic pipeline step with tool access.
   * The model can call tools and loop until it's satisfied.
   */
  private async executeAgenticStep(
    step: PipelineStep,
    provider: BaseProvider,
    prompt: string,
    callbacks?: V3Callbacks
  ): Promise<string> {
    const maxIterations = step.maxIterations ?? 5;

    // Get tool definitions for the specified tools
    const allTools = globalRegistry.getDefinitions();
    const toolDefs: ToolDefinition[] = step.tools!
      .map(name => allTools.find((t: ToolDefinition) => t.name === name))
      .filter((t): t is ToolDefinition => t !== undefined);

    if (toolDefs.length === 0) {
      logger.warn(`No valid tools found for step "${step.name}", falling back to non-agentic execution`);
      let output = '';
      const response = await provider.streamChat(
        [{ role: 'user', content: prompt }],
        undefined,
        (text: string) => {
          output += text;
          callbacks?.onStepText?.(step.name, text);
        }
      );
      return output || response.content;
    }

    logger.debug(`Agentic step "${step.name}" with tools: ${toolDefs.map(t => t.name).join(', ')}`);

    // Destructive tools that require confirmation
    const DESTRUCTIVE_TOOLS = new Set(['bash', 'write_file', 'edit_file', 'patch_file', 'insert_line']);

    // Use proper Message type with ContentBlock[] for tool results
    const messages: Message[] = [{ role: 'user', content: prompt }];
    let iterations = 0;
    let finalOutput = '';

    while (iterations < maxIterations) {
      iterations++;

      // Call the model with tool definitions
      const response = await provider.streamChat(
        messages,
        toolDefs,
        (text: string) => {
          finalOutput += text;
          callbacks?.onStepText?.(step.name, text);
        }
      );

      // Check if the model wants to use tools
      if (!response.toolCalls?.length) {
        // No tool calls, model is done
        return finalOutput || response.content;
      }

      // Build assistant message with tool_use content blocks
      const assistantContent: ContentBlock[] = [];
      if (response.content) {
        assistantContent.push({ type: 'text', text: response.content });
      }
      for (const toolCall of response.toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      // Build user message with tool_result content blocks
      const toolResultContent: ContentBlock[] = [];

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        callbacks?.onToolCall?.(step.name, toolCall.name, toolCall.input);

        // Check if tool requires confirmation
        if (DESTRUCTIVE_TOOLS.has(toolCall.name) && callbacks?.onToolConfirm) {
          const confirmed = await callbacks.onToolConfirm({
            name: toolCall.name,
            input: toolCall.input,
          });

          if (!confirmed) {
            // Tool denied
            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `Tool "${toolCall.name}" was denied by user. Please try a different approach or proceed without this operation.`,
              is_error: true,
            });
            callbacks?.onToolResult?.(step.name, toolCall.name, 'DENIED');
            continue;
          }
        }

        try {
          // Execute the tool
          const result = await globalRegistry.execute(toolCall);
          const resultContent = result.content;

          toolResultContent.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: resultContent,
            is_error: result.is_error,
          });

          callbacks?.onToolResult?.(step.name, toolCall.name, resultContent.substring(0, 100));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          toolResultContent.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: `Error executing tool "${toolCall.name}": ${errorMsg}`,
            is_error: true,
          });
          callbacks?.onToolResult?.(step.name, toolCall.name, `ERROR: ${errorMsg}`);
        }
      }

      // Add tool results as a user message
      messages.push({ role: 'user', content: toolResultContent });

      // Reset finalOutput for next iteration
      finalOutput = '';
    }

    // Max iterations reached, return last output
    logger.warn(`Agentic step "${step.name}" reached max iterations (${maxIterations})`);
    return finalOutput || 'Max iterations reached without final response.';
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
