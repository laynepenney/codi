// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RAGSearchTool } from '../src/tools/rag-search.js';
import type { Retriever } from '../src/rag/retriever.js';
import type { RetrievalResult } from '../src/rag/types.js';

describe('RAGSearchTool', () => {
  let tool: RAGSearchTool;
  let mockRetriever: Partial<Retriever>;

  beforeEach(() => {
    tool = new RAGSearchTool();
    mockRetriever = {
      search: vi.fn(),
      formatAsToolOutput: vi.fn(),
    };
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();

      expect(def.name).toBe('search_codebase');
      expect(def.description).toContain('semantic similarity');
      expect(def.input_schema.properties.query).toBeDefined();
      expect(def.input_schema.properties.max_results).toBeDefined();
      expect(def.input_schema.properties.min_score).toBeDefined();
      expect(def.input_schema.properties.dir).toBeDefined();
      expect(def.input_schema.properties.file_pattern).toBeDefined();
      expect(def.input_schema.required).toContain('query');
    });
  });

  describe('execute without retriever', () => {
    it('returns helpful message when RAG is not enabled', async () => {
      const result = await tool.execute({ query: 'test query' });

      expect(result).toContain('RAG index is not available');
      expect(result).toContain('To enable semantic code search');
      expect(result).toContain('/index');
    });
  });

  describe('execute with retriever', () => {
    const mockResults: RetrievalResult[] = [
      {
        chunk: {
          id: 'chunk1',
          content: 'function hello() { return "world"; }',
          filePath: '/project/src/hello.ts',
          relativePath: 'src/hello.ts',
          startLine: 1,
          endLine: 3,
          language: 'typescript',
          type: 'function',
          name: 'hello',
        },
        score: 0.92,
      },
      {
        chunk: {
          id: 'chunk2',
          content: 'class Greeter { greet() { return "hi"; } }',
          filePath: '/project/src/greeter.ts',
          relativePath: 'src/greeter.ts',
          startLine: 10,
          endLine: 15,
          language: 'typescript',
          type: 'class',
          name: 'Greeter',
        },
        score: 0.85,
      },
    ];

    beforeEach(() => {
      (mockRetriever.search as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
      (mockRetriever.formatAsToolOutput as ReturnType<typeof vi.fn>).mockReturnValue(
        'Found 2 relevant code snippets...'
      );
      tool.setRetriever(mockRetriever as Retriever);
    });

    it('requires query parameter', async () => {
      await expect(tool.execute({})).rejects.toThrow('Query is required');
    });

    it('searches with default max_results and min_score', async () => {
      await tool.execute({ query: 'hello function' });

      expect(mockRetriever.search).toHaveBeenCalledWith('hello function', 5, 0.7);
    });

    it('searches with custom max_results', async () => {
      await tool.execute({ query: 'test', max_results: 3 });

      expect(mockRetriever.search).toHaveBeenCalledWith('test', 3, 0.7);
    });

    it('searches with custom min_score', async () => {
      await tool.execute({ query: 'test', min_score: 0.5 });

      expect(mockRetriever.search).toHaveBeenCalledWith('test', 5, 0.5);
    });

    it('clamps max_results to upper bound (20)', async () => {
      await tool.execute({ query: 'test', max_results: 100 });
      expect(mockRetriever.search).toHaveBeenCalledWith('test', 20, 0.7);
    });

    it('clamps max_results to lower bound', async () => {
      await tool.execute({ query: 'test', max_results: -5 });
      expect(mockRetriever.search).toHaveBeenCalledWith('test', 1, 0.7);
    });

    it('clamps min_score to valid range', async () => {
      await tool.execute({ query: 'test', min_score: 1.5 });
      expect(mockRetriever.search).toHaveBeenCalledWith('test', 5, 1);

      await tool.execute({ query: 'test', min_score: -0.5 });
      expect(mockRetriever.search).toHaveBeenCalledWith('test', 5, 0);
    });

    it('formats results using retriever', async () => {
      const result = await tool.execute({ query: 'hello' });

      expect(mockRetriever.formatAsToolOutput).toHaveBeenCalledWith(mockResults);
      expect(result).toBe('Found 2 relevant code snippets...');
    });

    it('handles empty results', async () => {
      (mockRetriever.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await tool.execute({ query: 'nonexistent' });

      expect(result).toContain('No relevant code found');
      expect(result).toContain('nonexistent');
      expect(result).toContain('grep tool');
    });

    it('handles search errors', async () => {
      (mockRetriever.search as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection failed')
      );

      await expect(tool.execute({ query: 'test' })).rejects.toThrow(
        'RAG search failed: Connection failed'
      );
    });

    it('filters results by directory', async () => {
      const mixedResults: RetrievalResult[] = [
        {
          chunk: {
            id: 'chunk1',
            content: 'function a() {}',
            filePath: '/project/src/a.ts',
            relativePath: 'src/a.ts',
            startLine: 1,
            endLine: 1,
            language: 'typescript',
            type: 'function',
          },
          score: 0.9,
        },
        {
          chunk: {
            id: 'chunk2',
            content: 'function b() {}',
            filePath: '/project/tests/b.ts',
            relativePath: 'tests/b.ts',
            startLine: 1,
            endLine: 1,
            language: 'typescript',
            type: 'function',
          },
          score: 0.85,
        },
      ];
      (mockRetriever.search as ReturnType<typeof vi.fn>).mockResolvedValue(mixedResults);
      (mockRetriever.formatAsToolOutput as ReturnType<typeof vi.fn>).mockImplementation(
        (results: RetrievalResult[]) => `Found ${results.length} results`
      );

      const result = await tool.execute({ query: 'test', dir: 'src' });

      expect(result).toBe('Found 1 results');
    });

    it('filters results by file pattern', async () => {
      const mixedResults: RetrievalResult[] = [
        {
          chunk: {
            id: 'chunk1',
            content: 'test code',
            filePath: '/project/src/file.test.ts',
            relativePath: 'src/file.test.ts',
            startLine: 1,
            endLine: 1,
            language: 'typescript',
            type: 'function',
          },
          score: 0.9,
        },
        {
          chunk: {
            id: 'chunk2',
            content: 'production code',
            filePath: '/project/src/file.ts',
            relativePath: 'src/file.ts',
            startLine: 1,
            endLine: 1,
            language: 'typescript',
            type: 'function',
          },
          score: 0.85,
        },
      ];
      (mockRetriever.search as ReturnType<typeof vi.fn>).mockResolvedValue(mixedResults);
      (mockRetriever.formatAsToolOutput as ReturnType<typeof vi.fn>).mockImplementation(
        (results: RetrievalResult[]) => `Found ${results.length} results`
      );

      const result = await tool.execute({ query: 'test', file_pattern: '*.test.ts' });

      expect(result).toBe('Found 1 results');
    });

    it('shows filter info in no results message', async () => {
      (mockRetriever.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await tool.execute({ query: 'test', dir: 'src', min_score: 0.9 });

      expect(result).toContain('filtered to directory: src');
      expect(result).toContain('min score: 0.9');
    });
  });

  describe('setRetriever', () => {
    it('allows setting retriever after construction', async () => {
      const tool = new RAGSearchTool();

      // Without retriever, should return error message
      const resultWithout = await tool.execute({ query: 'test' });
      expect(resultWithout).toContain('not available');

      // Set retriever
      const mockRetriever = {
        search: vi.fn().mockResolvedValue([]),
        formatAsToolOutput: vi.fn().mockReturnValue('No results'),
      };
      tool.setRetriever(mockRetriever as unknown as Retriever);

      // Now should use the retriever
      const resultWith = await tool.execute({ query: 'test' });
      expect(resultWith).toContain('No relevant code found');
    });
  });
});
