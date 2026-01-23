// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  indexCommand,
  ragCommand,
  setRAGIndexer,
  setRAGConfig,
  registerRAGCommands,
} from '../src/commands/rag-commands.js';
import type { CommandContext } from '../src/commands/index.js';

// Mock the commands/index module
vi.mock('../src/commands/index.js', async () => {
  const actual = await vi.importActual<typeof import('../src/commands/index.js')>('../src/commands/index.js');
  return {
    ...actual,
    registerCommand: vi.fn(),
  };
});

import { registerCommand } from '../src/commands/index.js';

// Create mock indexer
function createMockIndexer() {
  return {
    getStats: vi.fn().mockResolvedValue({
      embeddingProvider: 'OpenAI',
      embeddingModel: 'text-embedding-3-small',
      totalFiles: 100,
      totalChunks: 500,
      indexSizeBytes: 1024 * 1024, // 1 MB
      lastIndexed: new Date(),
      isIndexing: false,
      queuedFiles: 0,
    }),
    isIndexingInProgress: vi.fn().mockReturnValue(false),
    clearIndex: vi.fn().mockResolvedValue(undefined),
    indexAll: vi.fn().mockResolvedValue({ totalFiles: 100, totalChunks: 500 }),
    getVectorStore: vi.fn().mockReturnValue({
      getIndexedFiles: vi.fn().mockResolvedValue(['src/index.ts', 'src/agent.ts']),
    }),
  };
}

function createMockRAGConfig() {
  return {
    enabled: true,
    embeddingProvider: 'openai' as const,
    openaiModel: 'text-embedding-3-small',
    ollamaModel: 'nomic-embed-text',
    topK: 5,
    minScore: 0.7,
    autoIndex: true,
    watchFiles: false,
    includePatterns: ['**/*.ts', '**/*.js'],
    excludePatterns: ['node_modules/**'],
  };
}

const createContext = (): CommandContext => ({
  workingDirectory: '/test/project',
});

describe('RAG Commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset module state
    setRAGIndexer(null as any);
    setRAGConfig(null as any);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('indexCommand', () => {
    it('has correct name and aliases', () => {
      expect(indexCommand.name).toBe('index');
      expect(indexCommand.aliases).toContain('reindex');
    });

    it('shows help when indexer is not available', async () => {
      const result = await indexCommand.execute('', createContext());

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('RAG system is not available');
    });

    it('shows status with --status flag when indexer is available', async () => {
      const mockIndexer = createMockIndexer();
      setRAGIndexer(mockIndexer as any);

      const result = await indexCommand.execute('--status', createContext());

      expect(result).toBeNull();
      expect(mockIndexer.getStats).toHaveBeenCalled();
    });

    it('does not start indexing if already in progress', async () => {
      const mockIndexer = createMockIndexer();
      mockIndexer.isIndexingInProgress.mockReturnValue(true);
      setRAGIndexer(mockIndexer as any);

      const result = await indexCommand.execute('', createContext());

      expect(result).toBeNull();
      expect(mockIndexer.indexAll).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('already in progress');
    });

    it('clears index with --clear flag', async () => {
      const mockIndexer = createMockIndexer();
      setRAGIndexer(mockIndexer as any);

      const result = await indexCommand.execute('--clear', createContext());

      expect(result).toBeNull();
      expect(mockIndexer.clearIndex).toHaveBeenCalled();
      expect(mockIndexer.indexAll).toHaveBeenCalled();
    });

    it('starts incremental indexing without --clear', async () => {
      const mockIndexer = createMockIndexer();
      setRAGIndexer(mockIndexer as any);

      const result = await indexCommand.execute('', createContext());

      expect(result).toBeNull();
      expect(mockIndexer.clearIndex).not.toHaveBeenCalled();
      expect(mockIndexer.indexAll).toHaveBeenCalled();
    });
  });

  describe('ragCommand', () => {
    it('has correct name and aliases', () => {
      expect(ragCommand.name).toBe('rag');
      expect(ragCommand.aliases).toContain('rag-status');
    });

    it('shows help with "help" action', async () => {
      const result = await ragCommand.execute('help', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Retrieval-Augmented Generation');
      expect(output).toContain('Commands:');
    });

    it('shows not enabled message when indexer is not available', async () => {
      const result = await ragCommand.execute('', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('RAG system is not enabled');
    });

    it('shows config with "config" action', async () => {
      const mockIndexer = createMockIndexer();
      const mockConfig = createMockRAGConfig();
      setRAGIndexer(mockIndexer as any);
      setRAGConfig(mockConfig);

      const result = await ragCommand.execute('config', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('RAG Configuration');
      expect(output).toContain('text-embedding-3-small');
    });

    it('shows indexed files with "files" action', async () => {
      const mockIndexer = createMockIndexer();
      const mockConfig = createMockRAGConfig();
      setRAGIndexer(mockIndexer as any);
      setRAGConfig(mockConfig);

      const result = await ragCommand.execute('files', createContext());

      expect(result).toBeNull();
      expect(mockIndexer.getVectorStore).toHaveBeenCalled();
    });

    it('shows status by default', async () => {
      const mockIndexer = createMockIndexer();
      const mockConfig = createMockRAGConfig();
      setRAGIndexer(mockIndexer as any);
      setRAGConfig(mockConfig);

      const result = await ragCommand.execute('', createContext());

      expect(result).toBeNull();
      expect(mockIndexer.getStats).toHaveBeenCalled();
    });

    it('handles error when listing files', async () => {
      const mockIndexer = createMockIndexer();
      mockIndexer.getVectorStore.mockReturnValue({
        getIndexedFiles: vi.fn().mockRejectedValue(new Error('Index not found')),
      });
      const mockConfig = createMockRAGConfig();
      setRAGIndexer(mockIndexer as any);
      setRAGConfig(mockConfig);

      const result = await ragCommand.execute('files', createContext());

      expect(result).toBeNull();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Failed to list files');
    });
  });

  describe('registerRAGCommands', () => {
    it('registers both RAG commands', () => {
      registerRAGCommands();

      expect(registerCommand).toHaveBeenCalledWith(indexCommand);
      expect(registerCommand).toHaveBeenCalledWith(ragCommand);
    });
  });
});
