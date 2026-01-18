// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getOllamaModelInfo,
  getOllamaContextWindow,
  ollamaSupportsTools,
  clearOllamaModelInfoCache,
} from '../src/providers/ollama-model-info.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ollama-model-info', () => {
  beforeEach(() => {
    clearOllamaModelInfoCache();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOllamaModelInfo', () => {
    it('returns model info with context window from /api/show', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: {
            'llama.context_length': 131072,
          },
          capabilities: ['completion', 'tools'],
          details: {
            family: 'llama',
            parameter_size: '8B',
            quantization_level: 'Q4_K_M',
          },
        }),
      });

      const info = await getOllamaModelInfo('llama3.2', 'http://localhost:11434');

      expect(info).not.toBeNull();
      expect(info?.contextWindow).toBe(131072);
      expect(info?.architecture).toBe('llama');
      expect(info?.capabilities).toContain('tools');
      expect(info?.parameterSize).toBe('8B');
      expect(info?.quantization).toBe('Q4_K_M');
    });

    it('caches results for repeated calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'qwen.context_length': 32768 },
          capabilities: [],
        }),
      });

      // First call - hits API
      const info1 = await getOllamaModelInfo('qwen:8b', 'http://localhost:11434');
      expect(info1?.contextWindow).toBe(32768);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const info2 = await getOllamaModelInfo('qwen:8b', 'http://localhost:11434');
      expect(info2?.contextWindow).toBe(32768);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional calls
    });

    it('caches by baseUrl and modelName', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'llama.context_length': 8192 },
          capabilities: [],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'llama.context_length': 16384 },
          capabilities: [],
        }),
      });

      // Same model, different base URLs
      const info1 = await getOllamaModelInfo('llama3.2', 'http://localhost:11434');
      const info2 = await getOllamaModelInfo('llama3.2', 'http://remote:11434');

      expect(info1?.contextWindow).toBe(8192);
      expect(info2?.contextWindow).toBe(16384);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns null and caches failure for non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const info1 = await getOllamaModelInfo('nonexistent', 'http://localhost:11434');
      expect(info1).toBeNull();

      // Second call should not retry
      const info2 = await getOllamaModelInfo('nonexistent', 'http://localhost:11434');
      expect(info2).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns null and caches failure for network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const info1 = await getOllamaModelInfo('llama3.2', 'http://localhost:11434');
      expect(info1).toBeNull();

      // Second call should not retry
      const info2 = await getOllamaModelInfo('llama3.2', 'http://localhost:11434');
      expect(info2).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('defaults to 8192 context window if not found in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: {},
          capabilities: [],
        }),
      });

      const info = await getOllamaModelInfo('unknown', 'http://localhost:11434');
      expect(info?.contextWindow).toBe(8192);
      expect(info?.architecture).toBe('unknown');
    });
  });

  describe('getOllamaContextWindow', () => {
    it('returns context window from model info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'mistral.context_length': 65536 },
          capabilities: [],
        }),
      });

      const contextWindow = await getOllamaContextWindow('mistral', 'http://localhost:11434');
      expect(contextWindow).toBe(65536);
    });

    it('returns default value on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const contextWindow = await getOllamaContextWindow('llama3.2', 'http://localhost:11434', 16384);
      expect(contextWindow).toBe(16384);
    });
  });

  describe('ollamaSupportsTools', () => {
    it('returns true if model has tools capability', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'llama.context_length': 8192 },
          capabilities: ['completion', 'tools'],
        }),
      });

      const supportsTools = await ollamaSupportsTools('llama3.2');
      expect(supportsTools).toBe(true);
    });

    it('returns false if model lacks tools capability', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'llama.context_length': 8192 },
          capabilities: ['completion'],
        }),
      });

      const supportsTools = await ollamaSupportsTools('llama3.2');
      expect(supportsTools).toBe(false);
    });

    it('returns false on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const supportsTools = await ollamaSupportsTools('llama3.2');
      expect(supportsTools).toBe(false);
    });
  });

  describe('clearOllamaModelInfoCache', () => {
    it('clears both caches allowing fresh fetches', async () => {
      // First call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'llama.context_length': 8192 },
          capabilities: [],
        }),
      });

      await getOllamaModelInfo('llama3.2', 'http://localhost:11434');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Clear cache
      clearOllamaModelInfoCache();

      // Now should fetch again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'llama.context_length': 16384 },
          capabilities: [],
        }),
      });

      const info = await getOllamaModelInfo('llama3.2', 'http://localhost:11434');
      expect(info?.contextWindow).toBe(16384);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('clears failed lookup cache allowing retry', async () => {
      // First call fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await getOllamaModelInfo('llama3.2', 'http://localhost:11434');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Clear cache
      clearOllamaModelInfoCache();

      // Now should retry
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_info: { 'llama.context_length': 8192 },
          capabilities: [],
        }),
      });

      const info = await getOllamaModelInfo('llama3.2', 'http://localhost:11434');
      expect(info?.contextWindow).toBe(8192);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
