// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../src/agent.js';
import { createProvider } from '../src/providers/index.js';

// Mock tool registry
const mockToolRegistry = {
  getDefinitions: () => [],
  getTool: () => null,
  hasTool: () => false,
  isAutoApproved: () => false
};

describe('Agent Provider Change Callback', () => {
  it('should call onProviderChange callback when provider is changed via setProvider', async () => {
    const onProviderChange = vi.fn();

    const provider1 = createProvider({
      type: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      apiKey: 'test-key-1'
    });

    const provider2 = createProvider({
      type: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key-2'
    });

    const agent = new Agent({
      provider: provider1,
      toolRegistry: mockToolRegistry as any,
      onProviderChange,
      useTools: false  // Disable tool use for this test
    });

    // Initial provider should not trigger callback
    expect(onProviderChange).not.toHaveBeenCalled();

    // Change provider
    agent.setProvider(provider2);

    // Callback should be called with new provider
    expect(onProviderChange).toHaveBeenCalledTimes(1);
    expect(onProviderChange).toHaveBeenCalledWith(provider2);

    // Verify provider actually changed
    const currentProvider = agent.getProvider();
    expect(currentProvider.getName()).toBe('OpenAI');
    expect(currentProvider.getModel()).toBe('gpt-4o');
  });

  it('should handle missing onProviderChange callback gracefully', async () => {
    const provider1 = createProvider({
      type: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      apiKey: 'test-key-1'
    });

    const provider2 = createProvider({
      type: 'anthropic',
      model: 'claude-3-5-haiku-latest',
      apiKey: 'test-key-2'
    });

    // Create agent without onProviderChange callback
    const agent = new Agent({
      provider: provider1,
      toolRegistry: mockToolRegistry as any,
      useTools: false
    });

    // Should not throw error
    expect(() => {
      agent.setProvider(provider2);
    }).not.toThrow();
  });

  it('should update ink UI status when provider changes', async () => {
    // This test verifies the integration with ink UI
    const mockStatusUpdates: Array<{provider: string; model?: string}> = [];

    const mockInkController = {
      setStatus: (status: any) => {
        mockStatusUpdates.push(status);
      }
    };

    const provider1 = createProvider({
      type: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      apiKey: 'test-key-1'
    });

    const provider2 = createProvider({
      type: 'anthropic',
      model: 'claude-3-5-haiku-latest',
      apiKey: 'test-key-2'
    });

    const agent = new Agent({
      provider: provider1,
      toolRegistry: mockToolRegistry as any,
      useTools: false,
      onProviderChange: (newProvider) => {
        // Simulate ink UI update
        mockInkController.setStatus({
          provider: newProvider.getName(),
          model: newProvider.getModel()
        });
      }
    });

    // Change provider
    agent.setProvider(provider2);

    // Verify mock status was updated
    expect(mockStatusUpdates).toHaveLength(1);
    expect(mockStatusUpdates[0]).toEqual({
      provider: 'Anthropic',
      model: 'claude-3-5-haiku-latest'
    });
  });
});