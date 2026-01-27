// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { recordChange } from '../history.js';
import { validateAndResolvePath } from '../utils/path-validation.js';
import { fileContentCache } from '../utils/file-content-cache.js';

export class WriteFileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, or overwrites it if it does. Parent directories are created automatically.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to write (relative or absolute)',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input.path as string;
    const content = input.content as string;

    if (!path) {
      throw new Error('Path is required');
    }

    if (content === undefined) {
      throw new Error('Content is required');
    }

    const resolvedPath = validateAndResolvePath(path);
    const isNewFile = !existsSync(resolvedPath);

    // Record change for undo
    const operation = isNewFile ? 'create' : 'write';
    recordChange({
      operation,
      filePath: path,
      newContent: content,
      description: isNewFile
        ? `Created ${path}`
        : `Wrote ${content.length} chars to ${path}`,
    });

    // Create parent directories if needed
    await mkdir(dirname(resolvedPath), { recursive: true });

    await writeFile(resolvedPath, content, 'utf-8');

    // Invalidate cache after write
    fileContentCache.invalidate(resolvedPath);

    return `Successfully wrote ${content.length} characters to ${resolvedPath}`;
  }
}
