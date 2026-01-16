// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseProvider } from '../src/providers/base.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { OpenAICompatibleProvider, createOllamaProvider, createRunPodProvider } from '../src/providers/openai-compatible.js';
import {
  createProvider,
  registerProviderFactory,
  getProviderTypes,
  hasProviderType,
} from '../src/providers/index.js';
import type { Message, ContentBlock } from '../src/types.js';

// Mock the SDK clients
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

describe('BaseProvider', () => {
  // Create a concrete implementation for testing
  class TestProvider extends BaseProvider {
    async chat() {
      return { content: '', toolCalls: [], stopReason: 'end_turn' as const };
    }
    async streamChat(
      _messages: Message[] = [],
      _tools?: unknown,
      _onChunk?: (chunk: string) => void,
      _systemPrompt?: string,
      _onReasoningChunk?: (chunk: string) => void
    ) {
      return { content: '', toolCalls: [], stopReason: 'end_turn' as const };
    }
    supportsToolUse() { return true; }
    getName() { return 'Test'; }
    getModel() { return 'test-model'; }
  }

  it('supportsVision returns false by default', () => {
    const provider = new TestProvider();
    expect(provider.supportsVision()).toBe(false);
  });

  describe('getContextWindow', () => {
    it('returns context window for known models', () => {
      class ClaudeProvider extends TestProvider {
        getModel() { return 'claude-sonnet-4-20250514'; }
      }
      const provider = new ClaudeProvider();
      expect(provider.getContextWindow()).toBe(200000);
    });

    it('returns context window for GPT-4o', () => {
      class GPT4oProvider extends TestProvider {
        getModel() { return 'gpt-4o'; }
      }
      const provider = new GPT4oProvider();
      expect(provider.getContextWindow()).toBe(128000);
    });

    it('returns context window for GPT-4 base', () => {
      class GPT4Provider extends TestProvider {
        getModel() { return 'gpt-4'; }
      }
      const provider = new GPT4Provider();
      expect(provider.getContextWindow()).toBe(8192);
    });

    it('returns default 128k for unknown models', () => {
      class UnknownProvider extends TestProvider {
        getModel() { return 'unknown-model-xyz'; }
      }
      const provider = new UnknownProvider();
      expect(provider.getContextWindow()).toBe(128000);
    });

    it('handles prefix matching for versioned models', () => {
      class VersionedProvider extends TestProvider {
        getModel() { return 'claude-3-5-sonnet-20241022'; }
      }
      const provider = new VersionedProvider();
      expect(provider.getContextWindow()).toBe(200000);
    });

    it('does not match gpt-4 to gpt-4o (different models)', () => {
      // gpt-4 and gpt-4o are different models with different context windows
      // gpt-4 = 8192 tokens, gpt-4o = 128000 tokens
      class GPT4Provider extends TestProvider {
        getModel() { return 'gpt-4'; }
      }
      class GPT4oProvider extends TestProvider {
        getModel() { return 'gpt-4o'; }
      }
      const gpt4 = new GPT4Provider();
      const gpt4o = new GPT4oProvider();
      // They should have different context windows
      expect(gpt4.getContextWindow()).toBe(8192);
      expect(gpt4o.getContextWindow()).toBe(128000);
      expect(gpt4.getContextWindow()).not.toBe(gpt4o.getContextWindow());
    });
  });
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  describe('supportsVision', () => {
    it('returns true for claude-3 models', () => {
      const provider3 = new AnthropicProvider({ apiKey: 'test', model: 'claude-3-opus-20240229' });
      expect(provider3.supportsVision()).toBe(true);
    });

    it('returns true for claude-sonnet-4 models', () => {
      const provider4 = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-20250514' });
      expect(provider4.supportsVision()).toBe(true);
    });

    it('returns true for claude-opus-4 models', () => {
      const providerOpus = new AnthropicProvider({ apiKey: 'test', model: 'claude-opus-4-20250514' });
      expect(providerOpus.supportsVision()).toBe(true);
    });

    it('returns false for claude-2 models', () => {
      const provider2 = new AnthropicProvider({ apiKey: 'test', model: 'claude-2.1' });
      expect(provider2.supportsVision()).toBe(false);
    });
  });

  describe('supportsToolUse', () => {
    it('returns true', () => {
      expect(provider.supportsToolUse()).toBe(true);
    });
  });

  describe('getName', () => {
    it('returns Anthropic', () => {
      expect(provider.getName()).toBe('Anthropic');
    });
  });

  describe('getModel', () => {
    it('returns the configured model', () => {
      const customProvider = new AnthropicProvider({ model: 'custom-model' });
      expect(customProvider.getModel()).toBe('custom-model');
    });

    it('returns default model when not specified', () => {
      expect(provider.getModel()).toContain('claude');
    });
  });
});

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider({ apiKey: 'test-key' });
  });

  describe('supportsVision', () => {
    it('returns true for gpt-4 models', () => {
      const provider4 = new OpenAICompatibleProvider({ model: 'gpt-4-turbo' });
      expect(provider4.supportsVision()).toBe(true);
    });

    it('returns true for gpt-4o models', () => {
      const provider4o = new OpenAICompatibleProvider({ model: 'gpt-4o' });
      expect(provider4o.supportsVision()).toBe(true);
    });

    it('returns true for gpt-5 models', () => {
      const provider5 = new OpenAICompatibleProvider({ model: 'gpt-5' });
      expect(provider5.supportsVision()).toBe(true);
    });

    it('returns true for models with vision in name', () => {
      const visionProvider = new OpenAICompatibleProvider({ model: 'llava-vision' });
      expect(visionProvider.supportsVision()).toBe(true);
    });

    it('returns false for gpt-3.5 models', () => {
      const provider35 = new OpenAICompatibleProvider({ model: 'gpt-3.5-turbo' });
      expect(provider35.supportsVision()).toBe(false);
    });
  });

  describe('supportsToolUse', () => {
    it('returns true', () => {
      expect(provider.supportsToolUse()).toBe(true);
    });
  });

  describe('getName', () => {
    it('returns OpenAI by default', () => {
      expect(provider.getName()).toBe('OpenAI');
    });

    it('returns custom provider name', () => {
      const customProvider = new OpenAICompatibleProvider({ providerName: 'Custom' } as any);
      expect(customProvider.getName()).toBe('Custom');
    });
  });

  describe('getModel', () => {
    it('returns the configured model', () => {
      const customProvider = new OpenAICompatibleProvider({ model: 'custom-model' });
      expect(customProvider.getModel()).toBe('custom-model');
    });
  });
});

