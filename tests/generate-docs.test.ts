import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GenerateDocsTool } from '../src/tools/generate-docs.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GenerateDocsTool', () => {
  let tool: GenerateDocsTool;
  let testDir: string;

  beforeEach(() => {
    tool = new GenerateDocsTool();
    testDir = join(tmpdir(), `.codi-generate-docs-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();

      expect(def.name).toBe('generate_docs');
      expect(def.description).toContain('documentation');
      expect(def.input_schema.properties).toHaveProperty('file');
      expect(def.input_schema.properties).toHaveProperty('symbol');
      expect(def.input_schema.properties).toHaveProperty('format');
      expect(def.input_schema.properties).toHaveProperty('include_private');
      expect(def.input_schema.required).toContain('file');
    });
  });

  describe('execute - error handling', () => {
    it('throws error when file path is missing', async () => {
      await expect(tool.execute({})).rejects.toThrow('File path is required');
    });

    it('throws error when file does not exist', async () => {
      await expect(tool.execute({ file: '/nonexistent/file.ts' }))
        .rejects.toThrow('File not found');
    });

    it('throws error for unsupported file types', async () => {
      const filePath = join(testDir, 'test.go');
      writeFileSync(filePath, 'package main');

      await expect(tool.execute({ file: filePath }))
        .rejects.toThrow('Unsupported file type');
    });
  });

  describe('execute - TypeScript/JavaScript JSDoc parsing', () => {
    it('parses function with JSDoc', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Adds two numbers together.
 * @param a - The first number
 * @param b - The second number
 * @returns The sum of a and b
 */
function add(a: number, b: number): number {
  return a + b;
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('add');
      expect(result).toContain('Adds two numbers together');
      expect(result).toContain('The first number');
      expect(result).toContain('The second number');
      expect(result).toContain('Returns');
    });

    it('parses arrow function with JSDoc', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Multiplies two numbers.
 */
const multiply = (a: number, b: number) => a * b;
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('multiply');
      expect(result).toContain('Multiplies two numbers');
    });

    it('parses class with JSDoc', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * A simple calculator class.
 */
class Calculator {
  /**
   * Calculates the sum.
   */
  sum(a: number, b: number) {
    return a + b;
  }
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('Calculator');
      expect(result).toContain('simple calculator');
      expect(result).toContain('Classes');
    });

    it('parses interface with JSDoc', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * User configuration options.
 */
export interface UserConfig {
  name: string;
  age: number;
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('UserConfig');
      expect(result).toContain('configuration options');
      expect(result).toContain('Interfaces');
    });

    it('parses type with JSDoc', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * A callback function type.
 */
export type Callback = (data: unknown) => void;
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('Callback');
      expect(result).toContain('callback function');
      expect(result).toContain('Types');
    });

    it('parses exported functions', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Exported helper function.
 */
export function helper() {
  return true;
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('helper');
    });

    it('parses async functions', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Fetches data from API.
 */
export async function fetchData() {
  return {};
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('fetchData');
    });

    it('handles JSDoc with @param type annotations', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Process an item.
 * @param {string} name - The item name
 * @param {number} count - How many items
 * @returns {boolean} Success status
 */
function process(name, count) {
  return true;
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('`string`');
      expect(result).toContain('`number`');
      expect(result).toContain('`boolean`');
    });

    it('handles files with no documented symbols', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
// No JSDoc here
function undocumented() {
  return 42;
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('No documented symbols found');
    });

    it('works with .js files', async () => {
      const filePath = join(testDir, 'test.js');
      writeFileSync(filePath, `
/**
 * A JavaScript function.
 */
function jsFunc() {}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('jsFunc');
    });

    it('works with .tsx files', async () => {
      const filePath = join(testDir, 'Component.tsx');
      writeFileSync(filePath, `
/**
 * A React component.
 */
function Component() {
  return null;
}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('Component');
    });
  });

  describe('execute - Python docstring parsing', () => {
    it('parses function with docstring', async () => {
      const filePath = join(testDir, 'test.py');
      writeFileSync(filePath, `
def greet(name):
    """
    Greet a person by name.
    """
    return f"Hello, {name}!"
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('greet');
      expect(result).toContain('Greet a person by name');
    });

    it('parses class with docstring', async () => {
      const filePath = join(testDir, 'test.py');
      writeFileSync(filePath, `
class Calculator:
    """
    A simple calculator class.
    """
    pass
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('Calculator');
      expect(result).toContain('simple calculator');
    });

    it('parses async function', async () => {
      const filePath = join(testDir, 'test.py');
      writeFileSync(filePath, `
async def fetch_data():
    """
    Fetch data asynchronously.
    """
    pass
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('fetch_data');
    });

    it('handles single-line docstrings', async () => {
      const filePath = join(testDir, 'test.py');
      writeFileSync(filePath, `
def quick():
    """Quick helper function."""
    pass
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('quick');
      expect(result).toContain('Quick helper function');
    });

    it('handles functions without docstrings', async () => {
      const filePath = join(testDir, 'test.py');
      writeFileSync(filePath, `
def no_docs():
    pass
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('No documented symbols found');
    });
  });

  describe('execute - symbol filtering', () => {
    it('filters to specific symbol', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * First function.
 */
function first() {}

/**
 * Second function.
 */
function second() {}
`);

      const result = await tool.execute({ file: filePath, symbol: 'first' });

      expect(result).toContain('first');
      expect(result).not.toContain('Second function');
    });

    it('case-insensitive symbol matching', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * My function.
 */
function MyFunction() {}
`);

      const result = await tool.execute({ file: filePath, symbol: 'myfunction' });

      expect(result).toContain('MyFunction');
    });

    it('returns message when symbol not found', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Some function.
 */
function existing() {}
`);

      const result = await tool.execute({ file: filePath, symbol: 'nonexistent' });

      expect(result).toContain('No documentation found for symbol "nonexistent"');
    });
  });

  describe('execute - private symbol filtering', () => {
    it('excludes private symbols by default', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Public function.
 */
function publicFunc() {}

/**
 * Private helper.
 */
function _privateFunc() {}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('publicFunc');
      expect(result).not.toContain('_privateFunc');
    });

    it('includes private symbols when requested', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Public function.
 */
function publicFunc() {}

/**
 * Private helper.
 */
function _privateFunc() {}
`);

      const result = await tool.execute({ file: filePath, include_private: true });

      expect(result).toContain('publicFunc');
      expect(result).toContain('_privateFunc');
    });
  });

  describe('execute - output formats', () => {
    it('outputs markdown by default', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * A function.
 */
function myFunc() {}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toContain('# Documentation:');
      expect(result).toContain('## Functions');
      expect(result).toContain('### `myFunc`');
    });

    it('outputs JSON when requested', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * A function.
 */
function myFunc() {}
`);

      const result = await tool.execute({ file: filePath, format: 'json' });

      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('name', 'myFunc');
      expect(parsed[0]).toHaveProperty('kind', 'function');
      expect(parsed[0]).toHaveProperty('description');
      expect(parsed[0]).toHaveProperty('line');
    });

    it('JSON output includes params and returns', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * Add numbers.
 * @param a - First number
 * @returns The sum
 */
function add(a: number) {
  return a;
}
`);

      const result = await tool.execute({ file: filePath, format: 'json' });

      const parsed = JSON.parse(result);
      expect(parsed[0].params).toBeDefined();
      expect(parsed[0].params[0]).toHaveProperty('name', 'a');
      expect(parsed[0].returns).toBeDefined();
    });
  });

  describe('execute - markdown formatting', () => {
    it('groups symbols by kind', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * A class.
 */
class MyClass {}

/**
 * A function.
 */
function myFunc() {}

/**
 * An interface.
 */
interface MyInterface {}
`);

      const result = await tool.execute({ file: filePath });

      // Classes should come before functions
      const classIndex = result.indexOf('## Classes');
      const funcIndex = result.indexOf('## Functions');
      const interfaceIndex = result.indexOf('## Interfaces');

      expect(classIndex).toBeLessThan(funcIndex);
      expect(interfaceIndex).toBeLessThan(funcIndex);
    });

    it('includes line numbers', async () => {
      const filePath = join(testDir, 'test.ts');
      writeFileSync(filePath, `
/**
 * A function.
 */
function myFunc() {}
`);

      const result = await tool.execute({ file: filePath });

      expect(result).toMatch(/Defined at line \d+/);
    });
  });
});
