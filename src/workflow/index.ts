// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

// Export core types
export type {
  Workflow,
  WorkflowStep,
  WorkflowState,
  StepExecution,
  WorkflowError,
  SwitchModelStep,
  ConditionalStep,
  LoopStep,
  InteractiveStep,
  ShellActionStep,
  AiPromptActionStep,
  PrActionStep,
  GitActionStep,
  WORKFLOW_DIRECTORIES,
  WORKFLOW_STATE_DIR,
  DEFAULT_NESTED_INTERFACE
} from './types.js';

// Export error handling utilities
export type {
  ErrorCategory
} from './errors.js';

export {
  EnhancedWorkflowError,
  createWorkflowError,
  handleWorkflowError,
  getWorkflowHints,
  validateWorkflowWithFeedback
} from './errors.js';

// Export core classes
export { WorkflowManager } from './manager.js';
export { WorkflowExecutor } from './executor.js';
export { WorkflowStateManager } from './state.js';

// Export utilities
export {
  validateWorkflow,
  loadWorkflow,
  findWorkflowFiles,
  getWorkflowByName,
  listWorkflows
} from './parser.js';

// Export UX enhancements
export {
  getProgressBar,
  getStepEmoji,
  getActionEmoji,
  formatWorkflowProgress,
  generateCompletionSummary,
  getExecutionHint,
  formatWorkflowStart
} from './ux.js';