// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WorkflowStep, WorkflowState, WorkflowError } from '../types.js';
import { createProvider, type BaseProvider } from '../../providers/index.js';

/**
 * Executes switch-model steps
 */
export async function executeSwitchModelStep(
  step: WorkflowStep,
  state: WorkflowState,
  agent: any,
  availableModels: Map<string, BaseProvider>
): Promise<any> {
  const targetModel = (step as any).model;
  
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
      const effectiveProvider = providerName || agent.provider.getName();
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
  const previousProvider = agent.provider;
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
  if (!(step as any).model || typeof (step as any).model !== 'string') {
    throw new WorkflowError(
      `Switch-model step ${step.id} must specify a model`,
      step.id
    );
  }
}