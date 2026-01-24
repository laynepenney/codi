// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RAG Commands
 *
 * Commands for managing the RAG code index.
 */

import { registerCommand, type Command, type CommandContext } from './index.js';
import type { BackgroundIndexer } from '../rag/indexer.js';
import type { RAGConfig, IndexStats } from '../rag/types.js';

// Module-level references set by the main app
let indexer: BackgroundIndexer | null = null;
let ragConfig: RAGConfig | null = null;

/**
 * Set the RAG indexer instance.
 */
export function setRAGIndexer(i: BackgroundIndexer): void {
  indexer = i;
}

/**
 * Set the RAG configuration.
 */
export function setRAGConfig(c: RAGConfig): void {
  ragConfig = c;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format an IndexStats object for display.
 */
function formatStats(stats: IndexStats): string {
  const lines: string[] = [];

  lines.push('**RAG Index Statistics**\n');
  lines.push(`Provider: ${stats.embeddingProvider} (${stats.embeddingModel})`);
  lines.push(`Files indexed: ${stats.totalFiles}`);
  lines.push(`Code chunks: ${stats.totalChunks}`);
  lines.push(`Index size: ${formatBytes(stats.indexSizeBytes)}`);

  if (stats.lastIndexed) {
    lines.push(`Last indexed: ${stats.lastIndexed.toLocaleString()}`);
  } else {
    lines.push('Last indexed: Never');
  }

  if (stats.isIndexing) {
    lines.push(`\nStatus: Indexing in progress (${stats.queuedFiles} files queued)`);
  } else {
    lines.push('\nStatus: Ready');
  }

  return lines.join('\n');
}

/**
 * /index command - Trigger reindexing.
 * This is an operational command - it prints output directly and doesn't call the AI.
 */
export const indexCommand: Command = {
  name: 'index',
  aliases: ['reindex'],
  description: 'Build or rebuild the RAG code index',
  usage: `/index [options]

Options:
  --clear    Clear the existing index before rebuilding
  --status   Show indexing status without starting

Examples:
  /index           - Incrementally update the index
  /index --clear   - Clear and rebuild from scratch
  /index --status  - Show current indexing status`,

  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    if (!indexer) {
      console.log(`
RAG system is not available.

RAG is enabled by default but requires an embedding provider:
  1. Set OPENAI_API_KEY environment variable (for OpenAI embeddings)
     or ensure Ollama is running with nomic-embed-text model
  2. Restart Codi

To disable RAG: add "rag": { "enabled": false } to your .codi.json
`);
      return null;
    }

    const shouldClear = args.includes('--clear');
    const statusOnly = args.includes('--status');

    if (statusOnly) {
      const stats = await indexer.getStats();
      console.log('\n' + formatStats(stats) + '\n');
      return null;
    }

    if (indexer.isIndexingInProgress()) {
      const stats = await indexer.getStats();
      console.log('\nIndexing is already in progress.\n');
      console.log(formatStats(stats) + '\n');
      return null;
    }

    if (shouldClear) {
      await indexer.clearIndex();
    }

    // Start indexing in background
    indexer
      .indexAll()
      .then((stats) => {
        console.log(
          `\nIndexing complete: ${stats.totalFiles} files, ${stats.totalChunks} chunks`
        );
      })
      .catch((err) => {
        console.error(`\nIndexing failed: ${err.message}`);
      });

    console.log(shouldClear
      ? '\nCleared index and started rebuilding. Progress will be shown as files are indexed.\n'
      : '\nStarted incremental indexing. Progress will be shown as files are indexed.\n');
    return null;
  },
};

/**
 * /rag command - Show RAG status and configuration.
 * This is an informational command - it prints output directly and doesn't call the AI.
 */
export const ragCommand: Command = {
  name: 'rag',
  aliases: ['rag-status'],
  description: 'Show RAG system status and statistics',
  usage: `/rag [action]

Actions:
  (none)    - Show current status and statistics
  config    - Show RAG configuration
  files     - List indexed files
  help      - Show RAG help

Examples:
  /rag           - Show status
  /rag config    - Show configuration
  /rag files     - List indexed files`,

  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const action = args.trim().toLowerCase();

    if (action === 'help') {
      console.log(`
RAG (Retrieval-Augmented Generation) System

RAG enables semantic code search by indexing your codebase with embeddings.
The AI can then search for relevant code snippets when answering questions.

Commands:
  /index        - Build or rebuild the code index
  /rag          - Show status and statistics
  /rag config   - Show configuration
  /rag files    - List indexed files

How it works:
  1. Code files are chunked into functions, classes, and blocks
  2. Each chunk is converted to a vector embedding
  3. When you ask a question, similar code is retrieved
  4. The AI uses this context to give better answers

Configuration (.codi.json):
  {
    "rag": {
      "enabled": true,
      "embeddingProvider": "auto",
      "topK": 5,
      "minScore": 0.7
    }
  }
`);
      return null;
    }

    if (!indexer || !ragConfig) {
      console.log(`
RAG system is not enabled.

To enable RAG, add this to your .codi.json:
  {
    "rag": {
      "enabled": true
    }
  }

Then restart Codi with an OpenAI API key set or Ollama running.
`);
      return null;
    }

    if (action === 'config') {
      const embeddingInfo = ragConfig.embeddingProvider === 'modelmap'
        ? `${ragConfig.embeddingProvider} (task: ${ragConfig.embeddingTask || 'embeddings'})`
        : ragConfig.embeddingProvider;

      console.log(`
RAG Configuration

  Enabled:              ${ragConfig.enabled}
  Embedding provider:   ${embeddingInfo}
  OpenAI model:         ${ragConfig.openaiModel}
  Ollama model:         ${ragConfig.ollamaModel}
  Top K results:        ${ragConfig.topK}
  Min similarity score: ${ragConfig.minScore}
  Auto-index on startup: ${ragConfig.autoIndex}
  Watch for file changes: ${ragConfig.watchFiles}
  Include patterns:     ${ragConfig.includePatterns.length} patterns
  Exclude patterns:     ${ragConfig.excludePatterns.length} patterns
`);
      return null;
    }

    if (action === 'files') {
      try {
        const vectorStore = indexer.getVectorStore();
        const files = await vectorStore.getIndexedFiles();

        if (files.length === 0) {
          console.log('\nNo files indexed yet. Run /index to build the index.\n');
          return null;
        }

        console.log(`\nIndexed Files (${files.length} total)\n`);

        // Show first 50 files
        const displayFiles = files.slice(0, 50);
        for (const file of displayFiles) {
          console.log(`  ${file}`);
        }

        if (files.length > 50) {
          console.log(`\n  ... and ${files.length - 50} more files`);
        }
        console.log('');
        return null;
      } catch (err) {
        console.log(`\nFailed to list files: ${err}\n`);
        return null;
      }
    }

    // Default: show status
    const stats = await indexer.getStats();
    console.log('\n' + formatStats(stats) + '\n');
    return null;
  },
};

/**
 * Register all RAG commands.
 */
export function registerRAGCommands(): void {
  registerCommand(indexCommand);
  registerCommand(ragCommand);
}