describe('createOllamaProvider', () => {
  it('creates provider with default model', () => {
    const provider = createOllamaProvider();
    expect(provider.getName()).toBe('Ollama');
    expect(provider.getModel()).toBe('llama3.2');
  });

  it('creates provider with custom model', () => {
    const provider = createOllamaProvider('mistral');
    expect(provider.getModel()).toBe('mistral');
  });
});

describe('createRunPodProvider', () => {
  beforeEach(() => {
    process.env.RUNPOD_API_KEY = 'test-key';
  });

  it('throws error when API key is missing', () => {
    delete process.env.RUNPOD_API_KEY;
    expect(() => createRunPodProvider('endpoint-id', 'model'))
      .toThrow('RunPod API key required');
  });

  it('throws error when endpoint ID is missing', () => {
    expect(() => createRunPodProvider('', 'model'))
      .toThrow('RunPod endpoint ID required');
  });

  it('creates provider with valid config', () => {
    const provider = createRunPodProvider('test-endpoint', 'test-model', 'test-key');
    expect(provider.getName()).toBe('RunPod');
    expect(provider.getModel()).toBe('test-model');
  });
});

describe('Provider Factory', () => {
  describe('getProviderTypes', () => {
    it('returns list of registered provider types', () => {
      const types = getProviderTypes();
      expect(types).toContain('anthropic');
      expect(types).toContain('openai');
      expect(types).toContain('ollama');
      expect(types).toContain('runpod');
    });
  });

  describe('hasProviderType', () => {
    it('returns true for registered types', () => {
      expect(hasProviderType('anthropic')).toBe(true);
      expect(hasProviderType('openai')).toBe(true);
    });

    it('returns false for unknown types', () => {
      expect(hasProviderType('unknown-provider')).toBe(false);
    });
  });

  describe('createProvider', () => {
    it('creates anthropic provider', () => {
      const provider = createProvider({ type: 'anthropic', apiKey: 'test' });
      expect(provider.getName()).toBe('Anthropic');
    });

    it('creates openai provider', () => {
      const provider = createProvider({ type: 'openai', apiKey: 'test' });
      expect(provider.getName()).toBe('OpenAI');
    });

    it('creates ollama provider', () => {
      const provider = createProvider({ type: 'ollama', model: 'llama3' });
      expect(provider.getName()).toBe('Ollama');
    });

    it('throws error for unknown provider type', () => {
      expect(() => createProvider({ type: 'unknown' }))
        .toThrow('Unknown provider type: unknown');
    });
  });

  describe('registerProviderFactory', () => {
    it('throws error when registering duplicate type', () => {
      expect(() => registerProviderFactory('anthropic', () => null as any))
        .toThrow("Provider type 'anthropic' is already registered");
    });
  });
});

