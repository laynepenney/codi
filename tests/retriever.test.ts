import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Retriever } from '../src/rag/retriever.js';
import type { RetrievalResult, CodeChunk, RAGConfig } from '../src/rag/types.js';

// Mock the embedding provider and vector store
vi.mock('../src/rag/vector-store.js', () => ({
  VectorStore: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    query: vi.fn(),
    getIndexedFiles: vi.fn().mockResolvedValue([]),
  })),
}));

describe('Retriever', () => {
  let retriever: Retriever;
  const mockConfig: RAGConfig = {
    enabled: true,
    embeddingProvider: 'openai',
    openaiModel: 'text-embedding-3-small',
    ollamaModel: 'nomic-embed-text',
    ollamaBaseUrl: 'http://localhost:11434',
    chunkStrategy: 'code',
    maxChunkSize: 1500,
    chunkOverlap: 200,
    topK: 5,
    minScore: 0.7,
    includePatterns: ['**/*.ts'],
    excludePatterns: ['**/node_modules/**'],
    autoIndex: false,
    watchFiles: false,
  };

  const mockEmbeddingProvider = {
    embedOne: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedMany: vi.fn(),
  };

  beforeEach(() => {
    retriever = new Retriever('/test/project', mockEmbeddingProvider as any, mockConfig);
  });

  describe('formatAsToolOutput', () => {
    it('returns message when no results', () => {
      const result = retriever.formatAsToolOutput([]);
      expect(result).toBe('No relevant code found.');
    });

    it('formats single result with symbol name', () => {
      const chunk: CodeChunk = {
        id: 'test-1',
        content: 'function foo() { return 42; }',
        filePath: '/test/project/src/utils.ts',
        relativePath: 'src/utils.ts',
        startLine: 10,
        endLine: 12,
        language: 'typescript',
        type: 'function',
        name: 'foo',
      };

      const results: RetrievalResult[] = [{ chunk, score: 0.85 }];
      const output = retriever.formatAsToolOutput(results);

      expect(output).toContain('Found 1 relevant code snippets:');
      expect(output).toContain('1. src/utils.ts:10-12');
      expect(output).toContain('Score: 85%');
      expect(output).toContain('Symbol: foo (function)');
      expect(output).toContain('```typescript');
      expect(output).toContain('function foo() { return 42; }');
    });

    it('formats result without symbol name (shows Kind)', () => {
      const chunk: CodeChunk = {
        id: 'test-2',
        content: 'const x = 1;\nconst y = 2;',
        filePath: '/test/project/src/config.ts',
        relativePath: 'src/config.ts',
        startLine: 1,
        endLine: 2,
        language: 'typescript',
        type: 'block',
        // No name
      };

      const results: RetrievalResult[] = [{ chunk, score: 0.72 }];
      const output = retriever.formatAsToolOutput(results);

      expect(output).toContain('Score: 72%');
      expect(output).toContain('Kind: block');
      expect(output).not.toContain('Symbol:');
    });

    it('formats multiple results', () => {
      const chunks: CodeChunk[] = [
        {
          id: 'test-1',
          content: 'class Foo {}',
          filePath: '/test/project/src/foo.ts',
          relativePath: 'src/foo.ts',
          startLine: 1,
          endLine: 5,
          language: 'typescript',
          type: 'class',
          name: 'Foo',
        },
        {
          id: 'test-2',
          content: 'function bar() {}',
          filePath: '/test/project/src/bar.ts',
          relativePath: 'src/bar.ts',
          startLine: 10,
          endLine: 15,
          language: 'typescript',
          type: 'function',
          name: 'bar',
        },
      ];

      const results: RetrievalResult[] = [
        { chunk: chunks[0], score: 0.9 },
        { chunk: chunks[1], score: 0.75 },
      ];
      const output = retriever.formatAsToolOutput(results);

      expect(output).toContain('Found 2 relevant code snippets:');
      expect(output).toContain('1. src/foo.ts:1-5');
      expect(output).toContain('Symbol: Foo (class)');
      expect(output).toContain('2. src/bar.ts:10-15');
      expect(output).toContain('Symbol: bar (function)');
    });

    it('truncates very long content', () => {
      const longContent = 'x'.repeat(4000);
      const chunk: CodeChunk = {
        id: 'test-long',
        content: longContent,
        filePath: '/test/project/src/big.ts',
        relativePath: 'src/big.ts',
        startLine: 1,
        endLine: 100,
        language: 'typescript',
        type: 'file',
      };

      const results: RetrievalResult[] = [{ chunk, score: 0.8 }];
      const output = retriever.formatAsToolOutput(results);

      expect(output).toContain('// ... (truncated)');
      expect(output.length).toBeLessThan(longContent.length);
    });
  });

  describe('formatForContext', () => {
    it('returns empty string when no results', () => {
      const result = retriever.formatForContext([]);
      expect(result).toBe('');
    });

    it('formats result with symbol context', () => {
      const chunk: CodeChunk = {
        id: 'test-1',
        content: 'export function helper() { }',
        filePath: '/test/project/src/helpers.ts',
        relativePath: 'src/helpers.ts',
        startLine: 5,
        endLine: 7,
        language: 'typescript',
        type: 'function',
        name: 'helper',
      };

      const results: RetrievalResult[] = [{ chunk, score: 0.88 }];
      const output = retriever.formatForContext(results);

      expect(output).toContain('## Relevant Code Context');
      expect(output).toContain('### src/helpers.ts:5-7 (88% match)');
      expect(output).toContain('**Symbol:** `helper` (function)');
      expect(output).toContain('```typescript');
    });

    it('shows Kind when no symbol name', () => {
      const chunk: CodeChunk = {
        id: 'test-2',
        content: '// some code block',
        filePath: '/test/project/src/misc.ts',
        relativePath: 'src/misc.ts',
        startLine: 1,
        endLine: 3,
        language: 'typescript',
        type: 'block',
      };

      const results: RetrievalResult[] = [{ chunk, score: 0.7 }];
      const output = retriever.formatForContext(results);

      expect(output).toContain('**Kind:** block');
      expect(output).not.toContain('**Symbol:**');
    });

    it('truncates content over 2000 characters', () => {
      const longContent = 'y'.repeat(2500);
      const chunk: CodeChunk = {
        id: 'test-long',
        content: longContent,
        filePath: '/test/project/src/long.ts',
        relativePath: 'src/long.ts',
        startLine: 1,
        endLine: 50,
        language: 'typescript',
        type: 'file',
      };

      const results: RetrievalResult[] = [{ chunk, score: 0.75 }];
      const output = retriever.formatForContext(results);

      expect(output).toContain('// ... (truncated)');
    });

    it('formats method type correctly', () => {
      const chunk: CodeChunk = {
        id: 'test-method',
        content: 'doSomething() { return true; }',
        filePath: '/test/project/src/service.ts',
        relativePath: 'src/service.ts',
        startLine: 20,
        endLine: 22,
        language: 'typescript',
        type: 'method',
        name: 'doSomething',
      };

      const results: RetrievalResult[] = [{ chunk, score: 0.82 }];
      const output = retriever.formatForContext(results);

      expect(output).toContain('**Symbol:** `doSomething` (method)');
    });
  });
});
