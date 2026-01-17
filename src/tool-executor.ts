// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Tool Executor - Parallel execution of independent tool calls.
 *
 * Groups tool calls by dependency and executes independent calls in parallel
 * while maintaining sequential execution for dependent operations.
 */

import type { ToolCall, ToolResult } from './types.js';
import type { ToolRegistry } from './tools/registry.js';
import { logger } from './logger.js';

/**
 * Tools that only read state and can safely run in parallel.
 */
export const READ_ONLY_TOOLS = new Set([
  'read_file',
  'glob',
  'grep',
  'list_directory',
  'find_symbol',
  'goto_definition',
  'find_references',
  'get_dependency_graph',
  'get_inheritance',
  'get_call_graph',
  'search_codebase',
  'analyze_image',
  'web_search',
]);

/**
 * Tools that modify state and need careful dependency handling.
 */
export const MUTATING_TOOLS = new Set([
  'write_file',
  'edit_file',
  'insert_line',
  'patch_file',
  'bash', // Could read or write, treat as mutating for safety
]);

/**
 * A batch of tool calls that can be executed together.
 */
export interface ToolBatch {
  /** Tool calls in this batch */
  calls: ToolCall[];
  /** Whether calls in this batch can run in parallel */
  parallel: boolean;
}

/**
 * Extract file path from a tool call's input.
 */
function getFilePath(toolCall: ToolCall): string | null {
  const input = toolCall.input;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.file === 'string') return input.file;
  return null;
}

/**
 * Check if a tool call is read-only.
 */
export function isReadOnly(toolCall: ToolCall): boolean {
  return READ_ONLY_TOOLS.has(toolCall.name);
}

/**
 * Check if a tool call is mutating.
 */
export function isMutating(toolCall: ToolCall): boolean {
  return MUTATING_TOOLS.has(toolCall.name);
}

/**
 * Check if two tool calls have a dependency (operate on the same file).
 */
function hasDependency(a: ToolCall, b: ToolCall): boolean {
  const pathA = getFilePath(a);
  const pathB = getFilePath(b);

  // If either doesn't have a path, we can't determine dependency
  // For safety, assume dependency for mutating tools without paths
  if (!pathA || !pathB) {
    // If both are read-only, no dependency
    if (isReadOnly(a) && isReadOnly(b)) return false;
    // If either is mutating without a clear path (e.g., bash), assume dependency
    return isMutating(a) || isMutating(b);
  }

  // Same file = dependency
  return pathA === pathB;
}

/**
 * Batch tool calls for optimal execution.
 *
 * Strategy:
 * 1. Consecutive read-only tools on different files → parallel batch
 * 2. Mutating tools → sequential batch (one at a time)
 * 3. Read-only tools on same file as pending mutation → wait for mutation
 */
export function batchToolCalls(toolCalls: ToolCall[]): ToolBatch[] {
  if (toolCalls.length === 0) return [];
  if (toolCalls.length === 1) {
    return [{ calls: [toolCalls[0]], parallel: false }];
  }

  const batches: ToolBatch[] = [];
  let currentReadOnlyBatch: ToolCall[] = [];
  const mutatedFiles = new Set<string>(); // Files modified by earlier tools

  for (const toolCall of toolCalls) {
    const filePath = getFilePath(toolCall);

    if (isReadOnly(toolCall)) {
      // Check if this read depends on a file that will be mutated
      const dependsOnMutation = filePath && mutatedFiles.has(filePath);

      if (dependsOnMutation) {
        // Flush current read-only batch first
        if (currentReadOnlyBatch.length > 0) {
          batches.push({
            calls: currentReadOnlyBatch,
            parallel: currentReadOnlyBatch.length > 1,
          });
          currentReadOnlyBatch = [];
        }
        // This read must wait, add as sequential
        batches.push({ calls: [toolCall], parallel: false });
      } else {
        // Can potentially parallelize with other reads
        currentReadOnlyBatch.push(toolCall);
      }
    } else {
      // Mutating tool - flush read batch and add sequentially
      if (currentReadOnlyBatch.length > 0) {
        batches.push({
          calls: currentReadOnlyBatch,
          parallel: currentReadOnlyBatch.length > 1,
        });
        currentReadOnlyBatch = [];
      }

      // Track the file being mutated
      if (filePath) {
        mutatedFiles.add(filePath);
      }

      // Mutating tools run one at a time
      batches.push({ calls: [toolCall], parallel: false });
    }
  }

  // Flush any remaining read-only batch
  if (currentReadOnlyBatch.length > 0) {
    batches.push({
      calls: currentReadOnlyBatch,
      parallel: currentReadOnlyBatch.length > 1,
    });
  }

  return batches;
}

/**
 * Result of executing a batch of tools.
 */
export interface BatchExecutionResult {
  results: ToolResult[];
  hasError: boolean;
}

/**
 * Execute a batch of tool calls.
 * If parallel=true, executes all calls concurrently.
 * Otherwise, executes sequentially.
 */
export async function executeBatch(
  batch: ToolBatch,
  registry: ToolRegistry,
  onToolCall?: (name: string, input: Record<string, unknown>) => void,
  onToolResult?: (name: string, result: string, isError: boolean) => void
): Promise<BatchExecutionResult> {
  const results: ToolResult[] = [];
  let hasError = false;

  if (batch.parallel && batch.calls.length > 1) {
    // Execute in parallel
    logger.debug(`Executing ${batch.calls.length} tools in parallel: ${batch.calls.map(c => c.name).join(', ')}`);

    // Notify all tool calls are starting
    for (const toolCall of batch.calls) {
      onToolCall?.(toolCall.name, toolCall.input);
    }

    // Execute all in parallel
    const promises = batch.calls.map(toolCall => registry.execute(toolCall));
    const parallelResults = await Promise.all(promises);

    // Process results
    for (let i = 0; i < parallelResults.length; i++) {
      const result = parallelResults[i];
      const toolCall = batch.calls[i];
      results.push(result);
      if (result.is_error) hasError = true;
      onToolResult?.(toolCall.name, result.content, !!result.is_error);
    }
  } else {
    // Execute sequentially
    for (const toolCall of batch.calls) {
      onToolCall?.(toolCall.name, toolCall.input);
      const result = await registry.execute(toolCall);
      results.push(result);
      if (result.is_error) hasError = true;
      onToolResult?.(toolCall.name, result.content, !!result.is_error);
    }
  }

  return { results, hasError };
}

/**
 * Get statistics about batching for logging.
 */
export function getBatchStats(batches: ToolBatch[]): {
  totalCalls: number;
  parallelBatches: number;
  sequentialBatches: number;
  maxParallelism: number;
} {
  let totalCalls = 0;
  let parallelBatches = 0;
  let sequentialBatches = 0;
  let maxParallelism = 0;

  for (const batch of batches) {
    totalCalls += batch.calls.length;
    if (batch.parallel) {
      parallelBatches++;
      maxParallelism = Math.max(maxParallelism, batch.calls.length);
    } else {
      sequentialBatches++;
    }
  }

  return { totalCalls, parallelBatches, sequentialBatches, maxParallelism };
}
