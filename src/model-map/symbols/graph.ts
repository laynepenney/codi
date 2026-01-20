// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dependency Graph Builder
 *
 * Builds a dependency graph from file symbol information, calculating
 * connectivity metrics and detecting circular dependencies.
 */

import { dirname, resolve, relative, basename } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  FileSymbolInfo,
  DependencyGraph,
  DependencyEdge,
  FileConnectivity,
} from './types.js';

/**
 * Entry point patterns for detecting main entry files
 */
const ENTRY_POINT_PATTERNS = [
  /^index\.[jt]sx?$/,
  /^main\.[jt]sx?$/,
  /^app\.[jt]sx?$/,
  /^server\.[jt]sx?$/,
  /^cli\.[jt]sx?$/,
];

/**
 * Builds dependency graphs from file symbol information
 */
export class DependencyGraphBuilder {
  private projectRoot: string;
  private resolutions: Map<string, string> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Build dependency graph from file symbol info
   */
  build(files: Map<string, FileSymbolInfo>): DependencyGraph {
    const edges: DependencyEdge[] = [];
    const fileSet = new Set(files.keys());

    // Build edges from imports and re-exports
    for (const [file, info] of files) {
      // Process imports
      for (const imp of info.imports) {
        const resolved = this.resolveModulePath(imp.source, file, fileSet);
        if (resolved) {
          edges.push({
            from: file,
            to: resolved,
            type: 'import',
            symbols: imp.symbols.map((s) => s.alias || s.name),
            isTypeOnly: imp.isTypeOnly,
          });
        }
      }

      // Process re-exports
      for (const exp of info.exports) {
        if (exp.source) {
          const resolved = this.resolveModulePath(exp.source, file, fileSet);
          if (resolved) {
            edges.push({
              from: file,
              to: resolved,
              type: 're-export',
              symbols: exp.symbols.map((s) => s.alias || s.name),
              isTypeOnly: exp.isTypeOnly,
            });
          }
        }
      }
    }

    // Calculate in/out degree
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (const file of fileSet) {
      inDegree.set(file, 0);
      outDegree.set(file, 0);
    }

    for (const edge of edges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
      outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
    }

    // Find roots (no outgoing edges - nothing imports anything)
    // Actually for roots we want files that don't import anything (sources)
    const roots = Array.from(outDegree.entries())
      .filter(([_, degree]) => degree === 0)
      .map(([file]) => file);

    // Find leaves (no incoming edges - nothing depends on them)
    const leaves = Array.from(inDegree.entries())
      .filter(([_, degree]) => degree === 0)
      .map(([file]) => file);

    // Detect cycles using Tarjan's algorithm
    const cycles = this.detectCycles(fileSet, edges);

    // Detect entry points (index files at directory roots, or main files)
    const entryPoints = this.detectEntryPoints(files, leaves);

    return {
      edges,
      roots,
      leaves,
      cycles,
      resolutions: this.resolutions,
      entryPoints,
    };
  }

  /**
   * Calculate connectivity metrics for each file
   */
  calculateConnectivity(
    files: Map<string, FileSymbolInfo>,
    graph: DependencyGraph
  ): Map<string, FileConnectivity> {
    const connectivity = new Map<string, FileConnectivity>();

    // Build adjacency lists
    const importers = new Map<string, Set<string>>(); // who imports file
    const dependencies = new Map<string, Set<string>>(); // what file imports

    for (const file of files.keys()) {
      importers.set(file, new Set());
      dependencies.set(file, new Set());
    }

    for (const edge of graph.edges) {
      importers.get(edge.to)?.add(edge.from);
      dependencies.get(edge.from)?.add(edge.to);
    }

    // Calculate metrics for each file
    for (const file of files.keys()) {
      const directDependents = Array.from(importers.get(file) || []);
      const directDependencies = Array.from(dependencies.get(file) || []);

      // Calculate transitive importers (BFS)
      const transitiveImporters = this.countTransitiveNodes(file, importers);

      // Check if on critical path (reachable from entry points)
      const isCriticalPath = graph.entryPoints.some((entry) =>
        this.hasPath(entry, file, dependencies)
      );

      connectivity.set(file, {
        inDegree: directDependents.length,
        outDegree: directDependencies.length,
        transitiveImporters,
        isCriticalPath,
        directDependents,
        directDependencies,
      });
    }

    return connectivity;
  }

