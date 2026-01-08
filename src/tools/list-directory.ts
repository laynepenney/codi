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

    const entries = await readdir(resolvedPath);
    const files: FileInfo[] = [];

    for (const entry of entries) {
      // Skip hidden files unless requested
      if (!showHidden && entry.startsWith('.')) {
        continue;
      }

      const fullPath = join(resolvedPath, entry);
      try {
        const stats = await stat(fullPath);
        files.push({
          name: entry,
          type: stats.isDirectory() ? 'directory' : 'file',
          size: stats.size,
        });
      } catch {
        // Skip entries we can't stat
        continue;
      }
    }

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
