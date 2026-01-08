import { glob } from 'node:fs/promises';
import { resolve } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

export class GlobTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'glob',
      description: 'Find files matching a glob pattern. Use this to discover files in the codebase. Examples: "**/*.ts" for all TypeScript files, "src/**/*.js" for JS files in src.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")',
          },
          cwd: {
            type: 'string',
            description: 'Directory to search in (optional, defaults to current directory)',
          },
        },
        required: ['pattern'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const pattern = input.pattern as string;
    const cwd = (input.cwd as string) || process.cwd();

    if (!pattern) {
      throw new Error('Pattern is required');
    }

    const resolvedCwd = resolve(process.cwd(), cwd);

    const files: string[] = [];
    for await (const file of glob(pattern, { cwd: resolvedCwd })) {
      files.push(file);
    }

    if (files.length === 0) {
      return `No files found matching pattern: ${pattern}`;
    }

    // Sort files alphabetically
    files.sort();

    // Limit output if too many files
    const MAX_FILES = 100;
    if (files.length > MAX_FILES) {
      const truncated = files.slice(0, MAX_FILES);
      return `Found ${files.length} files (showing first ${MAX_FILES}):\n\n${truncated.join('\n')}\n\n... and ${files.length - MAX_FILES} more`;
    }

    return `Found ${files.length} files:\n\n${files.join('\n')}`;
  }
}
