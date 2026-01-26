// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { promises as fs } from 'node:fs';
import type { Agent } from '../../agent.js';
import {
  WorkflowState,
  CheckFileExistsStep
} from '../types.js';

/**
 * Check file existence utility
 */
export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface FileExistsResult {
  filePath: string;
  exists: boolean;
  fileExists: boolean; // Alias for condition evaluation
}

/**
 * Execute a file existence check step
 */
export async function executeCheckFileExistsStep(
  step: CheckFileExistsStep,
  _state: WorkflowState,
  _agent?: Agent
): Promise<FileExistsResult> {
  const filePath = step.file || 'test-file.txt';
  const exists = await checkFileExists(filePath);

  return {
    filePath,
    exists,
    fileExists: exists
  };
}

/**
 * Validate a file existence check step
 */
export function validateCheckFileExistsStep(step: CheckFileExistsStep): void {
  if (!step.id || typeof step.id !== 'string') {
    throw new Error('Step must have an id');
  }
  // File path is optional, defaults to 'test-file.txt'
}