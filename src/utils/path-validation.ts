// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolve, sep } from 'path';
import { realpathSync, existsSync } from 'fs';

/**
 * Additional allowed directories beyond the project root.
 * Used primarily for testing with temp directories.
 * @internal
 */
const allowedDirectories: Set<string> = new Set();

/**
 * Adds an additional allowed directory for path validation.
 * Primarily for testing purposes.
 * @param dir - The directory to allow
 */
export function addAllowedDirectory(dir: string): void {
  allowedDirectories.add(resolve(dir));
}

/**
 * Removes an allowed directory.
 * @param dir - The directory to remove from allowed list
 */
export function removeAllowedDirectory(dir: string): void {
  allowedDirectories.delete(resolve(dir));
}

/**
 * Clears all additional allowed directories.
 * Primarily for test cleanup.
 */
export function clearAllowedDirectories(): void {
  allowedDirectories.clear();
}

/**
 * Safely gets the real path of a file/directory, handling symlinks.
 * If the path doesn't exist yet (e.g., a new file), gets the realpath of the parent.
 */
function safeRealpath(path: string): string {
  if (existsSync(path)) {
    return realpathSync(path);
  }
  // For non-existent paths, resolve symlinks in the parent directory
  const parentDir = resolve(path, '..');
  if (existsSync(parentDir)) {
    const parentReal = realpathSync(parentDir);
    const basename = path.substring(parentDir.length);
    return parentReal + basename;
  }
  // If parent also doesn't exist, just return resolved path
  return resolve(path);
}

/**
 * Validates that a resolved path is within the project directory or an allowed directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 * Handles symlinks by resolving to real paths before comparison.
 *
 * @param resolvedPath - The absolute path after resolution
 * @param projectRoot - The project root directory (usually process.cwd())
 * @returns true if the path is within the project or an allowed directory, false otherwise
 */
export function isPathWithinProject(resolvedPath: string, projectRoot: string): boolean {
  // Resolve symlinks to get canonical paths for comparison
  const normalizedPath = safeRealpath(resolve(resolvedPath));
  const normalizedRoot = safeRealpath(resolve(projectRoot));

  // Check if path is within project root
  if (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(normalizedRoot + sep)
  ) {
    return true;
  }

  // Check if path is within any allowed directory
  for (const allowedDir of allowedDirectories) {
    const normalizedAllowed = safeRealpath(allowedDir);
    if (
      normalizedPath === normalizedAllowed ||
      normalizedPath.startsWith(normalizedAllowed + sep)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a file path and returns the resolved path if valid.
 * Throws an error if the path is outside the project directory and all allowed directories.
 *
 * @param path - The path to validate (relative or absolute)
 * @param projectRoot - The project root directory (usually process.cwd())
 * @returns The resolved absolute path
 * @throws Error if the path is outside all allowed directories
 */
export function validateAndResolvePath(path: string, projectRoot: string = process.cwd()): string {
  const resolvedPath = resolve(projectRoot, path);

  if (!isPathWithinProject(resolvedPath, projectRoot)) {
    throw new Error(
      `Security error: Path "${path}" resolves outside the project directory. ` +
      `Access to files outside the project is not allowed.`
    );
  }

  return resolvedPath;
}
