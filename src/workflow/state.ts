// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import {
  WorkflowState,
  StepExecution,
  WorkflowError,
  WORKFLOW_STATE_DIR
} from './types.js';

const HOME_DIR = os.homedir();

/**
 * Manages workflow state persistence
 */
export class WorkflowStateManager {
  private stateDir: string;

  constructor() {
    this.stateDir = WORKFLOW_STATE_DIR.replace('~', HOME_DIR);
    this.ensureStateDir();
  }

  private ensureStateDir(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /**
   * Get state file path for a workflow
   */
  private getStateFilePath(workflowName: string): string {
    const safeName = workflowName.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.stateDir, `${safeName}.json`);
  }

  /**
   * Save workflow state
   */
  saveState(state: WorkflowState): void {
    try {
      const filePath = this.getStateFilePath(state.name);
      const content = JSON.stringify({
        ...state,
        updatedAt: new Date().toISOString()
      }, null, 2);
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      throw new WorkflowError(
        `Failed to save workflow state for ${state.name}: ${error instanceof Error ? error.message : String(error)}`,
        state.currentStep,
        state.name
      );
    }
  }

  /**
   * Load workflow state
   */
  loadState(workflowName: string): WorkflowState | null {
    try {
      const filePath = this.getStateFilePath(workflowName);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as WorkflowState;
    } catch (error) {
      throw new WorkflowError(
        `Failed to load workflow state for ${workflowName}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        workflowName
      );
    }
  }

  /**
   * Delete workflow state
   */
  deleteState(workflowName: string): void {
    try {
      const filePath = this.getStateFilePath(workflowName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      throw new WorkflowError(
        `Failed to delete workflow state for ${workflowName}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        workflowName
      );
    }
  }

  /**
   * Create initial state for a workflow
   */
  createInitialState(workflowName: string): WorkflowState {
    const now = new Date().toISOString();
    return {
      name: workflowName,
      currentStep: '', // Will be set when execution starts
      variables: {},
      history: [],
      iterationCount: 0,
      paused: false,
      completed: false,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Record a step execution
   */
  recordStepExecution(
    state: WorkflowState,
    stepId: string,
    status: StepExecution['status'],
    result?: any
  ): WorkflowState {
    const execution: StepExecution = {
      step: stepId,
      status,
      result,
      timestamp: new Date().toISOString()
    };

    const newState: WorkflowState = {
      ...state,
      history: [...state.history, execution],
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Update current step
   */
  updateCurrentStep(state: WorkflowState, stepId: string): WorkflowState {
    const newState: WorkflowState = {
      ...state,
      currentStep: stepId,
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Update workflow variables
   */
  updateVariables(state: WorkflowState, variables: Record<string, any>): WorkflowState {
    const newState: WorkflowState = {
      ...state,
      variables: { ...state.variables, ...variables },
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Mark workflow as completed
   */
  markCompleted(state: WorkflowState): WorkflowState {
    const newState: WorkflowState = {
      ...state,
      completed: true,
      paused: false,
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Pause workflow execution
   */
  pause(state: WorkflowState): WorkflowState {
    const newState: WorkflowState = {
      ...state,
      paused: true,
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Resume workflow execution
   */
  resume(state: WorkflowState): WorkflowState {
    const newState: WorkflowState = {
      ...state,
      paused: false,
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Increment iteration count (for loops)
   */
  incrementIteration(state: WorkflowState): WorkflowState {
    const newState: WorkflowState = {
      ...state,
      iterationCount: state.iterationCount + 1,
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * List all saved workflow states
   */
  listStates(): Array<{name: string; file: string; age: number}> {
    this.ensureStateDir();
    const states: Array<{name: string; file: string; age: number}> = [];
    
    try {
      const files = fs.readdirSync(this.stateDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.stateDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const state = JSON.parse(content) as WorkflowState;
            const age = Date.now() - new Date(state.updatedAt).getTime();
            states.push({
              name: state.name,
              file: filePath,
              age
            });
          } catch {
            // Skip corrupted state files
          }
        }
      }
    } catch {
      // Directory might not exist or be readable
    }
    
    return states;
  }
}