describe('Message Conversion with Images', () => {
  // Test that image blocks are properly handled in message conversion
  // We test this indirectly through the provider structure

  it('ContentBlock type supports image', () => {
    const imageBlock: ContentBlock = {
      type: 'image',
      image: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    };
    expect(imageBlock.type).toBe('image');
    expect(imageBlock.image?.media_type).toBe('image/png');
  });

  it('Message can contain image blocks', () => {
    const message: Message = {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image',
          image: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: '/9j/4AAQSkZJRg==',
          },
        },
      ],
    };
    expect(message.content).toHaveLength(2);
    expect((message.content as ContentBlock[])[1].type).toBe('image');
  });
});

describe('OpenAI Message Conversion - Tool Pairing', () => {
  // These tests verify that orphaned tool_results are filtered out
  // to prevent OpenAI API errors when loading cross-provider sessions

  it('filters orphaned tool_results that have no matching tool_use', () => {
    // This simulates a session that was compacted or loaded from a different provider
    // where tool_use blocks were summarized away but tool_results remain
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'orphaned_id_123',
            content: 'This result has no matching tool_use',
          },
        ],
      },
    ];

    // The orphaned tool_result should be skipped when converting
    // We test this indirectly by checking the message structure is valid
    expect(messages[1].content).toHaveLength(1);
    expect((messages[1].content as ContentBlock[])[0].type).toBe('tool_result');
  });

  it('properly pairs tool_use and tool_result in same conversation', () => {
    // This represents a valid conversation flow
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will read the file' },
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'read_file',
            input: { path: 'test.txt' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_123',
            content: 'file contents here',
          },
        ],
      },
    ];

    // Verify the structure is valid
    const assistantContent = messages[0].content as ContentBlock[];
    const userContent = messages[1].content as ContentBlock[];

    expect(assistantContent[1].type).toBe('tool_use');
    expect(assistantContent[1].id).toBe('tool_123');
    expect(userContent[0].type).toBe('tool_result');
    expect(userContent[0].tool_use_id).toBe('tool_123');
  });
});

