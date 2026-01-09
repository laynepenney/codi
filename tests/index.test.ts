import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ToolRegistry } from '../src/tools/registry';
import { BaseTool } from '../src/tools/base';
import { Agent } from '../src/agent';

// Tool implementations
import { registerDefaultTools, globalRegistry } from '../src/tools';
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

// Providers
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible';
import { AnthropicProvider } from '../src/providers/anthropic';

// -----------------------------
// Test helper: simple tool implementation
// -----------------------------
class TestTool extends BaseTool {
  constructor(
    private _name: string,
    private _description: string,
  ) {
    super();
  }

  getDefinition() {
    return {
      name: this._name,
      description: this._description,
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    };
  }

  async execute(): Promise<string> {
    return 'ok';
  }
}

// -----------------------------
// helpers
// -----------------------------
function tmpDir(prefix = 'codi-test-') {
  return path.join(process.cwd(), `.tmp/${prefix}${Math.random().toString(16).slice(2)}`);
}

describe('public exports (src/tools/index.ts)', () => {
  it('exports expected classes and helpers', () => {
    expect(typeof Agent).toBe('function');
    expect(typeof registerDefaultTools).toBe('function');
    expect(typeof ToolRegistry).toBe('function');

    // tools are classes
    expect(typeof ReadFileTool).toBe('function');
    expect(typeof WriteFileTool).toBe('function');
    expect(typeof EditFileTool).toBe('function');
    expect(typeof PatchFileTool).toBe('function');
    expect(typeof InsertLineTool).toBe('function');
    expect(typeof GlobTool).toBe('function');
    expect(typeof GrepTool).toBe('function');
    expect(typeof ListDirectoryTool).toBe('function');
    expect(typeof BashTool).toBe('function');
  });
});

describe('ToolRegistry', () => {
  it('registers and retrieves tools by name', () => {
    const reg = new ToolRegistry();
    const t = new TestTool('hello', 'test tool');

    reg.register(t);
    expect(reg.get('hello')).toBe(t);
    expect(reg.listTools()).toContain('hello');
  });

  it('returns undefined for missing tool', () => {
    const reg = new ToolRegistry();
    expect(reg.get('missing')).toBeUndefined();
  });

  it('throws when registering the same tool name twice', () => {
    const reg = new ToolRegistry();
    const t1 = new TestTool('dup', 'one');
    const t2 = new TestTool('dup', 'two');

    reg.register(t1);
    expect(() => reg.register(t2)).toThrow(/already registered/i);
    expect(reg.get('dup')?.getDefinition().description).toBe('one');
  });

  it('executes a tool and returns result', async () => {
    const reg = new ToolRegistry();
    const t = new TestTool('test', 'test tool');
    reg.register(t);

    const result = await reg.execute({ id: 'call_123', name: 'test', input: {} });
    expect(result.tool_use_id).toBe('call_123');
    expect(result.content).toBe('ok');
    expect(result.is_error).toBe(false);
  });

  it('returns error result for unknown tool', async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute({ id: 'call_456', name: 'unknown', input: {} });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Unknown tool');
  });
});

