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

    it('searches with default max_results', async () => {
      await tool.execute({ query: 'hello function' });

      expect(mockRetriever.search).toHaveBeenCalledWith('hello function', 5);
    });

    it('searches with custom max_results', async () => {
      await tool.execute({ query: 'test', max_results: 3 });

      expect(mockRetriever.search).toHaveBeenCalledWith('test', 3);
    });

    it('clamps max_results to upper bound', async () => {
      await tool.execute({ query: 'test', max_results: 100 });
      expect(mockRetriever.search).toHaveBeenCalledWith('test', 10);
    });

    it('clamps max_results to lower bound', async () => {
      await tool.execute({ query: 'test', max_results: -5 });
      expect(mockRetriever.search).toHaveBeenCalledWith('test', 1);
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
