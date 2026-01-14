// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Context Compression
 *
 * Generates compressed symbol context for model prompts.
 * Target: ~50-100 tokens per file to provide 80% of understanding
 * at 5% of the token cost.
 */

import type {
  CodebaseStructure,
  FileSymbolInfo,
  FileConnectivity,
  CompressedSymbolContext,
  CodeSymbol,
} from './types.js';

/**
 * Generate compressed context for a file
 */
export function compressFileContext(
  file: string,
  structure: CodebaseStructure
): CompressedSymbolContext {
  const fileInfo = structure.files.get(file);
  const connectivity = structure.connectivity.get(file);

  if (!fileInfo) {
    return {
      summary: 'Unknown file',
      exports: [],
      dependencies: [],
      dependentCount: 0,
      isEntryPoint: false,
      riskIndicators: [],
    };
  }

  // Build one-line summary
  const summary = buildFileSummary(fileInfo);

  // Get key exports (max 10, formatted as signatures)
  const exports = getKeyExports(fileInfo);

  // Get external dependencies only (max 5)
  const dependencies = fileInfo.imports
    .filter((i) => !i.source.startsWith('.'))
    .slice(0, 5)
    .map((i) => i.source);

  // Calculate dependent count
  const dependentCount = connectivity?.transitiveImporters || 0;

  // Check if entry point
  const isEntryPoint = structure.dependencyGraph.entryPoints.includes(file);

  // Build risk indicators
  const riskIndicators = buildRiskIndicators(file, structure, connectivity);

  return {
    summary,
    exports,
    dependencies,
    dependentCount,
    isEntryPoint,
    riskIndicators,
  };
}

/**
 * Build a one-line summary of the file
 */
function buildFileSummary(fileInfo: FileSymbolInfo): string {
  const exportedSymbols = fileInfo.symbols.filter(
    (s) => s.visibility !== 'internal'
  );

  // Find main export (default or first exported)
  const mainExport =
    exportedSymbols.find((s) => s.visibility === 'export-default') ||
    exportedSymbols[0];

  if (mainExport) {
    const doc = mainExport.docSummary ? `: ${mainExport.docSummary}` : '';
    return `${mainExport.kind} ${mainExport.name}${doc}`;
  }

  // Fallback to counts
  const classCount = fileInfo.symbols.filter((s) => s.kind === 'class').length;
  const funcCount = fileInfo.symbols.filter((s) => s.kind === 'function').length;
  const typeCount = fileInfo.symbols.filter(
    (s) => s.kind === 'interface' || s.kind === 'type'
  ).length;

  const parts: string[] = [];
  if (classCount) parts.push(`${classCount} class${classCount > 1 ? 'es' : ''}`);
  if (funcCount) parts.push(`${funcCount} function${funcCount > 1 ? 's' : ''}`);
  if (typeCount) parts.push(`${typeCount} type${typeCount > 1 ? 's' : ''}`);

  if (parts.length === 0) {
    return `${fileInfo.symbols.length} symbols, ${fileInfo.imports.length} imports`;
  }

  return `Module with ${parts.join(', ')}`;
}

/**
 * Get key exports formatted as compact signatures
 */
function getKeyExports(fileInfo: FileSymbolInfo): string[] {
  const exportedSymbols = fileInfo.symbols.filter(
    (s) => s.visibility !== 'internal'
  );

  return exportedSymbols.slice(0, 10).map((s) => formatSymbol(s));
}

/**
 * Format a symbol as a compact signature
 */
function formatSymbol(symbol: CodeSymbol): string {
  switch (symbol.kind) {
    case 'function':
      if (symbol.signature && symbol.signature.length < 60) {
        return symbol.signature;
      }
      return `${symbol.name}(...)`;

    case 'class':
      const ext = symbol.extends?.length ? ` extends ${symbol.extends[0]}` : '';
      return `class ${symbol.name}${ext}`;

    case 'interface':
      return `interface ${symbol.name}`;

    case 'type':
      return `type ${symbol.name}`;

    case 'enum':
      return `enum ${symbol.name}`;

    case 'constant':
      return `const ${symbol.name}${symbol.signature ? `: ${symbol.signature}` : ''}`;

    default:
      return `${symbol.kind} ${symbol.name}`;
  }
}

/**
 * Build risk indicators for a file
 */
