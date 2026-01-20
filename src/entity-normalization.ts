// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Entity Normalization for Semantic Deduplication
 *
 * Merges case variants and semantically similar entities to improve compression.
 * - UserService + userService + user_service -> UserService
 * - auth + authentication -> authentication
 */

import type { Entity, EntityType } from './compression.js';

/**
 * A normalized entity that may represent multiple variants.
 */
export interface NormalizedEntity {
  id: string;
  canonical: string;      // The normalized/canonical form
  variants: Set<string>;  // All original values that were merged
  type: EntityType;
  count: number;          // Combined count across all variants
  firstSeen: number;
}

/**
 * Configuration for entity normalization.
 */
export interface NormalizationConfig {
  mergeCaseVariants: boolean;    // Merge case variants (UserService, userService)
  mergeSimilarNames: boolean;    // Merge semantic synonyms (auth, authentication)
  minSimilarityScore: number;    // 0-1 threshold for Levenshtein similarity
}

/**
 * Default normalization configuration.
 */
export const DEFAULT_NORMALIZATION_CONFIG: NormalizationConfig = {
  mergeCaseVariants: true,
  mergeSimilarNames: true,
  minSimilarityScore: 0.8,
};

/**
 * Common code synonyms for semantic merging.
 * Maps short forms to their canonical (usually longer) form.
 */
const SEMANTIC_SYNONYMS: Map<string, string> = new Map([
  // Authentication
  ['auth', 'authentication'],
  ['authn', 'authentication'],
  ['authz', 'authorization'],
  ['authorize', 'authorization'],

  // Configuration
  ['config', 'configuration'],
  ['cfg', 'configuration'],
  ['conf', 'configuration'],
  ['settings', 'configuration'],
  ['opts', 'options'],

  // Database
  ['db', 'database'],
  ['datastore', 'database'],

  // Messages
  ['msg', 'message'],
  ['msgs', 'messages'],

  // Errors
  ['err', 'error'],
  ['errs', 'errors'],

  // Requests/Responses
  ['req', 'request'],
  ['reqs', 'requests'],
  ['res', 'response'],
  ['resp', 'response'],

  // Utilities
  ['util', 'utility'],
  ['utils', 'utilities'],
  ['helpers', 'utilities'],

  // Common abbreviations
  ['init', 'initialize'],
  ['params', 'parameters'],
  ['args', 'arguments'],
  ['ctx', 'context'],
  ['env', 'environment'],
  ['info', 'information'],
  ['mgr', 'manager'],
  ['svc', 'service'],
  ['repo', 'repository'],
  ['impl', 'implementation'],
]);

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate string similarity (0-1) based on Levenshtein distance.
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * Convert a string to PascalCase.
 */
function toPascalCase(str: string): string {
  return str
    // Handle snake_case and kebab-case
    .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    // Ensure first letter is uppercase
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}

/**
 * Convert a string to camelCase.
 */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Normalize case for an entity based on its type.
 */
export function normalizeCase(value: string, type: EntityType): string {
  switch (type) {
    case 'path':
      // Normalize path separators, but preserve case for paths
      return value.replace(/\\/g, '/');

    case 'url':
      // URLs are case-sensitive in path, normalize protocol only
      return value.replace(/^HTTPS?:/i, (match) => match.toLowerCase());

    case 'class':
      // Classes should be PascalCase
      return toPascalCase(value);

    case 'function':
      // Functions should be camelCase
      return toCamelCase(value);

    case 'variable':
      // Keep original case for variables (SCREAMING_SNAKE or snake_case)
      return value;

    case 'import':
      // Imports are case-sensitive, keep as-is
      return value;

    default:
      return value;
  }
}

/**
 * Find the canonical form for a value using semantic synonyms.
 */
export function findCanonicalForm(value: string): string | null {
  const lower = value.toLowerCase();

  // Check if it's a known synonym
  const canonical = SEMANTIC_SYNONYMS.get(lower);
  if (canonical) {
    return canonical;
  }

  // Check if it's already a canonical form
  for (const [, canonicalForm] of SEMANTIC_SYNONYMS) {
    if (lower === canonicalForm) {
      return canonicalForm;
    }
  }

  return null;
}

/**
 * Extract the base name from an entity value for comparison.
 * Removes common suffixes like Service, Controller, etc.
 */
function extractBaseName(value: string): string {
  return value
    .replace(/(?:Service|Controller|Handler|Manager|Factory|Provider|Repository|Component|Module|Helper|Util|Client|Server|Worker|Processor|Builder|Adapter|Wrapper|Interface|Base|Abstract|Impl)$/i, '')
    .toLowerCase();
}

/**
 * Group entities by their normalized form.
 */