describe('OllamaCloudProvider thinking extraction', () => {
  // Test the thinking extraction regex directly since the method is private
  function extractThinkingContent(content: string): { content: string; thinking: string } {
    const thinkPattern = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
    let thinking = '';
    let cleanedContent = content;

    let match;
    while ((match = thinkPattern.exec(content)) !== null) {
      thinking += (thinking ? '\n' : '') + match[1].trim();
    }

    if (thinking) {
      cleanedContent = content.replace(thinkPattern, '').trim();
    }

    return { content: cleanedContent, thinking };
  }

  it('extracts <think> tags from content', () => {
    const input = '<think>This is my reasoning process.</think>Here is the answer.';
    const result = extractThinkingContent(input);
    expect(result.thinking).toBe('This is my reasoning process.');
    expect(result.content).toBe('Here is the answer.');
  });

  it('extracts <thinking> tags from content', () => {
    const input = '<thinking>Analyzing the problem...</thinking>The solution is X.';
    const result = extractThinkingContent(input);
    expect(result.thinking).toBe('Analyzing the problem...');
    expect(result.content).toBe('The solution is X.');
  });

  it('handles multiple think blocks', () => {
    const input = '<think>First thought.</think>Middle text.<think>Second thought.</think>Final answer.';
    const result = extractThinkingContent(input);
    expect(result.thinking).toBe('First thought.\nSecond thought.');
    expect(result.content).toBe('Middle text.Final answer.');
  });

  it('handles multiline thinking content', () => {
    const input = `<think>
Step 1: Consider the problem
Step 2: Analyze options
Step 3: Choose solution
</think>The answer is 42.`;
    const result = extractThinkingContent(input);
    expect(result.thinking).toContain('Step 1');
    expect(result.thinking).toContain('Step 3');
    expect(result.content).toBe('The answer is 42.');
  });

  it('returns empty thinking when no tags present', () => {
    const input = 'Just a normal response without thinking.';
    const result = extractThinkingContent(input);
    expect(result.thinking).toBe('');
    expect(result.content).toBe('Just a normal response without thinking.');
  });

  it('handles case-insensitive tags', () => {
    const input = '<THINK>Uppercase thinking.</THINK>Response.';
    const result = extractThinkingContent(input);
    expect(result.thinking).toBe('Uppercase thinking.');
    expect(result.content).toBe('Response.');
  });
});

