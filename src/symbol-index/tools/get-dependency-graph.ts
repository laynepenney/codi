/**
 * get_dependency_graph Tool
 *
 * Show file-level import/export dependencies.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';
import type { DependencyResult } from '../types.js';

export class GetDependencyGraphTool extends BaseTool {
  private indexService: SymbolIndexService;

  constructor(indexService: SymbolIndexService) {
    super();
    this.indexService = indexService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'get_dependency_graph',
      description:
        'Show the dependency graph for a file. Returns files that import this file (dependents) and/or files that this file imports (dependencies). ' +
        'Use this to understand what would be affected by changes to a file.',
      input_schema: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'File path to analyze (relative to project root).',
          },
          direction: {
            type: 'string',
            enum: ['imports', 'importedBy', 'both'],
            description:
              'Direction of dependencies: "imports" shows what this file imports, "importedBy" shows what imports this file, "both" shows both. Default: both.',
          },
          depth: {
            type: 'number',
            description: 'How many levels deep to traverse. Default: 1.',
          },
          flat: {
            type: 'boolean',
            description: 'Return a flat list instead of nested by depth. Default: false.',
          },
          include_external: {
            type: 'boolean',
            description: 'Include external (node_modules) dependencies. Default: false.',
          },
        },
        required: ['file'],
      },
    };
  }

  /**
   * Deduplicate results by file path, keeping the entry with the smallest depth
   */
  private deduplicateResults(results: DependencyResult[]): DependencyResult[] {
    const seen = new Map<string, DependencyResult>();
    for (const r of results) {
      const key = `${r.direction}:${r.file}`;
      const existing = seen.get(key);
      if (!existing || r.depth < existing.depth) {
        seen.set(key, r);
      }
    }
    return Array.from(seen.values());
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const file = input.file as string;
    const direction = (input.direction as 'imports' | 'importedBy' | 'both') ?? 'both';
    const depth = (input.depth as number) ?? 1;
    const flat = (input.flat as boolean) ?? false;

    if (!file) {
      throw new Error('File path is required');
    }

    // Check if index exists
    if (!this.indexService.hasIndex()) {
      return 'Symbol index not built. Run /symbols rebuild to build the index first.';
    }

    // Get dependency graph
    let results = this.indexService.getDependencyGraph(file, direction, depth);

    // Deduplicate results
    results = this.deduplicateResults(results);

    if (results.length === 0) {
      const dirStr = direction === 'both' ? 'dependencies' : direction === 'imports' ? 'imports' : 'dependents';
      return `No ${dirStr} found for "${file}".`;
    }

    // Format results
    const lines: string[] = [];
    lines.push(`Dependency graph for "${file}":\n`);

    // Group by direction
    const imports = results.filter(r => r.direction === 'imports');
    const importedBy = results.filter(r => r.direction === 'importedBy');

    if (imports.length > 0) {
      lines.push('This file imports:');
      if (flat) {
        // Flat mode - simple list sorted alphabetically
        const sorted = [...imports].sort((a, b) => a.file.localeCompare(b.file));
        for (const dep of sorted) {
          const depthInfo = depth > 1 ? ` (depth: ${dep.depth})` : '';
          lines.push(`  ${dep.file}${depthInfo}`);
        }
      } else {
        // Nested mode - group by depth with indentation
        const byDepth = new Map<number, typeof imports>();
        for (const dep of imports) {
          if (!byDepth.has(dep.depth)) {
            byDepth.set(dep.depth, []);
          }
          byDepth.get(dep.depth)!.push(dep);
        }

        for (const [d, deps] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
          const indent = '  '.repeat(d);
          const depthLabel = d === 1 ? '(direct)' : `(transitive, depth ${d})`;
          if (d > 1) {
            lines.push(`${indent}${depthLabel}`);
          }
          for (const dep of deps.sort((a, b) => a.file.localeCompare(b.file))) {
            lines.push(`${indent}  ${dep.file}`);
          }
        }
      }
      lines.push('');
    }

    if (importedBy.length > 0) {
      lines.push('This file is imported by:');
      if (flat) {
        // Flat mode - simple list sorted alphabetically
        const sorted = [...importedBy].sort((a, b) => a.file.localeCompare(b.file));
        for (const dep of sorted) {
          const depthInfo = depth > 1 ? ` (depth: ${dep.depth})` : '';
          lines.push(`  ${dep.file}${depthInfo}`);
        }
      } else {
        // Nested mode - group by depth with indentation
        const byDepth = new Map<number, typeof importedBy>();
        for (const dep of importedBy) {
          if (!byDepth.has(dep.depth)) {
            byDepth.set(dep.depth, []);
          }
          byDepth.get(dep.depth)!.push(dep);
        }

        for (const [d, deps] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
          const indent = '  '.repeat(d);
          const depthLabel = d === 1 ? '(direct)' : `(transitive, depth ${d})`;
          if (d > 1) {
            lines.push(`${indent}${depthLabel}`);
          }
          for (const dep of deps.sort((a, b) => a.file.localeCompare(b.file))) {
            lines.push(`${indent}  ${dep.file}`);
          }
        }
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
