// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkflowStep, WorkflowState, ConditionalStep, CheckFileExistsStep, LoopStep, InteractiveStep } from '../types.js';
import { executeSwitchModelStep, validateSwitchModelStep } from './switch-model.js';
import { executeConditionalStep, validateConditionalStep } from './conditional.js';
import { executeCheckFileExistsStep, validateCheckFileExistsStep } from './file-exists.js';
import { executeLoopStep, validateLoopStep } from './loop.js';
import { executeInteractiveStep, validateInteractiveStep } from './interactive.js';

import { executeShellActionStep, validateShellActionStep } from './shell.js';
import { executeAiPromptActionStep, validateAiPromptActionStep } from './ai-prompt.js';
import { executeGitActionStep, validateGitActionStep } from './git.js';
import { executePrActionStep, validatePrActionStep } from './pr.js';

// Type imports for proper casting
import type { ShellActionStep, AiPromptActionStep, GitActionStep, PrActionStep } from '../types.js';
/**
 * Execute any workflow step
 */
export async function executeStep(
  step: WorkflowStep,
  state: WorkflowState,
  agent: any,
  availableModels: Map<string, any>
): Promise<any> {
  switch (step.action) {
    case 'switch-model':
      return executeSwitchModelStep(step, state, agent, availableModels);
    
    case 'conditional':
      return executeConditionalStep(step as ConditionalStep, state, agent);
    
    case 'check-file-exists':
      return executeCheckFileExistsStep(step as CheckFileExistsStep, state, agent);
    
    case 'loop':
      return executeLoopStep(step as LoopStep, state, agent);
    
    case 'interactive':
      return executeInteractiveStep(step as InteractiveStep, state, agent);
    
    case 'shell':
      return executeShellActionStep(step as ShellActionStep, state, agent);
    
    case 'ai-prompt':
      return executeAiPromptActionStep(step as AiPromptActionStep, state, agent);
    
    case 'create-pr':
    case 'review-pr':
    case 'merge-pr':
      return executePrActionStep(step as PrActionStep, state, agent);
    
    case 'commit':
    case 'push':
    case 'pull':
    case 'sync':
      return executeGitActionStep(step as GitActionStep, state, agent);
    
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

/**
 * Validate a workflow step
 */
export function validateStep(step: WorkflowStep): void {
  switch (step.action) {
    case 'switch-model':
      validateSwitchModelStep(step);
      break;
    
    case 'conditional':
      validateConditionalStep(step as ConditionalStep);
      break;
    
    case 'check-file-exists':
      validateCheckFileExistsStep(step as CheckFileExistsStep);
      break;
    
    case 'loop':
      validateLoopStep(step as LoopStep);
      break;
    
    case 'shell':
      validateShellActionStep(step as ShellActionStep);
      break;
    
    case 'ai-prompt':
      validateAiPromptActionStep(step as AiPromptActionStep);
      break;
    
    case 'create-pr':
    case 'review-pr':
    case 'merge-pr':
      validatePrActionStep(step as PrActionStep);
      break;
    
    case 'commit':
    case 'push':
    case 'pull':
    case 'sync':
      validateGitActionStep(step as GitActionStep);
      break;
    
    case 'interactive':
      validateInteractiveStep(step as InteractiveStep);
      break;
    
    // Add validation for other step types as needed
    default:
      // Basic validation for all steps
      if (!step.id || typeof step.id !== 'string') {
        throw new Error('Step must have an id');
      }
      if (!step.action || typeof step.action !== 'string') {
        throw new Error('Step must have an action');
      }
    }
  }
