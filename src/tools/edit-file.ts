// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { recordChange } from '../history.js';
import { validateAndResolvePath } from '../utils/path-validation.js';

export class EditFileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'edit_file',
      description: 'Make a targeted edit to a file by replacing a specific string with new content. More precise than rewriting the entire file. The old_string must match exactly (including whitespace and indentation).',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact string to find and replace (must match exactly)',
          },
          new_string: {
            type: 'string',
            description: 'The string to replace it with',
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace all occurrences (default: false, only replaces first occurrence)',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input.path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) || false;

    if (!path) {
      throw new Error('Path is required');
    }

    if (oldString === undefined) {
      throw new Error('old_string is required');
    }

    if (newString === undefined) {
      throw new Error('new_string is required');
    }

    const resolvedPath = validateAndResolvePath(path);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const content = await readFile(resolvedPath, 'utf-8');

    // Check if old_string exists in the file
    if (!content.includes(oldString)) {
      throw new Error(`String not found in file. Make sure old_string matches exactly including whitespace and indentation.`);
    }

    // Count occurrences
    const occurrences = content.split(oldString).length - 1;

    // Perform replacement
    let newContent: string;
    let replacedCount: number;

    if (replaceAll) {
      newContent = content.split(oldString).join(newString);
      replacedCount = occurrences;
    } else {
      newContent = content.replace(oldString, newString);
      replacedCount = 1;
    }

    // Record change for undo
    recordChange({
      operation: 'edit',
      filePath: path,
      newContent,
      description: `Replaced ${replacedCount} occurrence(s) in ${path}`,
    });

    // Write the file
    await writeFile(resolvedPath, newContent, 'utf-8');

    // Generate a simple diff preview
    const oldLines = oldString.split('\n').length;
    const newLines = newString.split('\n').length;

    let summary = `Edited ${path}: replaced ${replacedCount} occurrence(s)`;
    if (occurrences > 1 && !replaceAll) {
      summary += ` (${occurrences - 1} more occurrences remain)`;
    }
    summary += `\n\nRemoved ${oldLines} line(s), added ${newLines} line(s)`;

    return summary;
  }
}
