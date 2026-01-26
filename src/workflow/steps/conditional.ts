// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Agent } from '../../agent.js';
import {
  WorkflowState,
  ConditionalStep
} from '../types.js';

/**
 * Context type for condition evaluation
 */
type ConditionContext = Record<string, unknown>;

/**
 * Evaluate conditional expressions safely
 */
export function evaluateCondition(condition: string, context: ConditionContext): boolean {
  // Remove whitespace and normalize
  const normalizedCondition = condition.trim().toLowerCase();

  // Simple condition evaluation
  const simpleConditions: Record<string, (ctx: ConditionContext) => boolean> = {
    'true': () => true,
    'false': () => false,
    'approved': (ctx) => ctx?.approved === true,
    'file-exists': (ctx) => ctx?.fileExists === true || ctx?.exists === true,
    'variable-equals': (ctx) => {
      // Format: variable-equals|varname|value
      const parts = normalizedCondition.split('|');
      if (parts.length >= 3) {
        return ctx[parts[1]] === parts[2];
      }
      return false;
    },
    'contains': (ctx) => {
      // Format: contains|varname|substring
      const parts = normalizedCondition.split('|');
      if (parts.length >= 3) {
        const value = ctx[parts[1]];
        return typeof value === 'string' && value.includes(parts[2]);
      }
      return false;
    },
    'greater-than': (ctx) => {
      // Format: greater-than|varname|number
      const parts = normalizedCondition.split('|');
      if (parts.length >= 3) {
        const value = Number(ctx[parts[1]]);
        const threshold = Number(parts[2]);
        return value > threshold;
      }
      return false;
    },
    'less-than': (ctx) => {
      // Format: less-than|varname|number
      const parts = normalizedCondition.split('|');
      if (parts.length >= 3) {
        const value = Number(ctx[parts[1]]);
        const threshold = Number(parts[2]);
        return value < threshold;
      }
      return false;
    }
  };

  // Check for simple conditions first
  if (normalizedCondition in simpleConditions) {
    return simpleConditions[normalizedCondition](context);
  }

  // Check for operator-based conditions
  const operators = ['==', '!=', '>', '<', '>=', '<='];
  for (const operator of operators) {
    if (normalizedCondition.includes(operator)) {
      const [left, right] = normalizedCondition.split(operator).map(s => s.trim());
      const leftValue = context[left] ?? left;
      const rightValue = context[right] ?? right;
      
      switch (operator) {
        case '==': return leftValue == rightValue;
        case '!=': return leftValue != rightValue;
        case '>': return Number(leftValue) > Number(rightValue);
        case '<': return Number(leftValue) < Number(rightValue);
        case '>=': return Number(leftValue) >= Number(rightValue);
        case '<=': return Number(leftValue) <= Number(rightValue);
      }
    }
  }

  // Default to true if condition is not recognized (evaluates the variable itself)
  return !!context[normalizedCondition];
}

interface ConditionalResult {
  condition: string;
  result: boolean;
  nextStep: string | null;
  contextUsed: string[];
}

/**
 * Execute a conditional step
 */
export async function executeConditionalStep(
  step: ConditionalStep,
  state: WorkflowState,
  agent?: Agent
): Promise<ConditionalResult> {
  // Merge state variables with additional context
  const context: ConditionContext = {
    ...state.variables,
    agentAvailable: !!agent,
    stepCount: state.history.length,
    iterationCount: state.iterationCount,
    currentStep: state.currentStep
  };

  const result = evaluateCondition(step.check, context);

  return {
    condition: step.check,
    result,
    nextStep: result ? step.onTrue : (step.onFalse || null),
    contextUsed: Object.keys(context)
  };
}

/**
 * Validate a conditional step
 */
export function validateConditionalStep(step: ConditionalStep): void {
  if (!step.check || typeof step.check !== 'string') {
    throw new Error(`Conditional step ${step.id} must specify a check condition`);
  }
  
  if (!step.onTrue || typeof step.onTrue !== 'string') {
    throw new Error(`Conditional step ${step.id} must specify onTrue target`);
  }
}