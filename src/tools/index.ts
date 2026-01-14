// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

export { BaseTool } from './base.js';
export { ToolRegistry, globalRegistry } from './registry.js';
export { ReadFileTool } from './read-file.js';
export { WriteFileTool } from './write-file.js';
export { BashTool } from './bash.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
export { ListDirectoryTool } from './list-directory.js';
export { EditFileTool } from './edit-file.js';
export { PatchFileTool } from './patch-file.js';
export { InsertLineTool } from './insert-line.js';
export { AnalyzeImageTool } from './analyze-image.js';
export { RunTestsTool } from './run-tests.js';
export { RAGSearchTool } from './rag-search.js';
export { WebSearchTool } from './web-search.js';
export { RefactorTool } from './refactor.js';
export { ShellInfoTool } from './shell-info.js';
export { PipelineTool } from './pipeline.js';
export { GenerateDocsTool } from './generate-docs.js';

// Symbol index tools
export {
  FindSymbolTool,
  FindReferencesTool,
  GotoDefinitionTool,
  GetDependencyGraphTool,
  GetInheritanceTool,
  GetCallGraphTool,
  ShowImpactTool,
  GetIndexStatusTool,
  RebuildIndexTool,
} from '../symbol-index/index.js';

import { globalRegistry } from './registry.js';
import { ReadFileTool } from './read-file.js';
import { WriteFileTool } from './write-file.js';
import { BashTool } from './bash.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { ListDirectoryTool } from './list-directory.js';
import { EditFileTool } from './edit-file.js';
import { PatchFileTool } from './patch-file.js';
import { InsertLineTool } from './insert-line.js';
import { AnalyzeImageTool } from './analyze-image.js';
import { RunTestsTool } from './run-tests.js';
import { RAGSearchTool } from './rag-search.js';
import { WebSearchTool } from './web-search.js';
import { RefactorTool } from './refactor.js';
import { ShellInfoTool } from './shell-info.js';
import { PipelineTool } from './pipeline.js';
import { GenerateDocsTool } from './generate-docs.js';
import type { Retriever } from '../rag/retriever.js';
import type { SymbolIndexService } from '../symbol-index/service.js';
import {
  FindSymbolTool,
  FindReferencesTool,
  GotoDefinitionTool,
  GetDependencyGraphTool,
  GetInheritanceTool,
  GetCallGraphTool,
  ShowImpactTool,
  GetIndexStatusTool,
  RebuildIndexTool,
} from '../symbol-index/index.js';

/**
 * Register all default tools with the global registry.
 */
export function registerDefaultTools(): void {
  // File operations
  globalRegistry.register(new ReadFileTool());
  globalRegistry.register(new WriteFileTool());
  globalRegistry.register(new EditFileTool());
  globalRegistry.register(new InsertLineTool());
  globalRegistry.register(new PatchFileTool());

  // File exploration
  globalRegistry.register(new GlobTool());
  globalRegistry.register(new GrepTool());
  globalRegistry.register(new ListDirectoryTool());

  // Shell
  globalRegistry.register(new BashTool());

  // Vision
  globalRegistry.register(new AnalyzeImageTool());

  // Testing
  globalRegistry.register(new RunTestsTool());

  // Web search
  globalRegistry.register(new WebSearchTool());

  // Refactoring
  globalRegistry.register(new RefactorTool());

  // Environment info
  globalRegistry.register(new ShellInfoTool());

  // Pipeline/orchestration
  globalRegistry.register(new PipelineTool());

  // Documentation
  globalRegistry.register(new GenerateDocsTool());
}

/**
 * Register the RAG search tool with a retriever.
 */
export function registerRAGSearchTool(retriever: Retriever): RAGSearchTool {
  const ragTool = new RAGSearchTool();
  ragTool.setRetriever(retriever);
  globalRegistry.register(ragTool);
  return ragTool;
}

/**
 * Register symbol index tools with a symbol index service.
 */
export function registerSymbolIndexTools(indexService: SymbolIndexService, projectRoot?: string): void {
  const root = projectRoot || process.cwd();
  globalRegistry.register(new FindSymbolTool(indexService));
  globalRegistry.register(new FindReferencesTool(indexService));
  globalRegistry.register(new GotoDefinitionTool(indexService));
  globalRegistry.register(new GetDependencyGraphTool(indexService));
  globalRegistry.register(new GetInheritanceTool(indexService));
  globalRegistry.register(new GetCallGraphTool(indexService));
  globalRegistry.register(new ShowImpactTool(indexService));
  globalRegistry.register(new GetIndexStatusTool(indexService, root));
  globalRegistry.register(new RebuildIndexTool(root));
}
