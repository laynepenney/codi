// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Agent } from '../../agent.js';
import { WorkflowStep, WorkflowState, WorkflowError, SwitchModelStep, isSwitchModelStep } from '../types.js';
import { createProvider, type BaseProvider } from '../../providers/index.js';

interface SwitchModelResult {
  success: boolean;
  previousProvider: {
    name: string;
    model: string;
  };
  newProvider: {
    name: string;
    model: string;
  };
  contextPreserved: boolean;
}

/**
 * Executes switch-model steps
 */
export async function executeSwitchModelStep(
  step: WorkflowStep,
  _state: WorkflowState,
  agent: Agent,
  availableModels: Map<string, BaseProvider>
): Promise<SwitchModelResult> {
  if (!isSwitchModelStep(step)) {
    throw new WorkflowError(
      `Step ${step.id} is not a valid switch-model step`,
      step.id
    );
  }

  const targetModel = step.model;

  if (!targetModel || typeof targetModel !== 'string') {
    throw new WorkflowError(
      `Switch-model step ${step.id} must specify a model`,
      step.id
    );
  }

  // Check if we have a provider for this model
  let provider = availableModels.get(targetModel);
  
  if (!provider) {
    try {
      // Create a new provider for this model
      // Parse model format: "provider:model" or just "model"
      const [providerName, modelName] = targetModel.includes(':') 
        ? targetModel.split(':', 2)
        : ['', targetModel];
      
      // Default to current provider if no provider specified
      const effectiveProvider = providerName || agent.getProvider().getName();
      const effectiveModel = modelName || targetModel;
      
      provider = createProvider({
        type: effectiveProvider,
        model: effectiveModel
      });
      
      // Cache the provider
      availableModels.set(targetModel, provider);
    } catch (error) {
      throw new WorkflowError(
        `Failed to create provider for model "${targetModel}": ${error instanceof Error ? error.message : String(error)}`,
        step.id
      );
    }
  }

  // Save current provider context before switching
  const previousProvider = agent.getProvider();
  const previousModel = previousProvider.getModel();
  
  // Switch to the new provider
  agent.setProvider(provider);

  return {
    success: true,
    previousProvider: {
      name: previousProvider.getName(),
      model: previousModel
    },
    newProvider: {
      name: provider.getName(),
      model: provider.getModel()
    },
    contextPreserved: true
  };
}

/**
 * Validates that a switch-model step has required properties
 */
export function validateSwitchModelStep(step: WorkflowStep): void {
  if (!isSwitchModelStep(step)) {
    throw new WorkflowError(
      `Step ${step.id} is not a valid switch-model step`,
      step.id
    );
  }

  if (!step.model || typeof step.model !== 'string') {
    throw new WorkflowError(
      `Switch-model step ${step.id} must specify a model`,
      step.id
    );
  }
}