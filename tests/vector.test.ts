// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { cosineSimilarity, groupBySimilarity } from '../src/utils/vector.js';

describe('Vector Utilities', () => {
  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('returns -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it('returns 0 for mismatched lengths', () => {
      const a = [1, 0, 0];
      const b = [1, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('returns 0 for zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('calculates similarity for non-unit vectors', () => {
      const a = [2, 0, 0];
      const b = [3, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it('calculates partial similarity', () => {
      const a = [1, 1, 0];
      const b = [1, 0, 0];
      // cos(45°) ≈ 0.707
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.707, 2);
    });
  });

  describe('groupBySimilarity', () => {
    it('groups identical embeddings together', () => {
      const embeddings = [
        [1, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ];
      const groups = groupBySimilarity(embeddings, 0.99);
      // First two should be grouped, third separate
      expect(groups.length).toBe(2);
      expect(groups.some(g => g.includes(0) && g.includes(1))).toBe(true);
      expect(groups.some(g => g.includes(2) && g.length === 1)).toBe(true);
    });

    it('returns each item in its own group when all different', () => {
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const groups = groupBySimilarity(embeddings, 0.9);
      expect(groups.length).toBe(3);
    });

    it('groups similar embeddings based on threshold', () => {
      const embeddings = [
        [1, 0, 0],
        [0.99, 0.1, 0], // Very similar to first
        [0, 1, 0],
        [0.1, 0.99, 0], // Very similar to third
      ];
      const groups = groupBySimilarity(embeddings, 0.9);
      expect(groups.length).toBe(2);
    });

    it('handles empty input', () => {
      const groups = groupBySimilarity([]);
      expect(groups).toEqual([]);
    });

    it('handles single embedding', () => {
      const groups = groupBySimilarity([[1, 0, 0]]);
      expect(groups).toEqual([[0]]);
    });

    it('uses default threshold of 0.85', () => {
      const embeddings = [
        [1, 0, 0],
        [0.9, 0.4, 0], // similarity ~0.9, should be grouped with default 0.85
        [0, 1, 0],
      ];
      const groups = groupBySimilarity(embeddings);
      expect(groups.length).toBe(2);
    });
  });
});
