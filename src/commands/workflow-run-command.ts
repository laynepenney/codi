// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerCommand, type Command, type CommandContext } from './index.js';
import { WorkflowManager } from '../workflow/index.js';
import type { Agent } from '../agent.js';

export const workflowRunCommand: Command = {
  name: 'workflow-run',
  aliases: ['wr'],
  description: 'Execute a workflow',
  usage: '/workflow-run <workflow-name> [--resume]',
  taskType: 'complex',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const workflowName = parts[0];
    const shouldResume = parts.includes('--resume');

    if (!workflowName) {
      return `Usage: /workflow-run <workflow-name> [--resume]

Examples:
  /workflow-run test-model-switch     # Start a new workflow
  /workflow-run pr-review-loop --resume # Resume paused workflow`;
    }

    const manager = new WorkflowManager();
    
    // Need agent for workflow execution
    if (!context.agent) {
      const { handleWorkflowError } = await import('../workflow/errors.js');
      return handleWorkflowError(new Error('Agent not available'), workflowName);
    }

    // Set agent on executor
    manager.getExecutor().setAgent(context.agent as any);

    try {
      let result: string;
      const startTime = Date.now();
      
      if (shouldResume) {
        const { getWorkflowByName, formatWorkflowStart, formatWorkflowProgress, generateCompletionSummary } = await import('../workflow/index.js');
        
        const workflow = getWorkflowByName(workflowName);
        if (!workflow) {
          const { handleWorkflowError } = await import('../workflow/errors.js');
          return handleWorkflowError(new Error(`Workflow "${workflowName}" not found`), workflowName);
        }
        
        result = formatWorkflowStart(workflow, true);
        const state = await manager.resumeWorkflow(workflowName);
        
        if (state.completed) {
          result += `\n${formatWorkflowProgress(workflow, state, false)}`;
          result += generateCompletionSummary(workflow, state, startTime);
        } else if (state.paused) {
          result += `\n${formatWorkflowProgress(workflow, state, true)}`;
          result += `\n⏸️  Workflow paused - resume with: /workflow-run ${workflowName}\n`;
        } else {
          result += `\n${formatWorkflowProgress(workflow, state, true)}`;
        }
        
        return result;
      } else {
        const { getWorkflowByName, formatWorkflowStart, formatWorkflowProgress, generateCompletionSummary } = await import('../workflow/index.js');
        
        const workflow = getWorkflowByName(workflowName);
        if (!workflow) {
          const { handleWorkflowError } = await import('../workflow/errors.js');
          return handleWorkflowError(new Error(`Workflow "${workflowName}" not found`), workflowName);
        }
        
        result = formatWorkflowStart(workflow, false);
        const state = await manager.startWorkflow(workflowName);
        
        result += `\n${formatWorkflowProgress(workflow, state, true)}`;
        
        if (state.completed) {
          result += generateCompletionSummary(workflow, state, startTime);
        } else if (state.history.some(h => h.status === 'failed')) {
          result += generateCompletionSummary(workflow, state, startTime);
        }
        
        return result;
      }
    } catch (error) {
      const { handleWorkflowError } = await import('../workflow/errors.js');
      return handleWorkflowError(error, workflowName);
    }
  },
};

// Also add this as a subcommand to the main workflow command
// Replace the TODO comment in workflow-commands.ts with this
export const workflowSubcommands: Record<string, Command> = {
  'run': workflowRunCommand,
};

// Register workflow run command
export function registerWorkflowRunCommands(): void {
  registerCommand(workflowRunCommand);
}