import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RebuildIndexTool } from '../src/symbol-index/tools/rebuild-index.js';
import type { IndexStats } from '../src/symbol-index/types.js';

// Mock the background indexer module
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
  errors: [] as string[],
};

const mockIncrementalResult = {
  added: 5,
  modified: 3,
  removed: 1,
  duration: 200,
};

const mockGetIsIndexing = vi.fn().mockReturnValue(false);
const mockGetStats = vi.fn().mockReturnValue(mockStats);
const mockRebuild = vi.fn().mockResolvedValue(mockRebuildResult);
const mockIncrementalUpdate = vi.fn().mockResolvedValue(mockIncrementalResult);

vi.mock('../src/symbol-index/background-indexer.js', () => ({
  getBackgroundIndexer: vi.fn(() => ({
    getIsIndexing: mockGetIsIndexing,
    getStats: mockGetStats,
    rebuild: mockRebuild,
    incrementalUpdate: mockIncrementalUpdate,
  })),
}));

describe('RebuildIndexTool', () => {
  let tool: RebuildIndexTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIsIndexing.mockReturnValue(false);
    mockGetStats.mockReturnValue(mockStats);
    mockRebuild.mockResolvedValue(mockRebuildResult);
    mockIncrementalUpdate.mockResolvedValue(mockIncrementalResult);
    tool = new RebuildIndexTool('/test/project');
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();

      expect(def.name).toBe('rebuild_index');
      expect(def.description).toContain('Rebuild the symbol index');
      expect(def.input_schema.properties).toHaveProperty('mode');
      expect(def.input_schema.properties).toHaveProperty('clear');
    });

    it('has mode enum with correct values', () => {
      const def = tool.getDefinition();
      const modeProp = def.input_schema.properties.mode as { enum: string[] };

      expect(modeProp.enum).toContain('incremental');
      expect(modeProp.enum).toContain('full');
      expect(modeProp.enum).toContain('deep');
    });
  });

  describe('execute', () => {
    describe('incremental mode', () => {
      it('performs incremental update by default', async () => {
        const result = await tool.execute({});

        expect(mockIncrementalUpdate).toHaveBeenCalled();
        expect(result).toContain('Incremental Index Update Complete');
      });

      it('shows changes when files were updated', async () => {
        const result = await tool.execute({ mode: 'incremental' });

        expect(result).toContain('Changes Processed');
        expect(result).toContain('Added: 5 files');
        expect(result).toContain('Modified: 3 files');
        expect(result).toContain('Removed: 1 files');
      });

      it('shows "no changes" when nothing changed', async () => {
        mockIncrementalUpdate.mockResolvedValue({
          added: 0,
          modified: 0,
          removed: 0,
          duration: 50,
        });

        const result = await tool.execute({ mode: 'incremental' });

        expect(result).toContain('No changes detected');
        expect(result).toContain('Index is up to date');
      });

      it('includes index statistics', async () => {
        const result = await tool.execute({ mode: 'incremental' });

        expect(result).toContain('Index Statistics');
        expect(result).toContain('Total Files: 100');
        expect(result).toContain('Total Symbols: 500');
        expect(result).toContain('Total Imports: 200');
        expect(result).toContain('Total Dependencies: 150');
      });

      it('shows duration', async () => {
        const result = await tool.execute({ mode: 'incremental' });

        expect(result).toMatch(/Duration: \d+\.\d+s/);
      });
    });

    describe('full mode', () => {
      it('performs full rebuild', async () => {
        const result = await tool.execute({ mode: 'full' });

        expect(mockRebuild).toHaveBeenCalledWith(expect.objectContaining({
          deepIndex: false,
        }));
        expect(result).toContain('Full Index Rebuild Complete');
      });

      it('shows build results', async () => {
        const result = await tool.execute({ mode: 'full' });

        expect(result).toContain('Build Results');
        expect(result).toContain('Files Processed: 50');
        expect(result).toContain('Symbols Extracted: 250');
      });

      it('includes index version', async () => {
        const result = await tool.execute({ mode: 'full' });

        expect(result).toContain('Index Version: 1.0.0');
      });

      it('passes clear option', async () => {
        await tool.execute({ mode: 'full', clear: true });

        expect(mockRebuild).toHaveBeenCalledWith(expect.objectContaining({
          forceRebuild: true,
        }));
      });
    });

    describe('deep mode', () => {
      it('performs deep rebuild with usage tracking', async () => {
        const result = await tool.execute({ mode: 'deep' });

        expect(mockRebuild).toHaveBeenCalledWith(expect.objectContaining({
          deepIndex: true,
        }));
        expect(result).toContain('Deep Index Rebuild Complete');
      });

      it('includes note about deep indexing', async () => {
        const result = await tool.execute({ mode: 'deep' });

        expect(result).toContain('usage-based dependencies are tracked');
      });
    });

    describe('error handling', () => {
      it('returns message if indexing already in progress', async () => {
        mockGetIsIndexing.mockReturnValue(true);

        const result = await tool.execute({});

        expect(result).toContain('Index operation already in progress');
        expect(mockIncrementalUpdate).not.toHaveBeenCalled();
      });

      it('throws error on rebuild failure', async () => {
        mockRebuild.mockRejectedValue(new Error('Database error'));

        await expect(tool.execute({ mode: 'full' }))
          .rejects.toThrow('Index rebuild failed: Database error');
      });

      it('throws error on incremental update failure', async () => {
        mockIncrementalUpdate.mockRejectedValue(new Error('File system error'));

        await expect(tool.execute({ mode: 'incremental' }))
          .rejects.toThrow('Index rebuild failed: File system error');
      });
    });

    describe('with errors in results', () => {
      it('shows errors in full rebuild output', async () => {
        mockRebuild.mockResolvedValue({
          ...mockRebuildResult,
          errors: [
            '/path/to/file1.ts: Parse error',
            '/path/to/file2.ts: Syntax error',
          ],
        });

        const result = await tool.execute({ mode: 'full' });

        expect(result).toContain('Errors: 2');
        expect(result).toContain('/path/to/file1.ts: Parse error');
        expect(result).toContain('/path/to/file2.ts: Syntax error');
      });

      it('truncates error list when more than 5 errors', async () => {
        const manyErrors = Array.from({ length: 10 }, (_, i) => `Error ${i + 1}`);
        mockRebuild.mockResolvedValue({
          ...mockRebuildResult,
          errors: manyErrors,
        });

        const result = await tool.execute({ mode: 'full' });

        expect(result).toContain('Errors: 10');
        expect(result).toContain('Error 1');
        expect(result).toContain('Error 5');
        expect(result).toContain('... and 5 more');
        expect(result).not.toContain('Error 6');
      });
    });
  });
});