function groupByNormalizedForm(
  entities: Map<string, Entity>,
  config: NormalizationConfig
): Map<string, Entity[]> {
  const groups = new Map<string, Entity[]>();

  for (const entity of entities.values()) {
    let key: string;

    if (config.mergeCaseVariants) {
      // Use case-normalized form as key
      key = normalizeCase(entity.value, entity.type).toLowerCase();
    } else {
      key = entity.value;
    }

    // Also check for semantic synonyms
    if (config.mergeSimilarNames) {
      const baseName = extractBaseName(entity.value);
      const canonical = findCanonicalForm(baseName);
      if (canonical) {
        key = canonical;
      }
    }

    const group = groups.get(key) || [];
    group.push(entity);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Find similar entities using Levenshtein distance.
 */
function findSimilarGroups(
  groups: Map<string, Entity[]>,
  minSimilarity: number
): Map<string, string[]> {
  const mergeMap = new Map<string, string[]>();
  const keys = [...groups.keys()];
  const merged = new Set<string>();

  for (let i = 0; i < keys.length; i++) {
    if (merged.has(keys[i])) continue;

    const similar: string[] = [keys[i]];

    for (let j = i + 1; j < keys.length; j++) {
      if (merged.has(keys[j])) continue;

      const similarity = stringSimilarity(keys[i], keys[j]);
      if (similarity >= minSimilarity) {
        similar.push(keys[j]);
        merged.add(keys[j]);
      }
    }

    if (similar.length > 1) {
      // Use the longest key as the canonical form
      const canonical = similar.reduce((a, b) => a.length >= b.length ? a : b);
      mergeMap.set(canonical, similar);
    }
  }

  return mergeMap;
}

/**
 * Merge entity variants into normalized entities.
 */
export function mergeEntityVariants(
  entities: Map<string, Entity>,
  config: NormalizationConfig = DEFAULT_NORMALIZATION_CONFIG
): { entities: Map<string, NormalizedEntity>; stats: DeduplicationStats } {
  const stats: DeduplicationStats = {
    originalCount: entities.size,
    mergedCount: 0,
    caseVariantsMerged: 0,
    semanticMerged: 0,
  };

  if (entities.size === 0) {
    return { entities: new Map(), stats };
  }

  // Group by normalized form
  const groups = groupByNormalizedForm(entities, config);

  // Find similar groups to merge
  let mergeMap = new Map<string, string[]>();
  if (config.mergeSimilarNames) {
    mergeMap = findSimilarGroups(groups, config.minSimilarityScore);
  }

  // Build final normalized entities
  const normalized = new Map<string, NormalizedEntity>();
  let id = 1;
  const processed = new Set<string>();

  for (const [key, entityList] of groups) {
    if (processed.has(key)) continue;

    // Check if this key should be merged with others
    let allEntities = [...entityList];
    let keysToMerge = [key];

    for (const [canonical, similar] of mergeMap) {
      if (similar.includes(key)) {
        keysToMerge = similar;
        // Collect all entities from similar groups
        for (const similarKey of similar) {
          if (similarKey !== key && groups.has(similarKey)) {
            allEntities = allEntities.concat(groups.get(similarKey)!);
            processed.add(similarKey);
          }
        }
        break;
      }
    }

    processed.add(key);

    // Calculate combined stats
    const totalCount = allEntities.reduce((sum, e) => sum + e.count, 0);
    const firstSeen = Math.min(...allEntities.map(e => e.firstSeen));
    const variants = new Set(allEntities.map(e => e.value));

    // Choose canonical form (longest, or PascalCase for classes)
    let canonical = allEntities[0].value;
    for (const entity of allEntities) {
      if (entity.value.length > canonical.length) {
        canonical = entity.value;
      }
    }

    // Apply case normalization to canonical form
    const type = allEntities[0].type;
    canonical = normalizeCase(canonical, type);

    // Track merge stats
    if (allEntities.length > 1) {
      stats.mergedCount++;
      if (keysToMerge.length > 1) {
        stats.semanticMerged++;
      } else {
        stats.caseVariantsMerged++;
      }
    }

    normalized.set(`E${id}`, {
      id: `E${id}`,
      canonical,
      variants,
      type,
      count: totalCount,
      firstSeen,
    });

    id++;
  }

  return { entities: normalized, stats };
}

/**
 * Statistics about deduplication.
 */
export interface DeduplicationStats {
  originalCount: number;      // Original entity count
  mergedCount: number;        // Number of merge operations
  caseVariantsMerged: number; // Merged due to case differences
  semanticMerged: number;     // Merged due to semantic similarity
}

/**
 * Convert normalized entities back to regular entities for compression.
 * Uses the canonical form as the value.
 */
export function toEntityMap(normalized: Map<string, NormalizedEntity>): Map<string, Entity> {
  const entities = new Map<string, Entity>();

  for (const [id, norm] of normalized) {
    entities.set(id, {
      id,
      value: norm.canonical,
      type: norm.type,
      count: norm.count,
      firstSeen: norm.firstSeen,
    });
  }

  return entities;
}
