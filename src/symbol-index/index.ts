/**
 * Symbol Index Module
 *
 * Provides AST-based codebase indexing and navigation tools.
 */

export { SymbolDatabase, getIndexDirectory } from './database.js';
export { SymbolIndexService } from './service.js';
export {
  BackgroundIndexer,
  getBackgroundIndexer,
  initializeBackgroundIndexer,
  stopBackgroundIndexer,
  type BackgroundIndexerOptions,
} from './background-indexer.js';
export type {
  IndexMetadata,
  IndexedFile,
  IndexedSymbol,
  IndexedImport,
  IndexedImportSymbol,
  IndexedDependency,
  SymbolSearchResult,
  ReferenceResult,
  DependencyResult,
  InheritanceResult,
  CallGraphResult,
  IndexBuildOptions,
  IndexStats,
} from './types.js';

// Tool exports
export { FindSymbolTool } from './tools/find-symbol.js';
export { FindReferencesTool } from './tools/find-references.js';
export { GotoDefinitionTool } from './tools/goto-definition.js';
export { GetDependencyGraphTool } from './tools/get-dependency-graph.js';
export { GetInheritanceTool } from './tools/get-inheritance.js';
export { GetCallGraphTool } from './tools/get-call-graph.js';
export { ShowImpactTool } from './tools/show-impact.js';
export { GetIndexStatusTool } from './tools/get-index-status.js';
export { RebuildIndexTool } from './tools/rebuild-index.js';
