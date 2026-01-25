// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkflowStep, WorkflowState, ConditionalStep, CheckFileExistsStep, LoopStep, InteractiveStep } from '../types.js';
import { executeSwitchModelStep, validateSwitchModelStep } from './switch-model.js';
import { executeConditionalStep, validateConditionalStep } from './conditional.js';
import { executeCheckFileExistsStep, validateCheckFileExistsStep } from './file-exists.js';
import { executeLoopStep, validateLoopStep } from './loop.js';
import { executeInteractiveStep, validateInteractiveStep } from './interactive.js';

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
      return executeShellActionStep(step, state);
    
    case 'ai-prompt':
      console.log(`AI Prompt: ${(step as any).prompt}`);
      return { response: 'AI response placeholder' };
    
    case 'create-pr':
    case 'review-pr':
    case 'merge-pr':
      return executePrActionStep(step, state);
    
    case 'commit':
    case 'push':
    case 'pull':
    case 'sync':
      return executeGitActionStep(step, state);
    
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

// Placeholder implementations for shell actions
async function executeShellActionStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
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
        reject(new Error(`Shell command failed with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Shell command failed: ${error.message}`));
    });
  });
}

// Placeholder implementations for Git/PR actions
async function executePrActionStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
  return executeShellActionStep({
    id: step.id,
    action: 'shell',
    command: 'echo "PR action placeholder"'
  }, state);
}

async function executeGitActionStep(step: WorkflowStep, state: WorkflowState): Promise<any> {
  return executeShellActionStep({
    id: step.id,
    action: 'shell',
    command: 'echo "Git action placeholder"'
  }, state);
}