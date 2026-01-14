// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's text-embedding models for generating embeddings.
 */

import OpenAI from 'openai';
import { BaseEmbeddingProvider } from './base.js';

/**
 * Model dimensions for OpenAI embedding models.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * OpenAI embedding provider implementation.
 */
export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(model: string = 'text-embedding-3-small') {
    super();
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = model;
  }

  getName(): string {
    return 'OpenAI';
  }

  getModel(): string {
    return this.model;
  }

  getDimensions(): number {
    return MODEL_DIMENSIONS[this.model] || 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // OpenAI has a limit on batch size, process in chunks if needed
    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
      });

      // Sort by index to maintain order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sorted.map((d) => d.embedding));
    }

    return allEmbeddings;
  }

  async isAvailable(): Promise<boolean> {
    if (!process.env.OPENAI_API_KEY) {
      return false;
    }

    try {
      // Make a minimal request to verify the API key works
      await this.client.embeddings.create({
        model: this.model,
        input: 'test',
      });
      return true;
    } catch {
      return false;
    }
  }
}
