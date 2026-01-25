// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkflowStep, WorkflowState, GitActionStep } from '../types.js';

/**
 * Execute a Git action step
 */
export async function executeGitActionStep(
  step: GitActionStep,
  state: WorkflowState,
  agent: any
): Promise<any> {
  const { execSync } = await import('node:child_process');
  
  try {
    // Expand state variables in messages and parameters
    let expandedData: any = {};
    const variables = state.variables || {};
    
    if (step.message) {
      expandedData.message = step.message.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variables[varName] !== undefined ? String(variables[varName]) : match;
      });
    }
    
    switch (step.action) {
      case 'commit':
        const message = expandedData.message || `Workflow commit ${new Date().toISOString()}`;
        const commitCommand = `git commit -m "${message.replace(/"/g, '\\"')}"`;
        const commitOutput = execSync(commitCommand, { 
          stdio: 'pipe',
          encoding: 'utf8'
        }).toString();
        
        return {
          success: true,
          action: 'commit',
          output: commitOutput.trim(),
          message: message
        };
        
      case 'push':
        const pushOutput = execSync('git push', { 
          stdio: 'pipe',
          encoding: 'utf8'
        }).toString();
        
        return {
          success: true,
          action: 'push',
          output: pushOutput.trim()
        };
        
      case 'pull':
        const pullOutput = execSync('git pull', { 
          stdio: 'pipe',
          encoding: 'utf8'
        }).toString();
        
        return {
          success: true,
          action: 'pull',
          output: pullOutput.trim()
        };
        
      case 'sync':
        // Sync = fetch + reset --hard origin/main
        const syncOutput = execSync('git fetch origin main && git reset --hard origin/main', { 
          stdio: 'pipe',
          encoding: 'utf8'
        }).toString();
        
        return {
          success: true,
          action: 'sync',
          output: syncOutput.trim()
        };
        
      default:
        throw new Error(`Unknown Git action: ${step.action}`);
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
    
    throw new Error(`Git action failed: ${error.message}`);
  }
}

/**
 * Validate a Git action step
 */
export function validateGitActionStep(step: GitActionStep): void {
  if (!step.action || !['commit', 'push', 'pull', 'sync'].includes(step.action)) {
    throw new Error('Git action must be one of: commit, push, pull, sync');
  }
  
  // Validate commit has message
  if (step.action === 'commit' && (!step.message || typeof step.message !== 'string')) {
    throw new Error('Git commit action must have a message');
  }
  
  // Validate message length
  if (step.action === 'commit' && step.message && step.message.trim().length === 0) {
    throw new Error('Git commit message cannot be empty');
  }
}