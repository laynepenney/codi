// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * V4 Symbolication System
 *
 * Phase 0 orchestration for building codebase structure before analysis.
 * Provides symbol extraction, dependency graphs, and context compression.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  CodebaseStructure,
  FileSymbolInfo,
  SymbolicationOptions,
  SymbolicationResult,
  SymbolExtractor,
} from './types.js';
import { RegexSymbolExtractor } from './regex-extractor.js';
import { AstSymbolExtractor } from './ast-extractor.js';
import { DependencyGraphBuilder } from './graph.js';

// Re-export types and utilities
export * from './types.js';
export { compressFileContext, formatContextForPrompt, buildFileAnalysisPrompt } from './context.js';
export { buildNavigationContext, formatFullNavigationContext, getDepthFromEntry } from './navigation.js';
export { AstSymbolExtractor, createAstExtractor } from './ast-extractor.js';
export {
  getOptimalProcessingOrder,
  getDependencySummaries,
  type ProcessingOrderOptions,
  type ProcessingOrderResult,
} from './graph.js';

/**
 * Entry point patterns for critical file detection
 */
const ENTRY_POINT_PATTERNS = [
  /^index\.[jt]sx?$/,
  /^main\.[jt]sx?$/,
  /^app\.[jt]sx?$/,
  /^server\.[jt]sx?$/,
  /^cli\.[jt]sx?$/,
];

/**
 * High-risk patterns for critical file detection
 */
const HIGH_RISK_PATTERNS = [/auth/i, /security/i, /crypto/i, /permission/i, /token/i];

/**
 * Phase 0 Symbolication Orchestrator
 */
export class Phase0Symbolication {
  private regexExtractor: RegexSymbolExtractor;
  private astExtractor: AstSymbolExtractor | null = null;
  private projectRoot: string;

  constructor(options?: { projectRoot?: string; useAst?: boolean }) {
    this.regexExtractor = new RegexSymbolExtractor();
    // Only create AST extractor if explicitly enabled (it's heavier)
    if (options?.useAst) {
      this.astExtractor = new AstSymbolExtractor();
    }
    this.projectRoot = options?.projectRoot || process.cwd();
  }

  /**
   * Build complete codebase structure (Phase 0)
   */
  async buildStructure(options: SymbolicationOptions): Promise<SymbolicationResult> {
    const startTime = Date.now();
    const files = new Map<string, FileSymbolInfo>();
    const errors: Array<{ file: string; error: string }> = [];

    const criticalSet = new Set(options.criticalFiles || []);
    let regexCount = 0;
    let astCount = 0;

    // Create AST extractor on-demand if we have critical files
    const useAstForCritical = options.useAstForCritical !== false && criticalSet.size > 0;
    let astExtractor: AstSymbolExtractor | null = null;
    if (useAstForCritical && !this.astExtractor) {
      astExtractor = new AstSymbolExtractor();
    } else {
      astExtractor = this.astExtractor;
    }

    // Phase 0a: Extract symbols from all files
    const concurrency = options.astConcurrency ?? 8;
    const batches = this.chunk(options.files, concurrency);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const results = await Promise.all(
        batch.map(async (file, idx) => {
          const globalIdx = batchIdx * concurrency + idx;
          options.onProgress?.(globalIdx, options.files.length, file);

          try {
            const content = await readFile(file, 'utf-8');
            const isCritical = criticalSet.has(file);

            // Use AST extraction for critical files if available
            let info: FileSymbolInfo;
            if (isCritical && astExtractor && this.isTypeScriptOrJavaScript(file)) {
              info = astExtractor.extract(content, file);
              astCount++;
            } else {
              info = this.regexExtractor.extract(content, file);
              regexCount++;
            }

            return { file, info, error: null };
          } catch (error) {
            return { file, info: null, error: String(error) };
          }
        })
      );

      for (const result of results) {
        if (result.info) {
          files.set(result.file, result.info);
        } else if (result.error) {
          errors.push({ file: result.file, error: result.error });
        }
      }
    }

    // Dispose AST extractor if we created it on-demand
    if (astExtractor && astExtractor !== this.astExtractor) {
      astExtractor.dispose();
    }

    // Phase 0b: Build dependency graph
    const graphBuilder = new DependencyGraphBuilder(
      options.projectRoot || this.projectRoot
    );
    const dependencyGraph =
      options.buildDependencyGraph !== false
        ? graphBuilder.build(files)
        : {
            edges: [],
            roots: [],
            leaves: [],
            cycles: [],
            resolutions: new Map(),
            entryPoints: [],
          };

    // Phase 0c: Calculate connectivity
    const connectivity = graphBuilder.calculateConnectivity(files, dependencyGraph);

