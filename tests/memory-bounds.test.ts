// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createWorkingSet,
  updateWorkingSet,
  type WorkingSet,
} from '../src/context-windowing.js';
import { FIXED_CONFIG } from '../src/context-config.js';

describe('Memory Bounds', () => {
  describe('Working Set LRU Eviction', () => {
    let workingSet: WorkingSet;

    beforeEach(() => {
      workingSet = createWorkingSet();
    });

    it('should add files to the working set', () => {
      updateWorkingSet(workingSet, 'read_file', { path: 'file1.ts' });
      updateWorkingSet(workingSet, 'read_file', { path: 'file2.ts' });

      expect(workingSet.recentFiles.has('file1.ts')).toBe(true);
      expect(workingSet.recentFiles.has('file2.ts')).toBe(true);
      expect(workingSet.recentFiles.size).toBe(2);
    });

    it('should evict oldest files when exceeding limit', () => {
      // Add more than MAX_RECENT_FILES (100) files
      for (let i = 0; i < 110; i++) {
        updateWorkingSet(workingSet, 'read_file', { path: `file${i}.ts` });
      }

      // Should have exactly 100 files (the limit)
      expect(workingSet.recentFiles.size).toBe(100);

      // Oldest files (0-9) should be evicted
      expect(workingSet.recentFiles.has('file0.ts')).toBe(false);
      expect(workingSet.recentFiles.has('file9.ts')).toBe(false);

      // Newest files should be present
      expect(workingSet.recentFiles.has('file109.ts')).toBe(true);
      expect(workingSet.recentFiles.has('file10.ts')).toBe(true);
    });

    it('should update LRU order when re-accessing a file', () => {
      // Add 100 files
      for (let i = 0; i < 100; i++) {
        updateWorkingSet(workingSet, 'read_file', { path: `file${i}.ts` });
      }

      // Re-access file0 (which would be evicted next)
      updateWorkingSet(workingSet, 'read_file', { path: 'file0.ts' });

      // Add one more file to trigger eviction
      updateWorkingSet(workingSet, 'read_file', { path: 'newfile.ts' });

      // file0 should still be present (was accessed recently)
      expect(workingSet.recentFiles.has('file0.ts')).toBe(true);

      // file1 should be evicted (oldest after file0 was re-accessed)
      expect(workingSet.recentFiles.has('file1.ts')).toBe(false);
    });

    it('should not add files for non-file tools', () => {
      updateWorkingSet(workingSet, 'bash', { command: 'ls -la' });
      updateWorkingSet(workingSet, 'web_search', { query: 'test' });

      expect(workingSet.recentFiles.size).toBe(0);
    });

    it('should handle various file path parameter names', () => {
      updateWorkingSet(workingSet, 'read_file', { path: 'file1.ts' });
      updateWorkingSet(workingSet, 'read_file', { file_path: 'file2.ts' });
      updateWorkingSet(workingSet, 'read_file', { file: 'file3.ts' });

      expect(workingSet.recentFiles.has('file1.ts')).toBe(true);
      expect(workingSet.recentFiles.has('file2.ts')).toBe(true);
      expect(workingSet.recentFiles.has('file3.ts')).toBe(true);
    });
  });

  describe('Fixed Configuration', () => {
    it('should have MAX_MESSAGES configured', () => {
      expect(FIXED_CONFIG.MAX_MESSAGES).toBe(500);
    });

    it('should have MAX_CHAT_DURATION_MS configured', () => {
      expect(FIXED_CONFIG.MAX_CHAT_DURATION_MS).toBe(60 * 60 * 1000); // 1 hour
    });

    it('should have MAX_ITERATIONS configured', () => {
      expect(FIXED_CONFIG.MAX_ITERATIONS).toBe(2000);
    });
  });
});
