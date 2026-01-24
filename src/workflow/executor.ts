// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WorkflowStep,
  WorkflowState,
  WorkflowError
} from './types.js';

/**
 * Executes individual workflow steps
 */
export class WorkflowExecutor {
  private agent?: any; // Will be Agent type
  private context?: any; // Will be CommandContext type

  /**
   * Set agent reference for AI actions
   */
  setAgent(agent: any): void {
    this.agent = agent;
  }

  /**
   * Set command context for step execution
   */
  setContext(context: any): void {
    this.context = context;
  }

  /**
   * Execute a workflow step
   */
  async executeStep(step: WorkflowStep, state: WorkflowState, workflow: any): Promise<any> {
    switch (step.action) {
      case 'switch-model':
        return this.executeSwitchModelStep(step, state);
      
      case 'conditional':
        return this.executeConditionalStep(step, state);
      
      case 'loop':
        return this.executeLoopStep(step, state);
      
      case 'interactive':
        return this.executeInteractiveStep(step, state);
      
      case 'shell':
        return this.executeShellActionStep(step, state);
      
      case 'ai-prompt':
        return this.executeAiPromptActionStep(step, state);
      
      case 'create-pr':
      case 'review-pr':
      case 'merge-pr':
        return this.executePrActionStep(step, state);
      
      case 'commit':
      case 'push':
      case 'pull':
      case 'sync':
        return this.executeGitActionStep(step, state);
      
      default:
        throw new WorkflowError(
          `Unknown action: ${step.action}`,
          step.id,
          workflow.name
        );
    }
  }

  /**
   * Switch AI model
   */
  private async executeSwitchModelStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    console.log(`Switching to model: ${(step as any).model}`);
    return { success: true, model: (step as any).model };
  }

  /**
   * Conditional step (just evaluates condition)
   */
  private async executeConditionalStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    return { condition: (step as any).check };
  }

  /**
   * Loop step
   */
  private async executeLoopStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    return { 
      iterationCount: state.iterationCount,
      maxIterations: (step as any).maxIterations 
    };
  }

  /**
   * Interactive step
   */
  private async executeInteractiveStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    console.log(`Interactive: ${(step as any).prompt}`);
    return { userInput: null }; // Placeholder
  }

  /**
   * Execute shell command
   */
  private async executeShellActionStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    const { spawn } = await import('node:child_process');
    
    return new Promise((resolve, reject) => {
      const command = (step as any).command;
      const child = spawn(command, { 
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout, stderr });
        } else {
          reject(new WorkflowError(
            `Shell command failed with code ${code}: ${stderr}`,
            step.id
          ));
        }
      });

      child.on('error', (error) => {
        reject(new WorkflowError(
          `Shell command failed: ${error.message}`,
          step.id
        ));
      });
    });
  }

  /**
   * Execute AI prompt
   */
  private async executeAiPromptActionStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    console.log(`AI Prompt: ${(step as any).prompt}`);
    return { response: 'AI response placeholder' };
  }

  /**
   * Execute PR action
   */
  private async executePrActionStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    const prAction = step.action;
    const stepWithConfig = step as any;
    
    let command = 'gh pr';
    switch (prAction) {
      case 'create-pr':
        command += ` create --title "${stepWithConfig.title || 'Auto-generated PR'}"`;
        if (stepWithConfig.body) {
          command += ` --body "${stepWithConfig.body}"`;
        }
        if (stepWithConfig.base) {
          command += ` --base ${stepWithConfig.base}`;
        }
        break;
      case 'review-pr':
        command += ' review';
        break;
      case 'merge-pr':
        command += ' merge';
        break;
    }

    return this.executeShellActionStep({
      id: step.id,
      action: 'shell',
      command
    } as WorkflowStep, state);
  }

  /**
   * Execute Git action
   */
  private async executeGitActionStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
    const gitAction = step.action;
    const stepWithConfig = step as any;
    
    let command = 'git';
    switch (gitAction) {
      case 'commit':
        command += ` commit -m "${stepWithConfig.message || 'Auto-commit by workflow'}"`;
        break;
      case 'push':
        command += ' push';
        break;
      case 'pull':
        command += ' pull';
        break;
      case 'sync':
        command += ' fetch && git pull';
        break;
    }

    return this.executeShellActionStep({
      id: step.id,
      action: 'shell',
      command
    } as WorkflowStep, state);
  }

  /**
   * Substitute variables in strings
   */
  private substituteVariables(template: string, variables: Record<string, any>): string {
    return template.replace(/\$\{([^}]+)\}/g, (match, variableName) => {
      return variables[variableName] !== undefined ? String(variables[variableName]) : match;
    });
  }
}