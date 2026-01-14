/**
 * Background Indexer
 *
 * Indexes project files in the background with file watching support.
 */

import * as fs from 'fs';
import * as path from 'path';
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
  }

  /**
   * Initialize the indexer.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vectorStore.initialize();
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
   * Index all matching files in the project.
   */
  async indexAll(): Promise<IndexStats> {
    if (this.isIndexing) {
      throw new Error('Indexing already in progress');
    }

    this.isIndexing = true;
    this.totalFiles = 0;
    this.totalChunks = 0;

    try {
      const files = await this.findFilesToIndex();
      this.totalFiles = files.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.onProgress?.(i + 1, files.length, path.relative(this.projectPath, file));

        try {
          await this.indexFile(file);
        } catch (err) {
          // Log error but continue with other files
          console.error(`Failed to index ${file}: ${err}`);
        }
      }

      this.lastIndexed = new Date();
      const stats = await this.getStats();
      this.onComplete?.(stats);
      return stats;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Index a single file.
   */
  async indexFile(filePath: string): Promise<number> {
    // Skip excluded paths (safety check in case glob filter misses some)
    const relativePath = path.relative(this.projectPath, filePath);
    if (this.isExcludedPath(relativePath)) {
      return 0;
    }

    // Read file content
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // Skip binary or very large files
    if (this.isBinaryContent(content) || content.length > 1000000) {
      return 0;
    }

    // Delete existing chunks for this file
    await this.vectorStore.deleteByFile(filePath);

    // Chunk the file
    const chunks = this.chunker.chunk(content, filePath, this.projectPath);

    if (chunks.length === 0) {
      return 0;
    }

    // Generate embeddings in batches
    const batchSize = 10;
    let indexed = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.content);

      try {
        const embeddings = await this.embeddingProvider.embed(texts);

        for (let j = 0; j < batch.length; j++) {
          await this.vectorStore.upsert(batch[j], embeddings[j]);
          indexed++;
          this.totalChunks++;
        }
      } catch (err) {
        console.error(`Failed to embed chunks for ${filePath}: ${err}`);
      }
    }

    return indexed;
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
        console.error('File watcher error:', err);
      });
    } catch (err) {
      // fs.watch might not be available on all platforms
      console.warn('File watching not available:', err);
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
