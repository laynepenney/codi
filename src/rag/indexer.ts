// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Background Indexer
 *
 * Indexes project files in the background with file watching support.
 * Features:
 * - Parallel processing with configurable concurrency
 * - Incremental indexing (only re-indexes changed files)
 * - Persistent cache of file modification times
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { glob } from 'glob';
import type {
  RAGConfig,
  IndexStats,
  IndexProgressCallback,
  IndexCompleteCallback,
  IndexErrorCallback,
} from './types.js';
import type { BaseEmbeddingProvider } from './embeddings/base.js';
import { VectorStore } from './vector-store.js';
import { CodeChunker } from './chunker.js';

/** Default number of parallel indexing jobs */
const DEFAULT_PARALLEL_JOBS = 4;

/** Maximum parallel jobs allowed */
const MAX_PARALLEL_JOBS = 16;

/** File metadata for incremental indexing */
interface FileMetadata {
  mtime: number;
  size: number;
}

/** Cached index state */
interface IndexCache {
  files: Record<string, FileMetadata>;
  lastIndexed: string | null;
}

/**
 * Background indexer with file watching.
 */
export class BackgroundIndexer {
  private config: RAGConfig;
  private embeddingProvider: BaseEmbeddingProvider;
  private vectorStore: VectorStore;
  private chunker: CodeChunker;
  private projectPath: string;
  private watcher: fs.FSWatcher | null = null;
  private isIndexing: boolean = false;
  private indexQueue: Set<string> = new Set();
  private queueTimeout: NodeJS.Timeout | null = null;
  private lastIndexed: Date | null = null;
  private totalFiles: number = 0;
  private totalChunks: number = 0;
  private initialized: boolean = false;
  private indexedFiles: Map<string, FileMetadata> = new Map();
  private cacheFilePath: string;
  private parallelJobs: number = DEFAULT_PARALLEL_JOBS;

  /** Progress callback */
  onProgress: IndexProgressCallback | null = null;
  /** Completion callback */
  onComplete: IndexCompleteCallback | null = null;
  /** Error callback */
  onError: IndexErrorCallback | null = null;

  constructor(
    projectPath: string,
    embeddingProvider: BaseEmbeddingProvider,
    config: RAGConfig
  ) {
    this.projectPath = projectPath;
    this.embeddingProvider = embeddingProvider;
    this.config = config;
    this.vectorStore = new VectorStore(projectPath);
    this.chunker = new CodeChunker({
      maxChunkSize: config.maxChunkSize * 4, // Approximate chars from tokens
      chunkOverlap: config.chunkOverlap * 4,
    });

    // Set up cache file in the same location as the vector store
    const indexDir = this.vectorStore.getPath();
    this.cacheFilePath = path.join(path.dirname(indexDir), path.basename(indexDir) + '-cache.json');

    // Set parallel jobs from config or default
    this.parallelJobs = Math.min(
      Math.max(1, config.parallelJobs ?? DEFAULT_PARALLEL_JOBS),
      MAX_PARALLEL_JOBS
    );
  }

  /**
   * Initialize the indexer.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vectorStore.initialize();
    this.loadCache();
    this.initialized = true;

    if (this.config.watchFiles) {
      this.startWatching();
    }

    if (this.config.autoIndex) {
      // Start indexing in the background (don't await)
      this.indexAll().catch((err) => {
        this.onError?.(err);
      });
    }
  }

  /**
   * Load the index cache from disk.
   */
  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const data = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const cache: IndexCache = JSON.parse(data);

        // Restore indexed files map
        for (const [filePath, metadata] of Object.entries(cache.files)) {
          this.indexedFiles.set(filePath, metadata);
        }

        // Restore last indexed time
        if (cache.lastIndexed) {
          this.lastIndexed = new Date(cache.lastIndexed);
        }

