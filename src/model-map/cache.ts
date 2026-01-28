// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Result Caching for Pipeline Execution
 *
 * Caches analysis results based on file content hash to enable
 * fast incremental re-runs when files haven't changed.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { CodiPaths } from '../paths.js';

/**
 * Cached result structure
 */
export interface CachedResult {
  /** Content hash that was used as key */
  contentHash: string;
  /** Task/pipeline ID this result is for */
  taskId: string;
  /** The cached output */
  output: string;
  /** When this was cached */
  cachedAt: number;
  /** Model that produced this result */
  model?: string;
  /** Cache version for invalidation */
  version: number;
}

/**
 * Cache configuration
 */
export interface CacheOptions {
  /** Cache directory (default: ~/.codi/cache/pipeline) */
  directory?: string;
  /** Maximum age of cache entries in seconds (default: 7 days) */
  maxAge?: number;
  /** Maximum number of entries (default: 1000) */
  maxEntries?: number;
  /** Cache version for invalidation (default: 1) */
  version?: number;
}

/** Current cache version - increment to invalidate all caches */
const CACHE_VERSION = 1;

/**
 * Pipeline Result Cache
 */
export class PipelineCache {
  private readonly directory: string;
  private readonly maxAge: number;
  private readonly maxEntries: number;
  private readonly version: number;

  constructor(options: CacheOptions = {}) {
    this.directory = options.directory || CodiPaths.pipelineCache();
    this.maxAge = (options.maxAge ?? 7 * 24 * 60 * 60) * 1000; // Convert to ms
    this.maxEntries = options.maxEntries ?? 1000;
    this.version = options.version ?? CACHE_VERSION;

    // Ensure cache directory exists
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true });
    }
  }

  /**
   * Generate a cache key from file path and content
   */
  generateKey(filePath: string, fileContent: string, taskId: string): string {
    const hash = createHash('sha256')
      .update(fileContent)
      .update(taskId)
      .update(String(this.version))
      .digest('hex')
      .slice(0, 16);

    // Include file basename for readability
    const name = basename(filePath).replace(/\.[^.]+$/, '');
    return `${name}-${hash}`;
  }

  /**
   * Get a cached result if available and valid
   */
  get(key: string): CachedResult | null {
    const filePath = this.getCachePath(key);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const cached: CachedResult = JSON.parse(content);

      // Check version
      if (cached.version !== this.version) {
        this.delete(key);
        return null;
      }

      // Check age
      const age = Date.now() - cached.cachedAt;
      if (age > this.maxAge) {
        this.delete(key);
        return null;
      }

      return cached;
    } catch {
      // Corrupted cache entry
      this.delete(key);
      return null;
    }
  }

  /**
   * Store a result in the cache
   */
  set(key: string, result: Omit<CachedResult, 'cachedAt' | 'version'>): void {
    const cached: CachedResult = {
      ...result,
      cachedAt: Date.now(),
      version: this.version,
    };

    const filePath = this.getCachePath(key);
    writeFileSync(filePath, JSON.stringify(cached, null, 2));

    // Prune if needed
    this.pruneIfNeeded();
  }

  /**
   * Delete a cache entry
   */
  delete(key: string): void {
    const filePath = this.getCachePath(key);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    if (existsSync(this.directory)) {
      const entries = readdirSync(this.directory);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          try {
            unlinkSync(join(this.directory, entry));
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { entries: number; sizeBytes: number; oldestEntry: number | null } {
    if (!existsSync(this.directory)) {
      return { entries: 0, sizeBytes: 0, oldestEntry: null };
    }

    const entries = readdirSync(this.directory).filter((e) => e.endsWith('.json'));
    let sizeBytes = 0;
    let oldestEntry: number | null = null;

    for (const entry of entries) {
      try {
        const stats = statSync(join(this.directory, entry));
        sizeBytes += stats.size;
        if (oldestEntry === null || stats.mtimeMs < oldestEntry) {
          oldestEntry = stats.mtimeMs;
        }
      } catch {
        // Ignore stat errors
      }
    }

    return { entries: entries.length, sizeBytes, oldestEntry };
  }

  /**
   * Get the file path for a cache key
   */
  private getCachePath(key: string): string {
    return join(this.directory, `${key}.json`);
  }

  /**
   * Prune cache if it exceeds limits
   */
  private pruneIfNeeded(): void {
    if (!existsSync(this.directory)) {
      return;
    }

    const entries = readdirSync(this.directory)
      .filter((e) => e.endsWith('.json'))
      .map((e) => {
        try {
          const stats = statSync(join(this.directory, e));
          return { name: e, mtime: stats.mtimeMs };
        } catch {
          return { name: e, mtime: 0 };
        }
      })
      .sort((a, b) => a.mtime - b.mtime); // Oldest first

    // Remove oldest entries if over limit
    if (entries.length > this.maxEntries) {
      const toRemove = entries.slice(0, entries.length - this.maxEntries);
      for (const entry of toRemove) {
        try {
          unlinkSync(join(this.directory, entry.name));
        } catch {
          // Ignore
        }
      }
    }
  }
}

/**
 * Global cache instance
 */
let globalCache: PipelineCache | null = null;

/**
 * Get or create the global pipeline cache
 */
export function getCache(options?: CacheOptions): PipelineCache {
  if (!globalCache) {
    globalCache = new PipelineCache(options);
  }
  return globalCache;
}

/**
 * Compute content hash for a file
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Check if cached result can be reused for a file
 */
export function getCachedResult(
  filePath: string,
  fileContent: string,
  taskId: string,
  cache?: PipelineCache
): CachedResult | null {
  const cacheInstance = cache || getCache();
  const key = cacheInstance.generateKey(filePath, fileContent, taskId);
  return cacheInstance.get(key);
}

/**
 * Store result in cache
 */
export function cacheResult(
  filePath: string,
  fileContent: string,
  taskId: string,
  output: string,
  model?: string,
  cache?: PipelineCache
): void {
  const cacheInstance = cache || getCache();
  const key = cacheInstance.generateKey(filePath, fileContent, taskId);
  const contentHash = computeContentHash(fileContent);

  cacheInstance.set(key, {
    contentHash,
    taskId,
    output,
    model,
  });
}
