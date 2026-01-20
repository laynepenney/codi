// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generate Docs Tool
 *
 * Extract documentation from source files and generate markdown output.
 * Supports TypeScript/JavaScript JSDoc and Python docstrings.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

interface DocEntry {
  name: string;
  kind: string;
  description: string;
  params?: Array<{ name: string; type?: string; description?: string }>;
  returns?: { type?: string; description?: string };
  examples?: string[];
  line: number;
}

export class GenerateDocsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'generate_docs',
      description:
        'Extract documentation from source files and generate markdown. ' +
        'Parses JSDoc/TSDoc comments from TypeScript/JavaScript or docstrings from Python. ' +
        'Can target a specific symbol or document an entire file.',
      input_schema: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Path to the source file to document',
          },
          symbol: {
            type: 'string',
            description: 'Optional: specific symbol name to document (function, class, etc.)',
          },
          format: {
            type: 'string',
            enum: ['markdown', 'json'],
            description: 'Output format. Default: markdown',
          },
          include_private: {
            type: 'boolean',
            description: 'Include private/internal symbols (prefixed with _). Default: false',
          },
        },
        required: ['file'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = input.file as string;
    const targetSymbol = input.symbol as string | undefined;
    const format = (input.format as string) || 'markdown';
    const includePrivate = (input.include_private as boolean) ?? false;

    if (!filePath) {
      throw new Error('File path is required');
    }

    const resolvedPath = resolve(process.cwd(), filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const content = await readFile(resolvedPath, 'utf-8');
    const ext = extname(resolvedPath).toLowerCase();

    let entries: DocEntry[];

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      entries = this.parseTypeScript(content);
    } else if (ext === '.py') {
      entries = this.parsePython(content);
    } else {
      throw new Error(`Unsupported file type: ${ext}. Supported: .ts, .tsx, .js, .jsx, .py`);
    }

    // Filter private symbols if needed
    if (!includePrivate) {
      entries = entries.filter(e => !e.name.startsWith('_'));
    }

    // Filter to specific symbol if requested
    if (targetSymbol) {
      entries = entries.filter(e =>
        e.name === targetSymbol ||
        e.name.toLowerCase() === targetSymbol.toLowerCase()
      );

      if (entries.length === 0) {
        return `No documentation found for symbol "${targetSymbol}" in ${basename(resolvedPath)}`;
      }
    }

    if (entries.length === 0) {
      return `No documented symbols found in ${basename(resolvedPath)}`;
    }

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    return this.formatMarkdown(entries, basename(resolvedPath));
  }

  /**
   * Parse TypeScript/JavaScript JSDoc comments.
   */
  private parseTypeScript(content: string): DocEntry[] {
    const entries: DocEntry[] = [];
    const lines = content.split('\n');

    // Regex patterns
    const jsdocStart = /^\s*\/\*\*/;
    const jsdocEnd = /\*\/\s*$/;
    const jsdocLine = /^\s*\*\s?(.*)$/;
    const paramTag = /@param\s+(?:\{([^}]+)\}\s+)?(\w+)\s*-?\s*(.*)/;
    const returnsTag = /@returns?\s+(?:\{([^}]+)\}\s+)?(.*)/;
    const exampleTag = /@example/;

    // Symbol patterns
    const functionPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/;
    const arrowFunctionPattern = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/;
    const classPattern = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;
    const interfacePattern = /^(?:export\s+)?interface\s+(\w+)/;
    const typePattern = /^(?:export\s+)?type\s+(\w+)/;
    const methodPattern = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/;

    let currentJSDoc: string[] = [];
    let inJSDoc = false;
    let inExample = false;
    let currentExample: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Track JSDoc blocks
      if (jsdocStart.test(line)) {
        inJSDoc = true;
        currentJSDoc = [];
        inExample = false;
        currentExample = [];
        continue;
      }

      if (inJSDoc) {
        if (jsdocEnd.test(line)) {
          inJSDoc = false;

          // Look ahead for symbol definition
          const nextLine = lines[i + 1] || '';

          let symbolName: string | null = null;
          let symbolKind = 'unknown';

          const funcMatch = nextLine.match(functionPattern);
          const arrowMatch = nextLine.match(arrowFunctionPattern);
          const classMatch = nextLine.match(classPattern);
          const interfaceMatch = nextLine.match(interfacePattern);
          const typeMatch = nextLine.match(typePattern);
          const methodMatch = nextLine.match(methodPattern);

          if (funcMatch) {
            symbolName = funcMatch[1];
            symbolKind = 'function';
          } else if (arrowMatch) {
            symbolName = arrowMatch[1];
            symbolKind = 'function';
          } else if (classMatch) {
            symbolName = classMatch[1];
            symbolKind = 'class';
          } else if (interfaceMatch) {
            symbolName = interfaceMatch[1];
            symbolKind = 'interface';
          } else if (typeMatch) {
            symbolName = typeMatch[1];
            symbolKind = 'type';
          } else if (methodMatch) {
            symbolName = methodMatch[1];
            symbolKind = 'method';
          }

          if (symbolName) {
            const entry = this.parseJSDocContent(currentJSDoc, symbolName, symbolKind, lineNum);
            if (currentExample.length > 0) {
              entry.examples = [currentExample.join('\n')];
            }
            entries.push(entry);
          }

          continue;
        }

        const lineMatch = line.match(jsdocLine);
        if (lineMatch) {
          const content = lineMatch[1];

          if (exampleTag.test(content)) {
            inExample = true;
            continue;
          }

          if (inExample) {
            currentExample.push(content);
          } else {
            currentJSDoc.push(content);
          }
        }
      }
    }

    return entries;
  }

  /**
   * Parse JSDoc content into a DocEntry.
   */
  private parseJSDocContent(
    lines: string[],
    name: string,
    kind: string,
    line: number
  ): DocEntry {
    const entry: DocEntry = { name, kind, description: '', line };
    const descriptionLines: string[] = [];
    const params: DocEntry['params'] = [];
    let returns: DocEntry['returns'];

    const paramTag = /@param\s+(?:\{([^}]+)\}\s+)?(\w+)\s*-?\s*(.*)/;
    const returnsTag = /@returns?\s+(?:\{([^}]+)\}\s+)?(.*)/;

    for (const lineContent of lines) {
      const paramMatch = lineContent.match(paramTag);
      if (paramMatch) {
        params.push({
          name: paramMatch[2],
          type: paramMatch[1],
          description: paramMatch[3],
        });
        continue;
      }

      const returnsMatch = lineContent.match(returnsTag);
      if (returnsMatch) {
        returns = {
          type: returnsMatch[1],
          description: returnsMatch[2],
        };
        continue;
      }

      // Skip other tags
      if (lineContent.startsWith('@')) {
        continue;
      }

      // Add to description
      descriptionLines.push(lineContent);
    }

    entry.description = descriptionLines.join(' ').trim();
    if (params.length > 0) {
      entry.params = params;
    }
    if (returns) {
      entry.returns = returns;
    }

    return entry;
  }

  /**
   * Parse Python docstrings.
   */
  private parsePython(content: string): DocEntry[] {
    const entries: DocEntry[] = [];
    const lines = content.split('\n');

    // Patterns
    const funcPattern = /^(?:async\s+)?def\s+(\w+)\s*\(/;
    const classPattern = /^class\s+(\w+)/;
    const docstringStart = /^\s*("""|\''')/;
    const docstringEnd = /("""|\'\'\')\s*$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for function or class definition
      const funcMatch = line.match(funcPattern);
      const classMatch = line.match(classPattern);

      if (funcMatch || classMatch) {
        const symbolName = funcMatch ? funcMatch[1] : classMatch![1];
        const symbolKind = funcMatch ? 'function' : 'class';

        // Look for docstring on next line
        const nextLine = lines[i + 1] || '';
        if (docstringStart.test(nextLine)) {
          const docLines: string[] = [];
          let j = i + 1;

          // Single-line docstring
          if (docstringEnd.test(nextLine) && nextLine.indexOf('"""') !== nextLine.lastIndexOf('"""')) {
            const doc = nextLine.replace(/^\s*"""|"""\s*$/g, '').trim();
            entries.push({
              name: symbolName,
              kind: symbolKind,
              description: doc,
              line: lineNum,
            });
            continue;
          }

          // Multi-line docstring
          j++;
          while (j < lines.length && !docstringEnd.test(lines[j])) {
            docLines.push(lines[j].trim());
            j++;
          }

          const description = docLines.join(' ').trim();
          entries.push({
            name: symbolName,
            kind: symbolKind,
            description,
            line: lineNum,
          });
        }
      }
    }

    return entries;
  }

  /**
   * Format entries as markdown.
   */
  private formatMarkdown(entries: DocEntry[], fileName: string): string {
    const lines: string[] = [];

    lines.push(`# Documentation: ${fileName}`);
    lines.push('');

    // Group by kind
    const byKind: Record<string, DocEntry[]> = {};
    for (const entry of entries) {
      if (!byKind[entry.kind]) {
        byKind[entry.kind] = [];
      }
      byKind[entry.kind].push(entry);
    }

    const kindOrder = ['class', 'interface', 'type', 'function', 'method'];
    const sortedKinds = Object.keys(byKind).sort((a, b) => {
      const aIdx = kindOrder.indexOf(a);
      const bIdx = kindOrder.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    for (const kind of sortedKinds) {
      const kindEntries = byKind[kind];
      // Proper pluralization (class -> Classes, not Classs)
      const capitalizedKind = kind.charAt(0).toUpperCase() + kind.slice(1);
      const kindTitle = kind.endsWith('s') || kind.endsWith('ss')
        ? capitalizedKind + 'es'
        : capitalizedKind + 's';

      lines.push(`## ${kindTitle}`);
      lines.push('');

      for (const entry of kindEntries) {
        lines.push(`### \`${entry.name}\``);
        lines.push('');

        if (entry.description) {
          lines.push(entry.description);
          lines.push('');
        }

        if (entry.params && entry.params.length > 0) {
          lines.push('**Parameters:**');
          for (const param of entry.params) {
            const typeStr = param.type ? ` \`${param.type}\`` : '';
            const descStr = param.description ? ` - ${param.description}` : '';
            lines.push(`- \`${param.name}\`${typeStr}${descStr}`);
          }
          lines.push('');
        }

        if (entry.returns) {
          const typeStr = entry.returns.type ? ` \`${entry.returns.type}\`` : '';
          const descStr = entry.returns.description ? ` - ${entry.returns.description}` : '';
          lines.push(`**Returns:**${typeStr}${descStr}`);
          lines.push('');
        }

        if (entry.examples && entry.examples.length > 0) {
          lines.push('**Example:**');
          lines.push('```');
          lines.push(entry.examples[0]);
          lines.push('```');
          lines.push('');
        }

        lines.push(`*Defined at line ${entry.line}*`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
