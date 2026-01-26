// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerCommand, type Command, type CommandContext } from './index.js';
import { WorkflowManager, getWorkflowByName } from '../workflow/index.js';

// Import workflow commands
import { workflowBuildCommand } from './workflow-ai-builder.js';

// Import workflow run command
import { workflowRunCommand } from './workflow-run-command.js';

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
          const workflow = getWorkflowByName(validateName);
          
          if (!workflow) {
            const { createWorkflowError } = await import('../workflow/errors.js');
            const error = createWorkflowError(`Workflow "${validateName}" not found`, undefined, validateName);
            return error.getFullMessage();
          }
          
          const { valid, errors, warnings, hints } = await import('../workflow/errors.js').then(m => 
            m.validateWorkflowWithFeedback(workflow)
          );

          let output = '';
          
          if (valid) {
            output += `✅ Workflow "${validateName}" is valid\n\n`;
          } else {
            output += `❌ Workflow "${validateName}" has validation errors\n\n`;
          }

          if (errors.length > 0) {
            output += `🚨 Errors:\n`;
            errors.forEach(error => {
              output += `   • ${error}\n`;
            });
            output += '\n';
          }

          if (warnings.length > 0) {
            output += `⚠️  Warnings:\n`;
            warnings.forEach(warning => {
              output += `   • ${warning}\n`;
            });
            output += '\n';
          }

          if (hints.length > 0) {
            output += `💡 Hints:\n`;
            hints.forEach(hint => {
              output += `   ${hint}\n`;
            });
            output += '\n';
          }

          if (!valid && errors.length > 0) {
            const stepsWithErrors = workflow.steps?.filter((step: any) => 
              errors.some(err => err.includes(step.id))
            ) || [];
            if (stepsWithErrors.length > 0) {
              output += `📋 Affected Steps:\n`;
              stepsWithErrors.forEach((step: any, index: number) => {
                output += `   ${index + 1}. [${step.id}] ${step.action}\n`;
              });
              output += '\n';
              
              output += `🔍 Run /workflow show ${validateName} for detailed step information\n`;
            }
          }

          return output;
        } catch (error) {
          const { handleWorkflowError } = await import('../workflow/errors.js');
          return handleWorkflowError(error, validateName);
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
  registerCommand(workflowRunCommand);
  registerCommand(workflowBuildCommand);
}