    // Phase 0d: Detect barrel files
    const barrelFiles = this.detectBarrelFiles(files);

    // Phase 0e: Build symbol index
    const symbolIndex = this.buildSymbolIndex(files);

    // Build structure
    const structure: CodebaseStructure = {
      files,
      symbolIndex,
      dependencyGraph,
      connectivity,
      barrelFiles,
      reExportChains: new Map(), // Could be populated if resolveBarrels is true
      metadata: {
        builtAt: new Date(),
        totalFiles: files.size,
        astExtracted: astCount,
        regexExtracted: regexCount,
        totalSymbols: Array.from(files.values()).reduce(
          (sum, f) => sum + f.symbols.length,
          0
        ),
        buildDuration: Date.now() - startTime,
      },
    };

    return {
      structure,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Select critical files for deeper analysis (AST extraction)
   */
  selectCriticalFiles(files: string[]): string[] {
    const critical = new Set<string>();

    for (const file of files) {
      const fileName = basename(file);

      // Entry point patterns
      if (ENTRY_POINT_PATTERNS.some((p) => p.test(fileName))) {
        critical.add(file);
      }

      // High-risk patterns
      if (HIGH_RISK_PATTERNS.some((p) => p.test(file))) {
        critical.add(file);
      }
    }

    // Limit to ~20% of files for performance
    const maxCritical = Math.ceil(files.length * 0.2);
    return Array.from(critical).slice(0, maxCritical);
  }

  /**
   * Detect barrel files (index.ts that mostly re-exports)
   */
  private detectBarrelFiles(files: Map<string, FileSymbolInfo>): string[] {
    const barrels: string[] = [];

    for (const [file, info] of files) {
      const fileName = basename(file);
      const isIndexFile = /^index\.[jt]sx?$/.test(fileName);

      if (!isIndexFile) continue;

      // Count re-exports vs internal symbols
      const reExportCount = info.exports.filter((e) => e.source).length;
      const internalSymbolCount = info.symbols.filter(
        (s) => s.visibility !== 'internal'
      ).length;

      // Barrel files have more re-exports than internal symbols
      if (reExportCount > 0 && reExportCount >= internalSymbolCount) {
        barrels.push(file);
      }
    }

    return barrels;
  }

  /**
   * Build global symbol index: symbol name -> defining files
   */
  private buildSymbolIndex(files: Map<string, FileSymbolInfo>): Map<string, string[]> {
    const index = new Map<string, string[]>();

    for (const [file, info] of files) {
      for (const symbol of info.symbols) {
        if (symbol.visibility === 'internal') continue;

        const existing = index.get(symbol.name) || [];
        existing.push(file);
        index.set(symbol.name, existing);
      }
    }

    return index;
  }

  /**
   * Split array into chunks
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Check if file is TypeScript or JavaScript
   */
  private isTypeScriptOrJavaScript(file: string): boolean {
    return /\.[jt]sx?$/.test(file);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.astExtractor) {
      this.astExtractor.dispose();
      this.astExtractor = null;
    }
  }
}

/**
 * Build codebase structure (convenience function)
 */
export async function buildCodebaseStructure(
  files: string[],
  options?: Partial<SymbolicationOptions>
): Promise<SymbolicationResult> {
  const phase0 = new Phase0Symbolication({
    projectRoot: options?.projectRoot,
  });

  const criticalFiles = phase0.selectCriticalFiles(files);

  return phase0.buildStructure({
    files,
    criticalFiles,
    buildDependencyGraph: true,
    resolveBarrels: true,
    ...options,
  });
}

/**
 * Format symbolication result for display
 */
export function formatSymbolicationResult(result: SymbolicationResult): string {
  const { structure, duration, errors } = result;
  const meta = structure.metadata;

  const lines: string[] = [];

  lines.push(`## Symbolication Complete`);
  lines.push(`- Files processed: ${meta.totalFiles}`);
  lines.push(`- Symbols extracted: ${meta.totalSymbols}`);
  lines.push(`- Entry points: ${structure.dependencyGraph.entryPoints.length}`);
  lines.push(`- Barrel files: ${structure.barrelFiles.length}`);

  if (structure.dependencyGraph.cycles.length > 0) {
    lines.push(`- Circular dependencies: ${structure.dependencyGraph.cycles.length}`);
  }

  lines.push(`- Duration: ${(duration / 1000).toFixed(1)}s`);

  if (errors.length > 0) {
    lines.push(`\n### Errors (${errors.length})`);
    for (const { file, error } of errors.slice(0, 5)) {
      lines.push(`- ${file}: ${error}`);
    }
    if (errors.length > 5) {
      lines.push(`- ... and ${errors.length - 5} more`);
    }
  }

  return lines.join('\n');
}
