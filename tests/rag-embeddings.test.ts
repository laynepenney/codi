// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIEmbeddingProvider } from '../src/rag/embeddings/openai.js';
import { OllamaEmbeddingProvider } from '../src/rag/embeddings/ollama.js';
import { createEmbeddingProvider, detectAvailableProviders, createEmbeddingProviderFromModelDef } from '../src/rag/embeddings/index.js';
import type { RAGConfig } from '../src/rag/types.js';

// Mock OpenAI client
vi.mock('openai', () => {
  const mockEmbeddings = {
    create: vi.fn(),
  };

  const OpenAI = vi.fn(() => ({
    embeddings: mockEmbeddings,
  }));

  return { default: OpenAI, OpenAI };
});

// Mock fetch for Ollama
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Embedding Providers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('OpenAIEmbeddingProvider', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'test-api-key';
    });

    it('creates provider with default model', () => {
      const provider = new OpenAIEmbeddingProvider();

      expect(provider.getName()).toBe('OpenAI');
      expect(provider.getModel()).toBe('text-embedding-3-small');
      expect(provider.getDimensions()).toBe(1536);
    });

    it('creates provider with custom model', () => {
      const provider = new OpenAIEmbeddingProvider('text-embedding-3-large');

      expect(provider.getModel()).toBe('text-embedding-3-large');
      expect(provider.getDimensions()).toBe(3072);
    });

    it('generates embeddings for single text', async () => {
      const mockEmbed = [0.1, 0.2, 0.3];
      const { OpenAI } = await import('openai');
      const mockCreate = (new OpenAI() as { embeddings: { create: ReturnType<typeof vi.fn> } }).embeddings.create;
      mockCreate.mockResolvedValue({
        data: [{ index: 0, embedding: mockEmbed }],
      });

      const provider = new OpenAIEmbeddingProvider();
      const result = await provider.embedOne('test text');

      expect(result).toEqual(mockEmbed);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['test text'],
      });
    });

    it('generates embeddings for multiple texts', async () => {
      const mockEmbeds = [[0.1, 0.2], [0.3, 0.4]];
      const { OpenAI } = await import('openai');
      const mockCreate = (new OpenAI() as { embeddings: { create: ReturnType<typeof vi.fn> } }).embeddings.create;
      mockCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: mockEmbeds[0] },
          { index: 1, embedding: mockEmbeds[1] },
        ],
      });

      const provider = new OpenAIEmbeddingProvider();
      const result = await provider.embed(['text1', 'text2']);

      expect(result).toEqual(mockEmbeds);
    });

    it('handles empty input', async () => {
      const provider = new OpenAIEmbeddingProvider();
      const result = await provider.embed([]);

      expect(result).toEqual([]);
    });

    it('isAvailable returns false when API key is missing', async () => {
      delete process.env.OPENAI_API_KEY;

      const provider = new OpenAIEmbeddingProvider();
      const isAvailable = await provider.isAvailable();

      expect(isAvailable).toBe(false);
    });
  });

  describe('OllamaEmbeddingProvider', () => {
    it('creates provider with default model', () => {
      const provider = new OllamaEmbeddingProvider();

      expect(provider.getName()).toBe('Ollama');
      expect(provider.getModel()).toBe('nomic-embed-text');
      expect(provider.getDimensions()).toBe(768);
    });

    it('creates provider with custom model and URL', () => {
      const provider = new OllamaEmbeddingProvider('mxbai-embed-large', 'http://remote:11434');

      expect(provider.getModel()).toBe('mxbai-embed-large');
    });

    it('generates embeddings for single text', async () => {
      const mockEmbed = [0.1, 0.2, 0.3];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: mockEmbed }),
      });

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embedOne('test text');

      expect(result).toEqual(mockEmbed);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/embeddings',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test text'),
        })
      );
    });

    it('generates embeddings for multiple texts', async () => {
      const mockEmbeds = [[0.1, 0.2], [0.3, 0.4]];
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ embedding: mockEmbeds[0] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ embedding: mockEmbeds[1] }),
        });

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(['text1', 'text2']);

      expect(result).toEqual(mockEmbeds);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const provider = new OllamaEmbeddingProvider();

      await expect(provider.embedOne('test')).rejects.toThrow('Ollama embedding request failed');
    });

    it('handles empty input', async () => {
      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed([]);

      expect(result).toEqual([]);
    });

    it('is available when Ollama is running and model exists', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          models: [{ name: 'nomic-embed-text:latest' }],
        }),
      });

      const provider = new OllamaEmbeddingProvider();
      const isAvailable = await provider.isAvailable();

      expect(isAvailable).toBe(true);
    });

    it('is not available when Ollama is not running', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const provider = new OllamaEmbeddingProvider();
      const isAvailable = await provider.isAvailable();

      expect(isAvailable).toBe(false);
    });

    it('is not available when model is not installed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          models: [{ name: 'llama3:latest' }],
        }),
      });

      const provider = new OllamaEmbeddingProvider();
      const isAvailable = await provider.isAvailable();

      expect(isAvailable).toBe(false);
    });
  });

  describe('createEmbeddingProvider', () => {
    const baseConfig: RAGConfig = {
      enabled: true,
      embeddingProvider: 'auto',
      openaiModel: 'text-embedding-3-small',
      ollamaModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://localhost:11434',
      topK: 5,
      minScore: 0.7,
      includePatterns: [],
      excludePatterns: [],
      autoIndex: true,
      watchFiles: true,
    };

    it('creates OpenAI provider when specified', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'openai',
      });

      expect(provider.getName()).toBe('OpenAI');
    });

    it('creates Ollama provider when specified', () => {
      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'ollama',
      });

      expect(provider.getName()).toBe('Ollama');
    });

    it('defaults to Ollama for auto mode (free/local)', () => {
      // Auto mode always defaults to Ollama because it's free and local
      // Users can explicitly set embeddingProvider: 'openai' if they prefer OpenAI
      process.env.OPENAI_API_KEY = 'test-key';

      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'auto',
      });

      expect(provider.getName()).toBe('Ollama');
    });

    it('defaults to Ollama without any API key', () => {
      // Ollama is preferred for auto mode because it's free
      delete process.env.OPENAI_API_KEY;

      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'auto',
      });

      expect(provider.getName()).toBe('Ollama');
    });

    it('uses custom model from config', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'openai',
        openaiModel: 'text-embedding-3-large',
      });

      expect(provider.getModel()).toBe('text-embedding-3-large');
    });
  });

  describe('detectAvailableProviders', () => {
    const baseConfig: RAGConfig = {
      enabled: true,
      embeddingProvider: 'auto',
      openaiModel: 'text-embedding-3-small',
      ollamaModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://localhost:11434',
      topK: 5,
      minScore: 0.7,
      includePatterns: [],
      excludePatterns: [],
      autoIndex: true,
      watchFiles: true,
    };

    it('detects OpenAI availability based on API key', async () => {
      delete process.env.OPENAI_API_KEY;
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const providers = await detectAvailableProviders(baseConfig);

      expect(providers.openai).toBe(false);
    });

    it('detects Ollama availability', async () => {
      delete process.env.OPENAI_API_KEY;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          models: [{ name: 'nomic-embed-text:latest' }],
        }),
      });

      const providers = await detectAvailableProviders(baseConfig);

      expect(providers.ollama).toBe(true);
    });

    it('returns both unavailable when neither works', async () => {
      delete process.env.OPENAI_API_KEY;
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const providers = await detectAvailableProviders(baseConfig);

      expect(providers.openai).toBe(false);
      expect(providers.ollama).toBe(false);
    });
  });

  describe('Model Map Integration', () => {
    const baseConfig: RAGConfig = {
      enabled: true,
      embeddingProvider: 'auto',
      openaiModel: 'text-embedding-3-small',
      ollamaModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://localhost:11434',
      topK: 5,
      minScore: 0.7,
      includePatterns: [],
      excludePatterns: [],
      autoIndex: true,
      watchFiles: true,
    };

    it('creates Ollama provider from model map task', () => {
      const modelMap = {
        version: '1',
        models: {
          'nomic-embed-small': {
            provider: 'ollama',
            model: 'nomic-embed-text',
            description: 'Fast embedding model',
            baseUrl: 'http://localhost:11434',
          },
        },
        tasks: {
          embeddings: {
            model: 'nomic-embed-small',
            description: 'Primary embedding task',
          },
        },
      };

      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'modelmap' as const,
      }, modelMap);
      expect(provider.getName()).toBe('Ollama');
      expect(provider.getModel()).toBe('nomic-embed-text');
    });

    it('creates OpenAI provider from model map task', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const modelMap = {
        version: '1',
        models: {
          'openai-embed-small': {
            provider: 'openai',
            model: 'text-embedding-3-small',
            description: 'Fast OpenAI embeddings',
          },
        },
        tasks: {
          embeddings: {
            model: 'openai-embed-small',
            description: 'Primary embedding task',
          },
        },
      };

      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'modelmap' as const,
      }, modelMap);
      expect(provider.getName()).toBe('OpenAI');
      expect(provider.getModel()).toBe('text-embedding-3-small');
    });

    it('throws error when embedding task not found in model map', () => {
      const modelMap = {
        version: '1',
        models: {},
        tasks: {},
      };

      const config = {
        ...baseConfig,
        embeddingProvider: 'modelmap' as const,
        embeddingTask: 'missing-task',
      };

      expect(() => createEmbeddingProvider(config, modelMap)).toThrow(
        /Embedding task 'missing-task' not found in model map/
      );
    });

    it('throws error when model referenced by task not found', () => {
      const modelMap = {
        version: '1',
        models: {},
        tasks: {
          embeddings: {
            model: 'nonexistent-model',
            description: 'Missing model',
          },
        },
      };

      const config = {
        ...baseConfig,
        embeddingProvider: 'modelmap' as const,
        embeddingTask: 'embeddings',
      };

      expect(() => createEmbeddingProvider(config, modelMap)).toThrow(
        /Model 'nonexistent-model' not found in model map/
      );
    });

    it('defaults to embeddings task when no task specified', () => {
      const modelMap = {
        version: '1',
        models: {
          'nomic-embed-small': {
            provider: 'ollama',
            model: 'nomic-embed-text',
            description: 'Fast embedding model',
          },
        },
        tasks: {
          embeddings: {
            model: 'nomic-embed-small',
            description: 'Default embedding task',
          },
        },
      };

      const provider = createEmbeddingProvider(baseConfig, modelMap);
      expect(provider.getModel()).toBe('nomic-embed-text');
    });

    it('uses custom task name when specified', () => {
      const modelMap = {
        version: '1',
        models: {
          'openai-embed-dev': {
            provider: 'openai',
            model: 'text-embedding-3-large',
            description: 'Dev embeddings',
          },
        },
        tasks: {
          embeddings: {
            model: 'some-other-model',
            description: 'Default',
          },
          'embeddings-dev': {
            model: 'openai-embed-dev',
            description: 'Dev embeddings task',
          },
        },
      };

      process.env.OPENAI_API_KEY = 'test-key';

      const provider = createEmbeddingProvider(
        {
          ...baseConfig,
          embeddingProvider: 'modelmap' as const,
          embeddingTask: 'embeddings-dev',
        },
        modelMap
      );

      expect(provider.getModel()).toBe('text-embedding-3-large');
    });

    it('throws error for unsupported provider in model definition', () => {
      const modelDef = {
        provider: 'unsupported-provider',
        model: 'some-model',
      };

      expect(() => createEmbeddingProviderFromModelDef(modelDef)).toThrow(
        /Unsupported embedding provider: unsupported-provider/
      );
    });

    it('ignores model map when provider is not "modelmap"', () => {
      const modelMap = {
        version: '1',
        models: {
          'openai-embed': {
            provider: 'openai',
            model: 'text-embedding-3-large',
          },
        },
        tasks: {
          embeddings: { model: 'openai-embed' },
        },
      };

      process.env.OPENAI_API_KEY = 'test-key';

      // Provider is 'openai' not 'modelmap', should ignore model map
      const provider = createEmbeddingProvider({
        ...baseConfig,
        embeddingProvider: 'openai' as const,
      }, modelMap);

      expect(provider.getModel()).toBe('text-embedding-3-small'); // Uses config default, not model map
    });
  });

  describe('createEmbeddingProviderFromModelDef', () => {
    it('creates Ollama provider with custom baseUrl', () => {
      const modelDef = {
        provider: 'ollama' as const,
        model: 'nomic-embed-text',
        baseUrl: 'http://remote:11434',
      };

      const provider = createEmbeddingProviderFromModelDef(modelDef);
      expect(provider.getName()).toBe('Ollama');
      expect(provider.getModel()).toBe('nomic-embed-text');
    });

    it('creates Ollama-cloud provider', () => {
      const modelDef = {
        provider: 'ollama-cloud' as const,
        model: 'glm-4.7:cloud',
        baseUrl: 'https://api.ollama.ai',
      };

      const provider = createEmbeddingProviderFromModelDef(modelDef);
      expect(provider.getName()).toBe('Ollama');
      expect(provider.getModel()).toBe('glm-4.7:cloud');
    });

    it('uses default baseUrl when not specified in model definition', () => {
      const modelDef = {
        provider: 'ollama' as const,
        model: 'nomic-embed-text',
      };

      const provider = createEmbeddingProviderFromModelDef(modelDef);
      expect(provider.getName()).toBe('Ollama');
      expect(provider.getModel()).toBe('nomic-embed-text');
    });
  });
});