  /**
   * Resolve a module path to an actual file path
   */
  private resolveModulePath(
    modulePath: string,
    fromFile: string,
    knownFiles: Set<string>
  ): string | null {
    // Skip external packages
    if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
      return null;
    }

    const fromDir = dirname(fromFile);
    const basePath = resolve(fromDir, modulePath);

    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const candidates = [
      basePath,
      ...extensions.map((ext) => basePath + ext),
      ...extensions.map((ext) => resolve(basePath, 'index' + ext)),
    ];

    for (const candidate of candidates) {
      // Check if in known files
      if (knownFiles.has(candidate)) {
        this.resolutions.set(`${fromFile}:${modulePath}`, candidate);
        return candidate;
      }

      // Check relative path version
      const relativePath = relative(this.projectRoot, candidate);
      if (knownFiles.has(relativePath)) {
        this.resolutions.set(`${fromFile}:${modulePath}`, relativePath);
        return relativePath;
      }
    }

    return null;
  }

  /**
   * Detect cycles using Tarjan's strongly connected components algorithm
   */
  private detectCycles(
    files: Set<string>,
    edges: DependencyEdge[]
  ): string[][] {
    const adjacency = new Map<string, string[]>();

    // Build adjacency list
    for (const file of files) {
      adjacency.set(file, []);
    }
    for (const edge of edges) {
      adjacency.get(edge.from)?.push(edge.to);
    }

    // Tarjan's algorithm
    let index = 0;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const sccs: string[][] = [];

    const strongConnect = (v: string) => {
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const w of adjacency.get(v) || []) {
        if (!indices.has(w)) {
          strongConnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
        } else if (onStack.has(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
        }
      }

      if (lowlinks.get(v) === indices.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);

        // Only keep SCCs with more than one node (actual cycles)
        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    };

    for (const file of files) {
      if (!indices.has(file)) {
        strongConnect(file);
      }
    }

    return sccs;
  }

  /**
   * Detect entry points in the codebase
   */
  private detectEntryPoints(
    files: Map<string, FileSymbolInfo>,
    leaves: string[]
  ): string[] {
    const entryPoints: string[] = [];

    for (const file of files.keys()) {
      const fileName = basename(file);

      // Check if matches entry point patterns
      if (ENTRY_POINT_PATTERNS.some((p) => p.test(fileName))) {
        entryPoints.push(file);
        continue;
      }

      // Check if it's a leaf (nothing depends on it) at project root level
      if (leaves.includes(file)) {
        const relativePath = relative(this.projectRoot, file);
        // Top-level files that are leaves are likely entry points
        if (!relativePath.includes('/') || relativePath.startsWith('src/')) {
          const depth = relativePath.split('/').length;
          if (depth <= 2) {
            // Only consider shallow files
            entryPoints.push(file);
          }
        }
      }
    }

    // Deduplicate and sort by path depth (shallower first)
    return [...new Set(entryPoints)].sort(
      (a, b) => a.split('/').length - b.split('/').length
    );
  }

  /**
   * Count transitive nodes reachable via edges
   */
  private countTransitiveNodes(
    start: string,
    adjacency: Map<string, Set<string>>
  ): number {
    const visited = new Set<string>();
    const queue = [start];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);

      for (const neighbor of adjacency.get(node) || []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    // Exclude the start node itself
    return visited.size - 1;
  }

  /**
   * Check if there's a path from source to target
   */
  private hasPath(
    source: string,
    target: string,
    adjacency: Map<string, Set<string>>
  ): boolean {
    if (source === target) return true;

    const visited = new Set<string>();
    const queue = [source];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node === target) return true;
      if (visited.has(node)) continue;
      visited.add(node);

      for (const neighbor of adjacency.get(node) || []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return false;
  }
}

/**
 * Create a dependency graph builder instance
 */
export function createDependencyGraphBuilder(
  projectRoot: string
): DependencyGraphBuilder {
  return new DependencyGraphBuilder(projectRoot);
}

/**
 * Options for computing optimal processing order
 */
export interface ProcessingOrderOptions {
  /** Priority scores for files (higher = process earlier within same tier) */
  priorities?: Map<string, number>;
  /** Whether to include tier information in output */
  includeTiers?: boolean;
}

/**
 * Result of optimal processing order computation
 */
