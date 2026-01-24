// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { load } from 'js-yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Workflow,
  WorkflowError,
  WORKFLOW_DIRECTORIES,
  DEFAULT_NESTED_INTERFACE
} from './types.js';
import os from 'node:os';

const HOME_DIR = os.homedir();

/**
 * Validates that a workflow object conforms to the expected schema
 */
export function validateWorkflow(workflow: unknown): workflow is Workflow {
  if (!workflow || typeof workflow !== 'object') {
    throw new WorkflowError('Workflow must be an object');
  }

  const wf = workflow as Record<string, any>;

  // Required fields
  if (!wf.name || typeof wf.name !== 'string') {
    throw new WorkflowError('Workflow must have a name field');
  }

  if (!wf.steps || !Array.isArray(wf.steps)) {
    throw new WorkflowError('Workflow must have a steps array');
  }

  // Validate each step
  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    if (!step || typeof step !== 'object') {
      throw new WorkflowError(`Step ${i + 1} must be an object`);
    }

    if (!step.id || typeof step.id !== 'string') {
      throw new WorkflowError(`Step ${i + 1} must have an id`);
    }

    if (!step.action || typeof step.action !== 'string') {
      throw new WorkflowError(`Step ${i + 1} must have an action`);
    }

    // Validate action-specific fields
    const action = step.action;
    switch (action) {
      case 'switch-model':
        if (!step.model || typeof step.model !== 'string') {
          throw new WorkflowError(`Switch-model step ${step.id} must specify a model`);
        }
        break;
      case 'conditional':
        if (!step.check || typeof step.check !== 'string') {
          throw new WorkflowError(`Conditional step ${step.id} must specify a check`);
        }
        if (!step.onTrue || typeof step.onTrue !== 'string') {
          throw new WorkflowError(`Conditional step ${step.id} must specify onTrue target`);
        }
        break;
      case 'loop':
        if (!step.to || typeof step.to !== 'string') {
          throw new WorkflowError(`Loop step ${step.id} must specify target step`);
        }
        if (!step.condition || typeof step.condition !== 'string') {
          throw new WorkflowError(`Loop step ${step.id} must specify a condition`);
        }
        break;
      case 'interactive':
        if (!step.prompt || typeof step.prompt !== 'string') {
          throw new WorkflowError(`Interactive step ${step.id} must specify a prompt`);
        }
        break;
    }
  }

  return true;
}

/**
 * Loads a workflow from a YAML file
 */
export function loadWorkflow(filePath: string): Workflow {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const workflow = load(content) as unknown;
    validateWorkflow(workflow);
    return workflow as Workflow;
  } catch (error) {
    if (error instanceof WorkflowError) {
      throw error;
    }
    throw new WorkflowError(`Failed to load workflow from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Finds workflow files in standard directories
 */
export function findWorkflowFiles(): string[] {
  const files: string[] = [];

  for (const dir of WORKFLOW_DIRECTORIES) {
    const resolvedDir = dir.replace('~', HOME_DIR);
    if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
      try {
        const dirFiles = fs.readdirSync(resolvedDir);
        for (const file of dirFiles) {
          if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            files.push(path.join(resolvedDir, file));
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }
  }

  return files;
}

/**
 * Get a workflow by name from available files
 */
export function getWorkflowByName(name: string): Workflow | null {
  const files = findWorkflowFiles();
  
  for (const file of files) {
    try {
      const workflow = loadWorkflow(file);
      if (workflow.name === name) {
        return workflow;
      }
    } catch {
      // Skip invalid workflows
    }
  }
  
  return null;
}

/**
 * Lists all available workflows
 */
export function listWorkflows(): Array<{name: string; file: string; valid: boolean}> {
  const files = findWorkflowFiles();
  const workflows: Array<{name: string; file: string; valid: boolean}> = [];
  
  for (const file of files) {
    try {
      const workflow = loadWorkflow(file);
      workflows.push({
        name: workflow.name,
        file,
        valid: true
      });
    } catch (error) {
      workflows.push({
        name: path.basename(file, path.extname(file)),
        file,
        valid: false
      });
    }
  }
  
  return workflows;
}