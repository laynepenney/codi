// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { recordChange } from '../history.js';

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export class PatchFileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'patch_file',
      description:
        'Apply one or more unified diff patches to a file. Useful for making multiple changes at once. ' +
        'Supports both single patch (via "patch" param) or multiple patches (via "patches" array). ' +
        'Patches should be in standard unified diff format.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to patch',
          },
          patch: {
            type: 'string',
            description: 'Single unified diff patch to apply. Use this OR "patches" array.',
          },
          patches: {
            type: 'array',
            description: 'Array of patches to apply in order. Use this OR single "patch" param.',
            items: {
              type: 'object',
              properties: {
                diff: {
                  type: 'string',
                  description: 'The unified diff content',
                },
                description: {
                  type: 'string',
                  description: 'Optional description of what this patch does',
                },
              },
              required: ['diff'],
            },
          },
        },
        required: ['path'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = input.path as string;
    const singlePatch = input.patch as string | undefined;
    const patchesArray = input.patches as Array<{ diff: string; description?: string }> | undefined;

    if (!filePath) {
      throw new Error('Path is required');
    }

    if (!singlePatch && !patchesArray) {
      throw new Error('Either "patch" or "patches" is required');
    }

    if (singlePatch && patchesArray) {
      throw new Error('Provide either "patch" or "patches", not both');
    }

    const resolvedPath = resolve(process.cwd(), filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    // Normalize to array format
    const patches: Array<{ diff: string; description?: string }> = singlePatch
      ? [{ diff: singlePatch }]
      : patchesArray!;

    const content = await readFile(resolvedPath, 'utf-8');
    let lines = content.split('\n');

    let totalAdded = 0;
    let totalRemoved = 0;
    let totalHunks = 0;
    const results: string[] = [];

    // Apply each patch in order
    for (let i = 0; i < patches.length; i++) {
      const { diff, description } = patches[i];

      // Parse the patch
      const hunks = this.parsePatch(diff);

      if (hunks.length === 0) {
        const msg = description
          ? `Patch ${i + 1} (${description}): No valid hunks found`
          : `Patch ${i + 1}: No valid hunks found`;
        results.push(msg);
        continue;
      }

      // Apply hunks in reverse order to preserve line numbers
      const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

      let linesAdded = 0;
      let linesRemoved = 0;

      for (const hunk of sortedHunks) {
        const result = this.applyHunk(lines, hunk);
        lines = result.lines;
        linesAdded += result.added;
        linesRemoved += result.removed;
      }

      totalAdded += linesAdded;
      totalRemoved += linesRemoved;
      totalHunks += hunks.length;

      const patchLabel = description ? `${description}` : `Patch ${i + 1}`;
      results.push(`${patchLabel}: ${hunks.length} hunk(s), +${linesAdded}/-${linesRemoved}`);
    }

    const newContent = lines.join('\n');

    // Record change for undo
    recordChange({
      operation: 'edit',
      filePath,
      newContent,
      description: `Patched ${filePath}: ${patches.length} patch(es), ${totalHunks} hunk(s), +${totalAdded}/-${totalRemoved} lines`,
    });

    // Write the patched file
    await writeFile(resolvedPath, newContent, 'utf-8');

    // Format output
    if (patches.length === 1) {
      return `Patched ${filePath}: ${totalHunks} hunk(s) applied, +${totalAdded}/-${totalRemoved} lines`;
    }

    return `Patched ${filePath} with ${patches.length} patches:\n${results.map(r => `  - ${r}`).join('\n')}\nTotal: ${totalHunks} hunk(s), +${totalAdded}/-${totalRemoved} lines`;
  }

  private parsePatch(patch: string): Hunk[] {
    const hunks: Hunk[] = [];
    const lines = patch.split('\n');
    let currentHunk: Hunk | null = null;

    for (const line of lines) {
      // Match hunk header: @@ -start,count +start,count @@
      const hunkMatch = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);

      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newCount: parseInt(hunkMatch[4] || '1', 10),
          lines: [],
        };
        continue;
      }

      // Skip diff headers
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) {
        continue;
      }

      // Collect hunk lines
      if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '')) {
        currentHunk.lines.push(line);
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  private applyHunk(
    fileLines: string[],
    hunk: Hunk
  ): { lines: string[]; added: number; removed: number } {
    const result = [...fileLines];
    const startIndex = hunk.oldStart - 1; // Convert to 0-indexed

    let added = 0;
    let removed = 0;
    let offset = 0;

    for (const line of hunk.lines) {
      const content = line.slice(1); // Remove the prefix character

      if (line.startsWith('-')) {
        // Remove line
        result.splice(startIndex + offset, 1);
        removed++;
      } else if (line.startsWith('+')) {
        // Add line
        result.splice(startIndex + offset, 0, content);
        offset++;
        added++;
      } else if (line.startsWith(' ') || line === '') {
        // Context line - just move forward
        offset++;
      }
    }

    return { lines: result, added, removed };
  }
}
