/**
 * find_symbol Tool
 *
 * Find symbol definitions by name across the codebase.
 * Supports partial matching, filtering by kind, and export-only search.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';

export class FindSymbolTool extends BaseTool {
  private indexService: SymbolIndexService;

  constructor(indexService: SymbolIndexService) {
    super();
    this.indexService = indexService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'find_symbol',
      description:
        'Find symbol definitions by name across the codebase. Returns matching symbols with file locations, types, and signatures. ' +
        'Supports partial matching and filtering by kind. Use this to find where functions, classes, interfaces, types, etc. are defined.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Symbol name to find. Supports partial matching (e.g., "User" matches "UserService", "UserConfig").',
          },
          kind: {
            type: 'string',
            enum: ['function', 'class', 'interface', 'type', 'enum', 'variable', 'constant', 'method', 'property'],
            description: 'Filter by symbol kind. Omit to search all kinds.',
          },
          exact: {
            type: 'boolean',
            description: 'If true, require exact name match. Default: false (partial matching).',
          },
          exported_only: {
            type: 'boolean',
            description: 'If true, only return exported symbols. Default: false.',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return. Default: 10.',
          },
        },
        required: ['name'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const name = input.name as string;
    const kind = input.kind as string | undefined;
    const exact = (input.exact as boolean) ?? false;
    const exportedOnly = (input.exported_only as boolean) ?? false;
    const maxResults = (input.max_results as number) ?? 10;

    if (!name) {
      throw new Error('Symbol name is required');
    }

    // Check if index exists, if not suggest rebuilding
    if (!this.indexService.hasIndex()) {
      return 'Symbol index not built. Run /symbols rebuild to build the index first.';
    }

    // Find symbols
    const results = this.indexService.findSymbols(name, {
      kind,
      exact,
      exportedOnly,
      limit: maxResults,
    });

    if (results.length === 0) {
      const kindStr = kind ? ` of kind "${kind}"` : '';
      const exportStr = exportedOnly ? ' (exported only)' : '';
      return `No symbols found matching "${name}"${kindStr}${exportStr}.`;
    }

    // Format results
    const lines: string[] = [];
    lines.push(`Found ${results.length} symbol(s) matching "${name}":\n`);

    for (const result of results) {
      // Symbol header: name (kind) - visibility
      const visStr = result.visibility === 'internal' ? '' : ` [${result.visibility}]`;
      lines.push(`${result.name} (${result.kind})${visStr}`);

      // Location
      const endLineStr = result.endLine ? `-${result.endLine}` : '';
      lines.push(`  File: ${result.file}:${result.line}${endLineStr}`);

      // Signature (if available)
      if (result.signature) {
        lines.push(`  Signature: ${result.signature}`);
      }

      // Doc summary (if available)
      if (result.docSummary) {
        lines.push(`  Doc: ${result.docSummary}`);
      }

      lines.push(''); // Empty line between results
    }

    return lines.join('\n').trim();
  }
}
