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

  it('should handle unknown templates', async () => {
    const mockContext = {};
    const result = await workflowBuildCommand.execute('template unknown', mockContext);
    
    expect(result).toContain('Template "unknown" not found');
  });

  it('should handle natural language descriptions', async () => {
    const mockContext = {};
    const result = await workflowBuildCommand.execute('create a testing workflow', mockContext);
    
    expect(result).toContain('Generated workflow from your description');
  });

  it('should handle templates with AI context', async () => {
    const mockAgent = {
      chat: vi.fn().mockResolvedValue({ text: 'name: test-workflow\ndescription: Test\nsteps: []' })
    };
    const mockContext = { agent: mockAgent };
    
    const result = await workflowBuildCommand.execute('template deployment', mockContext);
    
    expect(result).toContain('Generated workflow from template "deployment"');
  });

  it('should include timestamp in generated workflow names', async () => {
    const mockContext = {};
    const result = await workflowBuildCommand.execute('template deployment', mockContext);
    
    expect(result).toMatch(/-\d{13}\.yaml/); // 13-digit timestamp in filename
  });
});