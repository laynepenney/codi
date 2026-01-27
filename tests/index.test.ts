// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

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

// Test helpers
import { createMinimalProvider, asProvider } from './helpers/mock-provider';

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

  beforeEach(async () => {
    root = tmpDir();
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'a.txt'), 'hello');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'b.txt'), 'world');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('ReadFileTool reads file contents', async () => {
    const tool = new ReadFileTool();
    const out = await tool.execute({ path: path.join(root, 'a.txt') });
    expect(out).toContain('hello');
  });

  it('ReadFileTool errors on missing file', async () => {
    const tool = new ReadFileTool();
    await expect(tool.execute({ path: path.join(root, 'nope.txt') })).rejects.toThrow(/not found/i);
  });

  it('WriteFileTool writes file and returns success message', async () => {
    const tool = new WriteFileTool();
    const out = await tool.execute({ path: path.join(root, 'new.txt'), content: 'x' });
    expect(out).toMatch(/wrote/i);
    await expect(fs.readFile(path.join(root, 'new.txt'), 'utf8')).resolves.toBe('x');
  });

  it('EditFileTool replaces exact substring', async () => {
    await fs.writeFile(path.join(root, 'edit.txt'), 'one two three');
    const tool = new EditFileTool();
    const out = await tool.execute({
      path: path.join(root, 'edit.txt'),
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
      tool.execute({ path: path.join(root, 'edit2.txt'), old_string: 'zzz', new_string: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('InsertLineTool inserts at given line', async () => {
    await fs.writeFile(path.join(root, 'i.txt'), '1\n2\n3\n');
    const tool = new InsertLineTool();
    const out = await tool.execute({ path: path.join(root, 'i.txt'), line: 2, content: 'X' });
    expect(out).toMatch(/inserted/i);
    await expect(fs.readFile(path.join(root, 'i.txt'), 'utf8')).resolves.toBe('1\nX\n2\n3\n');
  });

  it('GlobTool returns matching paths', async () => {
    const tool = new GlobTool();
    const out = await tool.execute({ pattern: '**/*.txt', cwd: root });
    expect(out).toContain('a.txt');
    expect(out).toContain('sub/b.txt');
  });

  it('GrepTool finds matches in files', async () => {
    const tool = new GrepTool();
    const out = await tool.execute({ pattern: 'world', path: root });
    expect(out).toContain('sub/b.txt');
    expect(out).toContain('world');
  });

  it('ListDirectoryTool lists directory contents', async () => {
    const tool = new ListDirectoryTool();
    const out = await tool.execute({ path: root });
    expect(out).toContain('a.txt');
    expect(out).toContain('sub');
  });

  it('BashTool runs command', async () => {
    const tool = new BashTool();
    const out = await tool.execute({ command: 'echo hello', cwd: root });
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
    const provider = createMinimalProvider();

    const agent = new Agent({
      provider,
      toolRegistry: new ToolRegistry(),
    });

    expect(agent).toBeInstanceOf(Agent);
  });

  it('clearHistory resets message history', () => {
    const provider = createMinimalProvider();

    const agent = new Agent({
      provider,
      toolRegistry: new ToolRegistry(),
    });

    // Initially empty
    expect(agent.getHistory()).toHaveLength(0);

    // Clear should work even when empty
    agent.clearHistory();
    expect(agent.getHistory()).toHaveLength(0);
  });

  it('getContextInfo returns token and message counts', () => {
    const provider = createMinimalProvider();

    const agent = new Agent({
      provider,
      toolRegistry: new ToolRegistry(),
    });

    const info = agent.getContextInfo();
    expect(info).toHaveProperty('tokens');
    expect(info).toHaveProperty('messages');
    expect(info).toHaveProperty('hasSummary');
    expect(info.messages).toBe(0);
    expect(info.hasSummary).toBe(false);
  });

  it('extracts tool calls from reasoning when content is empty', async () => {
    const toolRegistry = new ToolRegistry();
    let receivedInput: Record<string, unknown> | null = null;

    class CaptureTool extends BaseTool {
      getDefinition() {
        return {
          name: 'capture',
          description: 'capture input',
          input_schema: {
            type: 'object' as const,
            properties: {
              value: { type: 'number' },
            },
            required: ['value'],
          },
        };
      }

      async execute(input: Record<string, unknown>): Promise<string> {
        receivedInput = input;
        return 'ok';
      }
    }

    toolRegistry.register(new CaptureTool());

    const provider = asProvider({
      streamChat: vi.fn()
        .mockImplementationOnce(async (_messages, _tools, _onChunk, _systemPrompt, onReasoningChunk) => {
          const reasoning = '[Calling capture]: {"value": 42}';
          onReasoningChunk?.(reasoning);
          return {
            content: '',
            toolCalls: [],
            stopReason: 'end_turn' as const,
            reasoningContent: reasoning,
          };
        })
        .mockImplementationOnce(async () => ({
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn' as const,
        })),
      supportsToolUse: () => true,
      getName: () => 'mock',
      getModel: () => 'mock-model',
      getContextWindow: () => 128000,
    });

    const agent = new Agent({
      provider,
      toolRegistry,
    });

    const result = await agent.chat('continue');
    expect(result).toBe('done');
    expect(receivedInput).toEqual({ value: 42 });
  });

  it('setProvider updates maxContextTokens when not explicitly set', () => {
    // Provider with large context window (like Claude)
    const largeContextProvider = createMinimalProvider({
      name: 'Claude',
      model: 'claude-sonnet-4',
      contextWindow: 200000,
    });

    // Provider with small context window (like GPT-4 base)
    const smallContextProvider = createMinimalProvider({
      name: 'OpenAI',
      model: 'gpt-4',
      contextWindow: 8192,
    });

    const agent = new Agent({
      provider: largeContextProvider,
      toolRegistry: new ToolRegistry(),
    });

    // Initial maxTokens should use adaptive calculation (contextWindow - overhead)
    // For 200k context, should be much larger than the old 40% (80k)
    const initialTokens = agent.getContextInfo().maxTokens;
    expect(initialTokens).toBeGreaterThan(80000); // Better than old 40%
    expect(initialTokens).toBeLessThan(200000); // But still leaves room for overhead

    // Switch to smaller provider
    agent.setProvider(smallContextProvider);

    // maxTokens should be recalculated for new provider
    // For 8k context (small tier), minimum viable is 15% = 1229 tokens
    // Since output reserve (8192) exceeds context, we hit the floor value
    const newTokens = agent.getContextInfo().maxTokens;
    expect(newTokens).toBeLessThan(initialTokens); // Should be smaller
    expect(newTokens).toBeGreaterThanOrEqual(Math.floor(8192 * 0.15)); // At least minimum 15% (small tier)
  });

  it('setProvider preserves maxContextTokens when explicitly set', () => {
    const largeContextProvider = createMinimalProvider({
      name: 'Claude',
      model: 'claude-sonnet-4',
      contextWindow: 200000,
    });

    const smallContextProvider = createMinimalProvider({
      name: 'OpenAI',
      model: 'gpt-4',
      contextWindow: 8192,
    });

    // Explicitly set maxContextTokens
    const agent = new Agent({
      provider: largeContextProvider,
      toolRegistry: new ToolRegistry(),
      maxContextTokens: 50000,
    });

    expect(agent.getContextInfo().maxTokens).toBe(50000);

    // Switch provider - should preserve explicit setting
    agent.setProvider(smallContextProvider);

    // Should still be 50000, not recalculated
    expect(agent.getContextInfo().maxTokens).toBe(50000);
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