function buildRiskIndicators(
  file: string,
  structure: CodebaseStructure,
  connectivity?: FileConnectivity
): string[] {
  const indicators: string[] = [];

  // Entry point
  if (structure.dependencyGraph.entryPoints.includes(file)) {
    indicators.push('entry-point');
  }

  // Circular dependency
  if (structure.dependencyGraph.cycles.some((c) => c.includes(file))) {
    indicators.push('circular-dep');
  }

  // High impact (many things depend on it)
  if (connectivity && connectivity.transitiveImporters > 10) {
    indicators.push('high-impact');
  }

  // Barrel file (re-export hub)
  if (structure.barrelFiles.includes(file)) {
    indicators.push('barrel');
  }

  // Security-sensitive patterns in filename
  const securityPatterns = [
    /auth/i,
    /security/i,
    /crypto/i,
    /password/i,
    /token/i,
    /session/i,
  ];
  if (securityPatterns.some((p) => p.test(file))) {
    indicators.push('security');
  }

  return indicators;
}

/**
 * Format compressed context for model prompt
 * Target: ~50-100 tokens
 */
export function formatContextForPrompt(context: CompressedSymbolContext): string {
  const lines: string[] = [];

  // Summary line
  lines.push(`> ${context.summary}`);

  // Exports (if any)
  if (context.exports.length > 0) {
    lines.push(`Exports: ${context.exports.slice(0, 5).join(', ')}`);
    if (context.exports.length > 5) {
      lines.push(`  ...and ${context.exports.length - 5} more`);
    }
  }

  // External dependencies (if any)
  if (context.dependencies.length > 0) {
    lines.push(`Uses: ${context.dependencies.join(', ')}`);
  }

  // Dependent count
  if (context.dependentCount > 0) {
    lines.push(`Imported by ${context.dependentCount} file${context.dependentCount > 1 ? 's' : ''}`);
  }

  // Risk indicators
  if (context.riskIndicators.length > 0) {
    lines.push(`[${context.riskIndicators.join(', ')}]`);
  }

  return lines.join('\n');
}

/**
 * Build file analysis prompt with symbol context
 */
export function buildFileAnalysisPrompt(
  file: string,
  content: string,
  structure: CodebaseStructure,
  analysisType: 'deep' | 'normal' | 'quick',
  navigationContext?: string
): string {
  const context = compressFileContext(file, structure);
  const connectivity = structure.connectivity.get(file);

  // Get related file contexts (dependencies + dependents)
  const relatedContexts = new Map<string, CompressedSymbolContext>();
  if (connectivity) {
    // Add direct dependencies (max 5)
    for (const dep of connectivity.directDependencies.slice(0, 5)) {
      relatedContexts.set(dep, compressFileContext(dep, structure));
    }
    // Add direct dependents (max 3)
    for (const dep of connectivity.directDependents.slice(0, 3)) {
      relatedContexts.set(dep, compressFileContext(dep, structure));
    }
  }

  // Build context section
  let contextSection = `## Symbol Context

### This File
${formatContextForPrompt(context)}
`;

  // Add related files if any
  if (relatedContexts.size > 0) {
    contextSection += `
### Related Files
${Array.from(relatedContexts.entries())
  .map(([f, ctx]) => `**${f}**\n${formatContextForPrompt(ctx)}`)
  .join('\n\n')}
`;
  }

  // Add navigation context if provided
  if (navigationContext) {
    contextSection += `
### Navigation
${navigationContext}
`;
  }

  // Analysis instructions based on depth
  const depthInstructions: Record<typeof analysisType, string> = {
    deep: 'Perform thorough security and logic analysis. Check all edge cases, error handling, and potential vulnerabilities.',
    normal: 'Review for bugs, maintainability, and best practices. Focus on common issues.',
    quick: 'Quick scan for obvious issues only. Be brief.',
  };

  // Build focus points based on context
  const focusPoints: string[] = [
    `- How this file integrates with its dependencies`,
    `- Impact on files that import this (${connectivity?.transitiveImporters || 0} transitive importers)`,
  ];

  if (context.isEntryPoint) {
    focusPoints.push('- **This is an entry point - validate input handling**');
  }
  if (context.riskIndicators.includes('circular-dep')) {
    focusPoints.push(
      '- **Part of circular dependency - check for initialization issues**'
    );
  }
  if (context.riskIndicators.includes('high-impact')) {
    focusPoints.push('- **High-impact file - changes affect many dependents**');
  }
  if (context.riskIndicators.includes('security')) {
    focusPoints.push('- **Security-sensitive code - extra scrutiny required**');
  }

  // Build the full prompt
  return `${contextSection}

## File to Analyze: ${file}

\`\`\`typescript
${content}
\`\`\`

## Instructions
${depthInstructions[analysisType]}

Focus on:
${focusPoints.join('\n')}
`;
}

/**
 * Estimate token count for context (rough approximation)
 */
export function estimateContextTokens(context: CompressedSymbolContext): number {
  const text = formatContextForPrompt(context);
  // Rough estimate: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}
