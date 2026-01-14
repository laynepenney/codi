import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RefactorTool } from '../src/tools/refactor.js';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock recordChange to avoid side effects
vi.mock('../src/history.js', () => ({
  recordChange: vi.fn(),
}));

describe('RefactorTool', () => {
  let tool: RefactorTool;
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tool = new RefactorTool();
    testDir = join(tmpdir(), `.codi-refactor-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();

      expect(def.name).toBe('refactor');
      expect(def.description).toContain('search-and-replace');
      expect(def.input_schema.properties).toHaveProperty('search');
      expect(def.input_schema.properties).toHaveProperty('replace');
      expect(def.input_schema.properties).toHaveProperty('scope');
      expect(def.input_schema.properties).toHaveProperty('file_pattern');
      expect(def.input_schema.properties).toHaveProperty('is_regex');
      expect(def.input_schema.properties).toHaveProperty('case_sensitive');
      expect(def.input_schema.properties).toHaveProperty('whole_word');
      expect(def.input_schema.properties).toHaveProperty('dry_run');
      expect(def.input_schema.properties).toHaveProperty('max_files');
      expect(def.input_schema.required).toContain('search');
      expect(def.input_schema.required).toContain('replace');
    });
  });

  describe('execute - error handling', () => {
    it('throws error when search is missing', async () => {
      await expect(tool.execute({ replace: 'bar' })).rejects.toThrow('Search pattern is required');
    });

    it('throws error when search is empty', async () => {
      await expect(tool.execute({ search: '', replace: 'bar' })).rejects.toThrow(
        'Search pattern is required'
      );
    });

    it('throws error when replace is undefined', async () => {
      await expect(tool.execute({ search: 'foo' })).rejects.toThrow(
        'Replace text is required'
      );
    });

    it('allows empty replace string', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const foo = 1;');
      const result = await tool.execute({ search: 'foo', replace: '' });
      expect(result).toContain('replacement');
    });

    it('throws error for invalid regex pattern', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'content');
      await expect(
        tool.execute({ search: '[invalid(', replace: 'bar', is_regex: true })
      ).rejects.toThrow('Invalid regex pattern');
    });
  });

  describe('execute - literal search', () => {
    it('performs basic string replacement', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const oldName = 1;\nconst oldName = 2;');

      const result = await tool.execute({ search: 'oldName', replace: 'newName' });

      expect(result).toContain('newName');
      expect(result).toContain('2 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe('const newName = 1;\nconst newName = 2;');
    });

    it('escapes regex special characters in literal mode', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const x = a.b.c();');

      const result = await tool.execute({ search: 'a.b.c()', replace: 'newFunc()' });

      expect(result).toContain('1 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe('const x = newFunc();');
    });

    it('is case-sensitive by default', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const Foo = 1;\nconst foo = 2;');

      const result = await tool.execute({ search: 'Foo', replace: 'Bar' });

      expect(result).toContain('1 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe('const Bar = 1;\nconst foo = 2;');
    });

    it('supports case-insensitive matching', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const Foo = 1;\nconst FOO = 2;\nconst foo = 3;');

      const result = await tool.execute({
        search: 'foo',
        replace: 'bar',
        case_sensitive: false,
      });

      expect(result).toContain('3 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe('const bar = 1;\nconst bar = 2;\nconst bar = 3;');
    });

    it('supports whole word matching', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const foo = 1;\nconst foobar = 2;\nconst barfoo = 3;');

      const result = await tool.execute({
        search: 'foo',
        replace: 'baz',
        whole_word: true,
      });

      expect(result).toContain('1 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe('const baz = 1;\nconst foobar = 2;\nconst barfoo = 3;');
    });
  });

  describe('execute - regex search', () => {
    it('performs regex replacement', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'item1 item2 item3');

      const result = await tool.execute({
        search: 'item\\d',
        replace: 'thing',
        is_regex: true,
      });

      expect(result).toContain('3 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe('thing thing thing');
    });

    it('supports capture groups', async () => {
      writeFileSync(join(testDir, 'test.ts'), "console.log('hello');\nconsole.log('world');");

      const result = await tool.execute({
        search: "console\\.log\\('([^']+)'\\)",
        replace: "logger.info('$1')",
        is_regex: true,
      });

      expect(result).toContain('2 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe("logger.info('hello');\nlogger.info('world');");
    });

    it('supports multiple capture groups', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'import { foo } from "./bar";');

      const result = await tool.execute({
        search: "import \\{ (\\w+) \\} from \"\\./([^\"]+)\"",
        replace: "import { $1 } from '@/$2'",
        is_regex: true,
      });

      expect(result).toContain('1 replacement');

      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe("import { foo } from '@/bar';");
    });
  });

  describe('execute - file filtering', () => {
    it('uses custom file pattern', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const foo = 1;');
      writeFileSync(join(testDir, 'test.js'), 'const foo = 2;');
      writeFileSync(join(testDir, 'test.py'), 'foo = 3');

      const result = await tool.execute({
        search: 'foo',
        replace: 'bar',
        file_pattern: '**/*.ts',
      });

      expect(result).toContain('1 replacement');

      // Only .ts file should be modified
      expect(readFileSync(join(testDir, 'test.ts'), 'utf-8')).toBe('const bar = 1;');
      expect(readFileSync(join(testDir, 'test.js'), 'utf-8')).toBe('const foo = 2;');
      expect(readFileSync(join(testDir, 'test.py'), 'utf-8')).toBe('foo = 3');
    });

    it('returns message when no files match pattern', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'content');

      const result = await tool.execute({
        search: 'foo',
        replace: 'bar',
        file_pattern: '**/*.rs',
      });

      expect(result).toContain('No files found');
    });

    it('returns message when no matches in files', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const bar = 1;');

      const result = await tool.execute({
        search: 'notfound',
        replace: 'replacement',
      });

      expect(result).toContain('No matches found');
    });

    it('respects max_files limit', async () => {
      // Create 5 files with matches
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(testDir, `file${i}.ts`), 'const foo = 1;');
      }

      const result = await tool.execute({
        search: 'foo',
        replace: 'bar',
        max_files: 2,
      });

      expect(result).toContain('2'); // 2 files modified
      expect(result).toContain('Stopped at max_files limit');

      // Count how many files were modified
      let modifiedCount = 0;
      for (let i = 0; i < 5; i++) {
        const content = readFileSync(join(testDir, `file${i}.ts`), 'utf-8');
        if (content === 'const bar = 1;') {
          modifiedCount++;
        }
      }
      expect(modifiedCount).toBe(2);
    });

    it('searches in specified scope directory', async () => {
      mkdirSync(join(testDir, 'src'));
      writeFileSync(join(testDir, 'root.ts'), 'const foo = 1;');
      writeFileSync(join(testDir, 'src', 'nested.ts'), 'const foo = 2;');

      const result = await tool.execute({
        search: 'foo',
        replace: 'bar',
        scope: 'src',
      });

      expect(result).toContain('1 replacement');

      // Only src/nested.ts should be modified
      expect(readFileSync(join(testDir, 'root.ts'), 'utf-8')).toBe('const foo = 1;');
      expect(readFileSync(join(testDir, 'src', 'nested.ts'), 'utf-8')).toBe('const bar = 2;');
    });
  });

  describe('execute - dry run mode', () => {
    it('previews changes without modifying files', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const foo = 1;');

      const result = await tool.execute({
        search: 'foo',
        replace: 'bar',
        dry_run: true,
      });

      expect(result).toContain('[DRY RUN]');
      expect(result).toContain('1 replacement');
      expect(result).toContain('Run with dry_run: false');

      // File should NOT be modified
      const content = readFileSync(join(testDir, 'test.ts'), 'utf-8');
      expect(content).toBe('const foo = 1;');
    });
  });

  describe('execute - output formatting', () => {
    it('shows file count and replacement count', async () => {
      writeFileSync(join(testDir, 'a.ts'), 'foo foo');
      writeFileSync(join(testDir, 'b.ts'), 'foo');

      const result = await tool.execute({ search: 'foo', replace: 'bar' });

      expect(result).toContain('**Files:** 2');
      expect(result).toContain('**Total Replacements:** 3');
    });

    it('shows preview snippets', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const oldFunction = () => {};');

      const result = await tool.execute({ search: 'oldFunction', replace: 'newFunction' });

      expect(result).toContain('oldFunction');
      expect(result).toContain('→');
      expect(result).toContain('newFunction');
    });

    it('truncates file list when more than 20 files', async () => {
      // Create 25 files with matches
      for (let i = 0; i < 25; i++) {
        writeFileSync(join(testDir, `file${i.toString().padStart(2, '0')}.ts`), 'foo');
      }

      const result = await tool.execute({
        search: 'foo',
        replace: 'bar',
        max_files: 25,
      });

      expect(result).toContain('... and 5 more files');
    });
  });

  describe('execute - multiple files', () => {
    it('modifies multiple files across directory structure', async () => {
      mkdirSync(join(testDir, 'src', 'components'), { recursive: true });
      mkdirSync(join(testDir, 'src', 'utils'), { recursive: true });

      writeFileSync(join(testDir, 'src', 'index.ts'), "import { OldClass } from './old';");
      writeFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'class OldClass {}');
      writeFileSync(join(testDir, 'src', 'utils', 'helpers.ts'), 'export class OldClass {}');

      const result = await tool.execute({
        search: 'OldClass',
        replace: 'NewClass',
        file_pattern: '**/*.{ts,tsx}',
      });

      expect(result).toContain('**Files:** 3');
      expect(result).toContain('**Total Replacements:** 3');

      expect(readFileSync(join(testDir, 'src', 'index.ts'), 'utf-8')).toContain('NewClass');
      expect(readFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'utf-8')).toContain(
        'NewClass'
      );
      expect(readFileSync(join(testDir, 'src', 'utils', 'helpers.ts'), 'utf-8')).toContain(
        'NewClass'
      );
    });
  });
});
