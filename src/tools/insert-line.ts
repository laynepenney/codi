// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { recordChange } from '../history.js';

export class InsertLineTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'insert_line',
      description: 'Insert text at a specific line number. Line numbers start at 1. The new content is inserted BEFORE the specified line.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file',
          },
          line: {
            type: 'number',
            description: 'Line number to insert BEFORE (1-indexed). Use 1 to insert at the start of the file.',
          },
          content: {
            type: 'string',
            description: 'The text to insert (will be followed by a newline)',
          },
        },
        required: ['path', 'line', 'content'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input.path as string;
    const lineNum = input.line as number;
    const insertContent = input.content as string;

    if (!path) {
      throw new Error('Path is required');
    }

    if (!lineNum || lineNum < 1) {
      throw new Error('Line number is required and must be >= 1');
    }

    if (insertContent === undefined) {
      throw new Error('Content is required');
    }

    const resolvedPath = resolve(process.cwd(), path);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const fileContent = await readFile(resolvedPath, 'utf-8');
    const lines = fileContent.split('\n');

    // Validate line number
    if (lineNum > lines.length + 1) {
      throw new Error(`Line ${lineNum} is beyond end of file (file has ${lines.length} lines). Use line ${lines.length + 1} to append.`);
    }

    // Insert at the specified position (convert to 0-indexed)
    const insertIndex = lineNum - 1;
    const contentLines = insertContent.split('\n');
    lines.splice(insertIndex, 0, ...contentLines);

    const newContent = lines.join('\n');

    // Record change for undo
    recordChange({
      operation: 'edit',
      filePath: path,
      newContent,
      description: `Inserted ${contentLines.length} line(s) at line ${lineNum} in ${path}`,
    });

    // Write back
    await writeFile(resolvedPath, newContent, 'utf-8');

    return `Inserted ${contentLines.length} line(s) at line ${lineNum} in ${path}`;
  }
}
