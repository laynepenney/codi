// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkflowStep, WorkflowState, PrActionStep } from '../types.js';

/**
 * Execute a PR action step using GitHub CLI
 */
export async function executePrActionStep(
  step: PrActionStep,
  state: WorkflowState,
  agent: any
): Promise<any> {
  const { execSync } = await import('node:child_process');
  
  try {
    // Expand state variables in titles and bodies
    let expandedData: any = {};
    const variables = state.variables || {};
    
    if (step.title) {
      expandedData.title = step.title.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variables[varName] !== undefined ? String(variables[varName]) : match;
      });
    }
    
    if (step.body) {
      expandedData.body = step.body.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variables[varName] !== undefined ? String(variables[varName]) : match;
      });
    }
    
    if (step.base) {
      expandedData.base = step.base.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variables[varName] !== undefined ? String(variables[varName]) : match;
      });
    }
    
    switch (step.action) {
      case 'create-pr':
        const title = expandedData.title || `Workflow PR ${new Date().toISOString()}`;
        const base = expandedData.base || 'main';
        
        // Create PR using GitHub CLI
        const createCommand = `gh pr create ` +
          `--title "${title.replace(/"/g, '\\"')}" ` +
          `--base "${base.replace(/"/g, '\\"')}" ` +
          `${expandedData.body ? `--body "${expandedData.body.replace(/"/g, '\\"')}"` : ''}`;
        
        const createOutput = execSync(createCommand, { 
          stdio: 'pipe',
          encoding: 'utf8'
        }).toString();
        
        return {
          success: true,
          action: 'create-pr',
          output: createOutput.trim(),
          title: title,
          base: base
        };
        
      case 'review-pr':
        // Review latest PR (placeholder implementation)
        const reviewOutput = execSync('gh pr list --limit 1 --json number,title,state', { 
          stdio: 'pipe',
          encoding: 'utf8'
        }).toString();
        
        const prData = JSON.parse(reviewOutput);
        if (prData.length > 0) {
          return {
            success: true,
            action: 'review-pr',
            output: `Reviewed PR #${prData[0].number}: ${prData[0].title}`,
            pr: prData[0]
          };
        } else {
          return {
            success: true,
            action: 'review-pr',
            output: 'No open PRs found'
          };
        }
        
      case 'merge-pr':
        // Merge latest PR (placeholder implementation)
        const mergeOutput = execSync('gh pr list --limit 1 --json number', { 
          stdio: 'pipe',
          encoding: 'utf8'
        }).toString();
        
        const mergeData = JSON.parse(mergeOutput);
        if (mergeData.length > 0) {
          const mergeCommand = `gh pr merge ${mergeData[0].number} --merge`;
          const finalOutput = execSync(mergeCommand, {
            stdio: 'pipe',
            encoding: 'utf8'
          }).toString();
          
          return {
            success: true,
            action: 'merge-pr',
            output: finalOutput.trim(),
            prNumber: mergeData[0].number
          };
        } else {
          return {
            success: true,
            action: 'merge-pr',
            output: 'No open PRs found to merge'
          };
        }
        
      default:
        throw new Error(`Unknown PR action: ${step.action}`);
    }
    
  } catch (error: any) {
    if (error.status !== undefined && error.stdout) {
      // Command failed but has stdout/stderr
      return {
        success: false,
        action: step.action,
        error: error.message,
        stderr: error.stderr?.toString() || '',
        exitCode: error.status
      };
    }
    
    throw new Error(`PR action failed: ${error.message}`);
  }
}

/**
 * Validate a PR action step
 */
export function validatePrActionStep(step: PrActionStep): void {
  if (!step.action || !['create-pr', 'review-pr', 'merge-pr'].includes(step.action)) {
    throw new Error('PR action must be one of: create-pr, review-pr, merge-pr');
  }
  
  // Validate create-pr has title
  if (step.action === 'create-pr' && (!step.title || typeof step.title !== 'string')) {
    throw new Error('PR create action must have a title');
  }
  
  // Validate title length
  if (step.action === 'create-pr' && step.title && step.title.trim().length === 0) {
    throw new Error('PR title cannot be empty');
  }
}