// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * find_references Tool
 *
 * Find all usages/references of a symbol across the codebase.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';

export class FindReferencesTool extends BaseTool {
  private indexService: SymbolIndexService;

  constructor(indexService: SymbolIndexService) {
    super();
    this.indexService = indexService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'find_references',
      description:
        'Find all files that reference, import, or use a symbol. Returns import locations, callsites, and usage types. ' +
        'Use this to understand the impact of changes or find where a symbol is used.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The symbol name to find references for.',
          },
          file: {
            type: 'string',
            description: 'Optional file path where the symbol is defined. Helps disambiguate symbols with the same name and excludes this file from callsite search.',
          },
          include_imports: {
            type: 'boolean',
            description: 'Include import statements in results. Default: true.',
          },
          include_callsites: {
            type: 'boolean',
            description: 'Include callsites and usages (not just imports). Default: true.',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return. Default: 20.',
          },
        },
        required: ['name'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const name = input.name as string;
    const file = input.file as string | undefined;
    const includeImports = (input.include_imports as boolean) ?? true;
    const includeCallsites = (input.include_callsites as boolean) ?? true;
    const maxResults = (input.max_results as number) ?? 20;

    if (!name) {
      throw new Error('Symbol name is required');
    }

    // Check if index exists
    if (!this.indexService.hasIndex()) {
      return 'Symbol index not built. Run /symbols rebuild to build the index first.';
    }

    // Find references
    const results = this.indexService.findReferences(name, {
      file,
      includeImports,
      includeCallsites,
      limit: maxResults,
    });

    if (results.length === 0) {
      // Check if this might be a cross-language entry point (iOS/Swift)
      if (file && (file.includes('iosMain') || file.includes('MainViewController'))) {
        return `No Kotlin references found for "${name}".\nNote: This may be referenced from Swift/Objective-C code, which is not indexed.`;
      }
      return `No references found for "${name}".`;
    }

    // Format results
    const lines: string[] = [];

    // Group by type
    const imports = results.filter(r => r.type === 'import');
    const typeOnly = results.filter(r => r.type === 'type-only');
    const usages = results.filter(r => r.type === 'usage');

    // Calculate per-file counts
    const fileCountMap = new Map<string, number>();
    for (const ref of results) {
      fileCountMap.set(ref.file, (fileCountMap.get(ref.file) || 0) + 1);
    }
    const uniqueFiles = fileCountMap.size;

    // Summary header
    lines.push(`Found ${results.length} reference(s) to "${name}" across ${uniqueFiles} file(s):`);
    lines.push(`  - Imports: ${imports.length}`);
    lines.push(`  - Type-only: ${typeOnly.length}`);
    lines.push(`  - Usages: ${usages.length}`);
    lines.push('');

    if (imports.length > 0) {
      lines.push('## Imports');
      for (const ref of imports) {
        lines.push(`  ${ref.file}:${ref.line}`);
      }
      lines.push('');
    }

    if (typeOnly.length > 0) {
      lines.push('## Type-only imports');
      for (const ref of typeOnly) {
        lines.push(`  ${ref.file}:${ref.line}`);
      }
      lines.push('');
    }

    if (usages.length > 0) {
      lines.push('## Usages');
      for (const ref of usages) {
        const contextStr = ref.context ? ` - ${ref.context}` : '';
        lines.push(`  ${ref.file}:${ref.line}${contextStr}`);
      }
      lines.push('');
    }

    // Show files with most references
    if (uniqueFiles > 5) {
      const topFiles = [...fileCountMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      lines.push('## Files with most references');
      for (const [f, count] of topFiles) {
        lines.push(`  ${f}: ${count} reference(s)`);
      }
    }

    return lines.join('\n').trim();
  }
}
