// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  tryFixJson,
  tryParseJson,
  extractToolCallsFromText,
} from '../src/utils/json-parser.js';

describe('json-parser', () => {
  describe('tryFixJson', () => {
    it('converts single-quoted values to double quotes', () => {
      // Note: only fixes values after colons, not keys
      const input = '{"key": \'value\'}';
      const fixed = tryFixJson(input);
      expect(fixed).toContain('"value"');
    });

    it('handles multi-line content with single-quoted values', () => {
      const input = `{
        "name": 'test',
        "value": 'hello'
      }`;
      const fixed = tryFixJson(input);
      expect(fixed).toContain('"test"');
      expect(fixed).toContain('"hello"');
    });

    it('preserves valid double-quoted JSON', () => {
      const input = '{"key": "value"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe(input);
    });

    it('handles escaped characters in single-quoted values', () => {
      const input = '{"path": \'C:\\\\Users\\\\test\'}';
      const fixed = tryFixJson(input);
      expect(fixed).toContain('"C:\\\\Users\\\\test"');
    });

    it('handles empty strings', () => {
      const input = '{"empty": \'\'}';
      const fixed = tryFixJson(input);
      expect(fixed).toContain('""');
    });
  });

  describe('tryParseJson', () => {
    it('parses valid JSON', () => {
      const result = tryParseJson('{"name": "test", "value": 42}');
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('parses JSON with single-quoted values after fixing', () => {
      // Note: tryFixJson only fixes single-quoted values (after colons), not keys
      const result = tryParseJson('{"name": \'test\'}');
      expect(result).toEqual({ name: 'test' });
    });

    it('returns null for invalid JSON', () => {
      const result = tryParseJson('not json at all');
      expect(result).toBeNull();
    });

    it('returns null for unfixable JSON', () => {
      const result = tryParseJson('{broken: json without quotes}');
      expect(result).toBeNull();
    });

    it('parses arrays', () => {
      const result = tryParseJson('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('parses nested objects', () => {
      const result = tryParseJson('{"outer": {"inner": "value"}}');
      expect(result).toEqual({ outer: { inner: 'value' } });
    });

    it('handles empty objects and arrays', () => {
      expect(tryParseJson('{}')).toEqual({});
      expect(tryParseJson('[]')).toEqual([]);
    });

    it('handles null and boolean values', () => {
      const result = tryParseJson('{"a": null, "b": true, "c": false}');
      expect(result).toEqual({ a: null, b: true, c: false });
    });
  });

  describe('extractToolCallsFromText', () => {
    const availableTools = ['read_file', 'write_file', 'bash', 'glob'];

    describe('pattern 1: inline JSON with name and arguments', () => {
      it('extracts tool call with "arguments" key', () => {
        const text = 'I will read the file: {"name": "read_file", "arguments": {"path": "test.txt"}}';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
        expect(calls[0].input).toEqual({ path: 'test.txt' });
      });

      it('extracts tool call with "parameters" key', () => {
        const text = '{"name": "bash", "parameters": {"command": "ls -la"}}';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('bash');
        expect(calls[0].input).toEqual({ command: 'ls -la' });
      });

      it('extracts tool call with "input" key', () => {
        const text = '{"name": "glob", "input": {"pattern": "*.ts"}}';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('glob');
        expect(calls[0].input).toEqual({ pattern: '*.ts' });
      });

      it('extracts multiple tool calls', () => {
        const text = `
          {"name": "read_file", "arguments": {"path": "a.txt"}}
          {"name": "read_file", "arguments": {"path": "b.txt"}}
        `;
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(2);
        expect(calls[0].input).toEqual({ path: 'a.txt' });
        expect(calls[1].input).toEqual({ path: 'b.txt' });
      });

      it('ignores unknown tools', () => {
        const text = '{"name": "unknown_tool", "arguments": {"foo": "bar"}}';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(0);
      });

      it('generates unique IDs', () => {
        const text = `
          {"name": "bash", "arguments": {"command": "ls"}}
          {"name": "bash", "arguments": {"command": "pwd"}}
        `;
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls[0].id).not.toBe(calls[1].id);
        expect(calls[0].id).toMatch(/^extracted_/);
      });
    });

    describe('pattern 2: JSON in code blocks', () => {
      it('extracts from json code block', () => {
        const text = `
Here's the tool call:
\`\`\`json
{"name": "read_file", "arguments": {"path": "config.json"}}
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
      });

      it('extracts from unmarked code block', () => {
        const text = `
\`\`\`
{"name": "bash", "arguments": {"command": "echo hello"}}
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('bash');
      });

      it('extracts array of tool calls from code block', () => {
        const text = `
\`\`\`json
[
  {"name": "read_file", "arguments": {"path": "a.txt"}},
  {"name": "write_file", "arguments": {"path": "b.txt", "content": "test"}}
]
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(2);
        expect(calls[0].name).toBe('read_file');
        expect(calls[1].name).toBe('write_file');
      });

      it('ignores non-object/array code blocks', () => {
        const text = `
\`\`\`
just some text
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(0);
      });

      it('ignores code blocks without tool name', () => {
        const text = `
\`\`\`json
{"foo": "bar"}
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(0);
      });
    });

    describe('edge cases', () => {
      it('returns empty array for text without tool calls', () => {
        const text = 'Just a regular response without any tools';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toEqual([]);
      });

      it('handles empty available tools list', () => {
        const text = '{"name": "read_file", "arguments": {"path": "test.txt"}}';
        const calls = extractToolCallsFromText(text, []);

        expect(calls).toHaveLength(0);
      });

      it('handles nested objects in arguments', () => {
        const text = '{"name": "write_file", "arguments": {"path": "test.json", "content": "{\\"key\\": \\"value\\"}"}}';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
        expect(calls[0].input).toHaveProperty('path');
      });

      it('handles whitespace variations', () => {
        const text = '{  "name"  :  "bash"  ,  "arguments"  :  {  "command"  :  "ls"  }  }';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
      });

      it('prefers inline pattern over code block pattern', () => {
        // When inline pattern matches, code block pattern should not run
        const text = '{"name": "bash", "arguments": {"command": "ls"}}';
        const calls = extractToolCallsFromText(text, availableTools);

        expect(calls).toHaveLength(1);
      });
    });
  });
});
