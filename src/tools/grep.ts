// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, open } from 'fs/promises';
import { glob } from 'node:fs/promises';
import { resolve, join } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

interface Match {
  file: string;
  line: number;
  content: string;
}

// Binary file detection: check first 512 bytes for null bytes or high concentration of non-printable chars
const BINARY_CHECK_SIZE = 512;

async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const fd = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(BINARY_CHECK_SIZE);
      const { bytesRead } = await fd.read(buffer, 0, BINARY_CHECK_SIZE, 0);

      if (bytesRead === 0) return false; // Empty file is not binary

      // Check for null bytes (strong indicator of binary)
      let nullCount = 0;
      let nonPrintableCount = 0;

      for (let i = 0; i < bytesRead; i++) {
        const byte = buffer[i];
        if (byte === 0) {
          nullCount++;
        }
        // Non-printable bytes (excluding common whitespace: tab, newline, carriage return)
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
          nonPrintableCount++;
        }
      }

      // If there are any null bytes, it's likely binary
      if (nullCount > 0) return true;

      // If more than 30% non-printable characters, likely binary
      if (nonPrintableCount / bytesRead > 0.3) return true;

      return false;
    } finally {
      await fd.close();
    }
  } catch {
    // If we can't read the file, treat it as not binary (will fail on full read)
    return false;
  }
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
    // Support parameter aliases for model compatibility:
    // - query -> pattern (common model assumption)
    // - max_results, max, limit -> head_limit (various naming conventions)
    const pattern = (input.pattern as string) || (input.query as string);
    const path = (input.path as string) || '.';
    const filePattern = (input.file_pattern as string) || '**/*';
    const ignoreCase = (input.ignore_case as boolean) || false;
    const headLimit = (input.head_limit as number) ||
                      (input.max_results as number) ||
                      (input.max as number) ||
                      (input.limit as number) ||
                      100;

    if (!pattern) {
      throw new Error('Pattern is required (or use "query" alias)');
    }

    const resolvedPath = resolve(process.cwd(), path);
    const regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
    const matches: Match[] = [];
    const MAX_MATCHES = headLimit;
    let binarySkipped = 0;

    // Get list of files to search
    const files: string[] = [];
    for await (const file of glob(filePattern, { cwd: resolvedPath })) {
      files.push(file);
    }

    // Search each file
    for (const file of files) {
      if (matches.length >= MAX_MATCHES) break;

      const fullPath = join(resolvedPath, file);

      // Skip binary files early (much faster than reading full file)
      if (await isBinaryFile(fullPath)) {
        binarySkipped++;
        continue;
      }

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
      const binaryNote = binarySkipped > 0 ? ` (${binarySkipped} binary files skipped)` : '';
      return `No matches found for pattern: ${pattern}${binaryNote}`;
    }

    const output = matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n');
    const binaryNote = binarySkipped > 0 ? ` (${binarySkipped} binary files skipped)` : '';

    if (matches.length >= MAX_MATCHES) {
      return `Found ${MAX_MATCHES}+ matches (showing first ${MAX_MATCHES})${binaryNote}:\n\n${output}`;
    }

    return `Found ${matches.length} matches${binaryNote}:\n\n${output}`;
  }
}
