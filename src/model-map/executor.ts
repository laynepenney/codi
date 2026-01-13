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
  V4Options,
  V4Callbacks,
  TriageResult,
  CodebaseStructure,
  SymbolicationResult,
} from './types.js';
import type { ToolDefinition, Message, ContentBlock } from '../types.js';
import { triageFiles, getSuggestedModel } from './triage.js';
import { globalRegistry } from '../tools/index.js';
import { groupFiles, processInParallel } from './grouping.js';
import {
  Phase0Symbolication,
  buildFileAnalysisPrompt,
  buildNavigationContext,
  compressFileContext,
  getOptimalProcessingOrder,
} from './symbols/index.js';
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

  // ============================================================================
  // V4 Execution with Symbolication
  // ============================================================================

  /**
   * Execute pipeline iteratively over multiple files with V4 symbolication.
   * Adds Phase 0 symbolication before triage for enhanced context.
   */
  async executeIterativeV4(
    pipelineName: string,
    files: string[],
    options: V4Options = {}
  ): Promise<IterativeResult> {
    const startTime = Date.now();
    const v4Callbacks = options.callbacks as V4Callbacks | undefined;

    // Phase 0: Build codebase structure (symbolication)
    let structure: CodebaseStructure | undefined = options.structure;
    let symbolicationTime = 0;

    if (options.enableSymbolication !== false && !structure) {
      const symbolicationStart = Date.now();
      v4Callbacks?.onSymbolicationStart?.(files.length);

      const phase0 = new Phase0Symbolication({
        projectRoot: options.symbolicationOptions?.projectRoot,
      });

      const result = await phase0.buildStructure({
        files,
        criticalFiles: phase0.selectCriticalFiles(files),
        buildDependencyGraph: true,
        resolveBarrels: true,
        onProgress: (processed, total, file) => {
          v4Callbacks?.onSymbolicationProgress?.(processed, total, file);
        },
        ...options.symbolicationOptions,
      });

      structure = result.structure;
      symbolicationTime = Date.now() - symbolicationStart;
      v4Callbacks?.onSymbolicationComplete?.(result);
    }

    // Continue with V3 execution, passing structure for context enhancement
    const v3Options: V3Options = {
      ...options,
      callbacks: options.callbacks,
    };

    // Execute V3 with structure context
    const v3Result = await this.executeIterativeV3WithContext(
      pipelineName,
      files,
      v3Options,
      structure
    );

    // Add symbolication timing to result
    if (v3Result.timing) {
      v3Result.timing.total = Date.now() - startTime;
      (v3Result.timing as { symbolication?: number }).symbolication = symbolicationTime;
    }

    return v3Result;
  }

  /**
   * Execute V3 pipeline with optional codebase structure context.
   * When structure is provided, enhances triage and file prompts.
   */
  private async executeIterativeV3WithContext(
    pipelineName: string,
    files: string[],
    options: V3Options,
    structure?: CodebaseStructure
  ): Promise<IterativeResult> {
    const startTime = Date.now();
    const callbacks = options.callbacks;

    // Get pipeline definition from router
    if (!this.router) {
      throw new Error('Router is required for V4 execution');
    }
    const pipeline = this.router.getPipeline(pipelineName);

    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineName}`);
    }

    // Phase 1: Enhanced Triage (with connectivity if structure available)
    let triageResult: TriageResult | undefined;
    let triageTime = 0;

    if (options.enableTriage !== false && this.router) {
      const triageStart = Date.now();
      callbacks?.onTriageStart?.(files.length);

      triageResult = await triageFiles(files, this.registry, this.router, {
        role: options.triage?.role || 'fast',
        providerContext: options.providerContext,
        criteria: options.triage?.criteria,
        deepThreshold: options.triage?.deepThreshold,
        skipThreshold: options.triage?.skipThreshold,
      });

      // Enhance triage with connectivity if structure available
      if (structure) {
        triageResult = this.enhanceTriageWithConnectivity(triageResult, structure);
      }

      triageTime = Date.now() - triageStart;
      callbacks?.onTriageComplete?.(triageResult);
    }

    // Determine files to process based on triage
    let filesToProcess = triageResult
      ? [...triageResult.criticalPaths, ...triageResult.normalPaths]
      : files;

    const skippedFiles = triageResult
      ? triageResult.skipPaths.map((f) => ({ file: f, reason: 'low priority' }))
      : [];

    // Reorder files based on dependency graph (leaves first) if structure available
    // This ensures dependencies are processed before dependents for better context
    if (structure && (options as V4Options).useDependencyOrder !== false) {
      // Build priority map from triage scores
      const priorities = new Map<string, number>();
      if (triageResult) {
        // Critical files get higher priority (processed earlier within same tier)
        triageResult.criticalPaths.forEach((f, i) =>
          priorities.set(f, 1000 - i)
        );
        triageResult.normalPaths.forEach((f, i) =>
          priorities.set(f, 500 - i)
        );
      }

      const orderResult = getOptimalProcessingOrder(
        structure.dependencyGraph,
        filesToProcess,
        { priorities }
      );
      filesToProcess = orderResult.order;
    }

    // Phase 2: Process files with enhanced context (in parallel)
    const processStart = Date.now();
    const fileResults = new Map<string, PipelineResult>();
    const modelsUsed = new Set<string>();
    const concurrency = options.concurrency ?? 4;
    const v4Opts = options as V4Options;

    // Process files in parallel batches
    const results = await processInParallel(
      filesToProcess,
      async (file, index) => {
        callbacks?.onFileStart?.(file, index, filesToProcess.length);

        try {
          // Build enhanced prompt with structure context
          let enhancedInput: string;
          if (structure && v4Opts.includeNavigationContext !== false) {
            enhancedInput = this.formatFileInput(file, structure, v4Opts);
          } else {
            enhancedInput = file;
          }

          // Execute pipeline for this file
          const result = await this.execute(pipeline, enhancedInput, {
            providerContext: options.providerContext,
          });

          callbacks?.onFileComplete?.(file, result.output);
          return { file, result, error: null };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          callbacks?.onError?.(file, error as Error);
          return { file, result: null, error: errorMsg };
        }
      },
      concurrency
    );

    // Collect results
    for (const item of results) {
      if (item.result) {
        fileResults.set(item.file, item.result);
        item.result.modelsUsed.forEach((m) => modelsUsed.add(m));
      } else if (item.error) {
        skippedFiles.push({ file: item.file, reason: item.error });
      }
    }

    const processTime = Date.now() - processStart;

    // Phase 3: Aggregation
    let aggregatedOutput: string | undefined;
    let aggregationTime = 0;

    if (options.aggregation?.enabled !== false && fileResults.size > 0) {
      const aggStart = Date.now();
      callbacks?.onAggregationStart?.();

      aggregatedOutput = await this.metaAggregateV4(
        fileResults,
        structure,
        options
      );

      aggregationTime = Date.now() - aggStart;
    }

    return {
      fileResults,
      aggregatedOutput,
      filesProcessed: fileResults.size,
      totalFiles: files.length,
      modelsUsed: Array.from(modelsUsed),
      skippedFiles,
      triageResult,
      timing: {
        total: Date.now() - startTime,
        triage: triageTime,
        processing: processTime,
        aggregation: aggregationTime,
      },
    };
  }

  /**
   * Enhance triage scores with connectivity metrics from structure.
   */
  private enhanceTriageWithConnectivity(
    triageResult: TriageResult,
    structure: CodebaseStructure
  ): TriageResult {
    const enhancedScores = triageResult.scores.map((score) => {
      const connectivity = structure.connectivity.get(score.file);
      if (!connectivity) return score;

      // Boost importance for high-connectivity files
      let importanceBoost = 0;

      // Files imported by many others are more important
      if (connectivity.inDegree >= 5) {
        importanceBoost += 2;
      } else if (connectivity.inDegree >= 2) {
        importanceBoost += 1;
      }

      // Entry points are critical
      if (structure.dependencyGraph.entryPoints.includes(score.file)) {
        importanceBoost += 2;
      }

      // High transitive reach = high importance
      if (connectivity.transitiveImporters >= 10) {
        importanceBoost += 1;
      }

      // Boost complexity for files in cycles
      const inCycle = structure.dependencyGraph.cycles.some((cycle) =>
        cycle.includes(score.file)
      );
      const complexityBoost = inCycle ? 1 : 0;

      const newImportance = Math.min(10, score.importance + importanceBoost);
      const newComplexity = Math.min(10, score.complexity + complexityBoost);
      const newPriority = (newImportance + newComplexity + (score.risk === 'critical' ? 10 : score.risk === 'high' ? 7 : score.risk === 'medium' ? 4 : 1)) / 3;

      return {
        ...score,
        importance: newImportance,
        complexity: newComplexity,
        priority: newPriority,
        reasoning: `${score.reasoning} [Connectivity: in=${connectivity.inDegree}, out=${connectivity.outDegree}${inCycle ? ', in-cycle' : ''}]`,
      };
    });

    // Re-sort by priority
    enhancedScores.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Re-categorize based on new priorities
    const deepThreshold = 6;
    const skipThreshold = 3;

    const criticalPaths = enhancedScores
      .filter((s) => (s.priority || 0) >= deepThreshold)
      .map((s) => s.file);

    const normalPaths = enhancedScores
      .filter((s) => {
        const p = s.priority || 0;
        return p < deepThreshold && p > skipThreshold;
      })
      .map((s) => s.file);

    const skipPaths = enhancedScores
      .filter((s) => (s.priority || 0) <= skipThreshold)
      .map((s) => s.file);

    return {
      ...triageResult,
      scores: enhancedScores,
      criticalPaths,
      normalPaths,
      skipPaths,
    };
  }

  /**
   * Aggregate results with structure context for V4.
   */
  private async metaAggregateV4(
    fileResults: Map<string, PipelineResult>,
    structure: CodebaseStructure | undefined,
    options: V3Options
  ): Promise<string> {
    // Use batched aggregation for large result sets to avoid payload limits
    const BATCH_SIZE = 15; // Max files per batch
    const resultEntries = Array.from(fileResults.entries());

    if (resultEntries.length > BATCH_SIZE) {
      return this.batchedAggregateV4(resultEntries, structure, options, BATCH_SIZE);
    }

    // Small result set - aggregate directly
    return this.singleAggregateV4(resultEntries, structure, options);
  }

  /**
   * Aggregate a small set of results in a single request.
   */
  private async singleAggregateV4(
    results: Array<[string, PipelineResult]>,
    structure: CodebaseStructure | undefined,
    options: V3Options
  ): Promise<string> {
    const resultSummaries: string[] = [];

    for (const [file, result] of results) {
      resultSummaries.push(`### ${file}\n${result.output}`);
    }

    // Build aggregation prompt
    let aggregationPrompt = options.aggregation?.prompt ||
      'Synthesize these file analysis results into a coherent summary:\n\n{results}';

    // Add structure context if available
    let structureContext = '';
    if (structure) {
      const entryPoints = structure.dependencyGraph.entryPoints.slice(0, 5);
      const cycleCount = structure.dependencyGraph.cycles.length;

      structureContext = `
Codebase Structure:
- Total files: ${structure.metadata.totalFiles}
- Entry points: ${entryPoints.join(', ')}
- Circular dependencies: ${cycleCount}

`;
    }

    aggregationPrompt = aggregationPrompt.replace(
      '{results}',
      structureContext + resultSummaries.join('\n\n')
    );

    // Get aggregation model
    const provider = await this.getAggregationProvider(options);

    // Execute aggregation
    const response = await provider.chat([
      { role: 'user', content: aggregationPrompt },
    ]);

    return typeof response.content === 'string'
      ? response.content
      : (response.content as ContentBlock[]).map((b) => (b.type === 'text' ? b.text : '')).join('');
  }

  /**
   * Aggregate large result sets in batches to avoid payload limits.
   * First aggregates each batch in parallel (with rate limiting), then combines batch summaries into final output.
   */
  private async batchedAggregateV4(
    results: Array<[string, PipelineResult]>,
    structure: CodebaseStructure | undefined,
    options: V3Options,
    batchSize: number
  ): Promise<string> {
    // Split results into batches
    const batches: Array<Array<[string, PipelineResult]>> = [];
    for (let i = 0; i < results.length; i += batchSize) {
      batches.push(results.slice(i, i + batchSize));
    }

    console.log(`Info: Aggregating ${results.length} files in ${batches.length} batches (parallel)`);

    // Get provider once for all batches
    const provider = await this.getAggregationProvider(options);

    // Process a single batch
    const processBatch = async (batch: Array<[string, PipelineResult]>, batchIndex: number): Promise<string> => {
      const batchFiles = batch.map(([file]) => file);

      console.log(`  Batch ${batchIndex + 1}/${batches.length}: ${batch.length} files`);

      const resultSummaries = batch.map(([file, result]) => `### ${file}\n${result.output}`);

      const batchPrompt = `Summarize these ${batch.length} file analysis results into key findings. Be concise but comprehensive.

Files in this batch: ${batchFiles.join(', ')}

${resultSummaries.join('\n\n')}`;

      const response = await provider.chat([
        { role: 'user', content: batchPrompt },
      ]);

      const summary = typeof response.content === 'string'
        ? response.content
        : (response.content as ContentBlock[]).map((b) => (b.type === 'text' ? b.text : '')).join('');

      return `## Batch ${batchIndex + 1} (${batchFiles.slice(0, 3).join(', ')}${batch.length > 3 ? `, +${batch.length - 3} more` : ''})\n${summary}`;
    };

    // Run all batches in parallel (rate limiting is handled by the provider)
    const batchPromises = batches.map((batch, index) => processBatch(batch, index));
    const batchSummaries = await Promise.all(batchPromises);

    // Final aggregation of batch summaries
    console.log(`  Combining ${batches.length} batch summaries...`);

    let structureContext = '';
    if (structure) {
      const entryPoints = structure.dependencyGraph.entryPoints.slice(0, 5);
      const cycleCount = structure.dependencyGraph.cycles.length;

      structureContext = `
Codebase Structure:
- Total files analyzed: ${results.length}
- Entry points: ${entryPoints.join(', ')}
- Circular dependencies: ${cycleCount}

`;
    }

    const finalPrompt = `${structureContext}Synthesize these batch summaries into a coherent final analysis of the codebase:

${batchSummaries.join('\n\n')}

Provide a unified summary covering:
1. Overall codebase health
2. Critical issues found
3. Architecture recommendations
4. Priority action items`;

    const finalResponse = await provider.chat([
      { role: 'user', content: finalPrompt },
    ]);

    return typeof finalResponse.content === 'string'
      ? finalResponse.content
      : (finalResponse.content as ContentBlock[]).map((b) => (b.type === 'text' ? b.text : '')).join('');
  }

  /**
   * Get the provider for aggregation based on options.
   */
  private async getAggregationProvider(options: V3Options): Promise<BaseProvider> {
    let modelName: string;
    const roleName = options.aggregation?.role || 'capable';

    if (this.router) {
      const resolved = this.router.resolveRole(roleName, options.providerContext || 'anthropic');
      if (resolved) {
        modelName = resolved.name;
      } else {
        // Fallback to first available model
        const modelNames = this.registry.getModelNames();
        if (modelNames.length === 0) {
          throw new Error(`No models available for aggregation`);
        }
        modelName = modelNames[0];
      }
    } else {
      // No router, use first available model
      const modelNames = this.registry.getModelNames();
      if (modelNames.length === 0) {
        throw new Error(`No models available for aggregation`);
      }
      modelName = modelNames[0];
    }

    return this.registry.getProvider(modelName);
  }

  /**
   * Format file input with structure context.
   */
  private formatFileInput(
    file: string,
    structure: CodebaseStructure,
    options: V4Options
  ): string {
    const parts: string[] = [file];

    // Add navigation context
    if (options.includeNavigationContext !== false) {
      const navContext = buildNavigationContext(file, structure);
      if (navContext) {
        parts.push(`\n[Navigation: ${navContext}]`);
      }
    }

    // Add compressed file context
    if (options.includeRelatedContext !== false) {
      const compressed = compressFileContext(file, structure);
      if (compressed.exports.length > 0 || compressed.dependencies.length > 0) {
        parts.push(`\n[Exports: ${compressed.exports.slice(0, 5).join(', ')}]`);
        parts.push(`[Dependencies: ${compressed.dependencies.slice(0, 5).join(', ')}]`);
      }
    }

    return parts.join('');
  }
}

/**
 * Create a pipeline executor.
 */
export function createPipelineExecutor(registry: ModelRegistry, router?: TaskRouter): PipelineExecutor {
  return new PipelineExecutor(registry, router);
}
