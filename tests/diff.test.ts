import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  generateWriteDiff,
  generateEditDiff,
  formatDiffForTerminal,
  truncateDiff,
} from '../src/diff';

// Use a temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), '.codi-diff-test');

describe('Diff Utilities', () => {
  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Change to test directory for relative path tests
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    // Clean up test directory
    process.chdir(os.tmpdir());
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('generateWriteDiff', () => {
    it('generates diff for new file', async () => {
      const result = await generateWriteDiff('new-file.txt', 'Hello, World!\n');

      expect(result.isNewFile).toBe(true);
      expect(result.linesAdded).toBe(1);
      expect(result.linesRemoved).toBe(0);
      expect(result.summary).toContain('New file');
      expect(result.unifiedDiff).toContain('+Hello, World!');
    });

    it('generates diff for existing file modification', async () => {
      // Create existing file
      fs.writeFileSync('existing.txt', 'Original content\n');

      const result = await generateWriteDiff('existing.txt', 'Modified content\n');

      expect(result.isNewFile).toBe(false);
      expect(result.linesAdded).toBe(1);
      expect(result.linesRemoved).toBe(1);
      expect(result.unifiedDiff).toContain('-Original content');
      expect(result.unifiedDiff).toContain('+Modified content');
    });

    it('generates diff with multiple line changes', async () => {
      fs.writeFileSync('multi.txt', 'line1\nline2\nline3\n');

      const result = await generateWriteDiff('multi.txt', 'line1\nmodified\nline3\nnew line\n');

      expect(result.linesAdded).toBe(2);
      expect(result.linesRemoved).toBe(1);
    });

    it('shows no changes for identical content', async () => {
      fs.writeFileSync('same.txt', 'Same content\n');

      const result = await generateWriteDiff('same.txt', 'Same content\n');

      expect(result.linesAdded).toBe(0);
      expect(result.linesRemoved).toBe(0);
      expect(result.summary).toBe('No changes');
    });
  });

  describe('generateEditDiff', () => {
    it('generates diff for string replacement', async () => {
      fs.writeFileSync('edit.txt', 'Hello, World!\n');

      const result = await generateEditDiff('edit.txt', 'World', 'Universe');

      expect(result.isNewFile).toBe(false);
      expect(result.unifiedDiff).toContain('-Hello, World!');
      expect(result.unifiedDiff).toContain('+Hello, Universe!');
    });

    it('generates diff for multi-line replacement', async () => {
      fs.writeFileSync('multiline.txt', 'function foo() {\n  return 1;\n}\n');

      const result = await generateEditDiff(
        'multiline.txt',
        'return 1;',
        'return 42;'
      );

      expect(result.unifiedDiff).toContain('-  return 1;');
      expect(result.unifiedDiff).toContain('+  return 42;');
    });

    it('throws error for file not found', async () => {
      await expect(
        generateEditDiff('nonexistent.txt', 'old', 'new')
      ).rejects.toThrow('File not found');
    });

    it('throws error when string not found', async () => {
      fs.writeFileSync('nostring.txt', 'Some content\n');

      await expect(
        generateEditDiff('nostring.txt', 'not found', 'replacement')
      ).rejects.toThrow('String not found');
    });

    it('handles replaceAll option', async () => {
      fs.writeFileSync('replaceall.txt', 'foo bar foo baz foo\n');

      const result = await generateEditDiff('replaceall.txt', 'foo', 'qux', true);

      expect(result.unifiedDiff).toContain('+qux bar qux baz qux');
    });
  });

  describe('formatDiffForTerminal', () => {
    it('adds color codes to diff output', () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 context line
-removed line
+added line
 context line`;

      const formatted = formatDiffForTerminal(diff);

      // Check that ANSI codes are added
      expect(formatted).toContain('\x1b[32m+added line\x1b[0m');
      expect(formatted).toContain('\x1b[31m-removed line\x1b[0m');
      expect(formatted).toContain('\x1b[36m@@');
    });

    it('preserves context lines without coloring', () => {
      const diff = ` unchanged line`;
      const formatted = formatDiffForTerminal(diff);

      expect(formatted).toBe(' unchanged line');
    });
  });

  describe('truncateDiff', () => {
    it('returns unchanged diff when within limit', () => {
      const shortDiff = `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new`;

      const result = truncateDiff(shortDiff, 10);
      expect(result).toBe(shortDiff);
    });

    it('truncates long diffs', () => {
      const lines = ['--- a/file.txt', '+++ b/file.txt'];
      for (let i = 0; i < 50; i++) {
        lines.push(`+line ${i}`);
      }
      const longDiff = lines.join('\n');

      const result = truncateDiff(longDiff, 20);

      expect(result).toContain('more lines');
      expect(result.split('\n').length).toBeLessThanOrEqual(25);
    });

    it('preserves header lines when truncating', () => {
      const lines = ['--- a/file.txt', '+++ b/file.txt'];
      for (let i = 0; i < 50; i++) {
        lines.push(`+line ${i}`);
      }
      const longDiff = lines.join('\n');

      const result = truncateDiff(longDiff, 20);

      expect(result).toContain('--- a/file.txt');
      expect(result).toContain('+++ b/file.txt');
    });
  });
});
