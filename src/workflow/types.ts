// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core types for the Interactive Workflow System
 */

export interface Workflow {
  name: string;
  description?: string;
  version?: string;
  interactive?: boolean;
  persistent?: boolean;
  variables?: Record<string, any>;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  action: string;
  description?: string;
  // Step-specific configuration
  [key: string]: any;
}

export interface WorkflowState {
  name: string;
  currentStep: string;
  variables: Record<string, any>;
  history: StepExecution[];
  iterationCount: number;
  paused: boolean;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StepExecution {
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  timestamp: string;
}

// Step-specific types
export interface SwitchModelStep extends WorkflowStep {
  action: 'switch-model';
  model: string;
}

export interface ConditionalStep extends WorkflowStep {
  action: 'conditional';
  check: string;
  onTrue: string;
  onFalse?: string;
}

export interface LoopStep extends WorkflowStep {
  action: 'loop';
  to: string;
  condition: string;
  maxIterations?: number;
}

export interface InteractiveStep extends WorkflowStep {
  action: 'interactive';
  prompt: string;
}

// Action types
export interface ShellActionStep extends WorkflowStep {
  action: 'shell';
  command: string;
}

export interface AiPromptActionStep extends WorkflowStep {
  action: 'ai-prompt';
  prompt: string;
  model?: string;
}

export interface PrActionStep extends WorkflowStep {
  action: 'create-pr' | 'review-pr' | 'merge-pr';
  title?: string;
  body?: string;
  base?: string;
}

export interface GitActionStep extends WorkflowStep {
  action: 'commit' | 'push' | 'pull' | 'sync';
  message?: string;
}

// Error types
export class WorkflowError extends Error {
  constructor(
    message: string,
    public step?: string,
    public workflow?: string
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export const WORKFLOW_DIRECTORIES = [
  '~/.codi/workflows',
  '.codi/workflows',
  'workflows'
] as const;

export const WORKFLOW_STATE_DIR = '~/.codi/workflows/state';

export const DEFAULT_NESTED_INTERFACE = {
  modelConnectionPooling: 'disconnect-reconnect',
  conditionLanguage: 'simple-with-safe-js',
  workflowPermissions: 'prompt-for-sensitive',
  commandIntegration: 'trigger-existing'
} as const;