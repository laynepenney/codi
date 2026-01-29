// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ToolCall, ToolResult } from '../types.js';
import type { SecurityValidator } from '../security-validator.js';
import type { ToolRegistry } from '../tools/registry.js';
import { batchToolCalls, getBatchStats } from '../tool-executor.js';
import { logger } from '../logger.js';
import { FIXED_CONFIG } from '../context-config.js';

export class ToolProcessor {
  constructor(
    private toolRegistry: ToolRegistry,
    private securityValidator: SecurityValidator | null
  ) {}

  /**
   * Normalize tool call inputs
   */
  normalizeToolCall(toolCall: ToolCall): ToolCall {
    // Normalize bash command input
    if (toolCall.name === 'bash' && !toolCall.input.command && toolCall.input.cmd) {
      const cmd = toolCall.input.cmd;
      if (Array.isArray(cmd)) {
        // Format: {"cmd": ["bash", "-lc", "actual command"]}
        const command = cmd.find((c: string) => !c.startsWith('-') && c !== 'bash' && c !== 'sh');
        if (command) {
          return {
            ...toolCall,
            input: { ...toolCall.input, command }
          };
        }
      } else if (typeof cmd === 'string') {
        return {
          ...toolCall,
          input: { ...toolCall.input, command: cmd }
        };
      }
    }
    return toolCall;
  }

  /**
   * Check security validation for a tool call
   */
  async checkSecurityValidation(
    toolCall: ToolCall,
    isDangerous: boolean
  ): Promise<{
    securityWarning?: {
      riskScore: number;
      threats: string[];
      reasoning: string;
      recommendation: 'allow' | 'warn' | 'block';
      latencyMs: number;
    };
    error?: string;
  }> {
    if (!this.securityValidator || !this.securityValidator.shouldValidate(toolCall.name)) {
      return {};
    }

    try {
      const { SecurityValidator } = await import('../../../../security-validator.js');
      const securityResult = await SecurityValidator.validate(
        toolCall.name,
        toolCall.input
      );

      if (securityResult.recommendation === 'block') {
        return {
          error: `Security validation blocked: ${securityResult.threats.join(', ')}`
        };
      }

      // Warn if risk score is high or recommendation is warn
      if (securityResult.recommendation === 'warn' || securityResult.riskScore >= 4) {
        // Upgrade to dangerous if very high risk
        if (!isDangerous && securityResult.riskScore >= 6) {
          isDangerous = true;
        }

        return {
          securityWarning: securityResult
        };
      }
    } catch (error) {
      logger.debug(`Security validation failed: ${error}`);
      // Continue without validation on error
    }

    return {};
  }

  /**
   * Execute tool calls with batching and parallelization
   */
  async executeToolCalls(
    toolCalls: ToolCall[],
    debuggerContext: any,
    debugBridgeAvailable: boolean
  ): Promise<{
    toolResults: ToolResult[];
    hasError: boolean;
  }> {
    const toolResults: ToolResult[] = [];
    let hasError = false;

    // Get batch statistics
    const stats = getBatchStats(toolCalls);

    // Execute batches
    const batches = batchToolCalls(toolCalls, stats.parallelBatches);

    for (const batch of batches) {
      if (batch.parallel && batch.calls.length > 1) {
        // Parallel execution
        await this.executeParallelBatch(batch.calls, debuggerContext, debugBridgeAvailable, toolResults);
      } else {
        // Sequential execution
        for (const toolCall of batch.calls) {
          const result = await this.executeToolCall(toolCall, debuggerContext, debugBridgeAvailable);
          toolResults.push(result);
          if (result.is_error) {
            hasError = true;
          }
        }
      }
    }

    return { toolResults, hasError };
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(
    toolCall: ToolCall,
    debuggerContext: any,
    debugBridgeAvailable: boolean
  ): Promise<ToolResult> {
    const startTime = Date.now();

    if (debugBridgeAvailable) {
      debuggerContext.toolCallStart(toolCall.name, toolCall.input, toolCall.id);
    }

    try {
      const result = await this.toolRegistry.execute(toolCall.name, toolCall.input);
      const durationMs = Date.now() - startTime;

      if (debugBridgeAvailable) {
        debuggerContext.toolCallEnd(toolCall.name, toolCall.id, durationMs, false);
        debuggerContext.toolResult(toolCall.name, toolCall.id, result, false);
      }

      return {
        tool_use_id: toolCall.id,
        content: result,
        is_error: false
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.debug(`Tool ${toolCall.name} failed after ${durationMs}ms: ${error}`);

      if (debugBridgeAvailable) {
        debuggerContext.toolCallEnd(toolCall.name, toolCall.id, durationMs, true);
        debuggerContext.toolResult(toolCall.name, toolCall.id, error instanceof Error ? error.message : String(error), true);
      }

      return {
        tool_use_id: toolCall.id,
        content: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true
      };
    }
  }

  /**
   * Execute a batch of tool calls in parallel
   */
  private async executeParallelBatch(
    toolCalls: ToolCall[],
    debuggerContext: any,
    debugBridgeAvailable: boolean,
    toolResults: ToolResult[]
  ): Promise<void> {
    const { executeWithConcurrencyLimit } = await import('../../../../tool-executor.js');
    const parallelResults = await executeWithConcurrencyLimit(
      toolCalls.map(toolCall => (async () => {
        if (debugBridgeAvailable) {
          debuggerContext.toolCallStart(toolCall.name, toolCall.input, toolCall.id);
        }

        try {
          const result = await this.toolRegistry.execute(toolCall.name, toolCall.input);
          
          if (debugBridgeAvailable) {
            debuggerContext.toolCallEnd(toolCall.name, toolCall.id, 0, false);
            debuggerContext.toolResult(toolCall.name, toolCall.id, result, false);
          }

          return {
            toolCall,
            result: {
              tool_use_id: toolCall.id,
              content: result,
              is_error: false
            }
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          if (debugBridgeAvailable) {
            debuggerContext.toolCallEnd(toolCall.name, toolCall.id, 0, true);
            debuggerContext.toolResult(toolCall.name, toolCall.id, errorMessage, true);
          }

          return {
            toolCall,
            result: {
              tool_use_id: toolCall.id,
              content: `ERROR: ${errorMessage}`,
              is_error: true
            }
          };
        }
      }))
    );

    for (const { result } of parallelResults) {
      toolResults.push(result);
    }
  }

  /**
   * Get tool call statistics
   */
  getToolCallStats(toolCalls: ToolCall[]): {
    totalCalls: number;
    parallelCalls: number;
    sequentialCalls: number;
  } {
    const stats = getBatchStats(toolCalls);
    return {
      totalCalls: toolCalls.length,
      parallelCalls: stats.parallelBatches,
      sequentialCalls: stats.sequentialCalls
    };
  }
}