        this.totalFiles = this.indexedFiles.size;
      }
    } catch (err) {
      // Cache is corrupted or missing, start fresh
      this.indexedFiles.clear();
    }
  }

  /**
   * Save the index cache to disk.
   */
  private saveCache(): void {
    try {
      const cache: IndexCache = {
        files: Object.fromEntries(this.indexedFiles),
        lastIndexed: this.lastIndexed?.toISOString() ?? null,
      };
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(cache, null, 2));
    } catch (err) {
      // Ignore cache save errors
    }
  }

  /**
   * Check if a file needs to be re-indexed.
   */
  private needsReindex(filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      const cached = this.indexedFiles.get(filePath);

      if (!cached) {
        return true; // New file
      }

      // Check if file has been modified
      return stat.mtimeMs !== cached.mtime || stat.size !== cached.size;
    } catch {
      return true; // File might not exist, let indexFile handle it
    }
  }

  /**
   * Update the cache for a file.
   */
  private updateFileCache(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      this.indexedFiles.set(filePath, {
        mtime: stat.mtimeMs,
        size: stat.size,
      });
    } catch {
      // File might have been deleted
    }
  }

  /**
   * Index all matching files in the project.
   * Uses parallel processing for embedding generation, sequential writes to vector store.
   */
  async indexAll(): Promise<IndexStats> {
    if (this.isIndexing) {
      throw new Error('Indexing already in progress');
    }

    this.isIndexing = true;

    try {
      // Check if index was repaired (empty but cache has files)
      // If so, clear the cache to force re-indexing
      const storeStats = await this.vectorStore.getStats();
      if (storeStats.itemCount === 0 && this.indexedFiles.size > 0) {
        this.indexedFiles.clear();
        this.totalChunks = 0;
      }

      const allFiles = await this.findFilesToIndex();

      // Filter to only files that need re-indexing
      const filesToIndex = allFiles.filter((file) => this.needsReindex(file));

      // Also remove files from cache that no longer exist
      const allFilesSet = new Set(allFiles);
      for (const cachedFile of this.indexedFiles.keys()) {
        if (!allFilesSet.has(cachedFile)) {
          this.indexedFiles.delete(cachedFile);
          // Remove from vector store (sequential)
          await this.vectorStore.deleteByFile(cachedFile);
        }
      }

      this.totalFiles = allFiles.length;

      if (filesToIndex.length === 0) {
        // Nothing to index, everything is cached
        this.lastIndexed = new Date();
        const stats = await this.getStats();
        this.onComplete?.(stats);
        return stats;
      }

      let processed = 0;

      // Process files in parallel batches for embedding generation
      // but write to vector store sequentially
      for (let i = 0; i < filesToIndex.length; i += this.parallelJobs) {
        const batch = filesToIndex.slice(i, i + this.parallelJobs);

        // Step 1: Generate embeddings in parallel (slow API calls)
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            try {
              const result = await this.prepareFileForIndexing(file);
              return { file, result, error: null };
            } catch (err) {
              return { file, result: null, error: err };
            }
          })
        );

        // Step 2: Write to vector store sequentially (avoids concurrent write conflicts)
        for (const { file, result, error } of batchResults) {
          if (error) {
            this.onError?.(new Error(`Failed to index ${file}: ${error}`));
          } else if (result && result.chunks.length > 0) {
            try {
              // Delete existing chunks for this file
              await this.vectorStore.deleteByFile(file);
              // Write new chunks
              await this.vectorStore.batchUpsert(result.chunks, result.embeddings);
              this.totalChunks += result.chunks.length;
              this.updateFileCache(file);
            } catch (err) {
              this.onError?.(new Error(`Failed to write index for ${file}: ${err}`));
            }
          } else {
            // File was processed but had no chunks (empty/binary/excluded)
            this.updateFileCache(file);
          }

          processed++;
          this.onProgress?.(processed, filesToIndex.length, path.relative(this.projectPath, file));
        }
      }

      this.lastIndexed = new Date();
      this.saveCache();
      const stats = await this.getStats();
      this.onComplete?.(stats);
      return stats;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Prepare a file for indexing by reading, chunking, and generating embeddings.
   * This can be run in parallel as it doesn't write to the vector store.
   */
  private async prepareFileForIndexing(filePath: string): Promise<{
    chunks: import('./types.js').CodeChunk[];
    embeddings: number[][];
  } | null> {
    // Skip excluded paths (safety check in case glob filter misses some)
    const relativePath = path.relative(this.projectPath, filePath);
    if (this.isExcludedPath(relativePath)) {
      return null;
    }

    // Read file content
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // Skip binary or very large files
    if (this.isBinaryContent(content) || content.length > 1000000) {
      return null;
    }

    // Chunk the file
    const chunks = this.chunker.chunk(content, filePath, this.projectPath);

    if (chunks.length === 0) {
      return null;
    }

    // Generate embeddings for all chunks
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingProvider.embed(texts);

    return { chunks, embeddings };
  }

  /**
   * Index a single file.
   * Used for incremental updates from file watcher.
   */
  async indexFile(filePath: string): Promise<number> {
    const result = await this.prepareFileForIndexing(filePath);

    if (!result || result.chunks.length === 0) {
      return 0;
    }

    // Delete existing chunks for this file
    await this.vectorStore.deleteByFile(filePath);

    // Write new chunks using batch upsert
    await this.vectorStore.batchUpsert(result.chunks, result.embeddings);
    this.totalChunks += result.chunks.length;

    return result.chunks.length;
  }

  /**
   * Find all files matching include/exclude patterns.
   */
  private async findFilesToIndex(): Promise<string[]> {
    const files: string[] = [];

    // Ensure node_modules and other common directories are always excluded
    // Use both patterns for compatibility with different glob versions
    const ignorePatterns = [
      ...this.config.excludePatterns,
      '**/node_modules/**',
      'node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
    ];

    for (const pattern of this.config.includePatterns) {
      const matches = await glob(pattern, {
        cwd: this.projectPath,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true,
        dot: false,  // Don't match dotfiles by default
      });

      for (const file of matches) {
        // Double-check with hardcoded exclusion list
        const relativePath = path.relative(this.projectPath, file);
        if (!files.includes(file) && !this.isExcludedPath(relativePath)) {
          files.push(file);
        }
      }
    }

    return files;
  }

  /**
   * Check if content appears to be binary.
   */
  private isBinaryContent(content: string): boolean {
    // Check for null bytes or high ratio of non-printable characters
    let nonPrintable = 0;
    const sampleSize = Math.min(1000, content.length);

    for (let i = 0; i < sampleSize; i++) {
      const code = content.charCodeAt(i);
      if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        nonPrintable++;
      }
    }

    return nonPrintable / sampleSize > 0.1;
  }

  /**
   * Check if a path should be excluded (hardcoded safety check).
   * This catches files that might slip through glob's ignore patterns.
   */
  private isExcludedPath(relativePath: string): boolean {
    // Normalize path separators for cross-platform
    const normalizedPath = relativePath.replace(/\\/g, '/');

    // Hardcoded exclusions that should always be skipped
    const hardcodedExclusions = [
      'node_modules/',
      '.git/',
      'dist/',
      'build/',
      '.next/',
      '__pycache__/',
      '.venv/',
      'venv/',
      'target/',
      'vendor/',
      '.bundle/',
    ];

    for (const exclusion of hardcodedExclusions) {
      if (normalizedPath.startsWith(exclusion) || normalizedPath.includes(`/${exclusion}`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Start watching for file changes.
   */
  startWatching(): void {
    if (this.watcher) return;

    try {
      this.watcher = fs.watch(
        this.projectPath,
        { recursive: true },
        (eventType, filename) => {
          if (!filename) return;

          const fullPath = path.join(this.projectPath, filename);

          // Check if this file should be indexed
          if (this.shouldIndexFile(fullPath)) {
            this.queueFile(fullPath);
          }
        }
      );

      this.watcher.on('error', (err) => {
        this.onError?.(err instanceof Error ? err : new Error(`File watcher error: ${err}`));
      });
    } catch {
      // fs.watch might not be available on all platforms - silently ignore
    }
  }

  /**
   * Stop watching for file changes.
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Queue a file for indexing (debounced).
   */
  private queueFile(filePath: string): void {
    this.indexQueue.add(filePath);

    // Debounce: process queue after 500ms of no new files
    if (this.queueTimeout) {
      clearTimeout(this.queueTimeout);
    }

    this.queueTimeout = setTimeout(() => {
      this.processQueue().catch((err) => {
        this.onError?.(err);
      });
    }, 500);
  }

  /**
   * Process queued files.
   */
  private async processQueue(): Promise<void> {
    if (this.isIndexing || this.indexQueue.size === 0) return;

    const files = Array.from(this.indexQueue);
    this.indexQueue.clear();

    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          await this.indexFile(file);
        } else {
          // File was deleted, remove from index
          await this.vectorStore.deleteByFile(file);
        }
      } catch (err) {
        console.error(`Failed to process ${file}: ${err}`);
      }
    }
  }

  /**
   * Check if a file should be indexed based on patterns.
   */
  private shouldIndexFile(filePath: string): boolean {
    const relativePath = path.relative(this.projectPath, filePath);

    // Check exclude patterns first
    for (const pattern of this.config.excludePatterns) {
      if (this.matchPattern(relativePath, pattern)) {
        return false;
      }
    }

    // Check include patterns
    for (const pattern of this.config.includePatterns) {
      if (this.matchPattern(relativePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Simple glob pattern matching.
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regex = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\./g, '\\.')
      .replace(/{{GLOBSTAR}}/g, '.*');

    return new RegExp(`^${regex}$`).test(filePath);
  }

  /**
   * Get current index statistics.
   */
  async getStats(): Promise<IndexStats> {
    const storeStats = await this.vectorStore.getStats();

    return {
      totalFiles: this.totalFiles,
      totalChunks: storeStats.itemCount,
      lastIndexed: this.lastIndexed,
      indexSizeBytes: storeStats.sizeBytes,
      embeddingProvider: this.embeddingProvider.getName(),
      embeddingModel: this.embeddingProvider.getModel(),
      isIndexing: this.isIndexing,
      queuedFiles: this.indexQueue.size,
    };
  }

  /**
   * Clear the entire index.
   */
  async clearIndex(): Promise<void> {
    await this.vectorStore.clear();
    this.totalFiles = 0;
    this.totalChunks = 0;
    this.lastIndexed = null;
  }

  /**
   * Get the vector store instance.
   */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  /**
   * Check if indexing is in progress.
   */
  isIndexingInProgress(): boolean {
    return this.isIndexing;
  }

  /**
   * Shutdown the indexer.
   */
  shutdown(): void {
    this.stopWatching();
    if (this.queueTimeout) {
      clearTimeout(this.queueTimeout);
    }
  }
}
