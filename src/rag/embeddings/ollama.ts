// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ollama Embedding Provider
 *
 * Uses Ollama's local embedding models for generating embeddings.
 */

import { BaseEmbeddingProvider } from './base.js';

/**
 * Model dimensions for common Ollama embedding models.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'snowflake-arctic-embed': 1024,
};

/**
 * Response from Ollama embeddings API.
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Ollama embedding provider implementation.
 */
export class OllamaEmbeddingProvider extends BaseEmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimensions: number | null = null;

  constructor(
    model: string = 'nomic-embed-text',
    baseUrl: string = 'http://localhost:11434'
  ) {
    super();
    this.model = model;
    this.baseUrl = baseUrl;
  }

  getName(): string {
    return 'Ollama';
  }

  getModel(): string {
    return this.model;
  }

  getDimensions(): number {
    // Return cached dimensions if we've detected them
    if (this.dimensions !== null) {
      return this.dimensions;
    }
    // Return known dimensions or default
    return MODEL_DIMENSIONS[this.model] || 768;
  }

  /**
   * Embed a single text and return its embedding.
   */
  private async embedSingle(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama embedding request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as OllamaEmbeddingResponse;

    // Cache the dimensions from the first successful response
    if (this.dimensions === null && data.embedding) {
      this.dimensions = data.embedding.length;
    }

    return data.embedding;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Ollama's /api/embeddings endpoint only supports single prompts
    // so we use parallel requests with a concurrency limit to improve throughput
    const BATCH_SIZE = 5; // Limit concurrent requests to avoid overwhelming Ollama
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((text) => this.embedSingle(text))
      );
      embeddings.push(...batchResults);
    }

    return embeddings;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });

      if (!response.ok) {
        return false;
      }

      // Check if the model is available
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models || [];
      const hasModel = models.some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`)
      );

      if (!hasModel) {
        // Model not found, try to pull it might take too long
        // Just return false for now
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}
