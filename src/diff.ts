// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diff utility for generating and formatting file change previews.
 */
import { createTwoFilesPatch, structuredPatch } from 'diff';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from './logger.js';

/**
 * Represents a diff between two versions of content.
 */
export interface DiffResult {
  /** Unified diff string */
  unifiedDiff: string;
  /** Number of lines added */
  linesAdded: number;
  /** Number of lines removed */
  linesRemoved: number;
  /** Whether this is a new file */
  isNewFile: boolean;
  /** Summary of the change */
  summary: string;
}

/**
 * Generate a diff for a file that will be overwritten.
 * @param filePath - Path to the existing file
 * @param newContent - New content to be written
 * @returns Diff result with unified diff and statistics
 */
export async function generateWriteDiff(
  filePath: string,
  newContent: string
): Promise<DiffResult> {
  if (newContent === undefined || newContent === null) {
    throw new Error('Content is required for diff generation');
  }

  const resolvedPath = resolve(process.cwd(), filePath);
  const isNewFile = !existsSync(resolvedPath);

  let oldContent = '';
  if (!isNewFile) {
    try {
      oldContent = await readFile(resolvedPath, 'utf-8');
    } catch (error) {
      logger.debug(`Cannot read file for diff, treating as new: ${error instanceof Error ? error.message : error}`);
    }
  }

  return generateDiff(filePath, oldContent, newContent, isNewFile);
}

/**
 * Generate a diff for an edit operation.
 * @param filePath - Path to the file
 * @param oldString - String to be replaced
 * @param newString - Replacement string
 * @param replaceAll - Whether to replace all occurrences
 * @returns Diff result with unified diff and statistics
 */
export async function generateEditDiff(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false
): Promise<DiffResult> {
  const resolvedPath = resolve(process.cwd(), filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const oldContent = await readFile(resolvedPath, 'utf-8');

  if (!oldContent.includes(oldString)) {
    throw new Error('String not found in file');
  }

  // Generate new content
  let newContent: string;
  if (replaceAll) {
    newContent = oldContent.split(oldString).join(newString);
  } else {
    newContent = oldContent.replace(oldString, newString);
  }

  return generateDiff(filePath, oldContent, newContent, false);
}

/**
 * Generate a diff between two strings.
 */
function generateDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  isNewFile: boolean
): DiffResult {
  // Generate unified diff
  const unifiedDiff = createTwoFilesPatch(
    isNewFile ? '/dev/null' : `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    isNewFile ? '' : 'original',
    'modified',
    { context: 3 }
  );

  // Get structured patch for statistics
  const patch = structuredPatch(
    filePath,
    filePath,
    oldContent,
    newContent,
    '',
    '',
    { context: 3 }
  );

  // Count added and removed lines
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesRemoved++;
      }
    }
  }

  // Generate summary
  let summary: string;
  if (isNewFile) {
    summary = `New file: ${linesAdded} lines`;
  } else if (linesAdded === 0 && linesRemoved === 0) {
    summary = 'No changes';
  } else {
    const parts: string[] = [];
    if (linesRemoved > 0) parts.push(`-${linesRemoved}`);
    if (linesAdded > 0) parts.push(`+${linesAdded}`);
    summary = `${parts.join(', ')} lines`;
  }

  return {
    unifiedDiff,
    linesAdded,
    linesRemoved,
    isNewFile,
    summary,
  };
}

/**
 * Format a diff for display in the terminal.
 * Adds ANSI color codes for added/removed lines.
 */
export function formatDiffForTerminal(diff: string): string {
  const lines = diff.split('\n');
  const formatted: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      // File headers - dim
      formatted.push(`\x1b[2m${line}\x1b[0m`);
    } else if (line.startsWith('@@')) {
      // Hunk headers - cyan
      formatted.push(`\x1b[36m${line}\x1b[0m`);
    } else if (line.startsWith('+')) {
      // Added lines - green
      formatted.push(`\x1b[32m${line}\x1b[0m`);
    } else if (line.startsWith('-')) {
      // Removed lines - red
      formatted.push(`\x1b[31m${line}\x1b[0m`);
    } else {
      // Context lines
      formatted.push(line);
    }
  }

  return formatted.join('\n');
}

/**
 * Truncate a diff to a maximum number of lines for display.
 * Shows first and last portions with a "... X more lines ..." indicator.
 */
export function truncateDiff(diff: string, maxLines: number = 30): string {
  const lines = diff.split('\n');

  if (lines.length <= maxLines) {
    return diff;
  }

  const headerLines: string[] = [];
  const contentLines: string[] = [];

  // Separate headers from content
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) {
      headerLines.push(line);
    } else {
      contentLines.push(line);
    }
  }

  const availableLines = maxLines - headerLines.length - 1; // -1 for the "more lines" message
  const halfLines = Math.floor(availableLines / 2);

  if (contentLines.length <= availableLines) {
    return diff;
  }

  const firstPart = contentLines.slice(0, halfLines);
  const lastPart = contentLines.slice(-halfLines);
  const hiddenCount = contentLines.length - availableLines;

  return [
    ...headerLines,
    ...firstPart,
    `\x1b[2m... ${hiddenCount} more lines ...\x1b[0m`,
    ...lastPart,
  ].join('\n');
}
