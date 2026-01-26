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
  variables?: Record<string, unknown>;
  steps: WorkflowStep[];
}

/**
 * Base properties common to all workflow steps.
 */
export interface BaseWorkflowStep {
  id: string;
  description?: string;
}

/**
 * Discriminated union of all workflow step types.
 * Use type guards (isShellStep, isSwitchModelStep, etc.) to narrow the type.
 */
export type WorkflowStep =
  | ShellActionStep
  | SwitchModelStep
  | ConditionalStep
  | LoopStep
  | InteractiveStep
  | CheckFileExistsStep
  | AiPromptActionStep
  | PrActionStep
  | GitActionStep
  | GenericStep;

/**
 * Generic step for unknown/extensible actions.
 * Used as a fallback when action type is not recognized.
 */
export interface GenericStep extends BaseWorkflowStep {
  action: string;
  [key: string]: unknown;
}

export interface WorkflowState {
  name: string;
  currentStep: string;
  variables: Record<string, unknown>;
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
  result?: unknown;
  timestamp: string;
}

// Step-specific types - each extends BaseWorkflowStep and has a literal action
export interface SwitchModelStep extends BaseWorkflowStep {
  action: 'switch-model';
  model: string;
}

export interface ConditionalStep extends BaseWorkflowStep {
  action: 'conditional';
  check: string;
  onTrue: string;
  onFalse?: string;
}

export interface LoopStep extends BaseWorkflowStep {
  action: 'loop';
  to: string;
  condition: string;
  maxIterations?: number;
}

export interface InteractiveStep extends BaseWorkflowStep {
  action: 'interactive';
  prompt: string;
  inputType?: 'text' | 'password' | 'confirm' | 'choice' | 'multiline';
  timeoutMs?: number;
  defaultValue?: string;
  validationPattern?: string;
  choices?: string[];
}

export interface CheckFileExistsStep extends BaseWorkflowStep {
  action: 'check-file-exists';
  file?: string;
}

export interface ShellActionStep extends BaseWorkflowStep {
  action: 'shell';
  command: string;
}

export interface AiPromptActionStep extends BaseWorkflowStep {
  action: 'ai-prompt';
  prompt: string;
  model?: string;
}

export interface PrActionStep extends BaseWorkflowStep {
  action: 'create-pr' | 'review-pr' | 'merge-pr';
  title?: string;
  body?: string;
  base?: string;
}

export interface GitActionStep extends BaseWorkflowStep {
  action: 'commit' | 'push' | 'pull' | 'sync';
  message?: string;
  base?: string;
}

// Type guards for step types
export function isShellStep(step: WorkflowStep): step is ShellActionStep {
  return step.action === 'shell';
}

export function isSwitchModelStep(step: WorkflowStep): step is SwitchModelStep {
  return step.action === 'switch-model';
}

export function isConditionalStep(step: WorkflowStep): step is ConditionalStep {
  return step.action === 'conditional';
}

export function isLoopStep(step: WorkflowStep): step is LoopStep {
  return step.action === 'loop';
}

export function isInteractiveStep(step: WorkflowStep): step is InteractiveStep {
  return step.action === 'interactive';
}

export function isCheckFileExistsStep(step: WorkflowStep): step is CheckFileExistsStep {
  return step.action === 'check-file-exists';
}

export function isAiPromptStep(step: WorkflowStep): step is AiPromptActionStep {
  return step.action === 'ai-prompt';
}

export function isPrActionStep(step: WorkflowStep): step is PrActionStep {
  return step.action === 'create-pr' || step.action === 'review-pr' || step.action === 'merge-pr';
}

export function isGitActionStep(step: WorkflowStep): step is GitActionStep {
  return step.action === 'commit' || step.action === 'push' || step.action === 'pull' || step.action === 'sync';
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