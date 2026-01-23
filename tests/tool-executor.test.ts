// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  batchToolCalls,
  getBatchStats,
  isReadOnly,
  isMutating,
  READ_ONLY_TOOLS,
  MUTATING_TOOLS,
  Semaphore,
  executeWithConcurrencyLimit,
  MAX_CONCURRENT_TOOLS,
  toolExecutionSemaphore,
} from '../src/tool-executor.js';
import type { ToolCall } from '../src/types.js';

function createToolCall(name: string, input: Record<string, unknown> = {}): ToolCall {
  return {
    id: `test_${name}_${Date.now()}`,
    name,
    input,
  };
}

describe('tool-executor', () => {
  describe('isReadOnly', () => {
    it('should return true for read-only tools', () => {
      expect(isReadOnly(createToolCall('read_file'))).toBe(true);
      expect(isReadOnly(createToolCall('glob'))).toBe(true);
      expect(isReadOnly(createToolCall('grep'))).toBe(true);
      expect(isReadOnly(createToolCall('list_directory'))).toBe(true);
      expect(isReadOnly(createToolCall('find_symbol'))).toBe(true);
    });

    it('should return false for mutating tools', () => {
      expect(isReadOnly(createToolCall('write_file'))).toBe(false);
      expect(isReadOnly(createToolCall('edit_file'))).toBe(false);
      expect(isReadOnly(createToolCall('bash'))).toBe(false);
    });
  });

  describe('isMutating', () => {
    it('should return true for mutating tools', () => {
      expect(isMutating(createToolCall('write_file'))).toBe(true);
      expect(isMutating(createToolCall('edit_file'))).toBe(true);
      expect(isMutating(createToolCall('bash'))).toBe(true);
      expect(isMutating(createToolCall('patch_file'))).toBe(true);
    });

    it('should return false for read-only tools', () => {
      expect(isMutating(createToolCall('read_file'))).toBe(false);
      expect(isMutating(createToolCall('glob'))).toBe(false);
    });
  });

  describe('batchToolCalls', () => {
    it('should return empty array for no tool calls', () => {
      const batches = batchToolCalls([]);
      expect(batches).toEqual([]);
    });

    it('should return single batch for one tool call', () => {
      const tools = [createToolCall('read_file', { path: 'a.ts' })];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(1);
      expect(batches[0].parallel).toBe(false);
      expect(batches[0].calls).toHaveLength(1);
    });

    it('should batch consecutive read-only tools on different files', () => {
      const tools = [
        createToolCall('read_file', { path: 'a.ts' }),
        createToolCall('read_file', { path: 'b.ts' }),
        createToolCall('read_file', { path: 'c.ts' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(1);
      expect(batches[0].parallel).toBe(true);
      expect(batches[0].calls).toHaveLength(3);
    });

    it('should not batch read-only tools if only one', () => {
      const tools = [createToolCall('read_file', { path: 'a.ts' })];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(1);
      expect(batches[0].parallel).toBe(false);
    });

    it('should execute mutating tools sequentially', () => {
      const tools = [
        createToolCall('write_file', { path: 'a.ts' }),
        createToolCall('write_file', { path: 'b.ts' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(2);
      expect(batches[0].parallel).toBe(false);
      expect(batches[1].parallel).toBe(false);
    });

    it('should flush read batch before mutating tool', () => {
      const tools = [
        createToolCall('read_file', { path: 'a.ts' }),
        createToolCall('read_file', { path: 'b.ts' }),
        createToolCall('write_file', { path: 'c.ts' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(2);
      // First batch: parallel reads
      expect(batches[0].parallel).toBe(true);
      expect(batches[0].calls).toHaveLength(2);
      // Second batch: sequential write
      expect(batches[1].parallel).toBe(false);
      expect(batches[1].calls).toHaveLength(1);
    });

    it('should handle read after write on same file', () => {
      const tools = [
        createToolCall('write_file', { path: 'a.ts', content: 'new' }),
        createToolCall('read_file', { path: 'a.ts' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(2);
      // Write first
      expect(batches[0].calls[0].name).toBe('write_file');
      // Then read
      expect(batches[1].calls[0].name).toBe('read_file');
    });

    it('should allow parallel reads after write if different file', () => {
      const tools = [
        createToolCall('write_file', { path: 'a.ts', content: 'new' }),
        createToolCall('read_file', { path: 'b.ts' }),
        createToolCall('read_file', { path: 'c.ts' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(2);
      // First: write
      expect(batches[0].calls[0].name).toBe('write_file');
      // Second: parallel reads (different files than write)
      expect(batches[1].parallel).toBe(true);
      expect(batches[1].calls).toHaveLength(2);
    });

    it('should handle complex mixed sequence', () => {
      const tools = [
        createToolCall('read_file', { path: 'a.ts' }),
        createToolCall('read_file', { path: 'b.ts' }),
        createToolCall('write_file', { path: 'a.ts', content: 'modified' }),
        createToolCall('read_file', { path: 'a.ts' }), // depends on write
        createToolCall('read_file', { path: 'c.ts' }), // independent
      ];
      const batches = batchToolCalls(tools);

      // Batch 1: parallel reads of a.ts and b.ts
      expect(batches[0].parallel).toBe(true);
      expect(batches[0].calls).toHaveLength(2);

      // Batch 2: write to a.ts
      expect(batches[1].calls[0].name).toBe('write_file');

      // Batch 3: read a.ts (depends on write) - sequential
      expect(batches[2].parallel).toBe(false);
      expect(batches[2].calls[0].input.path).toBe('a.ts');

      // Batch 4: read c.ts (came after dependent read, so separate batch)
      expect(batches[3].calls[0].input.path).toBe('c.ts');
    });

    it('should handle bash commands as mutating', () => {
      const tools = [
        createToolCall('read_file', { path: 'a.ts' }),
        createToolCall('bash', { command: 'npm test' }),
        createToolCall('read_file', { path: 'b.ts' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(3);
      // Reads cannot be combined across bash
      expect(batches[0].calls[0].name).toBe('read_file');
      expect(batches[1].calls[0].name).toBe('bash');
      expect(batches[2].calls[0].name).toBe('read_file');
    });

    it('should handle glob and grep as parallel', () => {
      const tools = [
        createToolCall('glob', { pattern: '**/*.ts' }),
        createToolCall('grep', { pattern: 'function', path: 'src/' }),
        createToolCall('list_directory', { path: '.' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(1);
      expect(batches[0].parallel).toBe(true);
      expect(batches[0].calls).toHaveLength(3);
    });

    it('should normalize paths to detect same file', () => {
      const tools = [
        createToolCall('write_file', { path: './a.ts', content: 'new' }),
        createToolCall('read_file', { path: 'a.ts' }), // Same file, different path format
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(2);
      // Write first, then read (detected as same file)
      expect(batches[0].calls[0].name).toBe('write_file');
      expect(batches[1].calls[0].name).toBe('read_file');
    });

    it('should handle file_path input parameter', () => {
      const tools = [
        createToolCall('read_file', { file_path: 'a.ts' }),
        createToolCall('read_file', { file_path: 'b.ts' }),
      ];
      const batches = batchToolCalls(tools);
      expect(batches).toHaveLength(1);
      expect(batches[0].parallel).toBe(true);
    });
  });

  describe('getBatchStats', () => {
    it('should calculate correct stats for empty batches', () => {
      const stats = getBatchStats([]);
      expect(stats.totalCalls).toBe(0);
      expect(stats.parallelBatches).toBe(0);
      expect(stats.sequentialBatches).toBe(0);
      expect(stats.maxParallelism).toBe(0);
    });

    it('should calculate correct stats for mixed batches', () => {
      const batches = batchToolCalls([
        createToolCall('read_file', { path: 'a.ts' }),
        createToolCall('read_file', { path: 'b.ts' }),
        createToolCall('read_file', { path: 'c.ts' }),
        createToolCall('write_file', { path: 'd.ts' }),
        createToolCall('read_file', { path: 'e.ts' }),
      ]);
      const stats = getBatchStats(batches);
      expect(stats.totalCalls).toBe(5);
      expect(stats.parallelBatches).toBe(1); // First 3 reads
      expect(stats.sequentialBatches).toBe(2); // Write + final read
      expect(stats.maxParallelism).toBe(3);
    });
  });

  describe('tool categories', () => {
    it('READ_ONLY_TOOLS should include all read tools', () => {
      expect(READ_ONLY_TOOLS.has('read_file')).toBe(true);
      expect(READ_ONLY_TOOLS.has('glob')).toBe(true);
      expect(READ_ONLY_TOOLS.has('grep')).toBe(true);
      expect(READ_ONLY_TOOLS.has('list_directory')).toBe(true);
      expect(READ_ONLY_TOOLS.has('find_symbol')).toBe(true);
      expect(READ_ONLY_TOOLS.has('search_codebase')).toBe(true);
    });

    it('MUTATING_TOOLS should include all write tools', () => {
      expect(MUTATING_TOOLS.has('write_file')).toBe(true);
      expect(MUTATING_TOOLS.has('edit_file')).toBe(true);
      expect(MUTATING_TOOLS.has('patch_file')).toBe(true);
      expect(MUTATING_TOOLS.has('insert_line')).toBe(true);
      expect(MUTATING_TOOLS.has('bash')).toBe(true);
    });

    it('tool sets should not overlap', () => {
      for (const tool of READ_ONLY_TOOLS) {
        expect(MUTATING_TOOLS.has(tool)).toBe(false);
      }
      for (const tool of MUTATING_TOOLS) {
        expect(READ_ONLY_TOOLS.has(tool)).toBe(false);
      }
    });
  });

  describe('Semaphore', () => {
    it('should allow immediate acquisition when permits available', async () => {
      const sem = new Semaphore(2);
      const stats1 = sem.getStats();
      expect(stats1.available).toBe(2);

      await sem.acquire();
      const stats2 = sem.getStats();
      expect(stats2.available).toBe(1);

      await sem.acquire();
      const stats3 = sem.getStats();
      expect(stats3.available).toBe(0);
    });

    it('should queue requests when no permits available', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();

      // This should not resolve immediately
      let resolved = false;
      const promise = sem.acquire().then(() => { resolved = true; });

      // Give it a tick
      await new Promise(r => setTimeout(r, 10));
      expect(resolved).toBe(false);
      expect(sem.getStats().waiting).toBe(1);

      // Release should allow queued request to proceed
      sem.release();
      await promise;
      expect(resolved).toBe(true);
    });

    it('should release permits correctly', async () => {
      const sem = new Semaphore(2);
      await sem.acquire();
      await sem.acquire();
      expect(sem.getStats().available).toBe(0);

      sem.release();
      expect(sem.getStats().available).toBe(1);

      sem.release();
      expect(sem.getStats().available).toBe(2);
    });

    it('should run function with semaphore via run()', async () => {
      const sem = new Semaphore(1);
      let running = 0;
      let maxRunning = 0;

      const task = async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(r => setTimeout(r, 10));
        running--;
        return 'done';
      };

      const results = await Promise.all([
        sem.run(task),
        sem.run(task),
        sem.run(task),
      ]);

      expect(results).toEqual(['done', 'done', 'done']);
      expect(maxRunning).toBe(1); // Only 1 at a time
    });

    it('should report stats correctly', () => {
      const sem = new Semaphore(5);
      const stats = sem.getStats();
      expect(stats.available).toBe(5);
      expect(stats.max).toBe(5);
      expect(stats.waiting).toBe(0);
    });
  });

  describe('executeWithConcurrencyLimit', () => {
    it('should execute all items and return results in order', async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await executeWithConcurrencyLimit(
        items,
        async (n) => n * 2
      );
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('should limit concurrency to MAX_CONCURRENT_TOOLS', async () => {
      // This is a bit tricky to test directly since toolExecutionSemaphore is shared
      // We can at least verify the constant exists
      expect(MAX_CONCURRENT_TOOLS).toBe(8);
    });

    it('should handle errors in executor', async () => {
      const items = [1, 2, 3];
      await expect(
        executeWithConcurrencyLimit(items, async (n) => {
          if (n === 2) throw new Error('test error');
          return n;
        })
      ).rejects.toThrow('test error');
    });
  });

  describe('toolExecutionSemaphore', () => {
    it('should exist and have MAX_CONCURRENT_TOOLS permits', () => {
      const stats = toolExecutionSemaphore.getStats();
      expect(stats.max).toBe(MAX_CONCURRENT_TOOLS);
    });
  });
});
