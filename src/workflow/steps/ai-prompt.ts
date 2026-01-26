// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkflowStep, WorkflowState, AiPromptActionStep } from '../types.js';

export interface AiPromptResult {
  response: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Execute an AI prompt action step
 */
export async function executeAiPromptActionStep(
  step: AiPromptActionStep,
  state: WorkflowState,
  agent: any
): Promise<AiPromptResult> {
  if (!agent) {
    throw new Error('AI prompt action requires agent context');
  }
  
  // Expand state variables in prompt
  let prompt = step.prompt;
  const variables = state.variables || {};
  
  // Replace {{variable}} patterns
  prompt = prompt.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return variables[varName] !== undefined ? String(variables[varName]) : match;
  });
  
  try {
    // Use the agent's current model, or override with step-specific model
    const model = step.model || agent.currentModel;
    
    // Set model if specified
    if (step.model) {
      await agent.switchModel(step.model);
    }
    
    // Execute the prompt and get response
    const response = await agent.chat(prompt);
    
    const result: AiPromptResult = {
      response: response.text || response.response || 'No response generated',
      metadata: {
        model: model,
        prompt: prompt
      }
    };
    
    // Store the result in variables for future steps
    state.variables = state.variables || {};
    state.variables[`${step.id}_response`] = result.response;
    state.variables[`${step.id}_metadata`] = result.metadata;
    
    return result;
    
  } catch (error) {
    throw new Error(`AI prompt execution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate an AI prompt action step
 */
export function validateAiPromptActionStep(step: AiPromptActionStep): void {
  if (!step.prompt || typeof step.prompt !== 'string') {
    throw new Error('AI prompt action must have a prompt');
  }
  
  // Validate prompt length
  if (step.prompt.trim().length === 0) {
    throw new Error('AI prompt cannot be empty');
  }
  
  // If model is specified, validate it
  if (step.model && typeof step.model !== 'string') {
    throw new Error('AI prompt model must be a string');
  }
}