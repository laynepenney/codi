// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * get_inheritance Tool
 *
 * Show class/interface inheritance hierarchy.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';

export class GetInheritanceTool extends BaseTool {
  private indexService: SymbolIndexService;

  constructor(indexService: SymbolIndexService) {
    super();
    this.indexService = indexService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'get_inheritance',
      description:
        'Show the inheritance hierarchy for a class or interface. Returns ancestors (what it extends/implements) and/or descendants (what extends/implements it). ' +
        'Use this to understand class hierarchies and interface implementations.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Class or interface name to analyze.',
          },
          direction: {
            type: 'string',
            enum: ['ancestors', 'descendants', 'both'],
            description:
              'Direction: "ancestors" shows what this class/interface extends, "descendants" shows what extends this, "both" shows both. Default: both.',
          },
        },
        required: ['name'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const name = input.name as string;
    const direction = (input.direction as 'ancestors' | 'descendants' | 'both') ?? 'both';

    if (!name) {
      throw new Error('Class or interface name is required');
    }

    // Check if index exists
    if (!this.indexService.hasIndex()) {
      return 'Symbol index not built. Run /symbols rebuild to build the index first.';
    }

    // Get inheritance hierarchy
    const results = this.indexService.getInheritance(name, direction);

    if (results.length === 0) {
      return `No inheritance relationships found for "${name}".`;
    }

    // Format results
    const lines: string[] = [];
    lines.push(`Inheritance hierarchy for "${name}":\n`);

    // Group by direction
    const ancestors = results.filter(r => r.direction === 'extends' || r.direction === 'implements');
    const descendants = results.filter(r => r.direction === 'extended-by' || r.direction === 'implemented-by');

    if (ancestors.length > 0) {
      lines.push('Ancestors (extends/implements):');
      for (const item of ancestors) {
        const relationStr = item.direction === 'implements' ? 'implements' : 'extends';
        lines.push(`  ${relationStr} ${item.name} (${item.kind}) - ${item.file}:${item.line}`);
      }
      lines.push('');
    }

    if (descendants.length > 0) {
      lines.push('Descendants (extended-by/implemented-by):');
      for (const item of descendants) {
        const relationStr = item.direction;
        lines.push(`  ${relationStr} ${item.name} (${item.kind}) - ${item.file}:${item.line}`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
