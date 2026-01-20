// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PatchFileTool } from '../src/tools/patch-file.js';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the history module
vi.mock('../src/history.js', () => ({
  recordChange: vi.fn(),
}));

describe('PatchFileTool', () => {
  let tool: PatchFileTool;
  let testDir: string;

  beforeEach(() => {
    tool = new PatchFileTool();
    testDir = join(tmpdir(), `.codi-patch-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();
      expect(def.name).toBe('patch_file');
      expect(def.description).toContain('unified diff patch');
      expect(def.input_schema.properties).toHaveProperty('path');
      expect(def.input_schema.properties).toHaveProperty('patch');
      expect(def.input_schema.properties).toHaveProperty('patches');
      expect(def.input_schema.required).toContain('path');
      expect(def.input_schema.required).not.toContain('patch'); // patch is optional (can use patches array)
    });
  });

  describe('execute', () => {
    it('throws error when path is missing', async () => {
      await expect(tool.execute({ patch: '@@ -1,1 +1,1 @@\n-old\n+new' }))
        .rejects.toThrow('Path is required');
    });

    it('throws error when patch is missing', async () => {
      await expect(tool.execute({ path: 'test.txt' }))
        .rejects.toThrow('Either "patch" or "patches" is required');
    });

    it('throws error when file does not exist', async () => {
      await expect(tool.execute({
        path: join(testDir, 'nonexistent.txt'),
        patch: '@@ -1,1 +1,1 @@\n-old\n+new',
      })).rejects.toThrow('File not found');
    });

    it('returns message when no valid hunks found', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'hello world');

      const result = await tool.execute({
        path: filePath,
        patch: 'not a valid patch',
      });

      // With multi-patch support, invalid patches don't throw - they're reported in results
      expect(result).toContain('0 hunk(s) applied');
    });

    it('applies a simple single-line patch', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'hello world\n');

      const patch = `@@ -1,1 +1,1 @@
-hello world
+goodbye world`;

      const result = await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('goodbye world\n');
      expect(result).toContain('1 hunk(s) applied');
    });

    it('applies a patch that adds lines', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'line1\nline2\n');

      const patch = `@@ -1,2 +1,3 @@
 line1
+inserted
 line2`;

      const result = await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('line1\ninserted\nline2\n');
      expect(result).toContain('+1');
    });

    it('applies a patch that removes lines', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'line1\nto-remove\nline3\n');

      const patch = `@@ -1,3 +1,2 @@
 line1
-to-remove
 line3`;

      const result = await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('line1\nline3\n');
      expect(result).toContain('-1');
    });

    it('applies multiple hunks', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'a\nb\nc\nd\ne\nf\n');

      const patch = `@@ -1,2 +1,2 @@
-a
+A
 b
@@ -5,2 +5,2 @@
 e
-f
+F`;

      const result = await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('A\nb\nc\nd\ne\nF\n');
      expect(result).toContain('2 hunk(s) applied');
    });

    it('handles patch with diff headers', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'old content\n');

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,1 +1,1 @@
-old content
+new content`;

      const result = await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('new content\n');
    });

    it('handles hunks with default count of 1', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'single line\n');

      const patch = `@@ -1 +1 @@
-single line
+modified line`;

      const result = await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('modified line\n');
    });

    it('handles empty lines in patch', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'line1\n\nline3\n');

      const patch = `@@ -1,3 +1,4 @@
 line1

+inserted
 line3`;

      const result = await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('line1\n\ninserted\nline3\n');
    });

    it('applies hunks in reverse order to preserve line numbers', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, '1\n2\n3\n4\n5\n6\n7\n8\n');

      // Two hunks that both add a line
      const patch = `@@ -1,2 +1,3 @@
 1
+A
 2
@@ -7,2 +8,3 @@
 7
+B
 8`;

      await tool.execute({ path: filePath, patch });

      const newContent = readFileSync(filePath, 'utf-8');
      expect(newContent).toBe('1\nA\n2\n3\n4\n5\n6\n7\nB\n8\n');
    });
  });
});