describe('BaseTool', () => {
  it('getName returns the tool name from definition', () => {
    const t = new TestTool('mytool', 'desc');
    expect(t.getName()).toBe('mytool');
  });

  it('run wraps execute result in ToolResult', async () => {
    const t = new TestTool('wrapper', 'test');
    const result = await t.run('id_1', {});
    expect(result.tool_use_id).toBe('id_1');
    expect(result.content).toBe('ok');
    expect(result.is_error).toBe(false);
  });

  it('run catches errors and returns error result', async () => {
    class FailingTool extends BaseTool {
      getDefinition() {
        return {
          name: 'fail',
          description: 'fails',
          input_schema: { type: 'object' as const, properties: {}, required: [] },
        };
      }
      async execute(): Promise<string> {
        throw new Error('boom');
      }
    }

    const t = new FailingTool();
    const result = await t.run('id_2', {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('boom');
  });
});

describe('Tool implementations (filesystem / process tools)', () => {
  let root: string;
  let prevCwd: string;

  beforeEach(async () => {
    root = tmpDir();
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'a.txt'), 'hello');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'b.txt'), 'world');
    prevCwd = process.cwd();
    process.chdir(root);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('ReadFileTool reads file contents', async () => {
    const tool = new ReadFileTool();
    const out = await tool.execute({ path: 'a.txt' });
    expect(out).toContain('hello');
  });

  it('ReadFileTool errors on missing file', async () => {
    const tool = new ReadFileTool();
    await expect(tool.execute({ path: 'nope.txt' })).rejects.toThrow(/not found/i);
  });

  it('WriteFileTool writes file and returns success message', async () => {
    const tool = new WriteFileTool();
    const out = await tool.execute({ path: 'new.txt', content: 'x' });
    expect(out).toMatch(/wrote/i);
    await expect(fs.readFile(path.join(root, 'new.txt'), 'utf8')).resolves.toBe('x');
  });

  it('EditFileTool replaces exact substring', async () => {
    await fs.writeFile(path.join(root, 'edit.txt'), 'one two three');
    const tool = new EditFileTool();
    const out = await tool.execute({
      path: 'edit.txt',
      old_string: 'two',
      new_string: 'TWO',
    });
    expect(out).toMatch(/edited/i);
    await expect(fs.readFile(path.join(root, 'edit.txt'), 'utf8')).resolves.toBe('one TWO three');
  });

  it('EditFileTool throws when old_string not found', async () => {
    await fs.writeFile(path.join(root, 'edit2.txt'), 'abc');
    const tool = new EditFileTool();
    await expect(
      tool.execute({ path: 'edit2.txt', old_string: 'zzz', new_string: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('InsertLineTool inserts at given line', async () => {
    await fs.writeFile(path.join(root, 'i.txt'), '1\n2\n3\n');
    const tool = new InsertLineTool();
    const out = await tool.execute({ path: 'i.txt', line: 2, content: 'X' });
    expect(out).toMatch(/inserted/i);
    await expect(fs.readFile(path.join(root, 'i.txt'), 'utf8')).resolves.toBe('1\nX\n2\n3\n');
  });

  it('GlobTool returns matching paths', async () => {
    const tool = new GlobTool();
    const out = await tool.execute({ pattern: '**/*.txt' });
    expect(out).toContain('a.txt');
    expect(out).toContain('sub/b.txt');
  });

  it('GrepTool finds matches in files', async () => {
    const tool = new GrepTool();
    const out = await tool.execute({ pattern: 'world', path: '.' });
    expect(out).toContain('sub/b.txt');
    expect(out).toContain('world');
  });

  it('ListDirectoryTool lists directory contents', async () => {
    const tool = new ListDirectoryTool();
    const out = await tool.execute({ path: '.' });
    expect(out).toContain('a.txt');
    expect(out).toContain('sub');
  });

  it('BashTool runs command', async () => {
    const tool = new BashTool();
    const out = await tool.execute({ command: 'echo hello' });
    expect(out).toContain('hello');
  });
});

describe('registerDefaultTools', () => {
  it('registers default tools in the global registry', async () => {
    // Reset modules to get fresh registry
    vi.resetModules();

    const { registerDefaultTools, globalRegistry } = await import('../src/tools');
    registerDefaultTools();
    const names = globalRegistry.listTools();
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

describe('Agent', () => {
  it('can be instantiated with minimal config', () => {
    const mockProvider = {
      chat: vi.fn(),
      streamChat: vi.fn(),
      supportsToolUse: () => true,
      getName: () => 'mock',
      getModel: () => 'mock-model',
    };

    const agent = new Agent({
      provider: mockProvider as any,
      toolRegistry: new ToolRegistry(),
    });

    expect(agent).toBeInstanceOf(Agent);
  });

  it('clearHistory resets message history', () => {
    const mockProvider = {
      chat: vi.fn(),
      streamChat: vi.fn(),
      supportsToolUse: () => true,
      getName: () => 'mock',
      getModel: () => 'mock-model',
    };

    const agent = new Agent({
      provider: mockProvider as any,
      toolRegistry: new ToolRegistry(),
    });

    // Initially empty
    expect(agent.getHistory()).toHaveLength(0);

    // Clear should work even when empty
    agent.clearHistory();
    expect(agent.getHistory()).toHaveLength(0);
  });

  it('getContextInfo returns token and message counts', () => {
    const mockProvider = {
      chat: vi.fn(),
      streamChat: vi.fn(),
      supportsToolUse: () => true,
      getName: () => 'mock',
      getModel: () => 'mock-model',
    };

    const agent = new Agent({
      provider: mockProvider as any,
      toolRegistry: new ToolRegistry(),
    });

    const info = agent.getContextInfo();
    expect(info).toHaveProperty('tokens');
    expect(info).toHaveProperty('messages');
    expect(info).toHaveProperty('hasSummary');
    expect(info.messages).toBe(0);
    expect(info.hasSummary).toBe(false);
  });
});

describe('Providers', () => {
  it('OpenAICompatibleProvider can be instantiated', () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      model: 'gpt-4',
    });

    expect(provider.getName()).toBe('OpenAI');
    expect(provider.getModel()).toBe('gpt-4');
    expect(provider.supportsToolUse()).toBe(true);
  });

  it('AnthropicProvider can be instantiated', () => {
    const provider = new AnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-3-opus',
    });

    expect(provider.getName()).toBe('Anthropic');
    expect(provider.getModel()).toBe('claude-3-opus');
    expect(provider.supportsToolUse()).toBe(true);
  });
});
