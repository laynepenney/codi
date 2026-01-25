// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WorkflowStep,
  WorkflowState,
  InteractiveStep
} from '../types.js';

// Extended interface for enhanced interactive steps
interface EnhancedInteractiveStep extends InteractiveStep {
  inputType?: 'text' | 'password' | 'confirm' | 'choice' | 'multiline';
  timeoutMs?: number;
  defaultValue?: string;
  validationPattern?: string;
  choices?: string[];
}

/**
 * Execute an interactive step with enhanced features
 */
export async function executeInteractiveStep(
  step: InteractiveStep,
  state: WorkflowState,
  agent?: any
): Promise<any> {
  // Enhanced interactive step properties
  const enhancedStep = step as InteractiveStep & {
    inputType?: 'text' | 'password' | 'confirm' | 'choice' | 'multiline';
    timeoutMs?: number;
    defaultValue?: string;
    validationPattern?: string;
    choices?: string[];
  };

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
    inputType: enhancedStep.inputType || 'text',
    timeoutMs: enhancedStep.timeoutMs || 0, // 0 means no timeout
    defaultValue: enhancedStep.defaultValue || '',
    validationPattern: enhancedStep.validationPattern || '',
    choices: enhancedStep.choices || [],
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
 * Validate an interactive step with enhanced validation
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

  // Enhanced validation for additional properties
  const enhancedStep = step as InteractiveStep & {
    inputType?: 'text' | 'password' | 'confirm' | 'choice' | 'multiline';
    timeoutMs?: number;
    defaultValue?: string;
    validationPattern?: string;
    choices?: string[];
  };

  // Validate inputType if specified
  if (enhancedStep.inputType) {
    const validTypes = ['text', 'password', 'confirm', 'choice', 'multiline'] as const;
    if (!validTypes.includes(enhancedStep.inputType)) {
      throw new Error(`Interactive step ${step.id} has invalid inputType: ${enhancedStep.inputType}`);
    }
  }

  // Validate timeout if specified
  if (enhancedStep.timeoutMs !== undefined) {
    if (typeof enhancedStep.timeoutMs !== 'number' || enhancedStep.timeoutMs < 0) {
      throw new Error(`Interactive step ${step.id} timeoutMs must be a non-negative number`);
    }
  }

  // Validate validationPattern if specified
  if (enhancedStep.validationPattern) {
    try {
      new RegExp(enhancedStep.validationPattern);
    } catch (e) {
      throw new Error(`Interactive step ${step.id} has invalid validationPattern: ${enhancedStep.validationPattern}`);
    }
  }

  // Validate choices for choice input type
  if (enhancedStep.inputType === 'choice' && (!enhancedStep.choices || enhancedStep.choices.length === 0)) {
    throw new Error(`Interactive step ${step.id} with inputType 'choice' must specify choices array`);
  }
}