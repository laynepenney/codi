// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  recordChange,
  undoChange,
  redoChange,
  getHistory,
  getFileHistory,
  clearHistory,
  getUndoCount,
  getRedoCount,
  formatHistoryEntry,
  getHistoryDir,
} from '../src/history';

// Use a temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), '.codi-history-test');
const TEST_FILES_DIR = path.join(TEST_DIR, 'files');

describe('History System', () => {
  beforeEach(() => {
    // Create test directories
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_FILES_DIR, { recursive: true });

    // Clear history
    clearHistory();

    // Change to test directory
    process.chdir(TEST_FILES_DIR);
  });

  afterEach(() => {
    // Clean up
    process.chdir(os.tmpdir());
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    clearHistory();
  });

  describe('recordChange', () => {
    it('records a write operation', () => {
      // Create a file to track
      fs.writeFileSync('test.txt', 'original content');

      recordChange({
        operation: 'write',
        filePath: 'test.txt',
        newContent: 'new content',
        description: 'Updated test.txt',
      });

      const history = getHistory();
      expect(history.length).toBe(1);
      expect(history[0].operation).toBe('write');
      expect(history[0].description).toBe('Updated test.txt');
    });

    it('records create operation for new files', () => {
      recordChange({
        operation: 'create',
        filePath: 'new-file.txt',
        newContent: 'new file content',
        description: 'Created new-file.txt',
      });

      const history = getHistory();
      expect(history.length).toBe(1);
      expect(history[0].operation).toBe('create');
      expect(history[0].originalContent).toBeNull();
    });

    it('captures original content for existing files', () => {
      fs.writeFileSync('existing.txt', 'original content');

      recordChange({
        operation: 'edit',
        filePath: 'existing.txt',
        newContent: 'modified content',
        description: 'Edited existing.txt',
      });

      const history = getHistory();
      expect(history[0].originalContent).toBe('original content');
    });

    it('returns unique ID for each entry', () => {
      const id1 = recordChange({
        operation: 'write',
        filePath: 'file1.txt',
        newContent: 'content',
        description: 'First',
      });

      const id2 = recordChange({
        operation: 'write',
        filePath: 'file2.txt',
        newContent: 'content',
        description: 'Second',
      });

      expect(id1).not.toBe(id2);
    });
  });

  describe('undoChange', () => {
    it('restores original content', () => {
      const originalContent = 'original content';
      fs.writeFileSync('restore.txt', originalContent);

      recordChange({
        operation: 'write',
        filePath: 'restore.txt',
        newContent: 'new content',
        description: 'Modified',
      });

      // Simulate the write
      fs.writeFileSync('restore.txt', 'new content');

      // Undo
      const entry = undoChange();
      expect(entry).not.toBeNull();

      // Check file is restored
      const restored = fs.readFileSync('restore.txt', 'utf-8');
      expect(restored).toBe(originalContent);
    });

    it('deletes file when undoing create', () => {
      recordChange({
        operation: 'create',
        filePath: 'created.txt',
        newContent: 'new file',
        description: 'Created file',
      });

      // Simulate the create
      fs.writeFileSync('created.txt', 'new file');

      // Undo
      undoChange();

      // File should be deleted
      expect(fs.existsSync('created.txt')).toBe(false);
    });

    it('returns null when nothing to undo', () => {
      const entry = undoChange();
      expect(entry).toBeNull();
    });

    it('marks entry as undone', () => {
      fs.writeFileSync('mark.txt', 'original');

      recordChange({
        operation: 'write',
        filePath: 'mark.txt',
        newContent: 'new',
        description: 'Changed',
      });

      fs.writeFileSync('mark.txt', 'new');

      const undoneEntry = undoChange();

      expect(undoneEntry).not.toBeNull();
      expect(undoneEntry!.undone).toBe(true);
    });

    it('undoes most recent non-undone entry', () => {
      fs.writeFileSync('first.txt', 'a');
      fs.writeFileSync('second.txt', 'b');

      recordChange({
        operation: 'write',
        filePath: 'first.txt',
        newContent: 'A',
        description: 'First change',
      });
      fs.writeFileSync('first.txt', 'A');

      recordChange({
        operation: 'write',
        filePath: 'second.txt',
        newContent: 'B',
        description: 'Second change',
      });
      fs.writeFileSync('second.txt', 'B');

      // First undo should affect second.txt
      const entry = undoChange();
      expect(entry?.filePath).toContain('second.txt');
    });
  });

  describe('redoChange', () => {
    it('reapplies undone change', () => {
      fs.writeFileSync('redo.txt', 'original');

      recordChange({
        operation: 'write',
        filePath: 'redo.txt',
        newContent: 'modified',
        description: 'Change',
      });

      fs.writeFileSync('redo.txt', 'modified');

      undoChange();
      expect(fs.readFileSync('redo.txt', 'utf-8')).toBe('original');

      redoChange();
      expect(fs.readFileSync('redo.txt', 'utf-8')).toBe('modified');
    });

    it('returns null when nothing to redo', () => {
      const entry = redoChange();
      expect(entry).toBeNull();
    });

    it('marks entry as not undone', () => {
      fs.writeFileSync('mark2.txt', 'original');

      recordChange({
        operation: 'write',
        filePath: 'mark2.txt',
        newContent: 'new',
        description: 'Changed',
      });

      fs.writeFileSync('mark2.txt', 'new');

      undoChange();
      redoChange();

      const history = getHistory(10, true);
      expect(history[0].undone).toBe(false);
    });
  });

  describe('getHistory', () => {
    it('returns empty array when no history', () => {
      const history = getHistory();
      expect(history).toEqual([]);
    });

    it('returns entries in reverse chronological order', () => {
      recordChange({ operation: 'write', filePath: 'a.txt', newContent: 'a', description: 'First' });
      recordChange({ operation: 'write', filePath: 'b.txt', newContent: 'b', description: 'Second' });
      recordChange({ operation: 'write', filePath: 'c.txt', newContent: 'c', description: 'Third' });

      const history = getHistory();
      expect(history[0].description).toBe('Third');
      expect(history[2].description).toBe('First');
    });

    it('limits number of entries', () => {
      for (let i = 0; i < 10; i++) {
        recordChange({ operation: 'write', filePath: `${i}.txt`, newContent: 'x', description: `Entry ${i}` });
      }

      const history = getHistory(5);
      expect(history.length).toBe(5);
    });

    it('filters out undone entries when requested', () => {
      fs.writeFileSync('filter.txt', 'original');

      recordChange({ operation: 'write', filePath: 'filter.txt', newContent: 'new', description: 'Changed' });
      fs.writeFileSync('filter.txt', 'new');

      recordChange({ operation: 'write', filePath: 'other.txt', newContent: 'x', description: 'Other' });

      undoChange(); // Undo 'Other'

      const withUndone = getHistory(10, true);
      const withoutUndone = getHistory(10, false);

      expect(withUndone.length).toBe(2);
      expect(withoutUndone.length).toBe(1);
    });
  });

  describe('getFileHistory', () => {
    it('returns history for specific file', () => {
      recordChange({ operation: 'write', filePath: 'target.txt', newContent: 'a', description: 'First' });
      recordChange({ operation: 'write', filePath: 'other.txt', newContent: 'b', description: 'Other' });
      recordChange({ operation: 'edit', filePath: 'target.txt', newContent: 'c', description: 'Second' });

      const history = getFileHistory('target.txt');
      expect(history.length).toBe(2);
      expect(history.every(e => e.filePath.includes('target.txt'))).toBe(true);
    });
  });

  describe('clearHistory', () => {
    it('clears all entries', () => {
      recordChange({ operation: 'write', filePath: 'a.txt', newContent: 'a', description: 'A' });
      recordChange({ operation: 'write', filePath: 'b.txt', newContent: 'b', description: 'B' });

      const count = clearHistory();

      expect(count).toBe(2);
      expect(getHistory().length).toBe(0);
    });
  });

  describe('getUndoCount and getRedoCount', () => {
    it('returns correct counts', () => {
      fs.writeFileSync('count.txt', 'original');

      recordChange({ operation: 'write', filePath: 'count.txt', newContent: 'a', description: 'A' });
      fs.writeFileSync('count.txt', 'a');
      recordChange({ operation: 'write', filePath: 'count.txt', newContent: 'b', description: 'B' });
      fs.writeFileSync('count.txt', 'b');

      expect(getUndoCount()).toBe(2);
      expect(getRedoCount()).toBe(0);

      undoChange();

      expect(getUndoCount()).toBe(1);
      expect(getRedoCount()).toBe(1);

      undoChange();

      expect(getUndoCount()).toBe(0);
      expect(getRedoCount()).toBe(2);
    });
  });

  describe('formatHistoryEntry', () => {
    it('formats entry for display', () => {
      const entryId = recordChange({
        operation: 'write',
        filePath: 'format.txt',
        newContent: 'x',
        description: 'Test format',
      });

      const history = getHistory(50, true);
      const entry = history.find((item) => item.id === entryId);

      expect(entry).toBeDefined();
      const formatted = formatHistoryEntry(entry!);

      expect(formatted).toContain('write');
      expect(formatted).toContain('format.txt');
      expect(formatted).toContain('Test format');
    });

    it('indicates undone entries', () => {
      fs.writeFileSync('undone-format.txt', 'original');

      recordChange({ operation: 'write', filePath: 'undone-format.txt', newContent: 'x', description: 'Will undo' });
      fs.writeFileSync('undone-format.txt', 'x');

      const undoneEntry = undoChange();

      expect(undoneEntry).not.toBeNull();
      const formatted = formatHistoryEntry(undoneEntry!);

      expect(formatted).toContain('(undone)');
    });
  });

  describe('getHistoryDir', () => {
    it('returns the history directory path', () => {
      const dir = getHistoryDir();
      if (process.env.VITEST || process.env.NODE_ENV === 'test') {
        // Test environment uses .codi-test-{pid}/history path format
        expect(dir).toContain('.codi-test-');
        expect(dir).toContain('history');
        expect(dir).toContain(os.tmpdir());
      } else {
        expect(dir).toContain('.codi');
        expect(dir).toContain('history');
      }
    });
  });
});
