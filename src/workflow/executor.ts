// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WorkflowStep,
  WorkflowState,
  WorkflowError
} from './types.js';

import {
  executeStep,
  validateStep
} from './steps/index.js';

/**
 * Executes individual workflow steps
 */
export class WorkflowExecutor {
  private agent?: any; // Will be Agent type
  private context?: any; // Will be CommandContext type
  private availableModels = new Map<string, any>();

  /**
   * Set agent reference for AI actions
   */
  setAgent(agent: any): void {
    this.agent = agent;
    // Pre-populate available models with current provider
    if (agent?.provider) {
      const key = `${agent.provider.getName()}:${agent.provider.getModel()}`;
      this.availableModels.set(key, agent.provider);
    }
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
    if (!this.agent) {
      throw new WorkflowError('Agent not available for step execution');
    }

    try {
      // Validate the step
      validateStep(step);
      
      // Execute the step
      return await executeStep(step, state, this.agent, this.availableModels);
    } catch (error) {
      if (error instanceof WorkflowError) {
        throw error;
      }
      throw new WorkflowError(
        `Failed to execute step ${step.id}: ${error instanceof Error ? error.message : String(error)}`,
        step.id,
        workflow.name
      );
    }
  }

  /**
   * Get available models
   */
  getAvailableModels(): Map<string, any> {
    return this.availableModels;
  }

  /**
   * Clear model cache
   */
  clearModelCache(): void {
    this.availableModels.clear();
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