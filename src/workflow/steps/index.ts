// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Agent } from '../../agent.js';
import type { BaseProvider } from '../../providers/base.js';
import type {
  WorkflowStep,
  WorkflowState,
  LoopStep,
  InteractiveStep,
  ShellActionStep,
  AiPromptActionStep,
  GitActionStep,
  PrActionStep,
} from '../types.js';
import {
  isConditionalStep,
  isCheckFileExistsStep,
  isLoopStep,
  isInteractiveStep,
  isShellStep,
  isAiPromptStep,
  isPrActionStep,
  isGitActionStep,
} from '../types.js';
import { executeSwitchModelStep, validateSwitchModelStep } from './switch-model.js';
import { executeConditionalStep, validateConditionalStep } from './conditional.js';
import { executeCheckFileExistsStep, validateCheckFileExistsStep } from './file-exists.js';
import { executeLoopStep, validateLoopStep } from './loop.js';
import { executeInteractiveStep, validateInteractiveStep } from './interactive.js';
import { executeShellActionStep, validateShellActionStep } from './shell.js';
import { executeAiPromptActionStep, validateAiPromptActionStep } from './ai-prompt.js';
import { executeGitActionStep, validateGitActionStep } from './git.js';
import { executePrActionStep, validatePrActionStep } from './pr.js';

/**
 * Execute any workflow step
 */
export async function executeStep(
  step: WorkflowStep,
  state: WorkflowState,
  agent: Agent,
  availableModels: Map<string, BaseProvider>
): Promise<unknown> {
  switch (step.action) {
    case 'switch-model':
      return executeSwitchModelStep(step, state, agent, availableModels);

    case 'conditional':
      if (isConditionalStep(step)) {
        return executeConditionalStep(step, state, agent);
      }
      throw new Error(`Invalid conditional step: ${step.id}`);

    case 'check-file-exists':
      if (isCheckFileExistsStep(step)) {
        return executeCheckFileExistsStep(step, state, agent);
      }
      throw new Error(`Invalid check-file-exists step: ${step.id}`);

    case 'loop':
      if (isLoopStep(step)) {
        return executeLoopStep(step, state, agent);
      }
      throw new Error(`Invalid loop step: ${step.id}`);

    case 'interactive':
      if (isInteractiveStep(step)) {
        return executeInteractiveStep(step, state, agent);
      }
      throw new Error(`Invalid interactive step: ${step.id}`);

    case 'shell':
      if (isShellStep(step)) {
        return executeShellActionStep(step, state, agent);
      }
      throw new Error(`Invalid shell step: ${step.id}`);

    case 'ai-prompt':
      if (isAiPromptStep(step)) {
        return executeAiPromptActionStep(step, state, agent);
      }
      throw new Error(`Invalid ai-prompt step: ${step.id}`);

    case 'create-pr':
    case 'review-pr':
    case 'merge-pr':
      if (isPrActionStep(step)) {
        return executePrActionStep(step, state, agent);
      }
      throw new Error(`Invalid PR action step: ${step.id}`);

    case 'commit':
    case 'push':
    case 'pull':
    case 'sync':
      if (isGitActionStep(step)) {
        return executeGitActionStep(step, state, agent);
      }
      throw new Error(`Invalid git action step: ${step.id}`);

    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

/**
 * Validate a workflow step
 */
export function validateStep(step: WorkflowStep): void {
  // Basic validation for all steps
  if (!step.id || typeof step.id !== 'string') {
    throw new Error('Step must have an id');
  }
  if (!step.action || typeof step.action !== 'string') {
    throw new Error('Step must have an action');
  }

  switch (step.action) {
    case 'switch-model':
      validateSwitchModelStep(step);
      break;

    case 'conditional':
      if (isConditionalStep(step)) {
        validateConditionalStep(step);
      }
      break;

    case 'check-file-exists':
      if (isCheckFileExistsStep(step)) {
        validateCheckFileExistsStep(step);
      }
      break;

    case 'loop':
      if (isLoopStep(step)) {
        validateLoopStep(step);
      }
      break;

    case 'interactive':
      if (isInteractiveStep(step)) {
        validateInteractiveStep(step);
      }
      break;

    case 'shell':
      if (isShellStep(step)) {
        validateShellActionStep(step);
      }
      break;

    case 'ai-prompt':
      if (isAiPromptStep(step)) {
        validateAiPromptActionStep(step);
      }
      break;

    case 'create-pr':
    case 'review-pr':
    case 'merge-pr':
      if (isPrActionStep(step)) {
        validatePrActionStep(step);
      }
      break;

    case 'commit':
    case 'push':
    case 'pull':
    case 'sync':
      if (isGitActionStep(step)) {
        validateGitActionStep(step);
      }
      break;

    default:
      // Unknown action types pass through with basic validation only
      break;
  }
}
