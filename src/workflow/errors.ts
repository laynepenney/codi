// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Enhanced error handling utilities for workflow system
 * Provides actionable guidance and recovery suggestions
 */

import { WorkflowError } from './types.js';

/**
 * Error categories for better classification
 */
export enum ErrorCategory {
  VALIDATION = 'validation',
  EXECUTION = 'execution',
  FILE_IO = 'file_io',
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  PERMISSION = 'permission',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

/**
 * Enhanced workflow error with context and recovery suggestions
 */
export class EnhancedWorkflowError extends WorkflowError {
  constructor(
    message: string,
    public step?: string,
    public workflow?: string,
    public category: ErrorCategory = ErrorCategory.UNKNOWN,
    public suggestions: string[] = [],
    public retryable: boolean = false
  ) {
    super(message, step, workflow);
    this.name = 'EnhancedWorkflowError';
  }

  /**
   * Format the full error with suggestions
   */
  getFullMessage(): string {
    let output = `❌ ${this.message}\n`;

    if (this.workflow) {
      output += `\n📁 Workflow: ${this.workflow}\n`;
    }

    if (this.step) {
      output += `🔄 Step: ${this.step}\n`;
    }

    output += `\n📌 Category: ${this.category}\n`;

    if (this.suggestions.length > 0) {
      output += `\n💡 Suggestions:\n`;
      this.suggestions.forEach((suggestion, index) => {
        output += `   ${index + 1}. ${suggestion}\n`;
      });
    }

    if (this.retryable) {
      output += `\n🔄 This error is retryable. You can resume with:\n`;
      output += `   /workflow-run ${this.workflow}\n`;
    }

    return output;
  }
}

/**
 * Common error messages and recovery suggestions
 */
const ERROR_GUIDE: Record<string, { suggestions: string[]; retryable: boolean }> = {
  'workflow not found': {
    suggestions: [
      'Check the workflow name spelling',
      'Run /workflow list to see available workflows',
      'Ensure workflow files exist in ~/.codi/workflows/ or ./workflows/',
      'Try creating a new workflow with /workflow-build'
    ],
    retryable: false
  },

  'invalid yaml': {
    suggestions: [
      'Check YAML syntax - common issues: incorrect indentation, missing colons',
      'Use an online YAML validator to identify syntax errors',
      'Ensure all strings are properly quoted if they contain special characters',
      'Run /workflow validate <name> for detailed error information'
    ],
    retryable: false
  },

  'step not found': {
    suggestions: [
      'Verify the step ID exists in the workflow',
      'Check for typos in step references (onTrue, onFalse, to)',
      'Ensure step IDs are unique within the workflow',
      'Use /workflow show <name> to view all available steps'
    ],
    retryable: false
  },

  'invalid step': {
    suggestions: [
      'Review step configuration in workflow YAML',
      'Ensure all required fields are present for the step type',
      'Check /workflow show <name> for step details',
      'Refer to documentation for step-specific requirements'
    ],
    retryable: false
  },

  'agent not available': {
    suggestions: [
      'Ensure Codi is running with a valid AI provider',
      'Check your API key configuration',
      'Verify model availability with /models',
      'Restart Codi if the agent connection was lost'
    ],
    retryable: true
  },

  'model not found': {
    suggestions: [
      'Check available models with /models',
      'Verify the model name is correct for your provider',
      'Use /switch command to change to a valid model',
      'Consider using a different model in your workflow'
    ],
    retryable: true
  },

  'git command failed': {
    suggestions: [
      'Ensure git is installed and accessible',
      'Check git configuration with git config --list',
      'Verify you have the necessary git permissions',
      'Test the git command manually in your terminal'
    ],
    retryable: true
  },

  'shell command failed': {
    suggestions: [
      'Review the command - check for syntax errors',
      'Ensure all required tools are installed',
      'Verify the command works in a regular terminal',
      'Check file paths and permissions'
    ],
    retryable: true
  },

  'state file not found': {
    suggestions: [
      'The workflow may not have been started yet',
      'Run the workflow normally (no resume needed)',
      'Check ~/.codi/workflows/state/ for existing states',
      'Use /workflow-run <name> to start fresh'
    ],
    retryable: false
  },

  'max iterations exceeded': {
    suggestions: [
      'Increase maxIterations in the loop step configuration',
      'Review the loop condition - it may never be satisfied',
      'Check for bugs in the workflow that prevent loop completion',
      'Consider adding a break condition or manual cancel point'
    ],
    retryable: false
  },

  'timeout': {
    suggestions: [
      'Increase timeoutMs for interactive steps',
      'Check if a process is hung and kill it manually',
      'Consider breaking down long-running steps',
      'Use background processes for asynchronous operations'
    ],
    retryable: true
  },

  'permission denied': {
    suggestions: [
      'Check file/directory permissions with ls -la',
      'Ensure you have write access to required locations',
      'Run with appropriate permissions if necessary',
      'Consider using a different directory for workflow outputs'
    ],
    retryable: false
  },

  'ai generation failed': {
    suggestions: [
      'Check your API key and quota limits',
      'Verify the AI provider is accessible',
      'Try a simpler prompt to rule out complexity issues',
      'Temporarily switch to a different model'
    ],
    retryable: true
  },

  'template not found': {
    suggestions: [
      'Run /workflow-build template list to see available templates',
      'Check the template name for typos',
      'Ensure custom templates are in workflows/templates/ directory',
      'Use a built-in template or create a new one'
    ],
    retryable: false
  }
};

/**
 * Create an enhanced error with appropriate category and suggestions
 */
export function createWorkflowError(
  message: string,
  step?: string,
  workflow?: string
): EnhancedWorkflowError {
  const lowerMessage = message.toLowerCase();
  const guide = Object.entries(ERROR_GUIDE).find(([key]) => 
    lowerMessage.includes(key)
  );

  if (guide) {
    const { suggestions, retryable } = guide[1];
    return new EnhancedWorkflowError(
      message,
      step,
      workflow,
      getErrorCategory(message),
      suggestions,
      retryable
    );
  }

  // Default enhanced error without specific suggestions
  return new EnhancedWorkflowError(
    message,
    step,
    workflow,
    getErrorCategory(message),
    ['Review the workflow configuration', 'Check /workflow show for details'],
    false
  );
}

/**
 * Determine error category from message
 */
function getErrorCategory(message: string): ErrorCategory {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('validation') || lowerMessage.includes('invalid')) {
    return ErrorCategory.VALIDATION;
  }
  if (lowerMessage.includes('permission') || lowerMessage.includes('denied')) {
    return ErrorCategory.PERMISSION;
  }
  if (lowerMessage.includes('timeout')) {
    return ErrorCategory.TIMEOUT;
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
    return ErrorCategory.NETWORK;
  }
  if (lowerMessage.includes('auth') || lowerMessage.includes('api key')) {
    return ErrorCategory.AUTHENTICATION;
  }
  if (lowerMessage.includes('file') || lowerMessage.includes('read') || lowerMessage.includes('write')) {
    return ErrorCategory.FILE_IO;
  }

