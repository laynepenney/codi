// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';

interface CacheEntry {
  content: string;
  mtime: number;
  accessTime: number;
}

/**
 * LRU cache for file contents with mtime-based invalidation.
 * Used to avoid redundant file reads during multi-operation edits.
 */
class FileContentCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize = 20) {
    this.maxSize = maxSize;
  }

  /**
   * Get file content from cache or read from disk.
   * Validates cache entry against current file mtime.
   */
  async get(path: string): Promise<string> {
    if (!existsSync(path)) {
      this.cache.delete(path);
      throw new Error(`File not found: ${path}`);
    }

    const fileStat = await stat(path);
    const currentMtime = fileStat.mtimeMs;

    const cached = this.cache.get(path);
    if (cached && cached.mtime === currentMtime) {
      // Update access time for LRU tracking
      cached.accessTime = Date.now();
      return cached.content;
    }

    // Read fresh content
    const content = await readFile(path, 'utf-8');

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    // Store in cache
    this.cache.set(path, {
      content,
      mtime: currentMtime,
      accessTime: Date.now(),
    });

    return content;
  }

  /**
   * Invalidate cache entry for a path.
   * Should be called after writing to a file.
   */
  invalidate(path: string): void {
    this.cache.delete(path);
  }

  /**
   * Invalidate all cache entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  private evictOldest(): void {
    let oldestPath: string | null = null;
    let oldestTime = Infinity;

    for (const [path, entry] of this.cache) {
      if (entry.accessTime < oldestTime) {
        oldestTime = entry.accessTime;
        oldestPath = path;
      }
    }

    if (oldestPath) {
      this.cache.delete(oldestPath);
    }
  }
}

// Singleton instance for shared use across tools
export const fileContentCache = new FileContentCache();

// Export class for testing
export { FileContentCache };
