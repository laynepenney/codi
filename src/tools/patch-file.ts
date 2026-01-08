import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

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
      description: 'Apply a unified diff patch to a file. Useful for making multiple changes at once. The patch should be in standard unified diff format.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to patch',
          },
          patch: {
            type: 'string',
            description: 'The unified diff patch to apply. Lines starting with "-" are removed, "+" are added, " " are context.',
          },
        },
        required: ['path', 'patch'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input.path as string;
    const patch = input.patch as string;

    if (!path) {
      throw new Error('Path is required');
    }

    if (!patch) {
      throw new Error('Patch is required');
    }

    const resolvedPath = resolve(process.cwd(), path);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const content = await readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    // Parse the patch
    const hunks = this.parsePatch(patch);

    if (hunks.length === 0) {
      throw new Error('No valid hunks found in patch');
    }

    // Apply hunks in reverse order to preserve line numbers
    const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

    let linesAdded = 0;
    let linesRemoved = 0;

    for (const hunk of sortedHunks) {
      const result = this.applyHunk(lines, hunk);
      lines.splice(0, lines.length, ...result.lines);
      linesAdded += result.added;
      linesRemoved += result.removed;
    }

    // Write the patched file
    await writeFile(resolvedPath, lines.join('\n'), 'utf-8');

    return `Patched ${path}: ${hunks.length} hunk(s) applied, +${linesAdded}/-${linesRemoved} lines`;
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
