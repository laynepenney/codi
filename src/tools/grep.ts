import { readFile } from 'fs/promises';
import { glob } from 'node:fs/promises';
import { resolve, join } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

interface Match {
  file: string;
  line: number;
  content: string;
}

export class GrepTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'grep',
      description: 'Search for a pattern in file contents. Returns matching lines with file paths and line numbers. Supports regular expressions.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Search pattern (string or regex)',
          },
          path: {
            type: 'string',
            description: 'File or directory to search in (optional, defaults to current directory)',
          },
          file_pattern: {
            type: 'string',
            description: 'Glob pattern to filter files (e.g., "*.ts", "**/*.js"). Optional.',
          },
          ignore_case: {
            type: 'boolean',
            description: 'Case-insensitive search (default: false)',
          },
        },
        required: ['pattern'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const pattern = input.pattern as string;
    const path = (input.path as string) || '.';
    const filePattern = (input.file_pattern as string) || '**/*';
    const ignoreCase = (input.ignore_case as boolean) || false;

    if (!pattern) {
      throw new Error('Pattern is required');
    }

    const resolvedPath = resolve(process.cwd(), path);
    const regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
    const matches: Match[] = [];
    const MAX_MATCHES = 100;

    // Get list of files to search
    const files: string[] = [];
    for await (const file of glob(filePattern, { cwd: resolvedPath })) {
      files.push(file);
    }

    // Search each file
    for (const file of files) {
      if (matches.length >= MAX_MATCHES) break;

      const fullPath = join(resolvedPath, file);

      try {
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= MAX_MATCHES) break;

          if (regex.test(lines[i])) {
            matches.push({
              file,
              line: i + 1,
              content: lines[i].trim().slice(0, 200), // Truncate long lines
            });
          }
          // Reset regex lastIndex for global flag
          regex.lastIndex = 0;
        }
      } catch {
        // Skip files that can't be read (binary, permissions, etc.)
        continue;
      }
    }

    if (matches.length === 0) {
      return `No matches found for pattern: ${pattern}`;
    }

    const output = matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n');

    if (matches.length >= MAX_MATCHES) {
      return `Found ${MAX_MATCHES}+ matches (showing first ${MAX_MATCHES}):\n\n${output}`;
    }

    return `Found ${matches.length} matches:\n\n${output}`;
  }
}
