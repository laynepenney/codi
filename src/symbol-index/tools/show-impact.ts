// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * show_impact Tool
 *
 * Show the potential impact of changing a symbol or file.
 * Displays dependent files and usage counts.
 */

import { BaseTool } from '../../tools/base.js';
import type { ToolDefinition } from '../../types.js';
import type { SymbolIndexService } from '../service.js';

export class ShowImpactTool extends BaseTool {
  private indexService: SymbolIndexService;

  constructor(indexService: SymbolIndexService) {
    super();
    this.indexService = indexService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'show_impact',
      description:
        'Show the potential impact of changing a symbol or file. ' +
        'Returns a list of dependent files, usage counts, and risk assessment. ' +
        'Use this before making changes to understand the blast radius.',
      input_schema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Symbol name to analyze impact for.',
          },
          file: {
            type: 'string',
            description: 'File path to analyze impact for. If both symbol and file are provided, analyzes the symbol defined in that file.',
          },
          depth: {
            type: 'number',
            description: 'How many levels of dependencies to traverse. Default: 2.',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const symbol = input.symbol as string | undefined;
    const file = input.file as string | undefined;
    const depth = (input.depth as number) ?? 2;

    if (!symbol && !file) {
      throw new Error('Either symbol or file is required');
    }

    // Check if index exists
    if (!this.indexService.hasIndex()) {
      return 'Symbol index not built. Run /symbols rebuild to build the index first.';
    }

    const lines: string[] = [];

    if (symbol) {
      // Analyze symbol impact
      const symbolImpact = this.analyzeSymbolImpact(symbol, file, depth);
      lines.push(...symbolImpact);
    } else if (file) {
      // Analyze file impact
      const fileImpact = this.analyzeFileImpact(file, depth);
      lines.push(...fileImpact);
    }

    return lines.join('\n');
  }

  private analyzeSymbolImpact(symbolName: string, file: string | undefined, depth: number): string[] {
    const lines: string[] = [];
    lines.push(`## Impact Analysis: \`${symbolName}\`\n`);

    // Find the symbol
    const symbols = this.indexService.findSymbols(symbolName, {
      exact: true,
      limit: 10,
    });

    if (symbols.length === 0) {
      lines.push(`Symbol "${symbolName}" not found in index.`);
      return lines;
    }

    // If file is provided, filter to that file
    let targetSymbol = symbols[0];
    if (file) {
      const inFile = symbols.find(s => s.file.includes(file));
      if (inFile) {
        targetSymbol = inFile;
      }
    }

    lines.push(`**Definition:** ${targetSymbol.file}:${targetSymbol.line}`);
    lines.push(`**Kind:** ${targetSymbol.kind}`);
    lines.push(`**Visibility:** ${targetSymbol.visibility}`);
    lines.push('');

    // Find references
    const references = this.indexService.findReferences(symbolName, {
      file: targetSymbol.file,
      includeImports: true,
      includeCallsites: true,
      limit: 100,
    });

    // Group by file
    const byFile = new Map<string, { imports: number; usages: number }>();
    for (const ref of references) {
      const entry = byFile.get(ref.file) || { imports: 0, usages: 0 };
      if (ref.type === 'import' || ref.type === 'type-only') {
        entry.imports++;
      } else {
        entry.usages++;
      }
      byFile.set(ref.file, entry);
    }

    const fileCount = byFile.size;
    const totalRefs = references.length;

    // Risk assessment
    let risk = 'Low';
    let riskEmoji = '🟢';
    if (fileCount > 10 || totalRefs > 50) {
      risk = 'High';
      riskEmoji = '🔴';
    } else if (fileCount > 5 || totalRefs > 20) {
      risk = 'Medium';
      riskEmoji = '🟡';
    }

    lines.push(`### Impact Summary`);
    lines.push(`- **Risk Level:** ${riskEmoji} ${risk}`);
    lines.push(`- **Files Affected:** ${fileCount}`);
    lines.push(`- **Total References:** ${totalRefs}`);
    lines.push('');

    // List affected files
    if (fileCount > 0) {
      lines.push(`### Affected Files`);
      const sortedFiles = [...byFile.entries()]
        .sort((a, b) => (b[1].imports + b[1].usages) - (a[1].imports + a[1].usages));

      for (const [filePath, counts] of sortedFiles.slice(0, 20)) {
        const parts: string[] = [];
        if (counts.imports > 0) parts.push(`${counts.imports} import(s)`);
        if (counts.usages > 0) parts.push(`${counts.usages} usage(s)`);
        lines.push(`- ${filePath}: ${parts.join(', ')}`);
      }

      if (sortedFiles.length > 20) {
        lines.push(`- ... and ${sortedFiles.length - 20} more files`);
      }
    }

    // Check for downstream dependencies (files that import affected files)
    if (depth > 1 && fileCount > 0) {
      const indirectFiles = new Set<string>();
      for (const [filePath] of byFile) {
        const deps = this.indexService.getDependencyGraph(filePath, 'importedBy', depth - 1);
        for (const dep of deps) {
          if (!byFile.has(dep.file)) {
            indirectFiles.add(dep.file);
          }
        }
      }

      if (indirectFiles.size > 0) {
        lines.push('');
        lines.push(`### Indirect Impact (depth ${depth})`);
        lines.push(`${indirectFiles.size} additional file(s) may be affected through transitive dependencies.`);

        const indirectList = [...indirectFiles].slice(0, 10);
        for (const f of indirectList) {
          lines.push(`- ${f}`);
        }
        if (indirectFiles.size > 10) {
          lines.push(`- ... and ${indirectFiles.size - 10} more`);
        }
      }
    }

    return lines;
  }

  private analyzeFileImpact(filePath: string, depth: number): string[] {
    const lines: string[] = [];
    lines.push(`## Impact Analysis: \`${filePath}\`\n`);

    // Get file dependencies
    const dependents = this.indexService.getDependencyGraph(filePath, 'importedBy', depth);

    if (dependents.length === 0) {
      lines.push('No files depend on this file.');
      return lines;
    }

    // Group by depth
    const byDepth = new Map<number, string[]>();
    for (const dep of dependents) {
      const list = byDepth.get(dep.depth) || [];
      list.push(dep.file);
      byDepth.set(dep.depth, list);
    }

    // Risk assessment
    const directDeps = byDepth.get(1)?.length || 0;
    const totalDeps = dependents.length;

    let risk = 'Low';
    let riskEmoji = '🟢';
    if (directDeps > 10 || totalDeps > 30) {
      risk = 'High';
      riskEmoji = '🔴';
    } else if (directDeps > 5 || totalDeps > 15) {
      risk = 'Medium';
      riskEmoji = '🟡';
    }

    lines.push(`### Impact Summary`);
    lines.push(`- **Risk Level:** ${riskEmoji} ${risk}`);
    lines.push(`- **Direct Dependents:** ${directDeps}`);
    lines.push(`- **Total Dependents (depth ${depth}):** ${totalDeps}`);
    lines.push('');

    // List by depth
    for (let d = 1; d <= depth; d++) {
      const files = byDepth.get(d);
      if (files && files.length > 0) {
        lines.push(`### Depth ${d} (${files.length} file${files.length > 1 ? 's' : ''})`);
        for (const f of files.slice(0, 15)) {
          lines.push(`- ${f}`);
        }
        if (files.length > 15) {
          lines.push(`- ... and ${files.length - 15} more`);
        }
        lines.push('');
      }
    }

    return lines;
  }
}
