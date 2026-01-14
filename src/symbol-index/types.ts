/**
 * Types for the Symbol Index system.
 * Re-exports symbol types from model-map and adds index-specific types.
 */

// Re-export symbol types from model-map
export type {
  SymbolKind,
  SymbolVisibility,
  CodeSymbol,
  ImportStatement,
  ExportStatement,
  FileSymbolInfo,
  DependencyEdge,
  DependencyGraph,
  FileConnectivity,
  CodebaseStructure,
  SymbolicationOptions,
  SymbolicationResult,
  SymbolExtractor,
} from '../model-map/symbols/types.js';

/**
 * Index metadata stored in the database
 */
export interface IndexMetadata {
  version: string;
  projectRoot: string;
  lastFullRebuild: string;
  lastUpdate: string;
  totalFiles: number;
  totalSymbols: number;
}

/**
 * File record in the index
 */
export interface IndexedFile {
  id: number;
  path: string;
  hash: string;
  extractionMethod: 'regex' | 'ast';
  lastIndexed: string;
}

/**
 * Symbol record in the index
 */
export interface IndexedSymbol {
  id: number;
  fileId: number;
  name: string;
  kind: string;
  line: number;
  endLine?: number;
  visibility: string;
  signature?: string;
  docSummary?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Import record in the index
 */
export interface IndexedImport {
  id: number;
  fileId: number;
  sourcePath: string;
  resolvedFileId?: number;
  isTypeOnly: boolean;
  line: number;
}

/**
 * Import symbol record
 */
export interface IndexedImportSymbol {
  importId: number;
  name: string;
  alias?: string;
  isDefault: boolean;
}

/**
 * File dependency record
 */
export interface IndexedDependency {
  fromFileId: number;
  toFileId: number;
  type: 'import' | 'dynamic-import' | 're-export' | 'usage';
}

/**
 * Result from find_symbol query
 */
export interface SymbolSearchResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  endLine?: number;
  visibility: string;
  signature?: string;
  docSummary?: string;
}

/**
 * Result from find_references query
 */
export interface ReferenceResult {
  file: string;
  line: number;
  type: 'import' | 'usage' | 'type-only';
  context?: string;
}

/**
 * Result from get_dependency_graph query
 */
export interface DependencyResult {
  file: string;
  direction: 'imports' | 'importedBy';
  depth: number;
  type: 'import' | 'dynamic-import' | 're-export' | 'usage';
}

/**
 * Result from get_inheritance query
 */
export interface InheritanceResult {
  name: string;
  kind: 'class' | 'interface';
  file: string;
  line: number;
  direction: 'extends' | 'implements' | 'extended-by' | 'implemented-by';
}

/**
 * Result from get_call_graph query
 */
export interface CallGraphResult {
  name: string;
  file: string;
  line: number;
  direction: 'calls' | 'called-by';
  depth: number;
}

/**
 * Options for building or updating the index
 */
export interface IndexBuildOptions {
  /** Root directory of the project */
  projectRoot: string;
  /** Glob patterns for files to include */
  includePatterns?: string[];
  /** Glob patterns for files to exclude */
  excludePatterns?: string[];
  /** Force full rebuild even if index exists */
  forceRebuild?: boolean;
  /** Progress callback */
  onProgress?: (processed: number, total: number, file: string) => void;
  /**
   * Enable deep indexing with usage-based dependency detection.
   * This scans all files for symbol usages (like an IDE), but is slower.
   * Default: false (fast mode - only tracks explicit imports)
   */
  deepIndex?: boolean;
  /**
   * Number of parallel jobs for deep indexing.
   * Higher values use more CPU but complete faster.
   * Default: 4
   */
  parallelJobs?: number;
}

/**
 * Index statistics
 */
export interface IndexStats {
  version: string;
  projectRoot: string;
  totalFiles: number;
  totalSymbols: number;
  totalImports: number;
  totalDependencies: number;
  lastFullRebuild: string;
  lastUpdate: string;
  indexSizeBytes: number;
}
