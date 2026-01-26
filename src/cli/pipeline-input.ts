// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pipeline input resolution for file/glob patterns.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { isPathWithinProject } from '../utils/path-validation.js';

/**
 * Configuration for pipeline input resolution.
 */
export interface PipelineInputConfig {
  maxFiles: number;
  maxFileSize: number;
  maxTotalSize: number;
}

export const DEFAULT_PIPELINE_INPUT_CONFIG: PipelineInputConfig = {
  maxFiles: 20,
  maxFileSize: 50000, // 50KB per file
  maxTotalSize: 200000, // 200KB total
};

/**
 * Check if a string looks like a glob pattern or file path.
 */
export function isGlobOrFilePath(input: string): boolean {
  // Check for glob patterns
  if (input.includes('*') || input.includes('?')) {
    return true;
  }
  // Check if it looks like a file path (starts with ./ or / or contains file extensions)
  if (input.startsWith('./') || input.startsWith('/') || input.startsWith('src/')) {
    return true;
  }
  // Check for common file extensions
  if (/\.(ts|js|tsx|jsx|py|go|rs|java|md|json|yaml|yml)$/i.test(input)) {
    return true;
  }
  return false;
}

/**
 * Resolve pipeline input to actual file contents.
 * If input is a glob pattern or file path, reads the files and returns their contents.
 * Otherwise, returns the input as-is.
 */
export async function resolvePipelineInput(
  input: string,
  config: PipelineInputConfig = DEFAULT_PIPELINE_INPUT_CONFIG
): Promise<{ resolvedInput: string; filesRead: number; truncated: boolean }> {
  if (!isGlobOrFilePath(input)) {
    return { resolvedInput: input, filesRead: 0, truncated: false };
  }

  const cwd = process.cwd();
  const files: string[] = [];

  // Check if it's a direct file path or a glob pattern
  if (input.includes('*') || input.includes('?')) {
    // It's a glob pattern
    for await (const file of glob(input, { cwd })) {
      // Validate each file is within project (handles symlinks)
      const fullPath = join(cwd, file);
      if (isPathWithinProject(fullPath, cwd)) {
        files.push(file);
      }
    }
  } else {
    // It's a direct file path
    const fullPath = input.startsWith('/') ? input : join(cwd, input);

    // Validate path is within project directory (prevent path traversal)
    if (!isPathWithinProject(fullPath, cwd)) {
      return {
        resolvedInput: `Security error: Path "${input}" resolves outside the project directory.`,
        filesRead: 0,
        truncated: false
      };
    }

    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          files.push(input);
        } else if (stat.isDirectory()) {
          // If it's a directory, glob for common code files
          for await (const file of glob(`${input}/**/*.{ts,js,tsx,jsx,py,go,rs,java,md,json,yaml,yml}`, { cwd })) {
            // Validate each file is within project (handles symlinks)
            const filePath = join(cwd, file);
            if (isPathWithinProject(filePath, cwd)) {
              files.push(file);
            }
          }
        }
      } catch {
        // Ignore stat errors
      }
    }
  }

  if (files.length === 0) {
    return { resolvedInput: `No files found matching: ${input}`, filesRead: 0, truncated: false };
  }

  // Sort files for consistent ordering
  files.sort();

  // Limit number of files
  const filesToRead = files.slice(0, config.maxFiles);
  const truncatedFiles = files.length > config.maxFiles;

  // Read file contents
  const contents: string[] = [];
  let totalSize = 0;
  let truncatedSize = false;

  for (const file of filesToRead) {
    const fullPath = file.startsWith('/') ? file : join(cwd, file);

    // Defense in depth: validate path again before reading
    if (!isPathWithinProject(fullPath, cwd)) {
      contents.push(`\n### File: ${file}\n\`\`\`\n[Skipped: path resolves outside project directory]\n\`\`\`\n`);
      continue;
    }

    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;

      // Check file size
      if (stat.size > config.maxFileSize) {
        contents.push(`\n### File: ${file}\n\`\`\`\n[File too large: ${(stat.size / 1024).toFixed(1)}KB > ${(config.maxFileSize / 1024).toFixed(0)}KB limit]\n\`\`\`\n`);
        continue;
      }

      // Check total size limit
      if (totalSize + stat.size > config.maxTotalSize) {
        truncatedSize = true;
        contents.push(`\n### File: ${file}\n\`\`\`\n[Skipped: total size limit reached]\n\`\`\`\n`);
        continue;
      }

      const content = readFileSync(fullPath, 'utf-8');
      const ext = file.split('.').pop() || '';
      contents.push(`\n### File: ${file}\n\`\`\`${ext}\n${content}\n\`\`\`\n`);
      totalSize += stat.size;
    } catch (error) {
      contents.push(`\n### File: ${file}\n\`\`\`\n[Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}]\n\`\`\`\n`);
    }
  }

  // Build the resolved input
  let resolvedInput = `## Files matching: ${input}\n\nFound ${files.length} file(s)`;
  if (truncatedFiles) {
    resolvedInput += ` (showing first ${config.maxFiles})`;
  }
  resolvedInput += `:\n${contents.join('')}`;

  if (truncatedSize) {
    resolvedInput += `\n\n[Note: Some files skipped due to total size limit of ${(config.maxTotalSize / 1024).toFixed(0)}KB]`;
  }

  return {
    resolvedInput,
    filesRead: filesToRead.length,
    truncated: truncatedFiles || truncatedSize,
  };
}

/**
 * Resolve a glob pattern or file path to a list of files (without reading contents).
 * Used for iterative pipeline execution.
 */
export async function resolveFileList(
  input: string,
  maxFileSize: number = DEFAULT_PIPELINE_INPUT_CONFIG.maxFileSize
): Promise<string[]> {
  if (!isGlobOrFilePath(input)) {
    return [];
  }

  const cwd = process.cwd();
  const files: string[] = [];

  if (input.includes('*') || input.includes('?')) {
    // Glob pattern
    for await (const file of glob(input, { cwd })) {
      const fullPath = join(cwd, file);
      // Validate path is within project (handles symlinks)
      if (!isPathWithinProject(fullPath, cwd)) {
        continue;
      }
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.size <= maxFileSize) {
          files.push(file);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } else {
    // Direct file path
    const fullPath = input.startsWith('/') ? input : join(cwd, input);

    // Validate path is within project directory (prevent path traversal)
    if (!isPathWithinProject(fullPath, cwd)) {
      return []; // Return empty list for invalid paths
    }

    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.size <= maxFileSize) {
          files.push(input);
        } else if (stat.isDirectory()) {
          // If directory, glob for code files
          for await (const file of glob(`${input}/**/*.{ts,js,tsx,jsx,py,go,rs,java,md,json,yaml,yml}`, { cwd })) {
            const filePath = join(cwd, file);
            // Validate each file is within project (handles symlinks)
            if (!isPathWithinProject(filePath, cwd)) {
              continue;
            }
            try {
              const fileStat = statSync(filePath);
              if (fileStat.isFile() && fileStat.size <= maxFileSize) {
                files.push(file);
              }
            } catch {
              // Skip
            }
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  return files.sort();
}
