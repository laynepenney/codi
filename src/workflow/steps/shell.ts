// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkflowStep, WorkflowState, ShellActionStep } from '../types.js';

/**
 * Execute a shell command action step
 */
export async function executeShellActionStep(
  step: ShellActionStep,
  state: WorkflowState,
  agent: any
): Promise<any> {
  const { spawn } = await import('node:child_process');
  
  // Expand state variables in command
  let command = step.command;
  const variables = state.variables || {};
  
  // Replace {{variable}} patterns
  command = command.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return variables[varName] !== undefined ? String(variables[varName]) : match;
  });
  
  return new Promise((resolve, reject) => {
    const child = spawn(command, { 
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const result = { success: code === 0, stdout, stderr, exitCode: code };
      
      // Store the result in variables for future steps
      state.variables = state.variables || {};
      state.variables[`${step.id}_result`] = result;
      state.variables[`${step.id}_stdout`] = stdout;
      state.variables[`${step.id}_exitCode`] = code;
      
      if (code === 0) {
        resolve(result);
      } else {
        reject(new Error(`Shell command failed with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Shell command failed: ${error.message}`));
    });
  });
}

/**
 * Validate a shell action step
 */
export function validateShellActionStep(step: ShellActionStep): void {
  if (!step.command || typeof step.command !== 'string') {
    throw new Error('Shell action must have a command');
  }
  
  // Simple validation for dangerous commands
  const dangerousPatterns = [
    /rm\s+-rf/,
    /dd\s+if=/,
    /mkfs/,
    /chmod\s+777/,
    /chown\s+root:root/,
    /\|\s*sh$/,
    /echo\s+.+\s+\|\s+\/bin\/bash/,
    /curl\s+.*\s+\|\s+sh/
  ];
  
  const command = step.command.toLowerCase();
  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      throw new Error(`Potentially dangerous command detected: ${step.command}`);
    }
  }
}