export interface ProcessingOrderResult {
  /** Files in optimal order for processing */
  order: string[];
  /** Tier assignment for each file (0 = leaves, higher = closer to entry points) */
  tiers: Map<string, number>;
  /** Files in each tier */
  tierFiles: Map<number, string[]>;
}

/**
 * Compute optimal file processing order based on dependency graph.
 *
 * Uses a modified topological sort that:
 * 1. Starts with leaf files (no incoming dependencies from within the project)
 * 2. Processes files tier by tier, moving up to entry points
 * 3. Within each tier, prioritizes by optional priority scores
 *
 * This order ensures that when processing a file, all its dependencies
 * have already been processed (useful for context inclusion).
 */
export function getOptimalProcessingOrder(
  graph: DependencyGraph,
  files: Set<string> | string[],
  options: ProcessingOrderOptions = {}
): ProcessingOrderResult {
  const fileSet = files instanceof Set ? files : new Set(files);
  const priorities = options.priorities || new Map<string, number>();

  // Build adjacency lists
  // importers: who imports this file (dependents)
  // dependencies: what this file imports
  const importers = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();

  for (const file of fileSet) {
    importers.set(file, new Set());
    dependencies.set(file, new Set());
  }

  for (const edge of graph.edges) {
    // Only consider edges within our file set
    if (fileSet.has(edge.from) && fileSet.has(edge.to)) {
      importers.get(edge.to)?.add(edge.from);
      dependencies.get(edge.from)?.add(edge.to);
    }
  }

  // Calculate tiers using modified Kahn's algorithm
  // Tier 0 = leaves (no unprocessed dependencies)
  const tiers = new Map<string, number>();
  const tierFiles = new Map<number, string[]>();
  const order: string[] = [];

  // Track remaining dependencies for each file
  const remainingDeps = new Map<string, number>();
  for (const file of fileSet) {
    remainingDeps.set(file, dependencies.get(file)?.size || 0);
  }

  // Find initial leaves (files with no dependencies within the set)
  let currentTier: string[] = [];
  for (const [file, deps] of remainingDeps) {
    if (deps === 0) {
      currentTier.push(file);
    }
  }

  let tierNum = 0;

  while (currentTier.length > 0) {
    // Sort current tier by priority (higher priority first)
    currentTier.sort((a, b) => {
      const pA = priorities.get(a) || 0;
      const pB = priorities.get(b) || 0;
      return pB - pA; // Higher priority first
    });

    // Record this tier
    tierFiles.set(tierNum, [...currentTier]);
    for (const file of currentTier) {
      tiers.set(file, tierNum);
      order.push(file);
    }

    // Find next tier: files whose dependencies are all processed
    const nextTier: string[] = [];
    for (const file of currentTier) {
      // For each file that imports this one
      for (const importer of importers.get(file) || []) {
        // Decrease its remaining dependency count
        const remaining = (remainingDeps.get(importer) || 1) - 1;
        remainingDeps.set(importer, remaining);

        // If all dependencies are now processed, add to next tier
        if (remaining === 0) {
          nextTier.push(importer);
        }
      }
    }

    currentTier = nextTier;
    tierNum++;
  }

  // Handle any remaining files (cycles) - add them at the end
  for (const file of fileSet) {
    if (!tiers.has(file)) {
      tiers.set(file, tierNum);
      order.push(file);
      const existing = tierFiles.get(tierNum) || [];
      existing.push(file);
      tierFiles.set(tierNum, existing);
    }
  }

  return { order, tiers, tierFiles };
}

/**
 * Get dependency summaries for a file based on already-processed results.
 *
 * This is useful for including context about dependencies when processing a file.
 */
export function getDependencySummaries(
  file: string,
  graph: DependencyGraph,
  processedResults: Map<string, string>,
  maxDeps: number = 3
): string[] {
  const summaries: string[] = [];

  // Find dependencies of this file
  const deps = graph.edges
    .filter((e) => e.from === file && e.type !== 're-export')
    .map((e) => e.to);

  // Get summaries for dependencies that have been processed
  for (const dep of deps.slice(0, maxDeps)) {
    const result = processedResults.get(dep);
    if (result) {
      // Extract first ~100 chars as a summary
      const summary = result.slice(0, 200).replace(/\n/g, ' ').trim();
      summaries.push(`${dep}: ${summary}${result.length > 200 ? '...' : ''}`);
    }
  }

  return summaries;
}
