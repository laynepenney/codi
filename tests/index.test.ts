import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ToolRegistry } from '../src/tools/registry';
import { BaseTool } from '../src/tools/base';
import { Agent } from '../src/agent';

// Helper factories used by src code
import { registerDefaultTools } from '../src/tools';
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  PatchFileTool,
  InsertLineTool,
  GlobTool,
  GrepTool,
  ListDirectoryTool,
  BashTool,
} from '../src/tools';

// Note: provider implementations depend on external SDKs/network.
// We test their local, deterministic behaviors by mocking underlying clients.
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible';
import { AnthropicProvider } from '../src/providers/anthropic';

// -----------------------------
// helpers
// -----------------------------
function tmpDir(prefix = 'codi-test-') {
  return path.join(process.cwd(), `.tmp/${prefix}${Math.random().toString(16).slice(2)}`);
}

describe('public exports (src/index.ts)', () => {
  it('re-exports expected factories and classes', () => {
    expect(typeof Agent).toBe('function');
    expect(typeof createAgent).toBe('function');
    expect(typeof createContext).toBe('function');
    expect(typeof createTools).toBe('function');
    expect(typeof createToolRegistry).toBe('function');
    expect(typeof createTool).toBe('function');
    expect(typeof createToolSet).toBe('function');
  });
});

describe('ToolRegistry', () => {
  it('registers and retrieves tools by name', () => {
    const reg = new ToolRegistry();
    const t = createTool({
      name: 'hello',
      description: 'test tool',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => 'ok',
    });

    reg.register(t);
    expect(reg.get('hello')).toBe(t);
    expect(reg.list().map((x) => x.name)).toContain('hello');
  });

  it('throws when retrieving missing tool', () => {
    const reg = new ToolRegistry();
    expect(() => reg.get('missing')).toThrow(/Tool not found/i);
  });

  it('overwrites an existing tool when registering same name', () => {
    const reg = new ToolRegistry();
    const t1 = createTool({
      name: 'dup',
      description: 'one',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => '1',
    });
    const t2 = createTool({
      name: 'dup',
      description: 'two',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => '2',
    });

    reg.register(t1);
    reg.register(t2);
    expect(reg.get('dup').description).toBe('two');
  });
});

describe('createTool & BaseTool contract', () => {
  it('createTool returns an instance of BaseTool and preserves metadata', async () => {
    const tool = createTool({
      name: 'adder',
      description: 'adds',
      parameters: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
        additionalProperties: false,
      },
      execute: async ({ a, b }: any) => a + b,
    });

    expect(tool).toBeInstanceOf(BaseTool);
    expect(tool.name).toBe('adder');
    expect(tool.description).toBe('adds');
    expect(tool.parameters.required).toEqual(['a', 'b']);

    await expect(tool.execute({ a: 1, b: 2 } as any)).resolves.toBe(3);
  });

  it('BaseTool.toJSON returns OpenAI tool schema shape', () => {
    const tool = createTool({
      name: 't',
      description: 'd',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => null,
    });

    const json = tool.toJSON();
    expect(json).toEqual({
      type: 'function',
      function: {
        name: 't',
        description: 'd',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    });
  });
});

