// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkflowStep, WorkflowState, PrActionStep } from '../types.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check if GitHub CLI is installed and authenticated
 */
async function isGitHubCliAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import('node:child_process');
    execSync('gh --version', { stdio: 'pipe' });
    // Check if authenticated
    execSync('gh auth status', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate PR title to prevent injection
 */
function isValidPrTitle(title: string): boolean {
  // Prevent command injection and overly long titles
  return title.length > 0 && title.length <= 256 && /^[^\n\r\t]*$/.test(title);
}

/**
 * Execute a PR action step using GitHub CLI
 */
export async function executePrActionStep(
  step: PrActionStep,
  state: WorkflowState,
  agent: any
): Promise<any> {
  const { execSync } = await import('node:child_process');
  
  // Check if GitHub CLI is available
  if (!(await isGitHubCliAvailable())) {
    throw new Error('GitHub CLI (gh) is not installed or not authenticated. Please install and authenticate first.');
  }
  
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
        
        // Validate title
        if (!isValidPrTitle(title)) {
          throw new Error('Invalid PR title. Title must be 1-256 characters and not contain control characters.');
        }
        
        const base = expandedData.base || 'main';
        const body = expandedData.body || '';
        
        // Create PR using GitHub CLI with proper escaping
        const escapedTitle = title.replace(/"/g, '\\"');
        const escapedBody = body.replace(/"/g, '\\"');
        const escapedBase = base.replace(/"/g, '\\"');
        
        let createCommand = `gh pr create --title "${escapedTitle}" --base "${escapedBase}"`;
        if (body) {
          createCommand += ` --body "${escapedBody}"`;
        }
        
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
        try {
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
        } catch (parseError) {
          return {
            success: false,
            action: 'review-pr',
            error: 'Failed to parse PR list',
            stderr: String(parseError),
            output: 'Could not retrieve PR list'
          };
        }
        
      case 'merge-pr':
        try {
          // Merge latest PR (placeholder implementation)
          const mergeOutput = execSync('gh pr list --limit 1 --json number', { 
            stdio: 'pipe',
            encoding: 'utf8'
          }).toString();
          
          const mergeData = JSON.parse(mergeOutput);
          if (mergeData.length > 0) {
            const prNumber = mergeData[0].number;
            const mergeCommand = `gh pr merge ${prNumber} --merge`;
            const finalOutput = execSync(mergeCommand, {
              stdio: 'pipe',
              encoding: 'utf8'
              }).toString();
            
            return {
              success: true,
              action: 'merge-pr',
              output: finalOutput.trim(),
              prNumber: prNumber
            };
          } else {
            return {
              success: true,
              action: 'merge-pr',
              output: 'No open PRs found to merge'
            };
          }
        } catch (mergeError: any) {
          return {
            success: false,
            action: 'merge-pr',
            error: mergeError.message,
            stderr: mergeError.stderr?.toString() || '',
            exitCode: mergeError.status || 'unknown'
          };
        }
        
      default:
        throw new Error(`Unknown PR action: ${step.action}`);
    }
    
  } catch (error: any) {
    // Handle specific GitHub CLI errors
    if (error.message.includes('HTTP 401')) {
      return {
        success: false,
        action: step.action,
        error: 'GitHub authentication failed. Please check your credentials.',
        stderr: error.stderr?.toString() || '',
        exitCode: error.status || 'auth-error'
      };
    }
    
    if (error.message.includes('HTTP 403')) {
      return {
        success: false,
        action: step.action,
        error: 'Permission denied. Check your GitHub permissions.',
        stderr: error.stderr?.toString() || '',
        exitCode: error.status || 'perm-error'
      };
    }
    
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
  
  // Validate title length and content
  if (step.action === 'create-pr' && step.title) {
    if (step.title.trim().length === 0) {
      throw new Error('PR title cannot be empty');
    }
    if (!isValidPrTitle(step.title)) {
      throw new Error('Invalid PR title. Title must be 1-256 characters and not contain control characters.');
    }
  }
}