// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Child Agent Wrapper for Multi-Agent Orchestration
 *
 * Wraps the Agent class with IPC-based permission handling,
 * allowing child agents to request permissions from the commander.
 */

import { Agent, type AgentOptions, type ToolConfirmation, type ConfirmationResult } from '../agent.js';
import { IPCClient, type IPCClientConfig } from './ipc/client.js';
import type { WorkerResult } from './types.js';
import type { BaseProvider } from '../providers/base.js';
import type { ToolRegistry } from '../tools/registry.js';
import { logger } from '../logger.js';

/**
 * Configuration for a child agent.
 */
export interface ChildAgentConfig {
  /** IPC socket path to connect to commander */
  socketPath: string;
  /** Unique identifier for this child */
  childId: string;
  /** Worktree path */
  worktree: string;
  /** Branch name */
  branch: string;
  /** Task description */
  task: string;
  /** AI provider */
  provider: BaseProvider;
  /** Tool registry */
  toolRegistry: ToolRegistry;
  /** System prompt */
  systemPrompt: string;
  /** Model name (for reporting) */
  model?: string;
  /** Provider name (for reporting) */
  providerName?: string;
  /** Tools to auto-approve locally */
  autoApprove?: string[];
  /** Maximum iterations */
  maxIterations?: number;
  /** Enable tool use */
  useTools?: boolean;
}

/**
 * Child Agent that routes permissions through IPC to the commander.
 */
export class ChildAgent {
  private config: ChildAgentConfig;
  private ipcClient: IPCClient;
  private agent: Agent;
  private startTime: number = 0;
  private toolCallCount = 0;
  private tokensUsed = { input: 0, output: 0 };

  constructor(config: ChildAgentConfig) {
    this.config = config;

    // Create IPC client
    const ipcConfig: IPCClientConfig = {
      socketPath: config.socketPath,
      childId: config.childId,
      worktree: config.worktree,
      branch: config.branch,
      task: config.task,
      model: config.model,
      provider: config.providerName,
    };
    this.ipcClient = new IPCClient(ipcConfig);

    // Create agent with IPC-based onConfirm
    const agentOptions: AgentOptions = {
      provider: config.provider,
      toolRegistry: config.toolRegistry,
      systemPrompt: config.systemPrompt,
      useTools: config.useTools ?? true,
      autoApprove: config.autoApprove || false,

      // Route text output through IPC
      onText: (text) => {
        this.ipcClient.sendLog('text', text);
      },

      // Report tool calls
      onToolCall: (name, input) => {
        this.toolCallCount++;
        this.ipcClient.sendStatus('tool_call', {
          currentTool: name,
          message: `Executing ${name}`,
        });
      },

      // Report tool results
      onToolResult: (name, result, isError) => {
        if (isError) {
          this.ipcClient.sendLog('error', `Tool ${name} failed: ${result}`);
        }
      },

      // THE KEY: Route permissions through IPC to commander
      onConfirm: async (confirmation: ToolConfirmation): Promise<ConfirmationResult> => {
        return this.requestPermission(confirmation);
      },
    };

    this.agent = new Agent(agentOptions);

    // Handle cancel from commander
    this.ipcClient.on('cancel', () => {
      // TODO: Implement graceful cancellation
      logger.error('Task cancelled by commander');
      process.exit(1);
    });

    // Handle context injection from commander
    this.ipcClient.on('contextReceived', (message) => {
      if (message.context) {
        this.agent.injectContext(message.context);
      }
    });
  }

  /**
   * Request permission from the commander via IPC.
   */
  private async requestPermission(confirmation: ToolConfirmation): Promise<ConfirmationResult> {
    // Check if cancelled
    if (this.ipcClient.isCancelled()) {
      return 'abort';
    }

    // Update status to waiting
    this.ipcClient.sendStatus('waiting_permission', {
      currentTool: confirmation.toolName,
      message: `Waiting for permission: ${confirmation.toolName}`,
    });

    try {
      // Request permission from commander (blocks until user responds)
      const result = await this.ipcClient.requestPermission(confirmation);

      // Update status back to thinking
      this.ipcClient.sendStatus('thinking');

      return result;
    } catch (err) {
      // On timeout or error, deny the request
      logger.error(`Permission request failed: ${err}`);
      return 'deny';
    }
  }

  /**
   * Run the task.
   */
  async run(): Promise<WorkerResult> {
    this.startTime = Date.now();

    try {
      // Connect to commander
      await this.ipcClient.connect();

      // Send starting status
      this.ipcClient.sendStatus('starting', {
        message: `Starting task: ${this.config.task}`,
      });

      // Update to thinking
      this.ipcClient.sendStatus('thinking');

      // Run the agent
      const response = await this.agent.chat(this.config.task);

      // Token usage is tracked via callbacks, use accumulated values
      // (Agent doesn't expose getUsage directly)

      // Get git info
      const gitInfo = await this.getGitInfo();

      const result: WorkerResult = {
        workerId: this.config.childId,
        success: true,
        response,
        toolCallCount: this.toolCallCount,
        tokensUsed: this.tokensUsed,
        duration: Date.now() - this.startTime,
        branch: this.config.branch,
        commits: gitInfo.commits,
        filesChanged: gitInfo.filesChanged,
      };

      // Send completion
      this.ipcClient.sendTaskComplete(result);
      this.ipcClient.sendStatus('complete');

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Log the error first
      logger.error('Child agent error: ' + error.message, error);

      // Only try to send error via IPC if we're connected
      if (this.ipcClient.isConnected()) {
        try {
          this.ipcClient.sendTaskError({
            message: error.message,
            recoverable: false,
          });
          this.ipcClient.sendStatus('failed');
        } catch {
          // Ignore IPC errors during error handling
        }
      }

      return {
        workerId: this.config.childId,
        success: false,
        response: '',
        toolCallCount: this.toolCallCount,
        tokensUsed: this.tokensUsed,
        duration: Date.now() - this.startTime,
        branch: this.config.branch,
        commits: 0,
        filesChanged: [],
        error: error.message,
      };
    } finally {
      await this.ipcClient.disconnect();
    }
  }

  /**
   * Get git information for the result.
   */
  private async getGitInfo(): Promise<{ commits: number; filesChanged: string[] }> {
    // This would be implemented to get actual git info
    // For now, return empty/zero
    // TODO: Integrate with worktree manager or git commands
    return {
      commits: 0,
      filesChanged: [],
    };
  }
}

/**
 * Entry point for child agent process.
 * Called when codi is run with --child-mode flag.
 */
export async function runChildAgent(config: ChildAgentConfig): Promise<void> {
  const child = new ChildAgent(config);
  const result = await child.run();

  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}
