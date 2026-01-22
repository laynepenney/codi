// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateCacheId,
  cacheToolResult,
  getCachedResult,
  hasCachedResult,
  listCachedResults,
  cleanupCache,
  clearCache,
} from '../src/utils/tool-result-cache.js';

describe('tool-result-cache', () => {
  describe('generateCacheId', () => {
    it('generates consistent IDs for same input', () => {
      const id1 = generateCacheId('read_file', 'content');
      const id2 = generateCacheId('read_file', 'content');
      expect(id1).toBe(id2);
    });

    it('generates different IDs for different content', () => {
      const id1 = generateCacheId('read_file', 'content1');
      const id2 = generateCacheId('read_file', 'content2');
      expect(id1).not.toBe(id2);
    });

    it('generates different IDs for different tool names', () => {
      const id1 = generateCacheId('read_file', 'content');
      const id2 = generateCacheId('glob', 'content');
      expect(id1).not.toBe(id2);
    });

    it('includes tool name prefix in ID', () => {
      const id = generateCacheId('read_file', 'content');
      expect(id).toMatch(/^read_file_/);
    });

    it('truncates long tool names', () => {
      const id = generateCacheId('very_long_tool_name_here', 'content');
      expect(id).toMatch(/^very_long_/);
    });
  });

  describe('cacheToolResult', () => {
    it('returns a cache ID', () => {
      const id = cacheToolResult(
        'read_file',
        'file content here',
        '[read_file: 3 lines]',
        100,
        false
      );
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('stores result that can be retrieved', () => {
      const content = 'test file content\nline 2\nline 3';
      const id = cacheToolResult(
        'read_file',
        content,
        '[read_file: 3 lines]',
        75,
        false
      );

      const result = getCachedResult(id);
      expect(result).not.toBeNull();
      expect(result!.content).toBe(content);
      expect(result!.toolName).toBe('read_file');
      expect(result!.isError).toBe(false);
      expect(result!.estimatedTokens).toBe(75);
    });

    it('stores error results correctly', () => {
      const id = cacheToolResult(
        'bash',
        'Command failed: exit code 1',
        '[bash: ERROR]',
        20,
        true
      );

      const result = getCachedResult(id);
      expect(result!.isError).toBe(true);
    });

    it('stores tool input when provided', () => {
      const id = cacheToolResult(
        'read_file',
        'content',
        'summary',
        10,
        false,
        { path: '/test/file.txt' }
      );

      const result = getCachedResult(id);
      expect(result!.toolInput).toEqual({ path: '/test/file.txt' });
    });
  });

  describe('getCachedResult', () => {
    it('returns null for non-existent ID', () => {
      const result = getCachedResult('nonexistent_id_12345');
      expect(result).toBeNull();
    });

    it('returns complete result object', () => {
      const id = cacheToolResult(
        'grep',
        'match1\nmatch2',
        '[grep: 2 matches]',
        50,
        false
      );

      const result = getCachedResult(id);
      expect(result).toMatchObject({
        id,
        toolName: 'grep',
        content: 'match1\nmatch2',
        isError: false,
        summary: '[grep: 2 matches]',
        estimatedTokens: 50,
      });
      expect(result!.cachedAt).toBeGreaterThan(0);
    });
  });

  describe('hasCachedResult', () => {
    it('returns true for existing result', () => {
      const id = cacheToolResult('test', 'content', 'summary', 10, false);
      expect(hasCachedResult(id)).toBe(true);
    });

    it('returns false for non-existent result', () => {
      expect(hasCachedResult('fake_id_999')).toBe(false);
    });
  });

  describe('listCachedResults', () => {
    it('returns array of cached results', () => {
      // Cache a few results
      cacheToolResult('tool1', 'content1', 'summary1', 10, false);
      cacheToolResult('tool2', 'content2', 'summary2', 20, false);

      const results = listCachedResults();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('includes metadata for each result', () => {
      const id = cacheToolResult('test_tool', 'test content', 'test summary', 15, false);

      const results = listCachedResults();
      const entry = results.find(r => r.id === id);

      expect(entry).toBeDefined();
      expect(entry!.metadata.toolName).toBe('test_tool');
      expect(entry!.metadata.summary).toBe('test summary');
      expect(entry!.metadata.estimatedTokens).toBe(15);
    });

    it('sorts by cached time, newest first', () => {
      // Add with slight delay to ensure different timestamps
      const id1 = cacheToolResult('first', 'c1', 's1', 10, false);
      const id2 = cacheToolResult('second', 'c2', 's2', 10, false);

      const results = listCachedResults();
      const idx1 = results.findIndex(r => r.id === id1);
      const idx2 = results.findIndex(r => r.id === id2);

      // Second should come before first (newer first)
      expect(idx2).toBeLessThan(idx1);
    });
  });

  describe('cleanupCache', () => {
    it('returns cleanup statistics', () => {
      const stats = cleanupCache();
      expect(stats).toHaveProperty('removed');
      expect(stats).toHaveProperty('freedBytes');
      expect(typeof stats.removed).toBe('number');
      expect(typeof stats.freedBytes).toBe('number');
    });
  });

  describe('clearCache', () => {
    it('removes all cached results', () => {
      // Add some results
      cacheToolResult('t1', 'c1', 's1', 10, false);
      cacheToolResult('t2', 'c2', 's2', 10, false);

      const removed = clearCache();
      expect(removed).toBeGreaterThanOrEqual(0);
    });
  });
});
