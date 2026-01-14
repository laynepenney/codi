// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Background Indexer
 *
 * Manages automatic symbol index maintenance:
 * - Initializes index on startup
 * - Watches for file changes
 * - Performs incremental updates
 */

import * as fs from 'fs';
import * as path from 'path';
import { watch, FSWatcher } from 'chokidar';
import { SymbolIndexService } from './service.js';
import type { IndexStats, IndexBuildOptions } from './types.js';

export interface BackgroundIndexerOptions {
  /** Project root directory */
  projectRoot: string;
  /** Whether to watch for file changes */
  watchFiles?: boolean;
  /** Debounce delay for file changes (ms) */
  debounceMs?: number;
  /** Callback when indexing starts */
  onIndexStart?: () => void;
  /** Callback when indexing completes */
  onIndexComplete?: (stats: IndexStats) => void;
  /** Callback for index errors */
  onIndexError?: (error: Error) => void;
  /** Callback for file change detection */
  onFileChange?: (file: string, type: 'add' | 'change' | 'unlink') => void;
  /** Whether to auto-rebuild on startup if index is stale */
  autoRebuildOnStartup?: boolean;
  /** Max age in minutes before index is considered stale */
  staleThresholdMinutes?: number;
  /** Include patterns for files to index */
  includePatterns?: string[];
  /** Exclude patterns for files to skip */
  excludePatterns?: string[];
}

const DEFAULT_INCLUDE_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.kt',
  '**/*.kts',
];

const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.min.js',
];

/**
 * Background indexer for automatic index maintenance
 */
export class BackgroundIndexer {
  private service: SymbolIndexService;
  private projectRoot: string;
  private watcher: FSWatcher | null = null;
  private options: BackgroundIndexerOptions;
  private pendingChanges: Map<string, 'add' | 'change' | 'unlink'> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private isIndexing: boolean = false;
  private initialized: boolean = false;

  constructor(options: BackgroundIndexerOptions) {
    this.options = {
      watchFiles: true,
      debounceMs: 1000,
      autoRebuildOnStartup: true,
      staleThresholdMinutes: 30,
      includePatterns: DEFAULT_INCLUDE_PATTERNS,
      excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
      ...options,
    };
    this.projectRoot = path.resolve(options.projectRoot);
    this.service = new SymbolIndexService(this.projectRoot);
  }

  /**
   * Initialize the background indexer
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.service.initialize();

    // Check if we need to rebuild on startup
    if (this.options.autoRebuildOnStartup) {
      const hasIndex = this.service.hasIndex();
      const isStale = this.service.isStale(this.options.staleThresholdMinutes!);

      if (!hasIndex) {
        // No index exists, do a full build
        await this.rebuild();
      } else if (isStale) {
        // Index is stale, do an incremental update
        await this.incrementalUpdate();
      }
    }

    // Start file watching if enabled
    if (this.options.watchFiles) {
      this.startWatching();
    }

    this.initialized = true;
  }

  /**
   * Stop the background indexer
   */
  async stop(): Promise<void> {
    this.stopWatching();
    this.service.close();
    this.initialized = false;
  }

  /**
   * Get the symbol index service
   */
  getService(): SymbolIndexService {
    return this.service;
  }

  /**
   * Check if currently indexing
   */
  getIsIndexing(): boolean {
    return this.isIndexing;
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return this.service.getStats();
  }

  /**
   * Force a full rebuild of the index
   */
  async rebuild(options: Partial<IndexBuildOptions> = {}): Promise<{
    filesProcessed: number;
    symbolsExtracted: number;
    duration: number;
    errors: string[];
  }> {
    if (this.isIndexing) {
      throw new Error('Index operation already in progress');
    }

    this.isIndexing = true;
    this.options.onIndexStart?.();

    try {
      const result = await this.service.rebuild({
        includePatterns: this.options.includePatterns,
        excludePatterns: this.options.excludePatterns,
        ...options,
      });

      this.options.onIndexComplete?.(this.service.getStats());
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onIndexError?.(err);
      throw err;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Perform an incremental update
   */
  async incrementalUpdate(): Promise<{
    added: number;
    modified: number;
    removed: number;
    duration: number;
  }> {
    if (this.isIndexing) {
      throw new Error('Index operation already in progress');
    }

    this.isIndexing = true;
    this.options.onIndexStart?.();

    try {
      const result = await this.service.incrementalUpdate({
        includePatterns: this.options.includePatterns,
        excludePatterns: this.options.excludePatterns,
      });

      this.options.onIndexComplete?.(this.service.getStats());
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onIndexError?.(err);
      throw err;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Start watching for file changes
   */
  private startWatching(): void {
    if (this.watcher) return;

    // Convert include patterns to watch paths
    const watchPatterns = this.options.includePatterns!.map(pattern =>
      path.join(this.projectRoot, pattern)
    );

    this.watcher = watch(watchPatterns, {
      ignored: this.options.excludePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (filePath) => this.handleFileChange(filePath, 'add'));
    this.watcher.on('change', (filePath) => this.handleFileChange(filePath, 'change'));
    this.watcher.on('unlink', (filePath) => this.handleFileChange(filePath, 'unlink'));

    this.watcher.on('error', (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onIndexError?.(err);
    });
  }

  /**
   * Stop watching for file changes
   */
  private stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Handle a file change event
   */
  private handleFileChange(filePath: string, type: 'add' | 'change' | 'unlink'): void {
    const relativePath = path.relative(this.projectRoot, filePath);
    this.pendingChanges.set(relativePath, type);

    this.options.onFileChange?.(relativePath, type);

    // Debounce the update
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, this.options.debounceMs);
  }

  /**
   * Process accumulated file changes
   */
  private async processPendingChanges(): Promise<void> {
    if (this.pendingChanges.size === 0 || this.isIndexing) return;

    const changes = new Map(this.pendingChanges);
    this.pendingChanges.clear();

    try {
      await this.incrementalUpdate();
    } catch (error) {
      // Re-queue changes on error
      for (const [file, type] of changes) {
        this.pendingChanges.set(file, type);
      }
    }
  }
}

// Singleton instance for the current project
let backgroundIndexer: BackgroundIndexer | null = null;

/**
 * Get or create the background indexer for a project
 */
export function getBackgroundIndexer(projectRoot: string): BackgroundIndexer {
  if (!backgroundIndexer || backgroundIndexer.getService().getStats().projectRoot !== projectRoot) {
    backgroundIndexer = new BackgroundIndexer({ projectRoot });
  }
  return backgroundIndexer;
}

/**
 * Initialize the background indexer for a project
 */
export async function initializeBackgroundIndexer(
  projectRoot: string,
  options: Partial<BackgroundIndexerOptions> = {}
): Promise<BackgroundIndexer> {
  if (backgroundIndexer) {
    await backgroundIndexer.stop();
  }

  backgroundIndexer = new BackgroundIndexer({ projectRoot, ...options });
  await backgroundIndexer.initialize();
  return backgroundIndexer;
}

/**
 * Stop the background indexer
 */
export async function stopBackgroundIndexer(): Promise<void> {
  if (backgroundIndexer) {
    await backgroundIndexer.stop();
    backgroundIndexer = null;
  }
}