describe('Tool implementations (filesystem / process tools)', () => {
  const root = tmpDir();

  beforeEach(async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'a.txt'), 'hello');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'b.txt'), 'world');
  });

  afterEach(async () => {
    // best-effort cleanup
    await fs.rm(root, { recursive: true, force: true });
  });

  it('ReadFileTool reads file contents', async () => {
    const tool = new ReadFileTool({ rootDir: root });
    const out = await tool.execute({ path: 'a.txt' } as any);
    expect(out).toContain('hello');
  });

  it('ReadFileTool errors on missing file', async () => {
    const tool = new ReadFileTool({ rootDir: root });
    await expect(tool.execute({ path: 'nope.txt' } as any)).rejects.toThrow();
  });

  it('WriteFileTool writes file and returns success message', async () => {
    const tool = new WriteFileTool({ rootDir: root });
    const out = await tool.execute({ path: 'new.txt', content: 'x' } as any);
    expect(out).toMatch(/Wrote/i);
    await expect(fs.readFile(path.join(root, 'new.txt'), 'utf8')).resolves.toBe('x');
  });

  it('EditFileTool replaces exact substring (happy path)', async () => {
    await fs.writeFile(path.join(root, 'edit.txt'), 'one two three');
    const tool = new EditFileTool({ rootDir: root });
    const out = await tool.execute({
      path: 'edit.txt',
      old_string: 'two',
      new_string: 'TWO',
    } as any);
    expect(out).toMatch(/Edited/i);
    await expect(fs.readFile(path.join(root, 'edit.txt'), 'utf8')).resolves.toBe('one TWO three');
  });

  it('EditFileTool throws when old_string not found', async () => {
    await fs.writeFile(path.join(root, 'edit2.txt'), 'abc');
    const tool = new EditFileTool({ rootDir: root });
    await expect(
      tool.execute({ path: 'edit2.txt', old_string: 'zzz', new_string: 'x' } as any),
    ).rejects.toThrow(/not found/i);
  });

  it('PatchFileTool applies unified diff', async () => {
    await fs.writeFile(path.join(root, 'p.txt'), 'a\nb\n');
    const tool = new PatchFileTool({ rootDir: root });
    const patch = [
      '*** Begin Patch',
      '*** Update File: p.txt',
      '@@',
      '-a',
      '+A',
      '*** End Patch',
      '',
    ].join('\n');

    const out = await tool.execute({ path: 'p.txt', patch } as any);
    expect(out).toMatch(/Applied patch/i);
    await expect(fs.readFile(path.join(root, 'p.txt'), 'utf8')).resolves.toBe('A\nb\n');
  });

  it('PatchFileTool throws on invalid patch format', async () => {
    await fs.writeFile(path.join(root, 'p2.txt'), 'a');
    const tool = new PatchFileTool({ rootDir: root });
    await expect(tool.execute({ path: 'p2.txt', patch: 'not a patch' } as any)).rejects.toThrow();
  });

  it('InsertLineTool inserts before a given line', async () => {
    await fs.writeFile(path.join(root, 'i.txt'), '1\n2\n3\n');
    const tool = new InsertLineTool({ rootDir: root });
    const out = await tool.execute({ path: 'i.txt', line: 2, content: 'X' } as any);
    expect(out).toMatch(/Inserted/i);
    await expect(fs.readFile(path.join(root, 'i.txt'), 'utf8')).resolves.toBe('1\nX\n2\n3\n');
  });

  it('InsertLineTool throws on invalid line number', async () => {
    const tool = new InsertLineTool({ rootDir: root });
    await expect(tool.execute({ path: 'a.txt', line: 0, content: 'X' } as any)).rejects.toThrow(
      /line/i,
    );
  });

  it('GlobTool returns matching paths relative to rootDir', async () => {
    const tool = new GlobTool({ rootDir: root });
    const out = await tool.execute({ pattern: '**/*.txt' } as any);
    // tool returns JSON string
    const arr = JSON.parse(out);
    expect(arr).toEqual(expect.arrayContaining(['a.txt', 'sub/b.txt']));
  });

  it('GrepTool finds matches in files', async () => {
    const tool = new GrepTool({ rootDir: root });
    const out = await tool.execute({ pattern: 'world', path: '.' } as any);
    const matches = JSON.parse(out) as Array<any>;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toHaveProperty('file');
    expect(matches[0]).toHaveProperty('line');
    expect(matches[0]).toHaveProperty('text');
  });

  it('ListDirectoryTool lists directory contents', async () => {
    const tool = new ListDirectoryTool({ rootDir: root });
    const out = await tool.execute({ path: '.' } as any);
    const entries = JSON.parse(out) as Array<any>;
    const names = entries.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['a.txt', 'sub']));
  });

  it('BashTool runs command with cwd rootDir', async () => {
    const tool = new BashTool({ rootDir: root });
    const out = await tool.execute({ command: 'node -p "1+1"' } as any);
    const parsed = JSON.parse(out);
    expect(parsed.stdout.trim()).toBe('2');
    expect(parsed.code).toBe(0);
  });
});

describe('createTools (toolset composition)', () => {
  it('returns a default tool set with expected tool names', () => {
    const tools = createTools({ rootDir: process.cwd() });
    const names = tools.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'read_file',
        'write_file',
        'edit_file',
        'patch_file',
        'insert_line',
        'glob',
        'grep',
        'list_directory',
        'bash',
      ]),
    );
  });
});

describe('Agent minimal behavior (no network)', () => {
  it('createAgent produces an Agent with configured tools and context', () => {
    const agent = createAgent({
      rootDir: process.cwd(),
      provider: {
        name: 'mock',
        complete: vi.fn(async () => ({
          id: '1',
          model: 'mock',
          content: 'ok',
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      } as any,
    });

    expect(agent).toBeInstanceOf(Agent);
    expect(agent.tools).toBeTruthy();
    expect(agent.context).toBeTruthy();
  });
});

describe('Providers (mocked external clients)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('OpenAICompatibleProvider maps response into internal shape', async () => {
    const mockCreate = vi.fn(async () => ({
      id: 'resp_1',
      model: 'gpt-x',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello',
          },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    }));

    const provider = new OpenAICompatibleProvider({
      name: 'openai-compatible',
      model: 'gpt-x',
      client: {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as any,
    });

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    } as any);

    expect(mockCreate).toHaveBeenCalled();
    expect(result).toEqual({
      id: 'resp_1',
      model: 'gpt-x',
      content: 'Hello',
      usage: { input_tokens: 3, output_tokens: 5 },
    });
  });

  it('AnthropicProvider maps response into internal shape', async () => {
    const mockCreate = vi.fn(async () => ({
      id: 'a_1',
      model: 'claude-x',
      content: [{ type: 'text', text: 'Yo' }],
      usage: { input_tokens: 2, output_tokens: 7 },
    }));

    const provider = new AnthropicProvider({
      name: 'anthropic',
      model: 'claude-x',
      client: {
        messages: {
          create: mockCreate,
        },
      } as any,
    });

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    } as any);

    expect(mockCreate).toHaveBeenCalled();
    expect(result).toEqual({
      id: 'a_1',
      model: 'claude-x',
      content: 'Yo',
      usage: { input_tokens: 2, output_tokens: 7 },
    });
  });
});