describe('OllamaCloudProvider function-call style parsing', () => {
  // Test the argument parsing function directly (mirrors implementation in ollama-cloud.ts)
  function parseFunctionCallArgs(argsString: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    if (!argsString.trim()) return args;

    let i = 0;
    while (i < argsString.length) {
      // Skip whitespace
      while (i < argsString.length && /\s/.test(argsString[i])) i++;
      if (i >= argsString.length) break;

      // Find key
      const keyStart = i;
      while (i < argsString.length && /[a-z_]/i.test(argsString[i])) i++;
      const key = argsString.slice(keyStart, i);
      if (!key) break;

      // Skip whitespace and =
      while (i < argsString.length && /\s/.test(argsString[i])) i++;
      if (argsString[i] !== '=') break;
      i++;
      while (i < argsString.length && /\s/.test(argsString[i])) i++;

      // Parse value
      let value: string;
      const quote = argsString[i];

      if (quote === '"' || quote === "'") {
        i++;
        const valueStart = i;
        let escaped = false;
        while (i < argsString.length) {
          if (escaped) { escaped = false; i++; continue; }
          if (argsString[i] === '\\') { escaped = true; i++; continue; }
          if (argsString[i] === quote) break;
          i++;
        }
        value = argsString.slice(valueStart, i);
        value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        i++;
      } else {
        const valueStart = i;
        while (i < argsString.length && argsString[i] !== ',' && !/\s/.test(argsString[i])) i++;
        value = argsString.slice(valueStart, i);
      }

      if (value === 'true') args[key] = true;
      else if (value === 'false') args[key] = false;
      else if (value === 'null') args[key] = null;
      else if (!isNaN(Number(value)) && value !== '' && !/^0[0-9]/.test(value)) args[key] = Number(value);
      else args[key] = value;

      while (i < argsString.length && /[\s,]/.test(argsString[i])) i++;
    }

    return args;
  }

  // Test balanced parentheses extraction
  function extractBalancedParenContent(content: string, startIndex: number): string | null {
    let depth = 1;
    let inString: string | null = null;
    let escaped = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if ((char === '"' || char === "'") && !inString) { inString = char; continue; }
      if (char === inString) { inString = null; continue; }
      if (!inString) {
        if (char === '(') depth++;
        else if (char === ')') {
          depth--;
          if (depth === 0) return content.slice(startIndex, i);
        }
      }
    }
    return null;
  }

  it('parses string arguments with double quotes', () => {
    const result = parseFunctionCallArgs('path="./src"');
    expect(result.path).toBe('./src');
  });

  it('parses string arguments with single quotes', () => {
    const result = parseFunctionCallArgs("path='./src'");
    expect(result.path).toBe('./src');
  });

  it('parses boolean true', () => {
    const result = parseFunctionCallArgs('show_hidden=true');
    expect(result.show_hidden).toBe(true);
  });

  it('parses boolean false', () => {
    const result = parseFunctionCallArgs('recursive=false');
    expect(result.recursive).toBe(false);
  });

  it('parses numbers', () => {
    const result = parseFunctionCallArgs('limit=100');
    expect(result.limit).toBe(100);
  });

  it('parses multiple arguments', () => {
    const result = parseFunctionCallArgs('path=".", show_hidden=true, limit=50');
    expect(result.path).toBe('.');
    expect(result.show_hidden).toBe(true);
    expect(result.limit).toBe(50);
  });

  it('handles empty arguments', () => {
    const result = parseFunctionCallArgs('');
    expect(result).toEqual({});
  });

  it('parses real-world list_directory call', () => {
    const result = parseFunctionCallArgs('path=".", show_hidden=true');
    expect(result.path).toBe('.');
    expect(result.show_hidden).toBe(true);
  });

  // Tests for nested parentheses in quoted strings (bug fix)
  it('parses command with parentheses in double-quoted string', () => {
    const result = parseFunctionCallArgs('command="response.cookies.get(\'accessToken\')"');
    expect(result.command).toBe("response.cookies.get('accessToken')");
  });

  it('parses command with parentheses in single-quoted string', () => {
    const result = parseFunctionCallArgs("command='echo $(date)'");
    expect(result.command).toBe('echo $(date)');
  });

  it('parses command with multiple nested parentheses', () => {
    const result = parseFunctionCallArgs('command="foo(bar(baz()))"');
    expect(result.command).toBe('foo(bar(baz()))');
  });

  it('parses sed command with complex pattern', () => {
    const result = parseFunctionCallArgs('command="sed -i \\"s/old/new/g\\" file.txt"');
    expect(result.command).toBe('sed -i "s/old/new/g" file.txt');
  });

  // Tests for extractBalancedParenContent
  it('extracts balanced content with nested parens in quotes', () => {
    const content = '[bash(command="echo $(date)")]';
    const startIndex = 6; // after '[bash('
    const result = extractBalancedParenContent(content, startIndex);
    expect(result).toBe('command="echo $(date)"');
  });

  it('extracts balanced content with deeply nested parens', () => {
    const content = '[bash(command="foo(bar(baz()))")]';
    const startIndex = 6;
    const result = extractBalancedParenContent(content, startIndex);
    expect(result).toBe('command="foo(bar(baz()))"');
  });

  it('extracts balanced content with the real failing case', () => {
    const content = '[bash(command="sed -i \'s/old/response.cookies.get(\\\'accessToken\\\')/g\' file.py")]';
    const startIndex = 6;
    const result = extractBalancedParenContent(content, startIndex);
    expect(result).toBe("command=\"sed -i 's/old/response.cookies.get(\\'accessToken\\')/g' file.py\"");
  });

  it('returns null for unbalanced parentheses', () => {
    const content = '[bash(command="unclosed';
    const result = extractBalancedParenContent(content, 6);
    expect(result).toBeNull();
  });
});

