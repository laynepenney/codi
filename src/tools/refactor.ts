// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Refactor Tool
 *
 * Atomic search-and-replace across multiple files in the codebase.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative } from 'path';
import { glob } from 'glob';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { recordChange } from '../history.js';

interface RefactorResult {
  file: string;
  replacements: number;
  preview?: string;
}

export class RefactorTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'refactor',
      description:
        'Atomic search-and-replace across multiple files. ' +
        'Finds all occurrences of a pattern and replaces them in one operation. ' +
        'Use "dry_run: true" to preview changes without applying them. ' +
        'Supports regex patterns and file filtering.',
      input_schema: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Text or regex pattern to search for',
          },
          replace: {
            type: 'string',
            description: 'Replacement text. Use $1, $2 etc. for regex capture groups.',
          },
          scope: {
            type: 'string',
            description: 'Directory to search in (default: current directory)',
          },
          file_pattern: {
            type: 'string',
            description: 'Glob pattern for files to include (e.g., "**/*.ts", "src/**/*.js")',
          },
          is_regex: {
            type: 'boolean',
            description: 'Treat search as a regular expression. Default: false (literal string)',
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Case-sensitive matching. Default: true',
          },
          whole_word: {
            type: 'boolean',
            description: 'Match whole words only. Default: false',
          },
          dry_run: {
            type: 'boolean',
            description: 'Preview changes without applying them. Default: false',
          },
          max_files: {
            type: 'number',
            description: 'Maximum number of files to modify. Default: 50',
          },
        },
        required: ['search', 'replace'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const search = input.search as string;
    const replace = input.replace as string;
    const scope = (input.scope as string) || '.';
    const filePattern = (input.file_pattern as string) || '**/*.{ts,tsx,js,jsx,py,go,rs,java,kt}';
    const isRegex = (input.is_regex as boolean) ?? false;
    const caseSensitive = (input.case_sensitive as boolean) ?? true;
    const wholeWord = (input.whole_word as boolean) ?? false;
    const dryRun = (input.dry_run as boolean) ?? false;
    const maxFiles = (input.max_files as number) ?? 50;

    if (!search) {
      throw new Error('Search pattern is required');
    }

    if (replace === undefined) {
      throw new Error('Replace text is required (can be empty string)');
    }

    // Build the regex
    let pattern: RegExp;
    try {
      let searchPattern = search;

      if (!isRegex) {
        // Escape special regex characters for literal search
        searchPattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      if (wholeWord) {
        searchPattern = `\\b${searchPattern}\\b`;
      }

      const flags = caseSensitive ? 'g' : 'gi';
      pattern = new RegExp(searchPattern, flags);
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : error}`);
    }

    // Find matching files
    const cwd = resolve(process.cwd(), scope);
    const files = await glob(filePattern, {
      cwd,
      nodir: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    });

    if (files.length === 0) {
      return `No files found matching pattern "${filePattern}" in ${scope}`;
    }

    // Process files
    const results: RefactorResult[] = [];
    let totalReplacements = 0;
    let filesModified = 0;

    for (const file of files) {
      if (filesModified >= maxFiles) {
        break;
      }

      const filePath = resolve(cwd, file);

      if (!existsSync(filePath)) {
        continue;
      }

      try {
        const content = await readFile(filePath, 'utf-8');
        const matches = content.match(pattern);

        if (!matches || matches.length === 0) {
          continue;
        }

        const newContent = content.replace(pattern, replace);
        const replacements = matches.length;
        totalReplacements += replacements;

        // Get preview of first change
        const firstMatch = content.match(pattern);
        let preview: string | undefined;
        if (firstMatch && firstMatch.index !== undefined) {
          const start = Math.max(0, firstMatch.index - 20);
          const end = Math.min(content.length, firstMatch.index + firstMatch[0].length + 20);
          const before = content.slice(start, end);
          const after = before.replace(pattern, replace);
          preview = `"...${before.trim()}..." → "...${after.trim()}..."`;
        }

        results.push({
          file: relative(process.cwd(), filePath),
          replacements,
          preview,
        });

        if (!dryRun) {
          // Record change for undo
          recordChange({
            operation: 'edit',
            filePath: relative(process.cwd(), filePath),
            newContent,
            description: `Refactored: ${replacements} replacement(s) of "${search}"`,
          });

          await writeFile(filePath, newContent, 'utf-8');
        }

        filesModified++;
      } catch {
        // Skip files that can't be read (binary, etc.)
        continue;
      }
    }

    if (results.length === 0) {
      return `No matches found for "${search}" in ${files.length} file(s)`;
    }

    // Format output
    const mode = dryRun ? '[DRY RUN] ' : '';
    const lines: string[] = [];

    lines.push(`${mode}Refactor: "${search}" → "${replace}"`);
    lines.push('');
    lines.push(`**Files:** ${results.length}`);
    lines.push(`**Total Replacements:** ${totalReplacements}`);
    lines.push('');

    if (filesModified >= maxFiles) {
      lines.push(`⚠️  Stopped at max_files limit (${maxFiles}). More files may match.`);
      lines.push('');
    }

    lines.push('### Changes');
    for (const result of results.slice(0, 20)) {
      lines.push(`- **${result.file}**: ${result.replacements} replacement(s)`);
      if (result.preview) {
        lines.push(`  ${result.preview}`);
      }
    }

    if (results.length > 20) {
      lines.push(`- ... and ${results.length - 20} more files`);
    }

    if (dryRun) {
      lines.push('');
      lines.push('_Run with dry_run: false to apply these changes._');
    }

    return lines.join('\n');
  }
}
