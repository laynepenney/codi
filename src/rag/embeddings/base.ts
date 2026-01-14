// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Base Embedding Provider
 *
 * Abstract class that all embedding providers must implement.
 */

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
   * Generate embedding for a single text.
   * @param text - Text string to embed
   * @returns Embedding vector
   */
  async embedOne(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }

  /**
   * Check if the provider is available and properly configured.
   */
  abstract isAvailable(): Promise<boolean>;
}
