// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  normalizeCase,
  findCanonicalForm,
  stringSimilarity,
  mergeEntityVariants,
  toEntityMap,
  DEFAULT_NORMALIZATION_CONFIG,
} from '../src/entity-normalization.js';
import type { Entity } from '../src/compression.js';

describe('Entity Normalization', () => {
  describe('normalizeCase', () => {
    it('normalizes class names to PascalCase', () => {
      expect(normalizeCase('userService', 'class')).toBe('UserService');
      expect(normalizeCase('user_service', 'class')).toBe('UserService');
      expect(normalizeCase('UserService', 'class')).toBe('UserService');
    });

    it('normalizes function names to camelCase', () => {
      expect(normalizeCase('GetUser', 'function')).toBe('getUser');
      expect(normalizeCase('get_user', 'function')).toBe('getUser');
      expect(normalizeCase('getUser', 'function')).toBe('getUser');
    });

    it('normalizes path separators', () => {
      expect(normalizeCase('src\\services\\auth.ts', 'path')).toBe('src/services/auth.ts');
      expect(normalizeCase('src/services/auth.ts', 'path')).toBe('src/services/auth.ts');
    });

    it('preserves variables as-is', () => {
      expect(normalizeCase('MY_CONSTANT', 'variable')).toBe('MY_CONSTANT');
      expect(normalizeCase('my_variable', 'variable')).toBe('my_variable');
    });
  });

  describe('findCanonicalForm', () => {
    it('finds canonical form for known synonyms', () => {
      expect(findCanonicalForm('auth')).toBe('authentication');
      expect(findCanonicalForm('config')).toBe('configuration');
      expect(findCanonicalForm('db')).toBe('database');
      expect(findCanonicalForm('err')).toBe('error');
    });

    it('returns canonical form if already canonical', () => {
      expect(findCanonicalForm('authentication')).toBe('authentication');
      expect(findCanonicalForm('configuration')).toBe('configuration');
    });

    it('returns null for unknown terms', () => {
      expect(findCanonicalForm('foobar')).toBeNull();
      expect(findCanonicalForm('customThing')).toBeNull();
    });
  });

  describe('stringSimilarity', () => {
    it('returns 1 for identical strings', () => {
      expect(stringSimilarity('hello', 'hello')).toBe(1);
    });

    it('returns high similarity for similar strings', () => {
      expect(stringSimilarity('authentication', 'authenticaton')).toBeGreaterThan(0.9);
      expect(stringSimilarity('UserService', 'userService')).toBeGreaterThan(0.8);
    });

    it('returns low similarity for different strings', () => {
      expect(stringSimilarity('hello', 'world')).toBeLessThan(0.5);
    });

    it('handles empty strings', () => {
      // Two empty strings are considered identical (similarity = 1)
      expect(stringSimilarity('', '')).toBe(1);
      expect(stringSimilarity('hello', '')).toBe(0);
    });
  });

  describe('mergeEntityVariants', () => {
    it('merges case variants', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 3, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'userService', type: 'class', count: 2, firstSeen: 1 }],
      ]);

      const result = mergeEntityVariants(entities);

      // Should be merged into one entity
      expect(result.entities.size).toBe(1);
      expect(result.stats.caseVariantsMerged).toBeGreaterThan(0);

      // Get the merged entity
      const merged = [...result.entities.values()][0];
      expect(merged.count).toBe(5); // 3 + 2
      expect(merged.variants.size).toBe(2);
    });

    it('preserves unique entities', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 3, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'AuthController', type: 'class', count: 2, firstSeen: 1 }],
      ]);

      const result = mergeEntityVariants(entities);

      expect(result.entities.size).toBe(2);
      expect(result.stats.mergedCount).toBe(0);
    });

    it('respects config to disable merging', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 3, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'userService', type: 'class', count: 2, firstSeen: 1 }],
      ]);

      // Need to disable both case variants AND similar names merging
      // since similarity check is case-insensitive
      const result = mergeEntityVariants(entities, {
        ...DEFAULT_NORMALIZATION_CONFIG,
        mergeCaseVariants: false,
        mergeSimilarNames: false,
      });

      expect(result.entities.size).toBe(2);
    });

    it('handles empty entity map', () => {
      const result = mergeEntityVariants(new Map());
      expect(result.entities.size).toBe(0);
      expect(result.stats.originalCount).toBe(0);
    });
  });

  describe('toEntityMap', () => {
    it('converts normalized entities to regular entity map', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 3, firstSeen: 0 }],
      ]);

      const { entities: normalized } = mergeEntityVariants(entities);
      const regular = toEntityMap(normalized);

      expect(regular.size).toBe(1);
      const entity = regular.get('E1');
      expect(entity).toBeDefined();
      expect(entity!.value).toBeDefined();
    });
  });
});
