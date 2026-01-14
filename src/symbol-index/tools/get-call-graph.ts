// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * get_call_graph Tool
 *
 * Show function call relationships (callers and callees).
 *
 * Note: Full call graph analysis requires AST parsing to track call sites
 * within function bodies. This implementation provides a basic version
 * based on import/export relationships and symbol names.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';

export class GetCallGraphTool extends BaseTool {
  private indexService: SymbolIndexService;

  constructor(indexService: SymbolIndexService) {
    super();
    this.indexService = indexService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'get_call_graph',
      description:
        'Show potential callers of a function based on import analysis. ' +
        'Note: This provides import-based caller detection, not full call graph analysis. ' +
        'Use find_references for more accurate results.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Function name to analyze.',
          },
          file: {
            type: 'string',
            description: 'File where the function is defined. Helps disambiguate functions with the same name.',
          },
          direction: {
            type: 'string',
            enum: ['callers', 'callees', 'both'],
            description:
              'Direction: "callers" shows files that import and potentially call this function. Default: callers.',
          },
          depth: {
            type: 'number',
            description: 'How many levels deep to traverse. Default: 1.',
          },
        },
        required: ['name'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const name = input.name as string;
    const file = input.file as string | undefined;
    const direction = (input.direction as 'callers' | 'callees' | 'both') ?? 'callers';

    if (!name) {
      throw new Error('Function name is required');
    }

    // Check if index exists
    if (!this.indexService.hasIndex()) {
      return 'Symbol index not built. Run /symbols rebuild to build the index first.';
    }

    const lines: string[] = [];
    lines.push(`Call graph analysis for "${name}":\n`);

    // For callers, we use the import tracking to find files that import this symbol
    if (direction === 'callers' || direction === 'both') {
      const references = this.indexService.findReferences(name, {
        file,
        includeImports: true,
        limit: 50,
      });

      if (references.length > 0) {
        lines.push('Potential callers (files that import this symbol):');
        for (const ref of references) {
          const typeStr = ref.type === 'type-only' ? ' (type-only)' : '';
          lines.push(`  ${ref.file}:${ref.line}${typeStr}`);
        }
        lines.push('');
      } else {
        lines.push('No potential callers found (no imports of this symbol).');
        lines.push('');
      }
    }

    // For callees, we would need to parse the function body
    // This is a limitation of the current implementation
    if (direction === 'callees' || direction === 'both') {
      lines.push('Callees (functions called by this function):');
      lines.push('  Note: Full callee analysis requires AST parsing of function bodies.');
      lines.push('  Use the Read tool to examine the function implementation.');
      lines.push('');

      // We can at least show what the containing file imports
      if (file) {
        const deps = this.indexService.getDependencyGraph(file, 'imports', 1);
        if (deps.length > 0) {
          lines.push('Files imported by the containing file (potential callee sources):');
          for (const dep of deps) {
            lines.push(`  ${dep.file}`);
          }
          lines.push('');
        }
      }
    }

    return lines.join('\n').trim();
  }
}
