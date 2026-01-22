// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tool Result Cache
 *
 * Stores full tool results when they are truncated for context management.
 * Allows retrieval via hash/ID for RAG-like lookup.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Cached tool result entry.
 */
export interface CachedToolResult {
  /** Unique hash ID for lookup */
  id: string;
  /** Tool name that produced this result */
  toolName: string;
  /** Tool input (for context) */
  toolInput?: Record<string, unknown>;
  /** Full result content */
  content: string;
  /** Whether result was an error */
  isError: boolean;
  /** Timestamp when cached */
  cachedAt: number;
  /** Summary that was used in place of full content */
  summary: string;
  /** Token estimate of full content */
  estimatedTokens: number;
}

/**
 * Cache metadata stored alongside content.
 */
interface CacheMetadata {
  toolName: string;
  toolInput?: Record<string, unknown>;
  isError: boolean;
  cachedAt: number;
  summary: string;
  estimatedTokens: number;
  contentLength: number;
}

const CACHE_DIR = join(homedir(), '.codi', 'tool-cache');
const MAX_CACHE_SIZE_MB = 100; // Maximum cache size in MB
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastCacheTimestamp = 0;

/**
 * Ensure cache directory exists.
 */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Generate a hash ID for content.
 */
export function generateCacheId(toolName: string, content: string): string {
  const hash = createHash('sha256')
    .update(toolName)
    .update(content)
    .digest('hex')
    .slice(0, 12); // Short hash for readability
  return `${toolName.slice(0, 10)}_${hash}`;
}

/**
 * Store a tool result in the cache.
 */
export function cacheToolResult(
  toolName: string,
  content: string,
  summary: string,
  estimatedTokens: number,
  isError: boolean = false,
  toolInput?: Record<string, unknown>
): string {
  ensureCacheDir();

  let cachedAt = Date.now();
  if (cachedAt <= lastCacheTimestamp) {
    cachedAt = lastCacheTimestamp + 1;
  }
  lastCacheTimestamp = cachedAt;

  const id = generateCacheId(toolName, content);
  const contentPath = join(CACHE_DIR, `${id}.content`);
  const metaPath = join(CACHE_DIR, `${id}.meta.json`);

  // Write content
  writeFileSync(contentPath, content, 'utf-8');

  // Write metadata
  const metadata: CacheMetadata = {
    toolName,
    toolInput,
    isError,
    cachedAt,
    summary,
    estimatedTokens,
    contentLength: content.length,
  };
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

  return id;
}

/**
 * Retrieve a cached tool result by ID.
 */
export function getCachedResult(id: string): CachedToolResult | null {
  const contentPath = join(CACHE_DIR, `${id}.content`);
  const metaPath = join(CACHE_DIR, `${id}.meta.json`);

  if (!existsSync(contentPath) || !existsSync(metaPath)) {
    return null;
  }

  try {
    const content = readFileSync(contentPath, 'utf-8');
    const metadata: CacheMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));

    return {
      id,
      toolName: metadata.toolName,
      toolInput: metadata.toolInput,
      content,
      isError: metadata.isError,
      cachedAt: metadata.cachedAt,
      summary: metadata.summary,
      estimatedTokens: metadata.estimatedTokens,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a cached result exists.
 */
export function hasCachedResult(id: string): boolean {
  const contentPath = join(CACHE_DIR, `${id}.content`);
  return existsSync(contentPath);
}

/**
 * List all cached result IDs with metadata.
 */
export function listCachedResults(): Array<{ id: string; metadata: CacheMetadata }> {
  ensureCacheDir();

  const results: Array<{ id: string; metadata: CacheMetadata }> = [];
  const files = readdirSync(CACHE_DIR);

  for (const file of files) {
    if (file.endsWith('.meta.json')) {
      const id = file.replace('.meta.json', '');
      try {
        const metaPath = join(CACHE_DIR, file);
        const metadata: CacheMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
        results.push({ id, metadata });
      } catch {
        // Skip invalid files
      }
    }
  }

  // Sort by cached time, newest first
  results.sort((a, b) => b.metadata.cachedAt - a.metadata.cachedAt);
  return results;
}

/**
 * Clean up old cache entries.
 */
export function cleanupCache(): { removed: number; freedBytes: number } {
  ensureCacheDir();

  const now = Date.now();
  let removed = 0;
  let freedBytes = 0;

  const files = readdirSync(CACHE_DIR);

  for (const file of files) {
    if (file.endsWith('.meta.json')) {
      const id = file.replace('.meta.json', '');
      const metaPath = join(CACHE_DIR, file);
      const contentPath = join(CACHE_DIR, `${id}.content`);

      try {
        const metadata: CacheMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));

        // Remove old entries
        if (now - metadata.cachedAt > MAX_CACHE_AGE_MS) {
          if (existsSync(contentPath)) {
            freedBytes += statSync(contentPath).size;
            unlinkSync(contentPath);
          }
          freedBytes += statSync(metaPath).size;
          unlinkSync(metaPath);
          removed++;
        }
      } catch {
        // Remove invalid files
        try {
          if (existsSync(contentPath)) unlinkSync(contentPath);
          if (existsSync(metaPath)) unlinkSync(metaPath);
          removed++;
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  return { removed, freedBytes };
}

/**
 * Clear all cached results.
 */
export function clearCache(): number {
  ensureCacheDir();

  let removed = 0;
  const files = readdirSync(CACHE_DIR);

  for (const file of files) {
    try {
      unlinkSync(join(CACHE_DIR, file));
      removed++;
    } catch {
      // Ignore errors
    }
  }

  return removed;
}
