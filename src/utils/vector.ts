// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Vector utilities for embedding-based operations.
 */

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Group items by semantic similarity using embeddings.
 * Items with similarity > threshold are grouped together.
 * Returns array of groups, each containing indices of similar items.
 */
export function groupBySimilarity(
  embeddings: number[][],
  threshold: number = 0.85
): number[][] {
  const n = embeddings.length;
  const assigned = new Set<number>();
  const groups: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (assigned.has(i)) continue;

    const group = [i];
    assigned.add(i);

    for (let j = i + 1; j < n; j++) {
      if (assigned.has(j)) continue;

      const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
      if (similarity >= threshold) {
        group.push(j);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}
