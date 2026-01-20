// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pipeline Tool
 *
 * Execute a sequence of tool calls with optional stop-on-failure behavior.
 * Useful for chaining multiple operations atomically.
 */

import { BaseTool } from './base.js';
import { globalRegistry } from './registry.js';
import type { ToolDefinition, StructuredResult } from '../types.js';
import { success, failure, formatResult } from '../types.js';

interface PipelineStep {
  tool: string;
  args: Record<string, unknown>;
  name?: string; // Optional step name for logging
}

interface StepResult {
  step: number;
  name: string;
  tool: string;
  ok: boolean;
  output?: string;
  error?: string;
  duration: number;
}

interface PipelineResult {
  completed: number;
  total: number;
  success: boolean;
  steps: StepResult[];
  stoppedAt?: number;
}

export class PipelineTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'pipeline',
      description:
        'Execute a sequence of tool calls in order. ' +
        'Useful for chaining operations like edit -> test -> commit. ' +
        'Can stop on first failure or continue through errors.',
      input_schema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'Array of tool calls to execute in sequence',
            items: {
              type: 'object',
              properties: {
                tool: {
                  type: 'string',
                  description: 'Name of the tool to call',
                },
                args: {
                  type: 'object',
                  description: 'Arguments to pass to the tool',
                },
                name: {
                  type: 'string',
                  description: 'Optional human-readable name for this step',
                },
              },
              required: ['tool', 'args'],
            },
          },
          stop_on_failure: {
            type: 'boolean',
            description: 'Stop execution on first failure. Default: true',
          },
          dry_run: {
            type: 'boolean',
            description: 'Validate steps without executing. Default: false',
          },
        },
        required: ['steps'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const steps = input.steps as PipelineStep[];
    const stopOnFailure = (input.stop_on_failure as boolean) ?? true;
    const dryRun = (input.dry_run as boolean) ?? false;

    if (!steps || steps.length === 0) {
      return formatResult(failure('At least one step is required'));
    }

    // Validate all steps first
    const validationErrors: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.tool) {
        validationErrors.push(`Step ${i + 1}: missing tool name`);
        continue;
      }

      const tool = globalRegistry.get(step.tool);
      if (!tool) {
        validationErrors.push(`Step ${i + 1}: unknown tool "${step.tool}"`);
      }
    }

    if (validationErrors.length > 0) {
      return formatResult(failure(
        `Pipeline validation failed:\n${validationErrors.map(e => `  - ${e}`).join('\n')}`
      ));
    }

    // Dry run mode - just validate
    if (dryRun) {
      const stepSummary = steps.map((s, i) =>
        `  ${i + 1}. ${s.name || s.tool}`
      ).join('\n');

      return formatResult(success({
        validated: true,
        steps: steps.length,
        summary: `Pipeline validated:\n${stepSummary}`,
      }));
    }

    // Execute steps
    const results: StepResult[] = [];
    let allSucceeded = true;
    let stoppedAt: number | undefined;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepName = step.name || `Step ${i + 1}`;
      const tool = globalRegistry.get(step.tool)!;

      const startTime = Date.now();
      let stepResult: StepResult;

      try {
        const output = await tool.execute(step.args);
        const duration = Date.now() - startTime;

        // Check if output indicates an error (for tools using structured results)
        let isError = false;
        try {
          const parsed = JSON.parse(output);
          if (parsed && typeof parsed.ok === 'boolean' && !parsed.ok) {
            isError = true;
          }
        } catch {
          // Not JSON, check for error prefix
          isError = output.startsWith('Error:');
        }

        stepResult = {
          step: i + 1,
          name: stepName,
          tool: step.tool,
          ok: !isError,
          output: this.truncateOutput(output),
          duration,
        };

        if (isError) {
          allSucceeded = false;
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        stepResult = {
          step: i + 1,
          name: stepName,
          tool: step.tool,
          ok: false,
          error: errorMessage,
          duration,
        };

        allSucceeded = false;
      }

      results.push(stepResult);

      // Stop on failure if configured
      if (!stepResult.ok && stopOnFailure) {
        stoppedAt = i + 1;
        break;
      }
    }

    const pipelineResult: PipelineResult = {
      completed: results.length,
      total: steps.length,
      success: allSucceeded,
      steps: results,
      stoppedAt,
    };

    // Format output
    return this.formatPipelineResult(pipelineResult);
  }

  private truncateOutput(output: string, maxLength = 500): string {
    if (output.length <= maxLength) {
      return output;
    }
    return output.slice(0, maxLength) + '... (truncated)';
  }

  private formatPipelineResult(result: PipelineResult): string {
    const lines: string[] = [];

    const status = result.success ? 'SUCCESS' : 'FAILED';
    lines.push(`## Pipeline Result: ${status}`);
    lines.push('');
    lines.push(`**Completed:** ${result.completed}/${result.total} steps`);

    if (result.stoppedAt) {
      lines.push(`**Stopped at:** Step ${result.stoppedAt}`);
    }

    lines.push('');
    lines.push('### Steps');
    lines.push('');

    for (const step of result.steps) {
      const icon = step.ok ? '✓' : '✗';
      const duration = `${(step.duration / 1000).toFixed(2)}s`;

      lines.push(`**${icon} ${step.name}** (${step.tool}) - ${duration}`);

      if (step.error) {
        lines.push(`  Error: ${step.error}`);
      } else if (step.output && !step.ok) {
        // Show output for failed steps
        lines.push(`  Output: ${step.output.split('\n')[0]}`);
      }
    }

    // Add structured JSON at the end for programmatic parsing
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({
      ok: result.success,
      data: {
        completed: result.completed,
        total: result.total,
        stoppedAt: result.stoppedAt,
      },
    }, null, 2));
    lines.push('```');

    return lines.join('\n');
  }
}
