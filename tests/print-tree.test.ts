// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrintTreeTool } from '../src/tools/print-tree.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('PrintTreeTool', () => {
  let tool: PrintTreeTool;
  let tempDir: string;

  beforeEach(async () => {
    tool = new PrintTreeTool();
    // Create a temporary directory structure for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-tree-test-'));

    // Create test directory structure:
    // tempDir/
    //   src/
    //     index.ts
    //     utils/
    //       helpers.ts
    //   tests/
    //     test.ts
    //   package.json
    //   .hidden
    //   node_modules/  (should be skipped)
    //     somelib/
    //       index.js

    await fs.mkdir(path.join(tempDir, 'src'));
    await fs.mkdir(path.join(tempDir, 'src', 'utils'));
    await fs.mkdir(path.join(tempDir, 'tests'));
    await fs.mkdir(path.join(tempDir, 'node_modules'));
    await fs.mkdir(path.join(tempDir, 'node_modules', 'somelib'));

    await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), 'export {};');
    await fs.writeFile(path.join(tempDir, 'src', 'utils', 'helpers.ts'), 'export {};');
    await fs.writeFile(path.join(tempDir, 'tests', 'test.ts'), 'test();');
    await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
    await fs.writeFile(path.join(tempDir, '.hidden'), 'hidden file');
    await fs.writeFile(path.join(tempDir, 'node_modules', 'somelib', 'index.js'), '');
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();
      expect(def.name).toBe('print_tree');
      expect(def.description).toContain('tree');
      expect(def.input_schema.properties).toHaveProperty('path');
      expect(def.input_schema.properties).toHaveProperty('depth');
      expect(def.input_schema.properties).toHaveProperty('show_hidden');
      expect(def.input_schema.properties).toHaveProperty('show_files');
    });
  });

  describe('execute', () => {
    it('prints directory tree with default options', async () => {
      const result = await tool.execute({ path: tempDir });

      // Should show directories
      expect(result).toContain('src/');
      expect(result).toContain('tests/');

      // Should show files
      expect(result).toContain('package.json');

      // Should NOT show hidden files by default
      expect(result).not.toContain('.hidden');

      // Should NOT show node_modules (skipped directory)
      expect(result).not.toContain('node_modules');
    });

    it('shows tree connectors', async () => {
      const result = await tool.execute({ path: tempDir });

      // Should have tree connectors
      expect(result).toMatch(/[├└]──/);
    });

    it('respects depth parameter', async () => {
      const result = await tool.execute({ path: tempDir, depth: 1 });

      // Should show top-level directories
      expect(result).toContain('src/');
      expect(result).toContain('tests/');

      // Should NOT show nested files/dirs at depth 1
      expect(result).not.toContain('utils/');
      expect(result).not.toContain('helpers.ts');
    });

    it('shows hidden files when show_hidden is true', async () => {
      const result = await tool.execute({ path: tempDir, show_hidden: true });

      expect(result).toContain('.hidden');
    });

    it('hides files when show_files is false', async () => {
      const result = await tool.execute({ path: tempDir, show_files: false });

      // Should show directories
      expect(result).toContain('src/');
      expect(result).toContain('tests/');

      // Should NOT show files
      expect(result).not.toContain('package.json');
      expect(result).not.toContain('index.ts');
    });

    it('skips common non-essential directories', async () => {
      const result = await tool.execute({ path: tempDir });

      // node_modules should be skipped
      expect(result).not.toContain('node_modules');
      expect(result).not.toContain('somelib');
    });

    it('sorts directories before files', async () => {
      const result = await tool.execute({ path: tempDir });

      // Get the position of directories and files
      const srcPos = result.indexOf('src/');
      const testsPos = result.indexOf('tests/');
      const packagePos = result.indexOf('package.json');

      // Directories should come before files
      expect(srcPos).toBeLessThan(packagePos);
      expect(testsPos).toBeLessThan(packagePos);
    });

    it('handles empty directory', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      await fs.mkdir(emptyDir);

      const result = await tool.execute({ path: emptyDir });

      // Should show the directory name
      expect(result).toContain('empty/');
    });

    it('handles non-existent directory', async () => {
      const result = await tool.execute({ path: '/nonexistent/path/xyz' });

      expect(result).toContain('not found');
    });

    it('uses current directory when path not specified', async () => {
      // Save current dir
      const originalCwd = process.cwd();

      try {
        process.chdir(tempDir);
        const result = await tool.execute({});

        // Should show contents of tempDir
        expect(result).toContain('src/');
        expect(result).toContain('tests/');
      } finally {
        // Restore original cwd
        process.chdir(originalCwd);
      }
    });

    it('shows nested structure correctly', async () => {
      const result = await tool.execute({ path: tempDir, depth: 3 });

      // Should show nested utils directory
      expect(result).toContain('utils/');
      expect(result).toContain('helpers.ts');
    });
  });

  describe('tree formatting', () => {
    it('uses correct tree characters for last items', async () => {
      const result = await tool.execute({ path: tempDir });

      // Should have └── for last items in a directory
      expect(result).toContain('└──');
    });

    it('uses correct tree characters for non-last items', async () => {
      const result = await tool.execute({ path: tempDir });

      // Should have ├── for non-last items
      expect(result).toContain('├──');
    });

    it('uses vertical lines for nested items', async () => {
      const result = await tool.execute({ path: tempDir, depth: 3 });

      // Nested items should have │ for indentation
      // This appears when there are siblings after the parent
      expect(result).toMatch(/│\s+[├└]──/);
    });
  });
});
