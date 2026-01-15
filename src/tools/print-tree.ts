// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { readdir, stat } from 'fs/promises';
import { resolve, join, basename } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

interface TreeNode {
  name: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export class PrintTreeTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'print_tree',
      description: 'Print a tree-like directory structure. Useful for understanding project layout. Respects .gitignore patterns and skips common non-essential directories.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Root directory path (optional, defaults to current directory)',
          },
          depth: {
            type: 'number',
            description: 'Maximum depth to traverse (optional, defaults to 3)',
          },
          show_hidden: {
            type: 'boolean',
            description: 'Include hidden files and directories (default: false)',
          },
          show_files: {
            type: 'boolean',
            description: 'Include files in output, not just directories (default: true)',
          },
        },
        required: [],
      },
    };
  }

  // Directories to always skip (common non-essential directories)
  private readonly SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    '.nox',
    '.eggs',
    '*.egg-info',
    'dist',
    'build',
    '.next',
    '.nuxt',
    '.output',
    '.cache',
    '.parcel-cache',
    '.turbo',
    'coverage',
    '.nyc_output',
    'vendor',
    'target', // Rust/Java
    '.gradle',
    '.idea',
    '.vscode',
  ]);

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = (input.path as string) || '.';
    const maxDepth = (input.depth as number) || 3;
    const showHidden = (input.show_hidden as boolean) || false;
    const showFiles = input.show_files !== false; // Default to true

    const resolvedPath = resolve(process.cwd(), path);
    const rootName = basename(resolvedPath) || resolvedPath;

    try {
      const tree = await this.buildTree(resolvedPath, 0, maxDepth, showHidden, showFiles);
      if (!tree) {
        return `Directory not found or empty: ${path}`;
      }

      const lines: string[] = [rootName + '/'];
      this.renderTree(tree.children || [], '', lines, showFiles);

      return lines.join('\n');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Error reading directory: ${msg}`;
    }
  }

  private async buildTree(
    dirPath: string,
    currentDepth: number,
    maxDepth: number,
    showHidden: boolean,
    showFiles: boolean
  ): Promise<TreeNode | null> {
    try {
      const stats = await stat(dirPath);
      if (!stats.isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }

    const name = basename(dirPath) || dirPath;
    const node: TreeNode = { name, type: 'directory', children: [] };

    if (currentDepth >= maxDepth) {
      return node;
    }

    try {
      const entries = await readdir(dirPath);
      const children: TreeNode[] = [];

      for (const entry of entries) {
        // Skip hidden files unless requested
        if (!showHidden && entry.startsWith('.')) {
          continue;
        }

        // Skip non-essential directories
        if (this.SKIP_DIRS.has(entry)) {
          continue;
        }

        const fullPath = join(dirPath, entry);

        try {
          const entryStats = await stat(fullPath);

          if (entryStats.isDirectory()) {
            const childTree = await this.buildTree(
              fullPath,
              currentDepth + 1,
              maxDepth,
              showHidden,
              showFiles
            );
            if (childTree) {
              children.push(childTree);
            }
          } else if (showFiles) {
            children.push({ name: entry, type: 'file' });
          }
        } catch {
          // Skip entries we can't stat
          continue;
        }
      }

      // Sort: directories first, then files, alphabetically
      children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      node.children = children;
    } catch {
      // Can't read directory
    }

    return node;
  }

  private renderTree(nodes: TreeNode[], prefix: string, lines: string[], showFiles: boolean): void {
    const filteredNodes = showFiles ? nodes : nodes.filter(n => n.type === 'directory');

    for (let i = 0; i < filteredNodes.length; i++) {
      const node = filteredNodes[i];
      const isLast = i === filteredNodes.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      if (node.type === 'directory') {
        lines.push(prefix + connector + node.name + '/');
        if (node.children && node.children.length > 0) {
          this.renderTree(node.children, prefix + childPrefix, lines, showFiles);
        }
      } else {
        lines.push(prefix + connector + node.name);
      }
    }
  }
}
