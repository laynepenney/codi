// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Base Embedding Provider
 *
 * Abstract class that all embedding providers must implement.
 */

import { createHash } from 'crypto';

/**
 * Simple hash function for cache keys.
 */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Embedding cache entry with TTL.
 */
interface EmbeddingCacheEntry {
  embedding: number[];
  timestamp: number;
}

/**
 * In-memory LRU cache for embeddings with TTL.
 */
class EmbeddingCache {
  private cache = new Map<string, EmbeddingCacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 1000, ttlMinutes = 60) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  get(key: string): number[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.embedding;
  }

  set(key: string, embedding: number[]): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Shared cache instance across all providers
const embeddingCache = new EmbeddingCache();

/**
 * Abstract base class for embedding providers.
 */
export abstract class BaseEmbeddingProvider {
  /**
   * Get the provider name (e.g., "OpenAI", "Ollama").
   */
  abstract getName(): string;

  /**
   * Get the model name being used.
   */
  abstract getModel(): string;

  /**
   * Get the embedding vector dimensions.
   */
  abstract getDimensions(): number;

  /**
   * Generate embeddings for multiple texts.
   * @param texts - Array of text strings to embed
   * @returns Array of embedding vectors (number arrays)
   */
  abstract embed(texts: string[]): Promise<number[][]>;

  /**
   * Generate embedding for a single text with caching.
   * @param text - Text string to embed
   * @returns Embedding vector
   */
  async embedOne(text: string): Promise<number[]> {
    // Generate cache key based on provider, model, and text hash
    const cacheKey = `${this.getName()}:${this.getModel()}:${hashText(text)}`;

    // Check cache first
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Generate embedding
    const results = await this.embed([text]);
    const embedding = results[0];

    // Cache the result
    embeddingCache.set(cacheKey, embedding);

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts with caching.
   * @param texts - Array of text strings to embed
   * @returns Array of embedding vectors
   */
  async embedWithCache(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const cacheKey = `${this.getName()}:${this.getModel()}:${hashText(texts[i])}`;
      const cached = embeddingCache.get(cacheKey);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // Embed uncached texts
    if (uncachedTexts.length > 0) {
      const newEmbeddings = await this.embed(uncachedTexts);

      // Cache new embeddings and fill results
      for (let j = 0; j < uncachedIndices.length; j++) {
        const i = uncachedIndices[j];
        const embedding = newEmbeddings[j];
        results[i] = embedding;

        const cacheKey = `${this.getName()}:${this.getModel()}:${hashText(texts[i])}`;
        embeddingCache.set(cacheKey, embedding);
      }
    }

    return results as number[][];
  }

  /**
   * Check if the provider is available and properly configured.
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get embedding cache statistics.
   */
  static getCacheStats(): { size: number } {
    return { size: embeddingCache.size };
  }

  /**
   * Clear the embedding cache.
   */
  static clearCache(): void {
    embeddingCache.clear();
  }
}
