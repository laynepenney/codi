// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WorkflowStep,
  WorkflowState,
  LoopStep
} from '../types.js';
import { evaluateCondition } from './conditional.js';

/**
 * Execute a loop step
 */
export async function executeLoopStep(
  step: LoopStep,
  state: WorkflowState,
  agent?: any
): Promise<any> {
  // Increment iteration count for this loop
  const currentIteration = state.iterationCount + 1;
  const maxIterations = step.maxIterations || Number.MAX_SAFE_INTEGER;
  
  // Check if we've exceeded the maximum iterations
  if (currentIteration > maxIterations) {
    return {
      iterationCount: currentIteration - 1,
      maxIterations,
      condition: step.condition,
      shouldLoop: false,
      loopExceeded: true,
      reason: `Maximum iterations (${maxIterations}) exceeded`
    };
  }

  // Create context for condition evaluation
  const context = {
    ...state.variables,
    iteration: currentIteration,
    maxIterations,
    agentAvailable: !!agent,
    stepCount: state.history.length
  };

  // Evaluate the loop condition
  const shouldLoop = evaluateCondition(step.condition, context);
  
  return {
    iterationCount: currentIteration,
    maxIterations,
    condition: step.condition,
    shouldLoop,
    targetStep: step.to,
    contextUsed: Object.keys(context)
  };
}

/**
 * Validate a loop step
 */
export function validateLoopStep(step: LoopStep): void {
  if (!step.id || typeof step.id !== 'string') {
    throw new Error('Loop step must have an id');
  }
  
  if (!step.to || typeof step.to !== 'string') {
    throw new Error(`Loop step ${step.id} must specify target step`);
  }
  
  if (!step.condition || typeof step.condition !== 'string') {
    throw new Error(`Loop step ${step.id} must specify a condition`);
  }
  
  // Validate maxIterations if specified
  if (step.maxIterations !== undefined) {
    if (typeof step.maxIterations !== 'number' || step.maxIterations < 1) {
      throw new Error(`Loop step ${step.id} must specify a positive integer for maxIterations`);
    }
  }
}