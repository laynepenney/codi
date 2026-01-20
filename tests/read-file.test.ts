// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadFileTool } from '../src/tools/read-file.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ReadFileTool', () => {
  let tool: ReadFileTool;
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    tool = new ReadFileTool();
    testDir = join(tmpdir(), `.codi-read-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create a 10-line test file
    testFile = join(testDir, 'test.txt');
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} content`);
    writeFileSync(testFile, lines.join('\n'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();
      expect(def.name).toBe('read_file');
      expect(def.description).toContain('Read the contents of a file');
      expect(def.input_schema.properties).toHaveProperty('path');
      expect(def.input_schema.properties).toHaveProperty('offset');
      expect(def.input_schema.properties).toHaveProperty('max_lines');
      expect(def.input_schema.required).toContain('path');
    });

    it('has offset parameter in schema', () => {
      const def = tool.getDefinition();
      const offsetProp = def.input_schema.properties.offset;
      expect(offsetProp).toBeDefined();
      expect(offsetProp.type).toBe('number');
      expect(offsetProp.description).toContain('1-indexed');
    });
  });

  describe('execute - basic', () => {
    it('throws error when path is missing', async () => {
      await expect(tool.execute({})).rejects.toThrow('Path is required');
    });

    it('throws error when file does not exist', async () => {
      await expect(tool.execute({ path: '/nonexistent/file.txt' }))
        .rejects.toThrow('File not found');
    });

    it('reads entire file with line numbers', async () => {
      const result = await tool.execute({ path: testFile });

      expect(result).toContain('1: Line 1 content');
      expect(result).toContain('10: Line 10 content');
      expect(result).not.toContain('showing lines');
    });

    it('respects max_lines parameter', async () => {
      const result = await tool.execute({ path: testFile, max_lines: 3 });

      expect(result).toContain('1: Line 1 content');
      expect(result).toContain('3: Line 3 content');
      expect(result).not.toContain('Line 4 content');
      expect(result).toContain('showing lines 1-3 of 10');
    });
  });

  describe('execute - offset parameter', () => {
    it('reads from offset with correct line numbers', async () => {
      const result = await tool.execute({ path: testFile, offset: 5 });

      // Should start at line 5
      expect(result).toContain('5: Line 5 content');
      expect(result).toContain('10: Line 10 content');
      // Should NOT contain lines 1-4
      expect(result).not.toMatch(/^1:/m);
      expect(result).not.toContain('Line 1 content');
      expect(result).not.toContain('Line 4 content');
    });

    it('combines offset with max_lines', async () => {
      const result = await tool.execute({ path: testFile, offset: 5, max_lines: 3 });

      // Should have lines 5, 6, 7 only
      expect(result).toContain('5: Line 5 content');
      expect(result).toContain('6: Line 6 content');
      expect(result).toContain('7: Line 7 content');
      expect(result).not.toContain('Line 8 content');
      expect(result).toContain('showing lines 5-7 of 10');
    });

    it('preserves original line numbers (not renumbered)', async () => {
      const result = await tool.execute({ path: testFile, offset: 5, max_lines: 2 });

      // Line 5 should show "5:", not "1:"
      expect(result).toMatch(/^\s*5: Line 5 content/m);
      expect(result).toMatch(/^\s*6: Line 6 content/m);
      // Should NOT have line 1
      expect(result).not.toMatch(/^\s*1:/m);
    });

    it('handles offset of 1 (same as no offset)', async () => {
      const result1 = await tool.execute({ path: testFile, offset: 1, max_lines: 3 });
      const result2 = await tool.execute({ path: testFile, max_lines: 3 });

      // Both should start at line 1
      expect(result1).toContain('1: Line 1 content');
      expect(result2).toContain('1: Line 1 content');
    });

    it('handles offset at last line', async () => {
      const result = await tool.execute({ path: testFile, offset: 10 });

      expect(result).toContain('10: Line 10 content');
      expect(result).not.toContain('Line 9 content');
      expect(result).toContain('showing lines 10-10 of 10');
    });

    it('handles offset beyond file length gracefully', async () => {
      const result = await tool.execute({ path: testFile, offset: 100 });

      expect(result).toContain('offset 100 is beyond file length of 10');
    });

    it('treats negative offset as 1', async () => {
      const result = await tool.execute({ path: testFile, offset: -5, max_lines: 2 });

      expect(result).toContain('1: Line 1 content');
      expect(result).toContain('2: Line 2 content');
    });

    it('treats zero offset as 1', async () => {
      const result = await tool.execute({ path: testFile, offset: 0, max_lines: 2 });

      expect(result).toContain('1: Line 1 content');
      expect(result).toContain('2: Line 2 content');
    });
  });

  describe('execute - context messages', () => {
    it('shows context when using offset without max_lines', async () => {
      const result = await tool.execute({ path: testFile, offset: 5 });

      expect(result).toContain('showing lines 5-10 of 10 total');
    });

    it('shows context when using offset with max_lines', async () => {
      const result = await tool.execute({ path: testFile, offset: 3, max_lines: 4 });

      expect(result).toContain('showing lines 3-6 of 10 total');
    });

    it('does not show context for full file read', async () => {
      const result = await tool.execute({ path: testFile });

      expect(result).not.toContain('showing lines');
      expect(result).not.toContain('total');
    });
  });

  describe('execute - line number padding', () => {
    it('pads line numbers correctly for double-digit files', async () => {
      const result = await tool.execute({ path: testFile });

      // Line 1 should be padded to match line 10
      expect(result).toMatch(/^\s*1: Line 1 content/m);
      expect(result).toMatch(/^10: Line 10 content/m);
    });

    it('pads line numbers correctly when using offset', async () => {
      // Create a 100-line file
      const bigFile = join(testDir, 'big.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      writeFileSync(bigFile, lines.join('\n'));

      const result = await tool.execute({ path: bigFile, offset: 95, max_lines: 5 });

      // Should show lines 95-99, padded to 2 digits
      expect(result).toMatch(/^\s*95: Line 95/m);
      expect(result).toMatch(/^\s*99: Line 99/m);
    });
  });
});
