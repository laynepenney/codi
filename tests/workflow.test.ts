// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { 
  validateWorkflow, 
  loadWorkflow, 
  listWorkflows,
  getWorkflowByName,
  WorkflowManager
} from '../src/workflow/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_WORKFLOW_YAML = `
name: test-linear
description: Simple linear workflow for testing
steps:
  - id: step1
    action: shell
    command: echo "Step 1"
    
  - id: step2
    action: shell
    command: echo "Step 2"
    
  - id: step3
    action: shell
    command: echo "Step 3"
`;

describe('Workflow System', () => {
  const testWorkflowPath = path.join(process.cwd(), 'workflows', 'test-linear.yaml');
  const testDir = path.join(process.cwd(), 'workflows');

  beforeAll(() => {
    // Ensure test directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testWorkflowPath)) {
      fs.unlinkSync(testWorkflowPath);
    }
  });

  describe('validateWorkflow', () => {
    it('validates a valid workflow', () => {
      const workflow = {
        name: 'test',
        steps: [
          { id: 'step1', action: 'shell', command: 'echo test' }
        ]
      };
      
      expect(() => validateWorkflow(workflow)).not.toThrow();
    });

    it('rejects workflow without name', () => {
      const workflow = {
        steps: [{ id: 'step1', action: 'shell' }]
      };
      
      expect(() => validateWorkflow(workflow)).toThrow('Workflow must have a name field');
    });

    it('rejects workflow without steps', () => {
      const workflow = {
        name: 'test'
      };
      
      expect(() => validateWorkflow(workflow)).toThrow('Workflow must have a steps array');
    });

    it('rejects step without id', () => {
      const workflow = {
        name: 'test',
        steps: [{ action: 'shell' }]
      };
      
      expect(() => validateWorkflow(workflow)).toThrow('Step 1 must have an id');
    });

    it('rejects step without action', () => {
      const workflow = {
        name: 'test',
        steps: [{ id: 'step1' }]
      };
      
      expect(() => validateWorkflow(workflow)).toThrow('Step 1 must have an action');
    });
  });

  describe('loadWorkflow', () => {
    it('loads workflow from YAML file', () => {
      fs.writeFileSync(testWorkflowPath, TEST_WORKFLOW_YAML, 'utf8');
      
      const workflow = loadWorkflow(testWorkflowPath);
      
      expect(workflow.name).toBe('test-linear');
      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[0].id).toBe('step1');
      expect(workflow.steps[0].action).toBe('shell');
    });

    it('throws error for invalid YAML', () => {
      fs.writeFileSync(testWorkflowPath, 'invalid: yaml: {', 'utf8');
      
      expect(() => loadWorkflow(testWorkflowPath)).toThrow();
    });
  });

  describe('WorkflowManager', () => {
    it('lists available workflows', () => {
      fs.writeFileSync(testWorkflowPath, TEST_WORKFLOW_YAML, 'utf8');
      
      const manager = new WorkflowManager();
      const workflows = manager.listAvailableWorkflows();
      
      expect(workflows.length).toBeGreaterThan(0);
      const testWorkflow = workflows.find(w => w.name === 'test-linear');
      expect(testWorkflow).toBeDefined();
      expect(testWorkflow?.valid).toBe(true);
    });

    it('gets workflow by name', () => {
      fs.writeFileSync(testWorkflowPath, TEST_WORKFLOW_YAML, 'utf8');
      
      const workflow = getWorkflowByName('test-linear');
      expect(workflow).toBeDefined();
      expect(workflow?.name).toBe('test-linear');
    });

    it('returns null for non-existent workflow', () => {
      const workflow = getWorkflowByName('non-existent-workflow');
      expect(workflow).toBeNull();
    });
  });
});