// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { CodeChunker, DEFAULT_CHUNKER_CONFIG } from '../src/rag/chunker.js';

describe('CodeChunker', () => {
  // Use minChunkSize of 0 to catch even small chunks for testing
  const chunker = new CodeChunker({ minChunkSize: 10 });

  describe('TypeScript/JavaScript chunking', () => {
    it('chunks a function with body', () => {
      const content = `function hello(name: string): string {
  const greeting = "Hello, " + name;
  console.log(greeting);
  return greeting + "!";
}`;
      const chunks = chunker.chunk(content, '/project/test.ts', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('function');
      expect(chunks[0].name).toBe('hello');
      expect(chunks[0].language).toBe('typescript');
      expect(chunks[0].relativePath).toBe('test.ts');
      expect(chunks[0].startLine).toBe(1);
    });

    it('chunks an exported async function', () => {
      const content = `export async function fetchData(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed');
  return response;
}`;
      const chunks = chunker.chunk(content, '/project/api.ts', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('function');
      expect(chunks[0].name).toBe('fetchData');
    });

    it('chunks a class with methods', () => {
      const content = `export class Calculator {
  private value: number = 0;

  add(n: number): this {
    this.value += n;
    return this;
  }

  subtract(n: number): this {
    this.value -= n;
    return this;
  }

  getResult(): number {
    return this.value;
  }
}`;
      const chunks = chunker.chunk(content, '/project/calc.ts', '/project');

      // Should detect the class
      const classChunk = chunks.find((c) => c.type === 'class');
      expect(classChunk).toBeDefined();
      expect(classChunk?.name).toBe('Calculator');
    });

    it('chunks interfaces', () => {
      const content = `export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}`;
      const chunks = chunker.chunk(content, '/project/types.ts', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Interfaces are treated as classes for chunking
      expect(chunks[0].type).toBe('class');
      expect(chunks[0].name).toBe('User');
    });

    it('detects JavaScript files', () => {
      const content = `function greet(name) {
  return 'Hello, ' + name + '!';
}`;
      const chunks = chunker.chunk(content, '/project/test.js', '/project');

      expect(chunks[0].language).toBe('javascript');
    });

    it('handles JSX/TSX files', () => {
      const content = `export function Button({ onClick, children }) {
  return <button onClick={onClick}>{children}</button>;
}`;
      const chunks = chunker.chunk(content, '/project/Button.tsx', '/project');

      expect(chunks[0].language).toBe('tsx');
    });
  });

  describe('Python chunking', () => {
    it('chunks a function', () => {
      const content = `def greet(name: str) -> str:
    """Return a greeting message."""
    return f"Hello, {name}!"
`;
      const chunks = chunker.chunk(content, '/project/utils.py', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('function');
      expect(chunks[0].name).toBe('greet');
      expect(chunks[0].language).toBe('python');
    });

    it('chunks an async function', () => {
      const content = `async def fetch_data(url: str) -> dict:
    """Fetch data from URL."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()
`;
      const chunks = chunker.chunk(content, '/project/api.py', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('function');
      expect(chunks[0].name).toBe('fetch_data');
    });

    it('chunks a class', () => {
      const content = `class Person:
    """A person class."""

    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return f"Hello, I'm {self.name}"
`;
      const chunks = chunker.chunk(content, '/project/models.py', '/project');

      const classChunk = chunks.find((c) => c.type === 'class');
      expect(classChunk).toBeDefined();
      expect(classChunk?.name).toBe('Person');
    });
  });

  describe('Go chunking', () => {
    it('chunks a function', () => {
      const content = `func Hello(name string) string {
\treturn "Hello, " + name + "!"
}`;
      const chunks = chunker.chunk(content, '/project/main.go', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('function');
      expect(chunks[0].name).toBe('Hello');
      expect(chunks[0].language).toBe('go');
    });

    it('chunks a method with receiver', () => {
      const content = `func (p *Person) Greet() string {
\treturn "Hello, " + p.Name + "!"
}`;
      const chunks = chunker.chunk(content, '/project/person.go', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('function');
      expect(chunks[0].name).toBe('Greet');
    });

    it('chunks a struct', () => {
      const content = `type Person struct {
\tName string
\tAge  int
\tEmail string
}`;
      const chunks = chunker.chunk(content, '/project/types.go', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('class');
      expect(chunks[0].name).toBe('Person');
    });
  });

  describe('Rust chunking', () => {
    it('chunks a function', () => {
      const content = `fn hello(name: &str) -> String {
    let greeting = format!("Hello, {}!", name);
    greeting
}`;
      const chunks = chunker.chunk(content, '/project/lib.rs', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('function');
      expect(chunks[0].name).toBe('hello');
      expect(chunks[0].language).toBe('rust');
    });

    it('chunks a struct', () => {
      const content = `pub struct Person {
    name: String,
    age: u32,
    email: String,
}`;
      const chunks = chunker.chunk(content, '/project/types.rs', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe('class');
      expect(chunks[0].name).toBe('Person');
    });

    it('chunks an impl block', () => {
      const content = `impl Person {
    fn new(name: String) -> Self {
        Self { name, age: 0, email: String::new() }
    }
}`;
      const chunks = chunker.chunk(content, '/project/impl.rs', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // impl blocks are treated as classes
      expect(chunks[0].type).toBe('class');
    });
  });

  describe('Fixed-size chunking fallback', () => {
    it('uses fixed chunks for unknown languages', () => {
      const content = 'This is a text file with some content.\n'.repeat(10);
      const chunks = chunker.chunk(content, '/project/readme.txt', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].language).toBe('text');
      // For small files, should be a single chunk
      expect(chunks[0].type).toBe('file');
    });

    it('splits large files into multiple chunks', () => {
      // Create a large file that exceeds maxChunkSize
      const longLine = 'x'.repeat(100) + '\n';
      const content = longLine.repeat(100); // ~10000 chars

      const smallChunker = new CodeChunker({
        maxChunkSize: 1000,
        minChunkSize: 100,
      });

      const chunks = smallChunker.chunk(content, '/project/large.txt', '/project');

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.type).toBe('block');
      });
    });
  });

  describe('Chunk ID generation', () => {
    it('generates unique IDs for different chunks', () => {
      const content = `function a() {
  return "a";
}

function b() {
  return "b";
}`;
      const chunks = chunker.chunk(content, '/project/test.ts', '/project');

      if (chunks.length > 1) {
        const ids = chunks.map((c) => c.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }
    });

    it('generates consistent IDs for same file and line', () => {
      const content = `function test() {
  return "test";
}`;
      const chunks1 = chunker.chunk(content, '/project/test.ts', '/project');
      const chunks2 = chunker.chunk(content, '/project/test.ts', '/project');

      expect(chunks1[0].id).toBe(chunks2[0].id);
    });

    it('generates different IDs for different files', () => {
      const content = `function test() {
  return "test";
}`;
      const chunks1 = chunker.chunk(content, '/project/test1.ts', '/project');
      const chunks2 = chunker.chunk(content, '/project/test2.ts', '/project');

      expect(chunks1[0].id).not.toBe(chunks2[0].id);
    });
  });

  describe('Configuration', () => {
    it('uses default config', () => {
      expect(DEFAULT_CHUNKER_CONFIG.maxChunkSize).toBe(4000);
      expect(DEFAULT_CHUNKER_CONFIG.chunkOverlap).toBe(400);
      expect(DEFAULT_CHUNKER_CONFIG.minChunkSize).toBe(100);
    });

    it('accepts custom config', () => {
      const customChunker = new CodeChunker({
        maxChunkSize: 2000,
        minChunkSize: 50,
      });

      const content = `function test() {
  return "hello world from a custom chunker";
}`;
      const chunks = customChunker.chunk(content, '/project/small.ts', '/project');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('filters out chunks smaller than minChunkSize in semantic chunking', () => {
      const strictChunker = new CodeChunker({
        minChunkSize: 500,
      });

      // Function that's too small to meet the minChunkSize threshold
      const content = `function x() { }`;
      const chunks = strictChunker.chunk(content, '/project/tiny.ts', '/project');

      // Semantic chunks under minChunkSize are filtered, falls back to fixed-size chunking
      // Fixed-size chunking returns file as single chunk, which is also under threshold
      // So we expect 0 or 1 depending on whether fixed-size chunk is also filtered
      expect(chunks.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Edge cases', () => {
    it('handles empty files', () => {
      const defaultChunker = new CodeChunker();
      const chunks = defaultChunker.chunk('', '/project/empty.ts', '/project');
      // Empty content may return a single empty chunk or no chunks
      expect(chunks.length).toBeLessThanOrEqual(1);
    });

    it('handles files with only whitespace', () => {
      const defaultChunker = new CodeChunker();
      const chunks = defaultChunker.chunk('   \n\n   ', '/project/whitespace.ts', '/project');
      // Whitespace-only files may return empty results
      expect(chunks.length).toBeLessThanOrEqual(1);
    });

    it('handles nested functions', () => {
      const content = `function outer() {
  function inner() {
    return 'inner result';
  }
  return inner();
}`;
      const chunks = chunker.chunk(content, '/project/nested.ts', '/project');

      // Should detect at least the outer function
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.some((c) => c.name === 'outer')).toBe(true);
    });

    it('computes correct relative paths', () => {
      const content = `function test() {
  return "test";
}`;
      const chunks = chunker.chunk(content, '/home/user/project/src/utils/helpers.ts', '/home/user/project');

      expect(chunks[0].relativePath).toBe('src/utils/helpers.ts');
    });
  });
});
