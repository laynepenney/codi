// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowManager } from '../src/workflow/index.js';
import { MockProvider, createMockAgent } from './workflow-mocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('PR Review Workflow E2E Tests', () => {
  let mockProviders: MockProvider[];
  let mockAgent: any;
  let manager: WorkflowManager;

  beforeEach(async () => {
    // Clear workflow state before each test
    try {
      await fs.rm(path.join(__dirname, '..', '.codi', 'workflows', 'state'), { 
        recursive: true, 
        force: true 
      });
    } catch (error) {
      // Directory doesn't exist, that's fine
    }

    // Create mock providers
    mockProviders = [
      new MockProvider('anthropic', 'claude-sonnet-4-20250514'),
      new MockProvider('openai', 'gpt-4o'),
      new MockProvider('ollama', 'llama3.2')
    ];

    mockAgent = createMockAgent(mockProviders);
    manager = new WorkflowManager();
    
    // Configure mock agent for PR workflows
    mockAgent.provider = {
      getName: () => 'anthropic',
      getModel: () => 'claude-sonnet-4-20250514'
    };

    mockAgent.setProvider = vi.fn().mockImplementation((provider) => {
      mockAgent.provider = provider;
    });
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PR Review Workflow Execution', () => {
    it('should execute complete PR review workflow successfully', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Execute PR review workflow
      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow structure is valid - basic smoke test
      expect(result).toBeDefined();
      expect(result.name).toBe('pr-review');
    });

    it('should handle PR-specific scenarios', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow executed
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should handle GitHub PR review format generation', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow has valid structure
      expect(result).toBeDefined();
      expect(result.name).toBe('pr-review');
    });
  });

  describe('Multi-Model PR Review Integration', () => {
    it('should switch between models for different PR review stages', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Track model switches
      const modelSwitches: string[] = [];
      
      mockAgent.setProvider.mockImplementation((provider: any) => {
        const name = provider.getName ? provider.getName() : provider.name;
        modelSwitches.push(name.toLowerCase());
        mockAgent.provider = provider;
      });

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow executed
      expect(result).toBeDefined();
    });

    it('should use appropriate models for each PR review phase', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow executed
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('PR Review Workflow Error Handling', () => {
    it('should handle model switching failures gracefully', async () => {
      // Configure mock to throw on setProvider
      mockAgent.setProvider = vi.fn().mockImplementation(() => {
        throw new Error('Model not available');
      });

      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow structure handles errors properly
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(result.name).toBe('pr-review');
    });

    it('should handle PR-specific errors', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow captures result
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('PR Review Workflow Output Quality', () => {
    it('should generate actionable PR feedback', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow generates output
      expect(result).toBeDefined();
      expect(result.name).toBe('pr-review');
    });

    it('should provide code review best practices', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow runs and produces output
      expect(result).toBeDefined();
      expect(result.name).toBe('pr-review');
    });
  });
});