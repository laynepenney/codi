// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdir, stat } from 'fs/promises';
import { resolve, join } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

interface FileInfo {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

export class ListDirectoryTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'list_directory',
      description: 'List files and directories in a given path. Shows file types and sizes. Use this to explore the directory structure.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (optional, defaults to current directory)',
          },
          show_hidden: {
            type: 'boolean',
            description: 'Include hidden files (starting with .) (default: false)',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = (input.path as string) || '.';
    const showHidden = (input.show_hidden as boolean) || false;

    const resolvedPath = resolve(process.cwd(), path);

    // Use withFileTypes to get file types in a single call (10-100x faster for large directories)
    const entries = await readdir(resolvedPath, { withFileTypes: true });
    const files: FileInfo[] = [];
    const sizeLookups: Promise<void>[] = [];

    for (const entry of entries) {
      // Skip hidden files unless requested
      if (!showHidden && entry.name.startsWith('.')) {
        continue;
      }

      const isDirectory = entry.isDirectory();
      const fullPath = join(resolvedPath, entry.name);

      // For directories, we don't need size. For files, we need to stat for size.
      // This is still N stat calls for files, but we avoid stat calls for directories.
      if (isDirectory) {
        files.push({
          name: entry.name,
          type: 'directory',
          size: 0,
        });
      } else {
        // Queue size lookup for files (executed in parallel)
        const fileInfo: FileInfo = {
          name: entry.name,
          type: 'file',
          size: 0,
        };
        files.push(fileInfo);
        sizeLookups.push(
          stat(fullPath)
            .then((stats) => {
              fileInfo.size = stats.size;
            })
            .catch(() => {
              // If we can't stat, leave size as 0
            })
        );
      }
    }

    // Wait for all file size lookups in parallel
    await Promise.all(sizeLookups);

    if (files.length === 0) {
      return `Directory is empty: ${path}`;
    }

    // Sort: directories first, then files, alphabetically
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // Format output
    const lines = files.map((f) => {
      if (f.type === 'directory') {
        return `📁 ${f.name}/`;
      }
      return `📄 ${f.name} (${this.formatSize(f.size)})`;
    });

    return `Contents of ${path}:\n\n${lines.join('\n')}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}
