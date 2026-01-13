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
        'Find all files that reference or import a symbol. Returns import locations and usage types. ' +
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
            description: 'Optional file path where the symbol is defined. Helps disambiguate symbols with the same name.',
          },
          include_imports: {
            type: 'boolean',
            description: 'Include import statements in results. Default: true.',
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
      limit: maxResults,
    });

    if (results.length === 0) {
      return `No references found for "${name}".`;
    }

    // Format results
    const lines: string[] = [];
    lines.push(`Found ${results.length} reference(s) to "${name}":\n`);

    // Group by type
    const imports = results.filter(r => r.type === 'import');
    const typeOnly = results.filter(r => r.type === 'type-only');
    const usages = results.filter(r => r.type === 'usage');

    if (imports.length > 0) {
      lines.push('Imports:');
      for (const ref of imports) {
        lines.push(`  ${ref.file}:${ref.line}`);
      }
      lines.push('');
    }

    if (typeOnly.length > 0) {
      lines.push('Type-only imports:');
      for (const ref of typeOnly) {
        lines.push(`  ${ref.file}:${ref.line}`);
      }
      lines.push('');
    }

    if (usages.length > 0) {
      lines.push('Usages:');
      for (const ref of usages) {
        const contextStr = ref.context ? ` - ${ref.context}` : '';
        lines.push(`  ${ref.file}:${ref.line}${contextStr}`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
