import { workflowBuildCommand } from '../src/commands/workflow-ai-builder.js';
import { describe, it, expect, vi } from 'vitest';

describe('Workflow AI Builder Command', () => {
  it('should register the workflow-build command', () => {
    expect(workflowBuildCommand.name).toBe('workflow-build');
    expect(workflowBuildCommand.aliases).toContain('wbuild');
    expect(workflowBuildCommand.description).toBe('AI-assisted workflow creation');
  });

  it('should have proper usage information', () => {
    expect(workflowBuildCommand.usage).toContain('workflow-build');
  });

  it('should handle empty args', async () => {
    const mockContext = {};
    const result = await workflowBuildCommand.execute('', mockContext);
    
    expect(result).toContain('AI-Assisted Workflow Builder');
    expect(result).toContain('/workflow-build');
  });

  it('should handle template listing', async () => {
    const mockContext = {};
    const result = await workflowBuildCommand.execute('template list', mockContext);
    
    expect(result).toContain('Available workflow templates');
    expect(result).toContain('deployment');
    expect(result).toContain('documentation');
    expect(result).toContain('refactor');
  });
});