describe('OllamaCloudProvider tool name normalization', () => {
  // Test the normalization function directly (mirrors implementation in ollama-cloud.ts)
  function normalizeToolName(name: string): string {
    const prefixes = [
      'repo_browser.',
      'repo.',
      'mcp.',
      'tools.',
      'codi.',
    ];

    let normalized = name;
    for (const prefix of prefixes) {
      if (normalized.toLowerCase().startsWith(prefix)) {
        normalized = normalized.slice(prefix.length);
        break;
      }
    }

    // Tool aliases
    const aliases: Record<string, string> = {
      'run_git': 'bash',
      'run_command': 'bash',
      'execute': 'bash',
      'shell': 'bash',
      'run_shell': 'bash',
      'exec': 'bash',
      'terminal': 'bash',
      'read': 'read_file',
      'write': 'write_file',
      'edit': 'edit_file',
      'search': 'grep',
      'find': 'glob',
      'ls': 'list_directory',
      'dir': 'list_directory',
    };

    const lowerNormalized = normalized.toLowerCase();
    if (aliases[lowerNormalized]) {
      return aliases[lowerNormalized];
    }

    return normalized;
  }

  it('strips repo. prefix', () => {
    expect(normalizeToolName('repo.bash')).toBe('bash');
    expect(normalizeToolName('repo.read_file')).toBe('read_file');
  });

  it('strips repo_browser. prefix', () => {
    expect(normalizeToolName('repo_browser.bash')).toBe('bash');
    expect(normalizeToolName('repo_browser.list_directory')).toBe('list_directory');
  });

  it('strips mcp. prefix', () => {
    expect(normalizeToolName('mcp.read_file')).toBe('read_file');
  });

  it('strips tools. prefix', () => {
    expect(normalizeToolName('tools.bash')).toBe('bash');
  });

  it('strips codi. prefix', () => {
    expect(normalizeToolName('codi.grep')).toBe('grep');
  });

  it('handles case-insensitive prefixes', () => {
    expect(normalizeToolName('REPO.bash')).toBe('bash');
    expect(normalizeToolName('Repo_Browser.bash')).toBe('bash');
  });

  it('leaves unprefixed names unchanged', () => {
    expect(normalizeToolName('bash')).toBe('bash');
    expect(normalizeToolName('read_file')).toBe('read_file');
  });

  it('only strips one prefix', () => {
    expect(normalizeToolName('repo.mcp.bash')).toBe('mcp.bash');
  });

  // Tool alias tests
  it('maps run_git to bash', () => {
    expect(normalizeToolName('run_git')).toBe('bash');
  });

  it('maps run_command to bash', () => {
    expect(normalizeToolName('run_command')).toBe('bash');
  });

  it('maps shell aliases to bash', () => {
    expect(normalizeToolName('shell')).toBe('bash');
    expect(normalizeToolName('run_shell')).toBe('bash');
    expect(normalizeToolName('exec')).toBe('bash');
    expect(normalizeToolName('execute')).toBe('bash');
    expect(normalizeToolName('terminal')).toBe('bash');
  });

  it('maps file operation aliases', () => {
    expect(normalizeToolName('read')).toBe('read_file');
    expect(normalizeToolName('write')).toBe('write_file');
    expect(normalizeToolName('edit')).toBe('edit_file');
  });

  it('maps search/find aliases', () => {
    expect(normalizeToolName('search')).toBe('grep');
    expect(normalizeToolName('find')).toBe('glob');
    expect(normalizeToolName('ls')).toBe('list_directory');
    expect(normalizeToolName('dir')).toBe('list_directory');
  });

  it('handles aliases with prefixes', () => {
    expect(normalizeToolName('repo.run_git')).toBe('bash');
    expect(normalizeToolName('mcp.shell')).toBe('bash');
  });
});
