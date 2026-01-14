/**
 * Rebuild Index Tool
 *
 * Allows the AI to trigger a full or incremental rebuild of the symbol index.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import { getBackgroundIndexer } from '../background-indexer.js';

export class RebuildIndexTool extends BaseTool {
  private projectRoot: string;

  constructor(projectRoot: string) {
    super();
    this.projectRoot = projectRoot;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'rebuild_index',
      description: `Rebuild the symbol index for the codebase.

Use this when:
- Navigation tools (find_symbol, goto_definition, find_references) return stale results
- New files have been added to the project
- Major refactoring has occurred
- The index appears out of sync with the code

Options:
- full: Do a complete rebuild (slower, more thorough)
- incremental: Only update changed files (faster, default)
- deep: Include usage-based dependency tracking (slowest, most complete)

The index tracks symbols (functions, classes, types), imports, and dependencies
to enable fast code navigation.`,
      input_schema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['incremental', 'full', 'deep'],
            description: 'Rebuild mode: incremental (default), full, or deep (includes usage tracking)',
          },
          clear: {
            type: 'boolean',
            description: 'Clear the existing index before rebuilding (only applies to full/deep modes)',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const mode = (input.mode as string) || 'incremental';
    const clear = input.clear as boolean;

    const indexer = getBackgroundIndexer(this.projectRoot);

    try {
      // Check if indexing is already in progress
      if (indexer.getIsIndexing()) {
        return `Index operation already in progress. Please wait for it to complete.`;
      }

      const startTime = Date.now();

      if (mode === 'incremental') {
        const result = await indexer.incrementalUpdate();
        const stats = indexer.getStats();

        return this.formatIncrementalResult(result, stats, Date.now() - startTime);
      } else {
        // Full or deep rebuild
        const result = await indexer.rebuild({
          deepIndex: mode === 'deep',
          forceRebuild: clear,
        });
        const stats = indexer.getStats();

        return this.formatFullResult(result, stats, mode, Date.now() - startTime);
      }
    } catch (error) {
      throw new Error(`Index rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private formatIncrementalResult(
    result: { added: number; modified: number; removed: number; duration: number },
    stats: { totalFiles: number; totalSymbols: number; totalImports: number; totalDependencies: number },
    totalDuration: number
  ): string {
    const lines: string[] = ['## Incremental Index Update Complete'];
    lines.push('');

    if (result.added === 0 && result.modified === 0 && result.removed === 0) {
      lines.push('No changes detected. Index is up to date.');
    } else {
      lines.push('### Changes Processed');
      lines.push(`- Added: ${result.added} files`);
      lines.push(`- Modified: ${result.modified} files`);
      lines.push(`- Removed: ${result.removed} files`);
    }

    lines.push('');
    lines.push('### Index Statistics');
    lines.push(`- Total Files: ${stats.totalFiles}`);
    lines.push(`- Total Symbols: ${stats.totalSymbols}`);
    lines.push(`- Total Imports: ${stats.totalImports}`);
    lines.push(`- Total Dependencies: ${stats.totalDependencies}`);
    lines.push('');
    lines.push(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);

    return lines.join('\n');
  }

  private formatFullResult(
    result: { filesProcessed: number; symbolsExtracted: number; duration: number; errors: string[] },
    stats: { totalFiles: number; totalSymbols: number; totalImports: number; totalDependencies: number; version: string },
    mode: string,
    totalDuration: number
  ): string {
    const lines: string[] = [`## ${mode === 'deep' ? 'Deep' : 'Full'} Index Rebuild Complete`];
    lines.push('');

    lines.push('### Build Results');
    lines.push(`- Files Processed: ${result.filesProcessed}`);
    lines.push(`- Symbols Extracted: ${result.symbolsExtracted}`);

    if (result.errors.length > 0) {
      lines.push(`- Errors: ${result.errors.length}`);
      lines.push('');
      lines.push('### Errors');
      for (const error of result.errors.slice(0, 5)) {
        lines.push(`- ${error}`);
      }
      if (result.errors.length > 5) {
        lines.push(`  ... and ${result.errors.length - 5} more`);
      }
    }

    lines.push('');
    lines.push('### Index Statistics');
    lines.push(`- Total Files: ${stats.totalFiles}`);
    lines.push(`- Total Symbols: ${stats.totalSymbols}`);
    lines.push(`- Total Imports: ${stats.totalImports}`);
    lines.push(`- Total Dependencies: ${stats.totalDependencies}`);
    lines.push(`- Index Version: ${stats.version}`);

    if (mode === 'deep') {
      lines.push('');
      lines.push('_Deep indexing enabled: usage-based dependencies are tracked._');
    }

    lines.push('');
    lines.push(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);

    return lines.join('\n');
  }
}
