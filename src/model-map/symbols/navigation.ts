// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Navigation Context
 *
 * Builds breadcrumb trails showing how files are reached from entry points,
 * helping models understand the code flow through the codebase.
 */

import type { CodebaseStructure, DependencyEdge } from './types.js';

/**
 * Build a breadcrumb trail from entry point to current file
 */
export function buildNavigationContext(
  file: string,
  structure: CodebaseStructure
): string {
  const entryPoints = structure.dependencyGraph.entryPoints;

  if (entryPoints.length === 0) {
    return 'No entry points detected';
  }

  // Check if this file is itself an entry point
  if (entryPoints.includes(file)) {
    return 'Entry point (directly accessible)';
  }

  // Find shortest path from any entry point to this file
  const pathFromEntry = findShortestPath(entryPoints, file, structure);

  if (!pathFromEntry || pathFromEntry.length === 0) {
    return 'Standalone file (not reachable from entry points)';
  }

  // Build breadcrumb with key symbols at each step
  const breadcrumbs = buildBreadcrumbs(pathFromEntry, structure);

  return `Entry path: ${breadcrumbs}`;
}

/**
 * Find shortest path from any source to target using BFS
 */
function findShortestPath(
  sources: string[],
  target: string,
  structure: CodebaseStructure
): string[] | null {
  // Build adjacency list (forward direction: from importer to importee)
  const adjacency = new Map<string, string[]>();

  for (const edge of structure.dependencyGraph.edges) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    adjacency.get(edge.from)!.push(edge.to);
  }

  // BFS from each source
  for (const source of sources) {
    const visited = new Set<string>();
    const queue: Array<{ file: string; path: string[] }> = [
      { file: source, path: [source] },
    ];

    while (queue.length > 0) {
      const { file, path } = queue.shift()!;

      if (file === target) {
        return path;
      }

      if (visited.has(file)) continue;
      visited.add(file);

      const neighbors = adjacency.get(file) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ file: neighbor, path: [...path, neighbor] });
        }
      }
    }
  }

  return null;
}

/**
 * Build formatted breadcrumb string from path
 */
function buildBreadcrumbs(path: string[], structure: CodebaseStructure): string {
  const parts: string[] = [];

  for (let i = 0; i < path.length; i++) {
    const file = path[i];
    const nextFile = path[i + 1];

    // Shorten file path for readability
    const shortPath = shortenPath(file);

    if (!nextFile) {
      // Last file in path (the target)
      parts.push(shortPath);
    } else {
      // Find the symbols imported from next file
      const edge = structure.dependencyGraph.edges.find(
        (e) => e.from === file && e.to === nextFile
      );

      if (edge && edge.symbols.length > 0) {
        // Show which symbols are imported
        const symbols = edge.symbols.slice(0, 3).join(', ');
        const more = edge.symbols.length > 3 ? ', ...' : '';
        parts.push(`${shortPath} -> {${symbols}${more}}`);
      } else {
        parts.push(`${shortPath} ->`);
      }
    }
  }

  return parts.join(' ');
}

/**
 * Shorten a file path for display
 */
function shortenPath(filePath: string): string {
  // Remove common prefixes
  let short = filePath
    .replace(/^src\//, '')
    .replace(/\.tsx?$/, '')
    .replace(/\.jsx?$/, '');

  // If still too long, use basename
  if (short.length > 40) {
    const parts = short.split('/');
    if (parts.length > 2) {
      short = `.../${parts.slice(-2).join('/')}`;
    }
  }

  return short;
}

/**
 * Get all paths from entry points to a file (for understanding multiple access routes)
 */
export function getAllPaths(
  file: string,
  structure: CodebaseStructure,
  maxPaths: number = 3
): string[][] {
  const entryPoints = structure.dependencyGraph.entryPoints;
  const allPaths: string[][] = [];

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const edge of structure.dependencyGraph.edges) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    adjacency.get(edge.from)!.push(edge.to);
  }

  // DFS from each entry point
  for (const entry of entryPoints) {
    if (allPaths.length >= maxPaths) break;

    const paths = findAllPathsDFS(entry, file, adjacency, maxPaths - allPaths.length);
    allPaths.push(...paths);
  }

  return allPaths;
}

/**
 * Find all paths using DFS with cycle detection
 */
function findAllPathsDFS(
  source: string,
  target: string,
  adjacency: Map<string, string[]>,
  maxPaths: number
): string[][] {
  const paths: string[][] = [];
  const visited = new Set<string>();

  function dfs(current: string, path: string[]) {
    if (paths.length >= maxPaths) return;
    if (current === target) {
      paths.push([...path]);
      return;
    }

    if (visited.has(current)) return;
    visited.add(current);

    for (const neighbor of adjacency.get(current) || []) {
      dfs(neighbor, [...path, neighbor]);
    }

    visited.delete(current);
  }

  dfs(source, [source]);
  return paths;
}

/**
 * Get the depth of a file from entry points
 */
export function getDepthFromEntry(
  file: string,
  structure: CodebaseStructure
): number {
  const path = findShortestPath(
    structure.dependencyGraph.entryPoints,
    file,
    structure
  );

  if (!path) return -1;
  return path.length - 1;
}

/**
 * Format navigation context with depth information
 */
export function formatFullNavigationContext(
  file: string,
  structure: CodebaseStructure
): string {
  const lines: string[] = [];

  // Basic navigation
  const basicNav = buildNavigationContext(file, structure);
  lines.push(basicNav);

  // Depth from entry
  const depth = getDepthFromEntry(file, structure);
  if (depth >= 0) {
    lines.push(`Depth: ${depth} ${depth === 1 ? 'level' : 'levels'} from entry`);
  }

  // Alternative paths (if any)
  const allPaths = getAllPaths(file, structure, 3);
  if (allPaths.length > 1) {
    lines.push(`Alternative paths: ${allPaths.length - 1} other route${allPaths.length > 2 ? 's' : ''} available`);
  }

  return lines.join('\n');
}
