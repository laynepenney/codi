// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * get_index_status Tool
 *
 * Check the status and freshness of the symbol index.
 */

import { statSync, readdirSync } from 'fs';
import { resolve, relative } from 'path';
import { glob } from 'glob';
import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';

export class GetIndexStatusTool extends BaseTool {
  private indexService: SymbolIndexService;
  private projectRoot: string;

  constructor(indexService: SymbolIndexService, projectRoot: string) {
    super();
    this.indexService = indexService;
    this.projectRoot = projectRoot;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'get_index_status',
      description:
        'Check the status and freshness of the symbol index. ' +
        'Returns statistics, last update time, and lists stale files that have been modified since indexing. ' +
        'Use this to determine if the index needs to be rebuilt.',
      input_schema: {
        type: 'object',
        properties: {
          check_freshness: {
            type: 'boolean',
            description: 'Check for stale files (modified since last index). Default: true',
          },
          max_stale_files: {
            type: 'number',
            description: 'Maximum number of stale files to list. Default: 20',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const checkFreshness = (input.check_freshness as boolean) ?? true;
    const maxStaleFiles = (input.max_stale_files as number) ?? 20;

    // Check if index exists
    if (!this.indexService.hasIndex()) {
      return `## Index Status: Not Built

No symbol index found. Run \`/symbols rebuild\` to build the index.

Building the index enables:
- \`find_symbol\`: Find function/class definitions
- \`find_references\`: Find where symbols are used
- \`goto_definition\`: Navigate to symbol definitions
- \`show_impact\`: Analyze change impact
- And more code navigation features`;
    }

    const lines: string[] = [];
    lines.push('## Index Status\n');

    // Get stats from index service
    const stats = this.indexService.getStats();

    lines.push('### Statistics');
    lines.push(`- **Files Indexed:** ${stats.totalFiles}`);
    lines.push(`- **Total Symbols:** ${stats.totalSymbols}`);
    lines.push(`- **Total Imports:** ${stats.totalImports}`);
    lines.push(`- **Dependencies Tracked:** ${stats.totalDependencies}`);
    lines.push(`- **Index Size:** ${this.formatBytes(stats.indexSizeBytes)}`);
    lines.push('');

    // Timing info
    lines.push('### Timing');
    lines.push(`- **Last Full Rebuild:** ${this.formatDate(stats.lastFullRebuild)}`);
    lines.push(`- **Last Update:** ${this.formatDate(stats.lastUpdate)}`);
    lines.push('');

    // Check freshness if requested
    if (checkFreshness) {
      const { staleFiles, totalStale } = await this.findStaleFiles(
        stats.lastUpdate,
        maxStaleFiles
      );

      if (totalStale === 0) {
        lines.push('### Freshness');
        lines.push('Index is up to date. No stale files detected.');
      } else {
        lines.push(`### Freshness: ${totalStale} Stale File(s)`);
        lines.push('');
        lines.push('The following files have been modified since the last index update:');
        lines.push('');

        for (const file of staleFiles) {
          lines.push(`- ${file}`);
        }

        if (totalStale > maxStaleFiles) {
          lines.push(`- ... and ${totalStale - maxStaleFiles} more`);
        }

        lines.push('');
        lines.push('Run `/symbols update` for incremental update or `/symbols rebuild` for full rebuild.');
      }
    }

    return lines.join('\n');
  }

  /**
   * Find files that have been modified since the last index update.
   */
  private async findStaleFiles(
    lastUpdate: string,
    maxFiles: number
  ): Promise<{ staleFiles: string[]; totalStale: number }> {
    const lastUpdateTime = new Date(lastUpdate).getTime();
    const staleFiles: string[] = [];

    // Get all source files
    const sourcePatterns = [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py', '**/*.go', '**/*.rs', '**/*.java', '**/*.kt',
    ];

    try {
      const files = await glob(sourcePatterns, {
        cwd: this.projectRoot,
        nodir: true,
        ignore: [
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/.git/**',
          '**/coverage/**',
        ],
      });

      let totalStale = 0;

      for (const file of files) {
        try {
          const filePath = resolve(this.projectRoot, file);
          const stat = statSync(filePath);
          const mtime = stat.mtimeMs;

          if (mtime > lastUpdateTime) {
            totalStale++;
            if (staleFiles.length < maxFiles) {
              staleFiles.push(file);
            }
          }
        } catch {
          // Skip files that can't be stat'd
          continue;
        }
      }

      return { staleFiles, totalStale };
    } catch {
      return { staleFiles: [], totalStale: 0 };
    }
  }

  /**
   * Format bytes to human-readable size.
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Format date string to relative time.
   */
  private formatDate(dateStr: string): string {
    if (!dateStr) return 'Never';

    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute(s) ago`;
    if (diffHours < 24) return `${diffHours} hour(s) ago`;
    if (diffDays < 7) return `${diffDays} day(s) ago`;

    return date.toLocaleDateString();
  }
}
