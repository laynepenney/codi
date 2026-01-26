// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowManager, WorkflowExecutor } from '../src/workflow/index.js';
import { MockProvider, createMockAgent } from './workflow-mocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.join(__dirname, '..', 'workflows');

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

      // Mock workflow steps execution
      mockAgent.executeStep = vi.fn().mockImplementation(async () => {
        return { status: 'completed', result: 'step executed successfully' };
      });

      // Execute PR review workflow
      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow executed
      expect(result).toBeDefined();
      expect(result.name).toBe('pr-review');
      expect(result.history.length).toBeGreaterThan(0);
      
      // Verify workflow followed the expected path
      expect(result.history.some(h => h.status === 'completed')).toBe(true);
    });

    it('should handle PR-specific scenarios', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Mock provider responses for PR review scenarios
      mockProviders.forEach(provider => {
        vi.spyOn(provider, 'generateResponse').mockImplementation(async (prompt) => {
          if (prompt.includes('changes')) {
            return `PR Analysis: Found ${prompt.includes('critical') ? 'critical' : 'minor'} issues`;
          }
          if (prompt.includes('synthesize')) {
            return '## PR Review Synthesis\n\nCritical issues: 0\nImportant improvements: 2\nNice-to-have: 3';
          }
          return `Mock PR review response for: ${prompt.substring(0, 50)}`;
        });
      });

      const result = await manager.startWorkflow('pr-review');
      
      // Verify workflow completed with PR-specific responses
      expect(result).toBeDefined();
      const finalHistory = result.history.slice(-1)[0];
      expect(finalHistory.result).toContain('step executed successfully');
    });

    it('should handle GitHub PR review format generation', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Mock final GitHub review generation
      mockAgent.executeStep = vi.fn().mockImplementation(async (stepInfo) => {
        if (stepInfo.id === 'generate-review-summary') {
          return {
            status: 'completed',
            result: `## PR Review Summary\n\n**Approved with comments**\n\nOverall code quality is good with minor suggestions:\n- Add more test coverage for edge cases\n- Improve error handling messages\n- Consider using newer patterns for better maintainability`
          };
        }
        return { status: 'completed', result: 'default step result' };
      });

      const result = await manager.startWorkflow('pr-review');
      
      // Verify GitHub format was generated
      expect(result.history.some(h => h.result.includes('PR Review Summary'))).toBe(true);
      expect(result.history.some(h => h.result.includes('Approved'))).toBe(true);
    });
  });

  describe('Multi-Model PR Review Integration', () => {
    it('should switch between models for different PR review stages', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Track model switches
      const modelSwitches: string[] = [];
      mockAgent.setProvider.mockImplementation((provider) => {
        modelSwitches.push(provider.getName());
        mockAgent.provider = provider;
      });

      mockAgent.executeStep = vi.fn().mockImplementation(async () => {
        return { status: 'completed', result: 'step completed' };
      });

      await manager.startWorkflow('pr-review');
      
      // Verify models were switched for different review stages
      expect(modelSwitches.length).toBeGreaterThan(0);
      expect(modelSwitches).toEqual(expect.arrayContaining(['anthropic', 'openai', 'ollama']));
    });

    it('should use appropriate models for each PR review phase', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      const modelUsage: Record<string, string> = {};
      mockAgent.executeStep = vi.fn().mockImplementation(async (stepInfo) => {
        // Capture which model is being used for each step
        const currentModel = mockAgent.provider.getModel();
        modelUsage[stepInfo.id] = currentModel;
        
        return { status: 'completed', result: `Executed ${stepInfo.id} with ${currentModel}` };
      });

      await manager.startWorkflow('pr-review');
      
      // Verify appropriate model usage
      expect(modelUsage['analyze-pr-changes']).toBe('claude-3-5-haiku-latest'); // Fast model
      expect(modelUsage['detailed-code-review']).toBe('claude-sonnet-4-20250514'); // Detailed model
      expect(modelUsage['synthesize-review']).toBe('llama3.2'); // Synthesis model
    });
  });

  describe('PR Review Workflow Error Handling', () => {
    it('should handle model switching failures gracefully', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Mock model switching failure
      mockAgent.setProvider.mockImplementation(() => {
        throw new Error('Model not available');
      });

      mockAgent.executeStep = vi.fn().mockImplementation(async (stepInfo) => {
        // Allow initial step to succeed, fail on model switch
        if (stepInfo.id === 'analyze-pr-changes') {
          return { status: 'completed', result: 'initial analysis complete' };
        }
        return { status: 'failed', result: 'model switch failed' };
      });

      const result = await manager.startWorkflow('pr-review');
      
      // Verify graceful failure handling
      expect(result.history.some(h => h.status === 'failed')).toBe(true);
      expect(result.history.some(h => h.result === 'model switch failed')).toBe(true);
    });

    it('should handle PR-specific errors', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Mock PR-specific error scenario
      mockAgent.executeStep = vi.fn().mockImplementation(async (stepInfo) => {
        if (stepInfo.id === 'generate-review-summary') {
          return {
            status: 'failed',
            result: 'Failed to generate GitHub review format: Invalid PR diff format'
          };
        }
        return { status: 'completed', result: 'step completed' };
      });

      const result = await manager.startWorkflow('pr-review');
      
      // Verify PR-specific error handling
      expect(result.history.find(h => h.status === 'failed')?.result)
        .toContain('GitHub review format');
    });
  });

  describe('PR Review Workflow Output Quality', () => {
    it('should generate actionable PR feedback', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Mock high-quality PR review responses
      mockAgent.executeStep = vi.fn().mockImplementation(async (stepInfo) => {
        let result = 'Standard step output';
        
        if (stepInfo.id === 'detailed-code-review') {
          result = `## Code Review\n\n- **Critical Issues**: None\n- **High Priority**: Improve error handling\n- **Optional**: Add more comments`;
        } else if (stepInfo.id === 'synthesize-review') {
          result = '## Synthesis\n\n**Approval**: Approved with comments\n**Key Issues**: Error handling needs improvement\n**Follow-up**: Add tests for edge cases';
        } else if (stepInfo.id === 'generate-review-summary') {
          result = `## GitHub PR Review\n\n**Changes requested**:\n- Fix error handling in main function\n- Add test coverage for new features\n\n**Comments**: Overall good implementation, needs minor improvements.`;
        }
        
        return { status: 'completed', result };
      });

      const result = await manager.startWorkflow('pr-review');
      
      // Verify actionable feedback was generated
      const finalOutput = result.history.slice(-1)[0].result;
      expect(finalOutput).toContain('GitHub PR Review');
      expect(finalOutput).toContain('Changes requested');
      expect(finalOutput).toContain('Approved');
    });

    it('should provide code review best practices', async () => {
      const executor = manager.getExecutor();
      executor.setAgent(mockAgent as any);

      // Mock best practices output
      mockAgent.executeStep = vi.fn().mockImplementation(async (stepInfo) => {
        if (stepInfo.id === 'detailed-code-review') {
          return {
            status: 'completed',
            result: `## Code Review Best Practices Applied\n\n**Testing**: Coverage increased from 80% to 95%\n**Performance**: Optimized database queries\n**Security**: Input validation implemented`
          };
        }
        return { status: 'completed', result: 'standard output' };
      });

      const result = await manager.startWorkflow('pr-review');
      
      // Verify best practices are included
      const reviewStep = result.history.find(h => h.result.includes('Best Practices'));
      expect(reviewStep).toBeDefined();
      expect(reviewStep.result).toContain('Testing');
      expect(reviewStep.result).toContain('Performance');
      expect(reviewStep.result).toContain('Security');
    });
  });
});