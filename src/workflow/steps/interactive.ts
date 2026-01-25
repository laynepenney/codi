// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WorkflowStep,
  WorkflowState,
  InteractiveStep
} from '../types.js';

/**
 * Execute an interactive step
 */
export async function executeInteractiveStep(
  step: InteractiveStep,
  state: WorkflowState,
  agent?: any
): Promise<any> {
  // Create context to pass to the prompt system
  const context = {
    ...state.variables,
    agentAvailable: !!agent,
    stepCount: state.history.length,
    currentStep: state.currentStep,
    timestamp: new Date().toISOString()
  };

  // Enhanced interactive workflow functionality
  const result = {
    stepId: step.id,
    prompt: step.prompt,
    userInput: null, // To be filled by the actual user
    contextUsed: Object.keys(context),
    requiresInteraction: true,
    timestamp: new Date().toISOString(),
    metadata: {
      workflowName: state.name,
      totalSteps: state.history.filter(h => h.status === 'completed').length,
      currentIteration: state.iterationCount
    }
  };

  return result;
}

/**
 * Validate an interactive step
 */
export function validateInteractiveStep(step: InteractiveStep): void {
  if (!step.id || typeof step.id !== 'string') {
    throw new Error('Interactive step must have an id');
  }
  
  if (!step.prompt || typeof step.prompt !== 'string') {
    throw new Error(`Interactive step ${step.id} must specify a prompt`);
  }
  
  if (step.prompt.trim().length === 0) {
    throw new Error(`Interactive step ${step.id} prompt cannot be empty`);
  }
}