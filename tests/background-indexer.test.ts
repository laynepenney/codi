// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackgroundIndexer, getBackgroundIndexer } from '../src/symbol-index/background-indexer.js';
import type { IndexStats } from '../src/symbol-index/types.js';

// Mock chokidar
vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
  })),
}));

// Mock the SymbolIndexService
const mockStats: IndexStats = {
  totalFiles: 100,
  totalSymbols: 500,
  totalImports: 200,
  totalDependencies: 150,
  version: '1.0.0',
  lastRebuild: new Date().toISOString(),
  lastUpdate: new Date().toISOString(),
  deepIndexed: false,
  projectRoot: '/test/project',
};

const mockRebuildResult = {
  filesProcessed: 50,
  symbolsExtracted: 250,
  duration: 1500,
  errors: [],
};

const mockIncrementalResult = {
  added: 5,
  modified: 3,
  removed: 1,
  duration: 200,
};

vi.mock('../src/symbol-index/service.js', () => ({
  SymbolIndexService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    hasIndex: vi.fn().mockReturnValue(true),
    isStale: vi.fn().mockReturnValue(false),
    getStats: vi.fn().mockReturnValue(mockStats),
    rebuild: vi.fn().mockResolvedValue(mockRebuildResult),
    incrementalUpdate: vi.fn().mockResolvedValue(mockIncrementalResult),
    close: vi.fn(),
  })),
}));