  return ErrorCategory.EXECUTION;
}

/**
 * Handle error with user-friendly output
 */
export function handleWorkflowError(error: unknown, workflow?: string, step?: string): string {
  if (error instanceof EnhancedWorkflowError) {
    return error.getFullMessage();
  }

  if (error instanceof WorkflowError) {
    const enhanced = createWorkflowError(error.message, error.step, error.workflow || workflow);
    return enhanced.getFullMessage();
  }

  const enhanced = createWorkflowError(
    error instanceof Error ? error.message : String(error),
    step,
    workflow
  );
  return enhanced.getFullMessage();
}

/**
 * Get helpful hints based on workflow context
 */
export function getWorkflowHints(workflow: any): string[] {
  const hints: string[] = [];

  // Check for interactive workflows
  if (workflow?.interactive) {
    hints.push('ℹ️ This workflow requires interactive input - be ready to answer prompts');
  }

  // Check for persistent workflows
  if (workflow?.persistent) {
    hints.push('💾 This workflow saves state - you can resume with /workflow-run <name>');
  }

  // Check for loops
  const hasLoops = workflow?.steps?.some((s: any) => s.action === 'loop');
  if (hasLoops) {
    hints.push('🔄 This workflow contains loops - ensure conditions are satisfiable');
  }

  // Check for conditionals
  const hasConditions = workflow?.steps?.some((s: any) => s.action === 'conditional');
  if (hasConditions) {
    hints.push('🔀 This workflow has conditional branches - review all paths');
  }

  // Check for model switching
  const hasModelSwitch = workflow?.steps?.some((s: any) => s.action === 'switch-model');
  if (hasModelSwitch) {
    hints.push('🤖 This workflow switches models - ensure all models are available');
  }

  // Check for dangerous operations
  const hasGit = workflow?.steps?.some((s: any) => 
    s.action === 'commit' || s.action === 'push' || s.action === 'merge-pr'
  );
  if (hasGit) {
    hints.push('📝 This workflow modifies git - ensure your working tree is clean');
  }

  return hints;
}

/**
 * Validate workflow and provide helpful feedback
 */
export function validateWorkflowWithFeedback(workflow: any): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hints: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hints: string[] = getWorkflowHints(workflow);

  // Basic validation
  if (!workflow.name) {
    errors.push('Workflow must have a name');
  }

  if (!workflow.steps || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('Workflow must have at least one step');
  }

  // Step validation
  const stepIds = new Set<string>();
  if (workflow.steps) {
    workflow.steps.forEach((step: any, index: number) => {
      if (!step.id) {
        errors.push(`Step ${index + 1} missing required field: id`);
      } else if (stepIds.has(step.id)) {
        errors.push(`Duplicate step ID: ${step.id}`);
      } else {
        stepIds.add(step.id);
      }

      if (!step.action) {
        errors.push(`Step ${step.id || index + 1} missing required field: action`);
      }

      // Check for invalid step references
      if (step.onTrue && !stepIds.has(step.onTrue)) {
        warnings.push(`Step ${step.id} references non-existent step: ${step.onTrue} (onTrue)`);
      }
      if (step.onFalse && !stepIds.has(step.onFalse)) {
        warnings.push(`Step ${step.id} references non-existent step: ${step.onFalse} (onFalse)`);
      }
      if (step.to && !stepIds.has(step.to)) {
        warnings.push(`Step ${step.id} references non-existent step: ${step.to} (to)`);
      }
    });
  }

  // Loop validation
  const loops = workflow?.steps?.filter((s: any) => s.action === 'loop') || [];
  if (loops.length > 0) {
    loops.forEach((loop: any) => {
      if (!loop.condition) {
        errors.push(`Loop step ${loop.id} missing required field: condition`);
      }
      if (!loop.to) {
        errors.push(`Loop step ${loop.id} missing required field: to`);
      }
      if (loop.to === loop.id) {
        errors.push(`Loop step ${loop.id} cannot reference itself in 'to' field`);
      }
    });
  }

  // Conditional validation
  const conditionals = workflow?.steps?.filter((s: any) => s.action === 'conditional') || [];
  if (conditionals.length > 0) {
    conditionals.forEach((cond: any) => {
      if (!cond.check) {
        errors.push(`Conditional step ${cond.id} missing required field: check`);
      }
      if (!cond.onTrue) {
        errors.push(`Conditional step ${cond.id} missing required field: onTrue`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hints
  };
}