/**
 * V4 Symbolication Types
 *
 * Type definitions for the Phase 0 symbolication system that builds
 * a code structure map before analysis.
 */

/**
 * Kind of code symbol
 */
export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'constant'
  | 'method'
  | 'property'
  | 'namespace'
  | 'module';

/**
 * Symbol visibility/export status
 */
export type SymbolVisibility = 'export' | 'export-default' | 'internal';

/**
 * Extracted symbol from source code
 */
export interface CodeSymbol {
  /** Symbol name */
  name: string;
  /** Type of symbol */
  kind: SymbolKind;
  /** File where symbol is defined */
  file: string;
  /** Line number of definition */
  line: number;
  /** End line (for blocks) */
  endLine?: number;
  /** Visibility */
  visibility: SymbolVisibility;
  /** Type signature (for functions/variables) */
  signature?: string;
  /** JSDoc summary (first line) */
  docSummary?: string;
  /** Parent symbol (for methods, properties) */
  parent?: string;
  /** Generic type parameters */
  typeParams?: string[];
  /** Extends/implements */
  extends?: string[];
  /** For functions: parameter types */
  params?: Array<{ name: string; type?: string }>;
  /** For functions: return type */
  returnType?: string;
}

/**
 * Import statement in a file
 */
export interface ImportStatement {
  /** Module path (relative or package) */
  source: string;
  /** Imported symbols */
  symbols: Array<{
    name: string;
    alias?: string;
    isDefault?: boolean;
    isNamespace?: boolean;
  }>;
  /** True if this is a type-only import */
  isTypeOnly: boolean;
  /** Line number */
  line: number;
}

/**
 * Export statement in a file
 */
export interface ExportStatement {
  /** Re-exported from module (for re-exports) */
  source?: string;
  /** Exported symbols (empty for wildcard) */
  symbols: Array<{
    name: string;
    alias?: string;
    isDefault?: boolean;
  }>;
  /** True if this is a type-only export */
  isTypeOnly: boolean;
  /** Line number */
  line: number;
}

/**
 * Complete symbol information for a single file
 */
export interface FileSymbolInfo {
  /** File path */
  file: string;
  /** Symbols defined in this file */
  symbols: CodeSymbol[];
  /** Import statements */
  imports: ImportStatement[];
  /** Export statements (including re-exports) */
  exports: ExportStatement[];
  /** Extraction method used */
  extractionMethod: 'regex' | 'ast';
  /** Extraction duration (ms) */
  extractionTime: number;
  /** Errors during extraction */
  errors?: string[];
}

/**
 * Edge in the dependency graph
 */
export interface DependencyEdge {
  /** Source file (importer) */
  from: string;
  /** Target file (importee, resolved path) */
  to: string;
  /** Type of dependency */
  type: 'import' | 'dynamic-import' | 're-export';
  /** Imported symbols (empty = namespace/wildcard) */
  symbols: string[];
  /** Is this a type-only import */
  isTypeOnly: boolean;
}

/**
 * Dependency graph for the codebase
 */
export interface DependencyGraph {
  /** All edges */
  edges: DependencyEdge[];
  /** Files with no dependencies (roots of the graph) */
  roots: string[];
  /** Files that nothing depends on (leaves) */
  leaves: string[];
  /** Files involved in circular dependencies */
  cycles: string[][];
  /** Resolved module paths (import path -> file path) */
  resolutions: Map<string, string>;
  /** Entry points detected (index files, main files) */
  entryPoints: string[];
}

/**
 * File connectivity metrics
 */
export interface FileConnectivity {
  /** Number of files that import this file (direct) */
  inDegree: number;
  /** Number of files this file imports (direct) */
  outDegree: number;
  /** Count of all files that transitively depend on this */
  transitiveImporters: number;
  /** Is this file on a path from entry points */
  isCriticalPath: boolean;
  /** Files that directly depend on this */
  directDependents: string[];
  /** Files this directly depends on */
  directDependencies: string[];
}

/**
 * Complete codebase symbol structure
 */
export interface CodebaseStructure {
  /** Symbol info per file */
  files: Map<string, FileSymbolInfo>;
  /** Global symbol index: name -> defining files */
  symbolIndex: Map<string, string[]>;
  /** Dependency graph */
  dependencyGraph: DependencyGraph;
  /** File connectivity metrics */
  connectivity: Map<string, FileConnectivity>;
  /** Barrel file detection (index.ts that mostly re-exports) */
  barrelFiles: string[];
  /** Re-export chains (for barrel resolution) */
  reExportChains: Map<string, string[]>;
  /** Build metadata */
  metadata: {
    /** When structure was built */
    builtAt: Date;
    /** Total files processed */
    totalFiles: number;
    /** Files using AST extraction */
    astExtracted: number;
    /** Files using regex extraction */
    regexExtracted: number;
    /** Total symbols extracted */
    totalSymbols: number;
    /** Build duration (ms) */
    buildDuration: number;
  };
}

/**
 * Options for building codebase structure
 */
export interface SymbolicationOptions {
  /** Files to process */
  files: string[];
  /** Files to use AST extraction on (others use regex) */
  criticalFiles?: string[];
  /** Whether to use AST for critical files (default: true) */
  useAstForCritical?: boolean;
  /** Whether to build full dependency graph */
  buildDependencyGraph?: boolean;
  /** Whether to resolve barrel files */
  resolveBarrels?: boolean;
  /** Project root for module resolution */
  projectRoot?: string;
  /** tsconfig.json path for path aliases */
  tsconfigPath?: string;
  /** Max concurrent AST parses */
  astConcurrency?: number;
  /** Progress callback */
  onProgress?: (processed: number, total: number, file: string) => void;
}

/**
 * Result of symbolication phase
 */
export interface SymbolicationResult {
  /** Codebase structure */
  structure: CodebaseStructure;
  /** Duration (ms) */
  duration: number;
  /** Errors encountered */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Compressed symbol context for model consumption
 * Target: ~50-100 tokens per file
 */
export interface CompressedSymbolContext {
  /** One-line file summary */
  summary: string;
  /** Key exports (max 10) */
  exports: string[];
  /** Key dependencies (max 5, external only) */
  dependencies: string[];
  /** Count of files that import this */
  dependentCount: number;
  /** Is this an entry point */
  isEntryPoint: boolean;
  /** Risk/importance indicators */
  riskIndicators: string[];
}

/**
 * Symbol extractor interface
 */
export interface SymbolExtractor {
  /**
   * Extract symbols from a file
   */
  extract(content: string, filePath: string): FileSymbolInfo;

  /**
   * Get extraction method name
   */
  readonly method: 'regex' | 'ast';
}
