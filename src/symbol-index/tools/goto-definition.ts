/**
 * goto_definition Tool
 *
 * Navigate to a symbol's definition from a usage location.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';

export class GotoDefinitionTool extends BaseTool {
  private indexService: SymbolIndexService;

  constructor(indexService: SymbolIndexService) {
    super();
    this.indexService = indexService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'goto_definition',
      description:
        'Navigate to the definition of a symbol. Returns the file location, type, and signature of where the symbol is defined. ' +
        'Useful for finding where a function, class, type, or variable is originally declared.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The symbol name to find the definition of.',
          },
          from_file: {
            type: 'string',
            description:
              'Optional file path where the symbol is being used. Helps disambiguate when multiple definitions exist.',
          },
          resolve_reexports: {
            type: 'boolean',
            description: 'If true, follow re-exports to find the original definition. Default: true.',
          },
        },
        required: ['name'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const name = input.name as string;
    const fromFile = input.from_file as string | undefined;
    const resolveReexports = (input.resolve_reexports as boolean) ?? true;

    if (!name) {
      throw new Error('Symbol name is required');
    }

    // Check if index exists
    if (!this.indexService.hasIndex()) {
      return 'Symbol index not built. Run /symbols rebuild to build the index first.';
    }

    // Find definition
    const result = this.indexService.gotoDefinition(name, {
      fromFile,
      resolveReexports,
    });

    if (!result) {
      return `No definition found for "${name}".`;
    }

    // Format result
    const lines: string[] = [];
    lines.push(`Definition of "${name}":\n`);

    // Symbol info
    const visStr = result.visibility === 'internal' ? '' : ` [${result.visibility}]`;
    lines.push(`${result.name} (${result.kind})${visStr}`);

    // Location
    const endLineStr = result.endLine ? `-${result.endLine}` : '';
    lines.push(`  File: ${result.file}:${result.line}${endLineStr}`);

    // Signature
    if (result.signature) {
      lines.push(`  Signature: ${result.signature}`);
    }

    // Doc summary
    if (result.docSummary) {
      lines.push(`  Doc: ${result.docSummary}`);
    }

    return lines.join('\n');
  }
}
