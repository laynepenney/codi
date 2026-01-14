// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Pattern matching utilities for command approval.
 * Uses glob-like patterns converted to regex.
 */

/**
 * Convert a glob-like pattern to a regex.
 * Supports: * (any chars), ? (single char)
 */
export function patternToRegex(pattern: string): RegExp {
  // Escape special regex chars except * and ?
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Convert glob wildcards to regex
  escaped = escaped.replace(/\*/g, '.*');
  escaped = escaped.replace(/\?/g, '.');

  // Anchor pattern
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check if a command matches an approved pattern.
 */
export function matchesPattern(command: string, pattern: string): boolean {
  const regex = patternToRegex(pattern);
  return regex.test(command.trim());
}

/**
 * Tools that commonly have subcommands.
 */
const TOOLS_WITH_SUBCOMMAND = new Set([
  'npm',
  'yarn',
  'pnpm',
  'bun',
  'npx',
  'git',
  'go',
  'cargo',
  'pip',
  'pip3',
  'bundle',
  'mix',
  'make',
  'docker',
  'kubectl',
  'helm',
  'terraform',
  'aws',
  'gcloud',
  'az',
]);

/**
 * Suggest a pattern for a command.
 * Extracts the command prefix and suggests wildcards.
 */
export function suggestPattern(command: string): string {
  const parts = command.trim().split(/\s+/);

  if (parts.length === 0) return command;

  const tool = parts[0];

  // Tools with subcommands get first two parts
  if (parts.length >= 2 && TOOLS_WITH_SUBCOMMAND.has(tool)) {
    // e.g., "npm install react" -> "npm install *"
    if (parts.length > 2) {
      return `${parts[0]} ${parts[1]} *`;
    }
    // e.g., "npm test" -> "npm test*"
    return `${parts[0]} ${parts[1]}*`;
  }

  // Single command with args: "python script.py" -> "python *"
  if (parts.length > 1) {
    return `${parts[0]} *`;
  }

  // Single command: "ls" -> "ls*"
  return `${parts[0]}*`;
}

/**
 * Parse a command to extract tool and subcommand.
 */
export interface ParsedCommand {
  tool: string;
  subcommand?: string;
  args: string[];
  fullCommand: string;
}

export function parseCommand(command: string): ParsedCommand {
  const parts = command.trim().split(/\s+/);
  const tool = parts[0] || '';

  if (parts.length >= 2 && TOOLS_WITH_SUBCOMMAND.has(tool)) {
    return {
      tool,
      subcommand: parts[1],
      args: parts.slice(2),
      fullCommand: command.trim(),
    };
  }

  return {
    tool,
    args: parts.slice(1),
    fullCommand: command.trim(),
  };
}

// ============================================================================
// Path Pattern Utilities (for file operations)
// ============================================================================

/**
 * Convert a glob-like path pattern to a regex.
 * Supports: * (any chars except /), ** (any chars including /), ? (single char)
 */
export function pathPatternToRegex(pattern: string): RegExp {
  // Normalize path separators
  let normalized = pattern.replace(/\\/g, '/');

  // Escape special regex chars except * and ?
  let escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Convert ** first (matches any path including /)
  escaped = escaped.replace(/\*\*/g, '<<<GLOBSTAR>>>');
  // Convert * (matches anything except /)
  escaped = escaped.replace(/\*/g, '[^/]*');
  // Convert ** back (matches anything including /)
  escaped = escaped.replace(/<<<GLOBSTAR>>>/g, '.*');
  // Convert ?
  escaped = escaped.replace(/\?/g, '[^/]');

  // Anchor pattern
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check if a file path matches an approved path pattern.
 */
export function matchesPathPattern(filePath: string, pattern: string): boolean {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');
  const regex = pathPatternToRegex(pattern);
  return regex.test(normalized);
}

/**
 * Suggest a path pattern from a file path.
 * Preserves directory structure and uses wildcard for filename.
 *
 * Examples:
 *   "src/components/Button.tsx" -> "src/components/*.tsx"
 *   "tests/unit/auth.test.ts" -> "tests/unit/*.test.ts"
 *   "config.json" -> "*.json"
 */
export function suggestPathPattern(filePath: string): string {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');

  // Extract directory and filename
  const lastSlash = normalized.lastIndexOf('/');
  const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  // Extract extension (including compound extensions like .test.ts)
  const extension = getFileExtension(filename);

  // Build pattern: directory/*.extension
  if (directory) {
    return `${directory}/*${extension}`;
  }
  return `*${extension}`;
}

/**
 * Get the file extension, including compound extensions.
 * ".test.ts" -> ".test.ts"
 * ".ts" -> ".ts"
 * "Makefile" -> "" (no extension)
 */
function getFileExtension(filename: string): string {
  // Check for common compound extensions first
  const compoundExtensions = [
    '.test.ts', '.test.tsx', '.test.js', '.test.jsx',
    '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx',
    '.config.ts', '.config.js', '.config.json',
    '.d.ts',
  ];

  for (const ext of compoundExtensions) {
    if (filename.endsWith(ext)) {
      return ext;
    }
  }

  // Fall back to simple extension
  const lastDot = filename.lastIndexOf('.');
  if (lastDot > 0) { // > 0 to exclude dotfiles like .gitignore
    return filename.slice(lastDot);
  }

  return '';
}