describe('BackgroundIndexer', () => {
  let indexer: BackgroundIndexer;

  beforeEach(() => {
    vi.clearAllMocks();
    indexer = new BackgroundIndexer({
      projectRoot: '/test/project',
      watchFiles: false, // Disable watching for tests
      autoRebuildOnStartup: false,
    });
  });

  afterEach(async () => {
    await indexer.stop();
  });

  describe('constructor', () => {
    it('creates indexer with default options', () => {
      const idx = new BackgroundIndexer({ projectRoot: '/test' });
      expect(idx).toBeDefined();
      expect(idx.getIsIndexing()).toBe(false);
    });

    it('respects custom options', () => {
      const idx = new BackgroundIndexer({
        projectRoot: '/custom',
        debounceMs: 2000,
        staleThresholdMinutes: 60,
      });
      expect(idx).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('initializes successfully', async () => {
      await indexer.initialize();
      expect(indexer.getStats()).toBeDefined();
    });

    it('does not reinitialize if already initialized', async () => {
      await indexer.initialize();
      await indexer.initialize(); // Should not throw
      expect(indexer.getStats()).toBeDefined();
    });

    it('calls onIndexStart and onIndexComplete when rebuilding on startup', async () => {
      const onIndexStart = vi.fn();
      const onIndexComplete = vi.fn();

      // Mock the service constructor to return a service with no index
      const { SymbolIndexService } = await import('../src/symbol-index/service.js');
      vi.mocked(SymbolIndexService).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        hasIndex: vi.fn().mockReturnValue(false), // No index exists
        isStale: vi.fn().mockReturnValue(false),
        getStats: vi.fn().mockReturnValue(mockStats),
        rebuild: vi.fn().mockResolvedValue(mockRebuildResult),
        incrementalUpdate: vi.fn().mockResolvedValue(mockIncrementalResult),
        close: vi.fn(),
      }) as any);

      const startupIndexer = new BackgroundIndexer({
        projectRoot: '/test/project',
        watchFiles: false,
        autoRebuildOnStartup: true,
        onIndexStart,
        onIndexComplete,
      });

      await startupIndexer.initialize();

      expect(onIndexStart).toHaveBeenCalled();
      expect(onIndexComplete).toHaveBeenCalled();

      await startupIndexer.stop();
    });
  });

  describe('getStats', () => {
    it('returns index statistics', async () => {
      await indexer.initialize();
      const stats = indexer.getStats();

      expect(stats).toEqual(mockStats);
      expect(stats.totalFiles).toBe(100);
      expect(stats.totalSymbols).toBe(500);
    });
  });

  describe('getIsIndexing', () => {
    it('returns false when not indexing', () => {
      expect(indexer.getIsIndexing()).toBe(false);
    });
  });

  describe('rebuild', () => {
    beforeEach(async () => {
      await indexer.initialize();
    });

    it('performs full rebuild', async () => {
      const result = await indexer.rebuild();

      expect(result.filesProcessed).toBe(50);
      expect(result.symbolsExtracted).toBe(250);
      expect(result.duration).toBe(1500);
      expect(result.errors).toHaveLength(0);
    });

    it('passes options to service', async () => {
      const service = indexer.getService();

      await indexer.rebuild({ deepIndex: true });

      expect(service.rebuild).toHaveBeenCalledWith(
        expect.objectContaining({ deepIndex: true })
      );
    });

    it('calls onIndexStart and onIndexComplete callbacks', async () => {
      const onIndexStart = vi.fn();
      const onIndexComplete = vi.fn();

      const callbackIndexer = new BackgroundIndexer({
        projectRoot: '/test/project',
        watchFiles: false,
        autoRebuildOnStartup: false,
        onIndexStart,
        onIndexComplete,
      });

      await callbackIndexer.initialize();
      await callbackIndexer.rebuild();

      expect(onIndexStart).toHaveBeenCalled();
      expect(onIndexComplete).toHaveBeenCalledWith(mockStats);

      await callbackIndexer.stop();
    });

    it('throws error if already indexing', async () => {
      // Start a rebuild but don't await it
      const service = indexer.getService();
      vi.mocked(service.rebuild).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockRebuildResult), 100))
      );

      const firstRebuild = indexer.rebuild();

      // Try to start another rebuild immediately
      await expect(indexer.rebuild()).rejects.toThrow('Index operation already in progress');

      await firstRebuild;
    });

    it('calls onIndexError on failure', async () => {
      const onIndexError = vi.fn();

      // Mock the service constructor to return a service that fails on rebuild
      const { SymbolIndexService } = await import('../src/symbol-index/service.js');
      vi.mocked(SymbolIndexService).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        hasIndex: vi.fn().mockReturnValue(true),
        isStale: vi.fn().mockReturnValue(false),
        getStats: vi.fn().mockReturnValue(mockStats),
        rebuild: vi.fn().mockRejectedValue(new Error('Rebuild failed')),
        incrementalUpdate: vi.fn().mockResolvedValue(mockIncrementalResult),
        close: vi.fn(),
      }) as any);

      const errorIndexer = new BackgroundIndexer({
        projectRoot: '/test/project',
        watchFiles: false,
        autoRebuildOnStartup: false,
        onIndexError,
      });

      await errorIndexer.initialize();

      await expect(errorIndexer.rebuild()).rejects.toThrow('Rebuild failed');
      expect(onIndexError).toHaveBeenCalledWith(expect.any(Error));

      await errorIndexer.stop();
    });
  });

  describe('incrementalUpdate', () => {
    beforeEach(async () => {
      await indexer.initialize();
    });

    it('performs incremental update', async () => {
      const result = await indexer.incrementalUpdate();

      expect(result.added).toBe(5);
      expect(result.modified).toBe(3);
      expect(result.removed).toBe(1);
      expect(result.duration).toBe(200);
    });

    it('throws error if already indexing', async () => {
      const service = indexer.getService();
      vi.mocked(service.incrementalUpdate).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockIncrementalResult), 100))
      );

      const firstUpdate = indexer.incrementalUpdate();

      await expect(indexer.incrementalUpdate()).rejects.toThrow('Index operation already in progress');

      await firstUpdate;
    });
  });

  describe('stop', () => {
    it('stops the indexer and closes service', async () => {
      await indexer.initialize();
      const service = indexer.getService();

      await indexer.stop();

      expect(service.close).toHaveBeenCalled();
    });

    it('can be called multiple times safely', async () => {
      await indexer.initialize();
      await indexer.stop();
      await indexer.stop(); // Should not throw
    });
  });

  describe('getService', () => {
    it('returns the symbol index service', () => {
      const service = indexer.getService();
      expect(service).toBeDefined();
      expect(typeof service.initialize).toBe('function');
    });
  });
});

describe('getBackgroundIndexer', () => {
  it('returns a BackgroundIndexer instance', () => {
    const indexer = getBackgroundIndexer('/test/project');
    expect(indexer).toBeInstanceOf(BackgroundIndexer);
  });
});
