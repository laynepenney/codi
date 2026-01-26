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
      chat: vi.fn().mockResolvedValue({ text: 'name: test-workflow\ndescription: Test\nsteps:\n  - id: step1\n    action: shell\n    description: "Step description"\n    command: "echo hello"' })
    };
    const mockContext = { agent: mockAgent };
    
    const result = await workflowBuildCommand.execute('template deployment', mockContext);
    
    expect(result).toContain('Generated workflow from template "deployment"');
  });

  it('should handle AI workflow generation', async () => {
    const mockAgent = {
      chat: vi.fn().mockResolvedValue({ 
        text: 'name: testing-workflow\ndescription: "Generated workflow for testing"\nsteps:\n  - id: test-step\n    action: shell\n    description: "Test step"\n    command: "echo test"' 
      })
    };
    const mockContext = { agent: mockAgent };
    
    const result = await workflowBuildCommand.execute('create a testing workflow', mockContext);
    
    expect(result).toContain('Generated workflow from your description');
  });

  it('should include timestamp in generated workflow names', async () => {
    const mockContext = {};
    const result = await workflowBuildCommand.execute('template deployment', mockContext);
    
    expect(result).toMatch(/-\d{13}\.yaml/); // 13-digit timestamp in filename
  });
});

// Import the exported YAML parser function for testing
import { parseYAMLWorkflow } from '../src/commands/workflow-ai-builder.js';

describe('YAML Parser Function Tests', () => {
  it('should parse simple workflow YAML', () => {
    const yaml = `name: test-workflow
description: "Test workflow"
steps:
  - id: step1
    action: shell
    description: "Test step"
    command: "echo test"`;

    const result = parseYAMLWorkflow(yaml);
    
    expect(result.name).toBe('test-workflow');
    expect(result.description).toBe('Test workflow');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].action).toBe('shell');
    expect(result.steps[0].command).toBe('echo test');
  });

  it('should parse workflow with markdown code blocks', () => {
    const yaml = `\`\`\`yaml
name: markdown-workflow
description: "Workflow in markdown"
steps:
  - id: step1
    action: shell
    command: "echo hello"
\`\`\``;

    const result = parseYAMLWorkflow(yaml);
    
    expect(result.name).toBe('markdown-workflow');
    expect(result.steps).toHaveLength(1);
  });

  it('should parse workflow with conditional logic', () => {
    const yaml = `name: conditional-workflow
description: "Workflow with conditions"
steps:
  - id: check-file
    action: check-file-exists
    file: "test.ts"
    check: "file-exists"
    onTrue: "run-test"
    onFalse: "skip-test"`;

    const result = parseYAMLWorkflow(yaml);
    
    expect(result.steps[0].action).toBe('check-file-exists');
    expect(result.steps[0].check).toBe('file-exists');
    expect(result.steps[0].onTrue).toBe('run-test');
    expect(result.steps[0].onFalse).toBe('skip-test');
  });

  it('should parse workflow with various data types', () => {
    const yaml = `name: typed-workflow
interactive: true
persistent: false
steps:
  - id: test-types
    action: shell
    timeoutMs: 30000
    maxIterations: 5
    choice: true`;

    const result = parseYAMLWorkflow(yaml);
    
    expect(result.interactive).toBe(true);
    expect(result.persistent).toBe(false);
    expect(result.steps[0].timeoutMs).toBe(30000);
    expect(result.steps[0].maxIterations).toBe(5);
    expect(result.steps[0].choice).toBe(true);
  });

  it('should handle empty or malformed YAML gracefully', () => {
    const yaml = `name: minimal-workflow
description: "Minimal workflow"`;

    const result = parseYAMLWorkflow(yaml);
    
    expect(result.name).toBe('minimal-workflow');
    expect(result.steps).toBeDefined();
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('should parse workflow with array properties', () => {
    const yaml = `name: array-workflow
description: "Workflow with arrays"
steps:
  - id: test-array
    action: interactive
    inputType: "choice"
    choices: ["option1", "option2", "option3"]`;

    const result = parseYAMLWorkflow(yaml);
    
    expect(result.steps[0].action).toBe('interactive');
    expect(result.steps[0].choices).toEqual(['option1', 'option2', 'option3']);
  });
});