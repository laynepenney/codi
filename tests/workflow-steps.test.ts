// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { executeSwitchModelStep } from '../../src/workflow/steps/switch-model.js';
import { WorkflowState } from '../../src/workflow/types.js';

// Mock Agent class
class MockAgent {
  provider = {
    getName: () => 'ollama',
    getModel: () => 'llama3.2'
  };
  
  setProvider(newProvider: any) {
    this.provider = {
      getName: () => newProvider.type,
      getModel: () => newProvider.model
    };
  }
}

// Mock createProvider
vi.mock('../../../src/providers/index.js', () => ({
  createProvider: vi.fn((options) => ({
    type: options.type,
    model: options.model,
    getName: () => options.type,
    getModel: () => options.model
  }))
}));

describe('Model Switching', () => {
  let mockAgent: MockAgent;
  let availableModels: Map<string, any>;
  
  beforeEach(() => {
    mockAgent = new MockAgent();
    availableModels = new Map();
  });

  describe('executeSwitchModelStep', () => {
    it('switches to a valid model', async () => {
      const step = {
        id: 'switch-1',
        action: 'switch-model',
        model: 'llama3.2'
      };
      
      const state: WorkflowState = {
        name: 'test',
        currentStep: 'switch-1',
        variables: {},
        history: [],
        iterationCount: 0,
        paused: false,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await executeSwitchModelStep(step, state, mockAgent, availableModels);
      
      expect(result.success).toBe(true);
      expect(result.previousProvider.name).toBe('ollama');
      expect(result.newProvider.name).toBe('ollama'); // Should default to current provider
      expect(availableModels.has('llama3.2')).toBe(true);
    });

    it('throws error when model is not specified', async () => {
      const step = {
        id: 'switch-1',
        action: 'switch-model'
        // Missing model
      };
      
      const state: WorkflowState = {
        name: 'test',
        currentStep: 'switch-1',
        variables: {},
        history: [],
        iterationCount: 0,
        paused: false,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await expect(
        executeSwitchModelStep(step, state, mockAgent, availableModels)
      ).rejects.toThrow('Switch-model step switch-1 must specify a model');
    });

    it('handles provider:model format', async () => {
      const step = {
        id: 'switch-2',
        action: 'switch-model',
        model: 'anthropic:claude-3-haiku'
      };
      
      const state: WorkflowState = {
        name: 'test',
        currentStep: 'switch-2',
        variables: {},
        history: [],
        iterationCount: 0,
        paused: false,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await executeSwitchModelStep(step, state, mockAgent, availableModels);
      
      expect(result.success).toBe(true);
      expect(result.newProvider.name).toBe('anthropic');
      expect(result.newProvider.model).toBe('claude-3-haiku');
      expect(availableModels.has('anthropic:claude-3-haiku')).toBe(true);
    });
  });
});