import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

export class ReadFileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'read_file',
      description: 'Read the contents of a file from the filesystem. Returns the file content as text.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read (relative or absolute)',
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
    const maxLines = input.max_lines as number | undefined;

    if (!path) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(process.cwd(), path);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const content = await readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    // Add line numbers to help with insert_line tool
    const formatWithLineNumbers = (linesToFormat: string[]): string => {
      const padding = String(linesToFormat.length).length;
      return linesToFormat
        .map((line, i) => `${String(i + 1).padStart(padding)}: ${line}`)
        .join('\n');
    };

    if (maxLines && maxLines > 0) {
      const truncated = lines.slice(0, maxLines);
      let result = formatWithLineNumbers(truncated);
      if (lines.length > maxLines) {
        result += `\n\n... (truncated, showing ${maxLines} of ${lines.length} lines)`;
      }
      return result;
    }

    return formatWithLineNumbers(lines);
  }
}
