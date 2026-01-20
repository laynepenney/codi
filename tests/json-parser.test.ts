// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

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

    it('escapes raw newlines inside strings', () => {
      const input = '{"command": "line1\nline2"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe('{"command": "line1\\nline2"}');
    });

    it('escapes multiple raw newlines inside strings', () => {
      const input = '{"notes": "What\'s New\n\nVideo Upload:\n- Added feature"}';
      const fixed = tryFixJson(input);
      expect(fixed).toContain('\\n\\n');
      expect(fixed).not.toContain('\n');
    });

    it('preserves newlines outside of strings', () => {
      const input = '{\n  "key": "value"\n}';
      const fixed = tryFixJson(input);
      // Newlines outside strings should be preserved
      expect(fixed).toBe('{\n  "key": "value"\n}');
    });

    it('handles CRLF in strings', () => {
      const input = '{"text": "line1\r\nline2"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe('{"text": "line1\\nline2"}');
    });

    it('handles already escaped newlines', () => {
      const input = '{"text": "line1\\nline2"}';
      const fixed = tryFixJson(input);
      // Already escaped should remain escaped (not double-escaped)
      expect(fixed).toBe('{"text": "line1\\nline2"}');
    });

    it('removes trailing quote after number before closing brace', () => {
      const input = '{"max_lines":15"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe('{"max_lines":15}');
    });

    it('removes trailing quote after number before comma', () => {
      const input = '{"count":42", "name":"test"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe('{"count":42, "name":"test"}');
    });

    it('removes trailing quote after decimal number', () => {
      const input = '{"value":3.14"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe('{"value":3.14}');
    });

    it('removes trailing quote after negative number', () => {
      const input = '{"offset":-10"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe('{"offset":-10}');
    });

    it('preserves valid quoted string after number', () => {
      // This should NOT be affected - number followed by proper string
      const input = '{"a":1,"b":"test"}';
      const fixed = tryFixJson(input);
      expect(fixed).toBe('{"a":1,"b":"test"}');
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

    it('parses JSON with raw newlines inside strings after fixing', () => {
      const input = '{"command": "gh release create --notes \\"What\'s New\n\n- Feature 1\n- Feature 2\\""}';
      const result = tryParseJson(input);
      expect(result).not.toBeNull();
      expect((result as Record<string, string>).command).toContain("What's New");
    });

    it('parses bash command with escaped newlines', () => {
      // Input has escaped \n which JSON interprets as actual newline
      const input = '{"command": "echo \\"line1\\nline2\\""}';
      const result = tryParseJson(input);
      // After JSON parsing, \\n becomes actual newline character
      expect(result).toEqual({ command: 'echo "line1\nline2"' });
    });
  });

  describe('extractToolCallsFromText', () => {
    const toolNames = ['read_file', 'write_file', 'bash', 'glob'];
    const toolDefinitions = toolNames.map((name) => ({
      name,
      description: `${name} tool`,
      input_schema: { type: 'object', properties: {} },
    }));

    describe('pattern 1: inline JSON with name and arguments', () => {
      it('extracts tool call with "arguments" key', () => {
        const text = 'I will read the file: {"name": "read_file", "arguments": {"path": "test.txt"}}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
        expect(calls[0].input).toEqual({ path: 'test.txt' });
      });

      it('extracts tool call with "parameters" key', () => {
        const text = '{"name": "bash", "parameters": {"command": "ls -la"}}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('bash');
        expect(calls[0].input).toEqual({ command: 'ls -la' });
      });

      it('extracts tool call with "input" key', () => {
        const text = '{"name": "glob", "input": {"pattern": "*.ts"}}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('glob');
        expect(calls[0].input).toEqual({ pattern: '*.ts' });
      });

      it('extracts multiple tool calls', () => {
        const text = `
          {"name": "read_file", "arguments": {"path": "a.txt"}}
          {"name": "read_file", "arguments": {"path": "b.txt"}}
        `;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(2);
        expect(calls[0].input).toEqual({ path: 'a.txt' });
        expect(calls[1].input).toEqual({ path: 'b.txt' });
      });

      it('ignores unknown tools', () => {
        const text = '{"name": "unknown_tool", "arguments": {"foo": "bar"}}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(0);
      });

      it('generates unique IDs', () => {
        const text = `
          {"name": "bash", "arguments": {"command": "ls"}}
          {"name": "bash", "arguments": {"command": "pwd"}}
        `;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls[0].id).not.toBe(calls[1].id);
        expect(calls[0].id).toMatch(/^extracted_/);
      });
    });

    describe('pattern 2: [Calling tool_name]: {json} traces', () => {
      it('extracts tool calls from calling trace format', () => {
        const text = '[Calling write_file]: {"path": "notes.txt", "content": "hello"}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('write_file');
        expect(calls[0].input).toEqual({ path: 'notes.txt', content: 'hello' });
      });

      it('extracts multiple calling trace tool calls', () => {
        const text = `
[Calling read_file]: {"path": "a.txt"}
[Calling read_file]: {"path": "b.txt"}
        `;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(2);
        expect(calls[0].input).toEqual({ path: 'a.txt' });
        expect(calls[1].input).toEqual({ path: 'b.txt' });
      });

      it('extracts tool calls from running trace format without colon', () => {
        const text = '[Running bash]{"cmd": ["bash", "-lc", "git status --porcelain"], "timeout": 100000}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('bash');
        expect(calls[0].input).toEqual({
          cmd: ['bash', '-lc', 'git status --porcelain'],
          timeout: 100000,
        });
      });
    });

    describe('pattern 3: JSON in code blocks', () => {
      it('extracts from json code block', () => {
        const text = `
Here's the tool call:
\`\`\`json
{"name": "read_file", "arguments": {"path": "config.json"}}
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
      });

      it('extracts from unmarked code block', () => {
        const text = `
\`\`\`
{"name": "bash", "arguments": {"command": "echo hello"}}
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, toolDefinitions);

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
        const calls = extractToolCallsFromText(text, toolDefinitions);

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
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(0);
      });

      it('ignores code blocks without tool name', () => {
        const text = `
\`\`\`json
{"foo": "bar"}
\`\`\`
        `;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(0);
      });
    });

    describe('pattern 4: bash code blocks as implicit tool calls', () => {
      it('extracts bash tool call from bash code block', () => {
        const text = `Let me run this command:
\`\`\`bash
find src -name "*.ts" -type f
\`\`\``;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('bash');
        expect(calls[0].input).toEqual({ command: 'find src -name "*.ts" -type f' });
      });

      it('extracts bash tool call from sh code block', () => {
        const text = `\`\`\`sh
ls -la /tmp
\`\`\``;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('bash');
        expect(calls[0].input).toEqual({ command: 'ls -la /tmp' });
      });

      it('extracts bash tool call from shell code block', () => {
        const text = `\`\`\`shell
git status
\`\`\``;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('bash');
      });

      it('extracts multiple bash commands from separate code blocks', () => {
        const text = `First command:
\`\`\`bash
ls -la
\`\`\`
Second command:
\`\`\`bash
pwd
\`\`\``;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(2);
        expect(calls[0].input).toEqual({ command: 'ls -la' });
        expect(calls[1].input).toEqual({ command: 'pwd' });
      });

      it('ignores bash blocks that look like examples or documentation', () => {
        const text = `Here's an example:
\`\`\`bash
# This is just a comment
\`\`\``;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(0);
      });

      it('ignores bash blocks with placeholder text', () => {
        const text = `\`\`\`bash
your-command-here
\`\`\``;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(0);
      });

      it('does not extract bash blocks if bash tool is not available', () => {
        const limitedTools = [{ name: 'read_file', description: 'Read files', input_schema: { type: 'object', properties: {} } }];
        const text = `\`\`\`bash
ls -la
\`\`\``;
        const calls = extractToolCallsFromText(text, limitedTools);

        expect(calls).toHaveLength(0);
      });

      it('prefers earlier patterns over bash code blocks', () => {
        // If pattern 1 matches, bash code blocks should not be used
        const text = `{"name": "bash", "arguments": {"command": "echo hello"}}
\`\`\`bash
ls -la
\`\`\``;
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].input).toEqual({ command: 'echo hello' });
      });
    });

    describe('pattern 5: read_file from natural language', () => {
      it('extracts read_file from "let me read" phrase', () => {
        const text = 'Let me read src/index.ts to understand the code.';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
        expect(calls[0].input).toEqual({ path: 'src/index.ts' });
      });

      it('extracts read_file from "I\'ll look at" phrase', () => {
        const text = "I'll look at package.json to check dependencies.";
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
        expect(calls[0].input).toEqual({ path: 'package.json' });
      });

      it('extracts read_file from backtick-wrapped path', () => {
        const text = 'Let me check `src/utils/helper.ts` for the implementation.';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].input).toEqual({ path: 'src/utils/helper.ts' });
      });

      it('does not extract non-file-like paths', () => {
        const text = 'Let me read about TypeScript.';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(0);
      });
    });

    describe('edge cases', () => {
      it('auto-corrects close tool name matches', () => {
        const text = '{"name": "readfile", "arguments": {"path": "test.txt"}}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
      });

      it('handles trailing quote after number in JSON (LLM hallucination)', () => {
        // This is a real case where the LLM outputs invalid JSON with trailing quote
        const text = '[Calling read_file]: {"offset":145,"path":"./test.kt","max_lines":15"}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
        expect(calls[0].input).toEqual({
          offset: 145,
          path: './test.kt',
          max_lines: 15,
        });
      });

      it('returns empty array for text without tool calls', () => {
        const text = 'Just a regular response without any tools';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toEqual([]);
      });

      it('handles empty available tools list', () => {
        const text = '{"name": "read_file", "arguments": {"path": "test.txt"}}';
        const calls = extractToolCallsFromText(text, []);

        expect(calls).toHaveLength(0);
      });

      it('handles nested objects in arguments', () => {
        const text = '{"name": "write_file", "arguments": {"path": "test.json", "content": "{\\"key\\": \\"value\\"}"}}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
        expect(calls[0].input).toHaveProperty('path');
      });

      it('handles whitespace variations', () => {
        const text = '{  "name"  :  "bash"  ,  "arguments"  :  {  "command"  :  "ls"  }  }';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
      });

      it('prefers inline pattern over code block pattern', () => {
        // When inline pattern matches, code block pattern should not run
        const text = '{"name": "bash", "arguments": {"command": "ls"}}';
        const calls = extractToolCallsFromText(text, toolDefinitions);

        expect(calls).toHaveLength(1);
      });
    });
  });
});
