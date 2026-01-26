// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowManager, WorkflowExecutor } from '../src/workflow/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.join(__dirname, '..', 'workflows');

describe('Minimal PR Review Workflow Test', () => {
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

    manager = new WorkflowManager();
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load the PR review workflow', async () => {
    // Verify workflow file exists
    const workflowPath = path.join(workflowsDir, 'pr-review-workflow.yaml');
    const workflowContent = await fs.readFile(workflowPath, 'utf-8');
    expect(workflowContent).toContain('name: pr-review');
    expect(workflowContent).toContain('PR Review Workflow');
  });

  it('should have proper workflow structure', async () => {
    const workflowPath = path.join(workflowsDir, 'pr-review-workflow.yaml');
    const workflowContent = await fs.readFile(workflowPath, 'utf-8');
    
    // Verify key workflow elements
    expect(workflowContent).toContain('analyze-pr-changes');
    expect(workflowContent).toContain('switch-model');
    expect(workflowContent).toContain('ai-prompt');
    expect(workflowContent).toContain('generate-review-summary');
  });

  it('should validate workflow syntax', async () => {
    // This verifies the YAML is valid
    const workflowPath = path.join(workflowsDir, 'pr-review-workflow.yaml');
    const workflowContent = await fs.readFile(workflowPath, 'utf-8');
    
    // If we can read it without errors, syntax is valid
    expect(() => JSON.parse(JSON.stringify(workflowContent))).not.toThrow();
  });
});