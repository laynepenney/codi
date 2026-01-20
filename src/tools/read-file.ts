// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

export class ReadFileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'read_file',
      description: 'Read the contents of a file from the filesystem. Returns the file content as text with line numbers.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read (relative or absolute)',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-indexed, default: 1)',
          },
          max_lines: {
            type: 'number',
            description: 'Maximum number of lines to read (optional, defaults to all)',
          },
        },
        required: ['path'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input.path as string;
    const offset = Math.max(1, (input.offset as number) || 1);
    const maxLines = input.max_lines as number | undefined;

    if (!path) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(process.cwd(), path);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const content = await readFile(resolvedPath, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;

    // Apply offset (1-indexed, so subtract 1)
    const startIndex = offset - 1;

    // Handle offset beyond file length
    if (startIndex >= totalLines) {
      return `... (offset ${offset} is beyond file length of ${totalLines} lines)`;
    }

    const lines = allLines.slice(startIndex);

    // Format with ORIGINAL line numbers (crucial for edit_file accuracy)
    const formatWithLineNumbers = (linesToFormat: string[], startLineNum: number): string => {
      const maxLineNum = startLineNum + linesToFormat.length - 1;
      const padding = String(maxLineNum).length;
      return linesToFormat
        .map((line, i) => `${String(startLineNum + i).padStart(padding)}: ${line}`)
        .join('\n');
    };

    if (maxLines && maxLines > 0) {
      const truncated = lines.slice(0, maxLines);
      let result = formatWithLineNumbers(truncated, offset);

      // Show context about what was read
      const endLine = offset + truncated.length - 1;
      if (lines.length > maxLines || startIndex > 0) {
        result += `\n\n... (showing lines ${offset}-${endLine} of ${totalLines} total)`;
      }
      return result;
    }

    let result = formatWithLineNumbers(lines, offset);
    if (startIndex > 0) {
      const endLine = offset + lines.length - 1;
      result += `\n\n... (showing lines ${offset}-${endLine} of ${totalLines} total)`;
    }
    return result;
  }
}
