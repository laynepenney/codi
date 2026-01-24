// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerCommand, type Command, type CommandContext } from './index.js';
import { WorkflowManager, getWorkflowByName } from '../workflow/index.js';

export const workflowListCommand: Command = {
  name: 'workflow',
  description: 'List available workflows',
  usage: '/workflow list',
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || 'list';

    const manager = new WorkflowManager();

    switch (subcommand) {
      case 'list':
      case 'ls':
        const workflows = manager.listAvailableWorkflows();
        if (workflows.length === 0) {
          return 'No workflows found. Create workflow files in ~/.codi/workflows/ or ./workflows/';
        }

        let output = 'Available workflows:\n\n';
        workflows.forEach(wf => {
          const status = wf.valid ? '✅' : '❌';
          output += `${status} ${wf.name}\n   File: ${wf.file}\n\n`;
        });

        return output;

      case 'show':
      case 'view':
        const workflowName = parts[1];
        if (!workflowName) {
          return 'Usage: /workflow show <name>';
        }

        const workflow = getWorkflowByName(workflowName);
        if (!workflow) {
          return `Workflow "${workflowName}" not found`;
        }

        let workflowInfo = `Workflow: ${workflow.name}\n`;
        if (workflow.description) {
          workflowInfo += `Description: ${workflow.description}\n`;
        }
        workflowInfo += `Steps: ${workflow.steps.length}\n`;
        workflowInfo += `Interactivity: ${workflow.interactive ? 'yes' : 'no'}\n`;
        workflowInfo += `Persistence: ${workflow.persistent ? 'yes' : 'no'}\n\n`;

        workflow.steps.forEach((step, index) => {
          workflowInfo += `${index + 1}. [${step.id}] ${step.action}`;
          if (step.description) {
            workflowInfo += `: ${step.description}`;
          }
          workflowInfo += '\n';

          // Show step-specific details
          switch (step.action) {
            case 'switch-model':
              workflowInfo += `   Model: ${step.model}\n`;
              break;
            case 'conditional':
              workflowInfo += `   Check: ${step.check}\n`;
              workflowInfo += `   On True: ${step.onTrue}\n`;
              if (step.onFalse) {
                workflowInfo += `   On False: ${step.onFalse}\n`;
              }
              break;
            case 'loop':
              workflowInfo += `   Condition: ${step.condition}\n`;
              workflowInfo += `   To Step: ${step.to}\n`;
              if (step.maxIterations) {
                workflowInfo += `   Max Iterations: ${step.maxIterations}\n`;
              }
              break;
          }
          workflowInfo += '\n';
        });

        return workflowInfo;

      case 'validate':
        const validateName = parts[1];
        if (!validateName) {
          return 'Usage: /workflow validate <name>';
        }

        try {
          getWorkflowByName(validateName);
          return `✅ Workflow "${validateName}" is valid`;
        } catch (error) {
          return `❌ Workflow "${validateName}" is invalid: ${error instanceof Error ? error.message : String(error)}`;
        }

      default:
        return `Unknown workflow command: "${subcommand}"

Available subcommands:
  /workflow list      - List available workflows
  /workflow show <name> - Show workflow details
  /workflow validate <name> - Validate workflow syntax`;
    }
  },
};

// TODO: Add these commands in Phase 2
// export const workflowRunCommand: Command = { ... };
// export const workflowStatusCommand: Command = { ... };
// export const workflowPauseCommand: Command = { ... };
// export const workflowResumeCommand: Command = { ... };

// Register workflow commands
export function registerWorkflowCommands(): void {
  registerCommand(workflowListCommand);
  // TODO: Register other commands as they're implemented
}