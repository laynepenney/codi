// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Workflow,
  WorkflowState,
  WorkflowStep,
  StepExecution,
  WorkflowError
} from './types.js';
import { WorkflowExecutor } from './executor.js';
import { WorkflowStateManager } from './state.js';
import { listWorkflows, getWorkflowByName, loadWorkflow } from './parser.js';

export class WorkflowManager {
  private stateManager: WorkflowStateManager;
  private executor: WorkflowExecutor;
  private activeStates: Map<string, WorkflowState>;

  constructor() {
    this.stateManager = new WorkflowStateManager();
    this.executor = new WorkflowExecutor();
    this.activeStates = new Map();
  }

  /**
   * Start a new workflow execution
   */
  async startWorkflow(workflowName: string): Promise<WorkflowState> {
    // Load workflow definition
    const workflow = getWorkflowByName(workflowName);
    if (!workflow) {
      throw new WorkflowError(`Workflow "${workflowName}" not found`);
    }

    // Create initial state
    let state = this.stateManager.createInitialState(workflowName);
    
    // Set initial step (first step ID)
    const firstStep = workflow.steps[0];
    if (!firstStep) {
      throw new WorkflowError(`Workflow "${workflowName}" has no steps`);
    }

    state = this.stateManager.updateCurrentStep(state, firstStep.id);
    this.activeStates.set(workflowName, state);

    // Start execution
    return this.executeNextStep(state, workflow);
  }

  /**
   * Resume a paused workflow
   */
  async resumeWorkflow(workflowName: string): Promise<WorkflowState> {
    const state = this.stateManager.loadState(workflowName);
    if (!state) {
      throw new WorkflowError(`No saved state found for workflow "${workflowName}"`);
    }

    if (!state.paused) {
      throw new WorkflowError(`Workflow "${workflowName}" is not paused`);
    }

    const workflow = getWorkflowByName(workflowName);
    if (!workflow) {
      throw new WorkflowError(`Workflow "${workflowName}" not found`);
    }

    // Resume workflow
    const resumedState = this.stateManager.resume(state);
    this.activeStates.set(workflowName, resumedState);

    return this.executeNextStep(resumedState, workflow);
  }

  /**
   * Execute the next step in a workflow
   */
  private async executeNextStep(state: WorkflowState, workflow: Workflow): Promise<WorkflowState> {
    if (state.completed) {
      return state; // Workflow is already complete
    }

    if (state.paused) {
      return state; // Workflow is paused
    }

    const stepId = state.currentStep;
    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) {
      throw new WorkflowError(`Step "${stepId}" not found in workflow "${workflow.name}"`);
    }

    try {
      // Record step start
      state = this.stateManager.recordStepExecution(state, stepId, 'running');

      // Execute the step
      const result = await this.executor.executeStep(step, state, workflow);
      
      // Record step completion
      state = this.stateManager.recordStepExecution(state, stepId, 'completed', result);

      // Determine next step
      const nextStepId = this.determineNextStep(step, result, workflow);
      
      if (nextStepId) {
        state = this.stateManager.updateCurrentStep(state, nextStepId);
        
        // Continue execution
        return this.executeNextStep(state, workflow);
      } else {
        // Workflow complete
        return this.stateManager.markCompleted(state);
      }

    } catch (error) {
      // Record step failure
      const failedState = this.stateManager.recordStepExecution(
        state, 
        stepId, 
        'failed', 
        error instanceof Error ? error.message : String(error)
      );

      // Don't continue execution on failure
      return failedState;
    }
  }

  /**
   * Determine the next step based on step type and result
   */
  private determineNextStep(step: WorkflowStep, result: any, workflow: Workflow): string | null {
    switch (step.action) {
      case 'conditional':
        return result.nextStep || null;
      
      case 'loop':
        return result.shouldLoop ? step.to as string : null;
      
      default:
        // Linear execution - find next step by index
        const currentIndex = workflow.steps.findIndex(s => s.id === step.id);
        if (currentIndex < workflow.steps.length - 1) {
          return workflow.steps[currentIndex + 1].id;
        }
        return null;
    }
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateCondition(condition: string, context: any): boolean {
    // Simple condition evaluation for now
    // TODO: Implement safe JavaScript evaluation
    const simpleConditions: Record<string, (ctx: any) => boolean> = {
      'true': () => true,
      'false': () => false,
      'approved': (ctx) => ctx?.approved === true,
      'file-exists': (ctx) => ctx?.fileExists === true || ctx?.exists === true,
      'variable-equals': (ctx) => {
        // Format: variable-equals|varname|value
        const parts = condition.split('|');
        if (parts.length >= 3) {
          return ctx[parts[1]] === parts[2];
        }
        return false;
      }
    };

    if (condition in simpleConditions) {
      return simpleConditions[condition](context);
    }

    // Default to true if condition is not recognized
    console.warn(`Unknown condition: ${condition}, defaulting to true`);
    return true;
  }

  /**
   * Pause the current workflow execution
   */
  pauseWorkflow(workflowName: string): WorkflowState {
    const state = this.activeStates.get(workflowName);
    if (!state) {
      throw new WorkflowError(`No active workflow "${workflowName}" found`);
    }

    const pausedState = this.stateManager.pause(state);
    this.activeStates.set(workflowName, pausedState);
    return pausedState;
  }

  /**
   * Get current status of a workflow
   */
  getWorkflowStatus(workflowName: string): WorkflowState | null {
    return this.activeStates.get(workflowName) || this.stateManager.loadState(workflowName);
  }

  /**
   * List all available workflows
   */
  listAvailableWorkflows(): ReturnType<typeof listWorkflows> {
    return listWorkflows();
  }

  /**
   * Load a workflow definition from file
   */
  loadWorkflowFromFile(filePath: string): Workflow {
    return loadWorkflow(filePath);
  }

  /**
   * Clean up resources for a workflow
   */
  cleanupWorkflow(workflowName: string): void {
    this.activeStates.delete(workflowName);
    this.stateManager.deleteState(workflowName);
  }

  /**
   * Get execution history for a workflow
   */
  getExecutionHistory(workflowName: string): StepExecution[] {
    const state = this.stateManager.loadState(workflowName);
    return state?.history || [];
  }

  /**
   * Get all active workflows
   */
  getActiveWorkflows(): WorkflowState[] {
    return Array.from(this.activeStates.values());
  }

  /**
   * Get the workflow executor
   */
  getExecutor(): WorkflowExecutor {
    return this.executor;
  }

  /**
   * Stop execution of an active workflow
   */
  stopWorkflow(workflowName: string): WorkflowState {
    const state = this.activeStates.get(workflowName);
    if (!state) {
      throw new WorkflowError(`No active workflow "${workflowName}" found`);
    }

    const stoppedState = this.stateManager.pause(state);
    this.activeStates.delete(workflowName);
    return stoppedState;
  }
}