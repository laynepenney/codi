// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import {
  findBestToolMatch,
  mapParameters,
  formatFallbackError,
  formatMappingInfo,
  GLOBAL_PARAMETER_ALIASES,
  DEFAULT_FALLBACK_CONFIG,
  type ToolFallbackConfig,
} from '../src/tools/tool-fallback.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { ToolDefinition } from '../src/types.js';

// Mock tool definitions for testing
const mockTools: ToolDefinition[] = [
  {
    name: 'grep',
    description: 'Search for patterns in file contents. Returns matching lines with file paths.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        path: { type: 'string', description: 'Path to search in' },
        head_limit: { type: 'number', description: 'Max results' },
        ignore_case: { type: 'boolean', description: 'Case insensitive' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns file paths.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
        path: { type: 'string', description: 'Base path' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a given path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        show_hidden: { type: 'boolean', description: 'Show hidden files' },
      },
      required: [],
    },
  },
  {
    name: 'print_tree',
    description: 'Print a tree-like directory structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Root path' },
        depth: { type: 'number', description: 'Max depth' },
      },
      required: [],
    },
  },
  {
    name: 'bash',
    description: 'Execute a bash command.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
      },
      required: ['command'],
    },
  },
];

describe('findBestToolMatch', () => {
  it('returns exact match when tool exists', () => {
    const result = findBestToolMatch('grep', mockTools);
    expect(result.exactMatch).toBe(true);
    expect(result.matchedName).toBe('grep');
    expect(result.score).toBe(1.0);
    expect(result.suggestions).toHaveLength(0);
    expect(result.shouldAutoCorrect).toBe(false);
  });

  it('is case-sensitive for exact matches', () => {
    const result = findBestToolMatch('Grep', mockTools);
    expect(result.exactMatch).toBe(false);
    // But should suggest grep with high similarity
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].name).toBe('grep');
  });

  it('suggests similar tools for typos', () => {
    const result = findBestToolMatch('gre', mockTools);
    expect(result.exactMatch).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].name).toBe('grep');
  });

  it('auto-corrects high-similarity case typos', () => {
    const result = findBestToolMatch('GREP', mockTools);
    // GREP vs grep should have high similarity due to case-insensitive comparison
    expect(result.shouldAutoCorrect).toBe(true);
    expect(result.matchedName).toBe('grep');
  });

  it('suggests print_tree for print_tre typo', () => {
    // "print_tre" vs "print_tree" has high similarity
    const result = findBestToolMatch('print_tre', mockTools);
    expect(result.exactMatch).toBe(false);
    expect(result.suggestions.some((s) => s.name === 'print_tree')).toBe(true);
  });

  it('suggests list_directory for list_directo typo', () => {
    // "list_directo" vs "list_directory" has high similarity (only missing 'ry')
    const result = findBestToolMatch('list_directo', mockTools);
    expect(result.exactMatch).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].name).toBe('list_directory');
  });

  it('returns no suggestions when disabled', () => {
    const config: ToolFallbackConfig = { ...DEFAULT_FALLBACK_CONFIG, enabled: false };
    const result = findBestToolMatch('unknown', mockTools, config);
    expect(result.suggestions).toHaveLength(0);
    expect(result.matchedName).toBeNull();
  });

  it('does not auto-correct when multiple close matches exist', () => {
    // Create tools with close names to test ambiguity
    // Both "test_a" and "test_b" are equally similar to "test_x"
    const ambiguousTools: ToolDefinition[] = [
      { name: 'test_a', description: 'Test A', input_schema: { type: 'object', properties: {} } },
      { name: 'test_b', description: 'Test B', input_schema: { type: 'object', properties: {} } },
    ];
    // "test_x" has equal similarity to both test_a and test_b (both differ by 1 char)
    const result = findBestToolMatch('test_x', ambiguousTools);
    expect(result.suggestions.length).toBeGreaterThan(0);
    // Should not auto-correct because both are equally close matches
    expect(result.shouldAutoCorrect).toBe(false);
  });

  it('respects custom thresholds', () => {
    const config: ToolFallbackConfig = {
      ...DEFAULT_FALLBACK_CONFIG,
      suggestionThreshold: 0.9, // Very high threshold
    };
    const result = findBestToolMatch('gre', mockTools, config);
    // 'gre' vs 'grep' is about 0.75 similarity, below 0.9 threshold
    expect(result.suggestions).toHaveLength(0);
  });

  it('includes truncated descriptions in suggestions', () => {
    const result = findBestToolMatch('search', mockTools);
    for (const suggestion of result.suggestions) {
      expect(suggestion.description).toBeDefined();
      expect(suggestion.description.length).toBeLessThanOrEqual(83); // 80 + '...'
    }
  });
});

describe('mapParameters', () => {
  const grepSchema = mockTools.find((t) => t.name === 'grep')!.input_schema;
  const writeFileSchema = mockTools.find((t) => t.name === 'write_file')!.input_schema;
  const bashSchema = mockTools.find((t) => t.name === 'bash')!.input_schema;

  it('passes through valid parameters unchanged', () => {
    const result = mapParameters({ pattern: 'test', path: '.' }, grepSchema);
    expect(result.mappedInput.pattern).toBe('test');
    expect(result.mappedInput.path).toBe('.');
    expect(result.mappings).toHaveLength(0);
    expect(result.unmappedParams).toHaveLength(0);
  });

  it('maps query to pattern', () => {
    const result = mapParameters({ query: 'test' }, grepSchema);
    expect(result.mappedInput.pattern).toBe('test');
    expect(result.mappings).toContainEqual({ from: 'query', to: 'pattern' });
  });

  it('maps search to pattern', () => {
    const result = mapParameters({ search: 'test' }, grepSchema);
    expect(result.mappedInput.pattern).toBe('test');
    expect(result.mappings).toContainEqual({ from: 'search', to: 'pattern' });
  });

  it('maps max_results to head_limit', () => {
    const result = mapParameters({ max_results: 10 }, grepSchema);
    expect(result.mappedInput.head_limit).toBe(10);
    expect(result.mappings).toContainEqual({ from: 'max_results', to: 'head_limit' });
  });

  it('maps max to head_limit', () => {
    const result = mapParameters({ max: 5 }, grepSchema);
    expect(result.mappedInput.head_limit).toBe(5);
  });

  it('maps limit to head_limit', () => {
    const result = mapParameters({ limit: 20 }, grepSchema);
    expect(result.mappedInput.head_limit).toBe(20);
  });

  it('maps file_path to path', () => {
    const result = mapParameters({ file_path: '/test.ts' }, grepSchema);
    expect(result.mappedInput.path).toBe('/test.ts');
  });

  it('maps case_insensitive to ignore_case', () => {
    const result = mapParameters({ case_insensitive: true }, grepSchema);
    expect(result.mappedInput.ignore_case).toBe(true);
  });

  it('maps text to content for write_file', () => {
    const result = mapParameters({ path: '/test.txt', text: 'hello' }, writeFileSchema);
    expect(result.mappedInput.content).toBe('hello');
    expect(result.mappings).toContainEqual({ from: 'text', to: 'content' });
  });

  it('maps cmd to command for bash', () => {
    const result = mapParameters({ cmd: 'ls -la' }, bashSchema);
    expect(result.mappedInput.command).toBe('ls -la');
  });

  it('preserves unmapped parameters', () => {
    const result = mapParameters({ unknown_param: 'value', pattern: 'test' }, grepSchema);
    expect(result.mappedInput.unknown_param).toBe('value');
    expect(result.unmappedParams).toContain('unknown_param');
  });

  it('explicit parameters take precedence over aliases', () => {
    const result = mapParameters({ pattern: 'explicit', query: 'alias' }, grepSchema);
    expect(result.mappedInput.pattern).toBe('explicit');
    // query should be ignored since pattern is already set
    expect(result.mappings).toHaveLength(0);
  });

  it('does not map when aliasing is disabled', () => {
    const config: ToolFallbackConfig = { ...DEFAULT_FALLBACK_CONFIG, parameterAliasing: false };
    const result = mapParameters({ query: 'test' }, grepSchema, config);
    expect(result.mappedInput.query).toBe('test');
    expect(result.mappedInput.pattern).toBeUndefined();
    expect(result.mappings).toHaveLength(0);
  });

  it('handles multiple alias mappings', () => {
    const result = mapParameters(
      { query: 'test', max: 10, file_path: '/src' },
      grepSchema
    );
    expect(result.mappedInput.pattern).toBe('test');
    expect(result.mappedInput.head_limit).toBe(10);
    expect(result.mappedInput.path).toBe('/src');
    expect(result.mappings).toHaveLength(3);
  });
});

describe('formatFallbackError', () => {
  it('includes tool name in error', () => {
    const matchResult = {
      exactMatch: false,
      matchedName: null,
      score: 0.5,
      suggestions: [],
      shouldAutoCorrect: false,
    };
    const error = formatFallbackError('unknown_tool', matchResult);
    expect(error).toContain('unknown_tool');
    expect(error).toContain('Error');
  });

  it('includes suggestions when available', () => {
    const matchResult = {
      exactMatch: false,
      matchedName: null,
      score: 0.75,
      suggestions: [
        { name: 'grep', score: 0.75, description: 'Search for patterns' },
        { name: 'glob', score: 0.6, description: 'Find files' },
      ],
      shouldAutoCorrect: false,
    };
    const error = formatFallbackError('gre', matchResult);
    expect(error).toContain('Did you mean');
    expect(error).toContain('grep');
    expect(error).toContain('75%');
    expect(error).toContain('glob');
    expect(error).toContain('60%');
  });

  it('limits suggestions to 3', () => {
    const matchResult = {
      exactMatch: false,
      matchedName: null,
      score: 0.5,
      suggestions: [
        { name: 'tool1', score: 0.8, description: 'Desc 1' },
        { name: 'tool2', score: 0.7, description: 'Desc 2' },
        { name: 'tool3', score: 0.65, description: 'Desc 3' },
        { name: 'tool4', score: 0.6, description: 'Desc 4' },
        { name: 'tool5', score: 0.55, description: 'Desc 5' },
      ],
      shouldAutoCorrect: false,
    };
    const error = formatFallbackError('unknown', matchResult);
    expect(error).toContain('tool1');
    expect(error).toContain('tool2');
    expect(error).toContain('tool3');
    expect(error).not.toContain('tool4');
    expect(error).not.toContain('tool5');
  });
});

describe('formatMappingInfo', () => {
  it('returns null when no mappings', () => {
    const result = formatMappingInfo(null, []);
    expect(result).toBeNull();
  });

  it('formats tool correction', () => {
    const result = formatMappingInfo({ from: 'GREP', to: 'grep' }, []);
    expect(result).toContain('Tool');
    expect(result).toContain('GREP');
    expect(result).toContain('grep');
  });

  it('formats parameter mappings', () => {
    const result = formatMappingInfo(null, [
      { from: 'query', to: 'pattern' },
      { from: 'max', to: 'head_limit' },
    ]);
    expect(result).toContain('Params');
    expect(result).toContain('query→pattern');
    expect(result).toContain('max→head_limit');
  });

  it('formats both tool and parameter mappings', () => {
    const result = formatMappingInfo(
      { from: 'GREP', to: 'grep' },
      [{ from: 'query', to: 'pattern' }]
    );
    expect(result).toContain('Tool');
    expect(result).toContain('Params');
  });
});

describe('GLOBAL_PARAMETER_ALIASES', () => {
  it('has common query aliases for pattern', () => {
    const aliases = GLOBAL_PARAMETER_ALIASES.get('pattern');
    expect(aliases).toContain('query');
    expect(aliases).toContain('search');
    expect(aliases).toContain('search_term');
  });

  it('has common path aliases', () => {
    const aliases = GLOBAL_PARAMETER_ALIASES.get('path');
    expect(aliases).toContain('file');
    expect(aliases).toContain('file_path');
    expect(aliases).toContain('directory');
  });

  it('has limit aliases for head_limit', () => {
    const aliases = GLOBAL_PARAMETER_ALIASES.get('head_limit');
    expect(aliases).toContain('max_results');
    expect(aliases).toContain('max');
    expect(aliases).toContain('limit');
  });

  it('has command aliases for bash', () => {
    const aliases = GLOBAL_PARAMETER_ALIASES.get('command');
    expect(aliases).toContain('cmd');
    expect(aliases).toContain('script');
  });
});

describe('ToolRegistry integration', () => {
  let registry: ToolRegistry;

  // Simple mock tool for testing
  class MockTool {
    private name: string;
    private definition: ToolDefinition;
    private response: string;

    constructor(name: string, definition: ToolDefinition, response: string = 'Success') {
      this.name = name;
      this.definition = definition;
      this.response = response;
    }

    getName(): string {
      return this.name;
    }

    getDefinition(): ToolDefinition {
      return this.definition;
    }

    async run(toolUseId: string, input: Record<string, unknown>) {
      // Validate required params
      const required = this.definition.input_schema.required || [];
      for (const param of required) {
        if (!(param in input)) {
          return {
            tool_use_id: toolUseId,
            content: `Error: Missing required parameter: ${param}`,
            is_error: true,
          };
        }
      }
      return {
        tool_use_id: toolUseId,
        content: `${this.response}: ${JSON.stringify(input)}`,
        is_error: false,
      };
    }
  }

  beforeEach(() => {
    registry = new ToolRegistry();
    // Register mock tools
    for (const def of mockTools) {
      registry.register(new MockTool(def.name, def) as any);
    }
  });

  it('executes exact tool match', async () => {
    const result = await registry.execute({
      id: 'test-1',
      name: 'grep',
      input: { pattern: 'test' },
    });
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('Success');
  });

  it('provides suggestions for unknown tool with similar name', async () => {
    const result = await registry.execute({
      id: 'test-2',
      name: 'greb', // Typo of 'grep' - should get suggestions
      input: { pattern: 'test' },
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Unknown tool');
    expect(result.content).toContain('Did you mean');
    expect(result.content).toContain('grep');
  });

  it('returns error without suggestions for completely unknown tool', async () => {
    const result = await registry.execute({
      id: 'test-2b',
      name: 'xyzabc123', // Completely unknown - no similar tools
      input: { pattern: 'test' },
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Unknown tool');
    // No suggestions because nothing is similar enough
  });

  it('auto-corrects high-similarity tool name', async () => {
    const result = await registry.execute({
      id: 'test-3',
      name: 'GREP', // Case typo
      input: { pattern: 'test' },
    });
    // Should auto-correct and succeed
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('Mapped');
    expect(result.content).toContain('GREP');
    expect(result.content).toContain('grep');
  });

  it('maps query parameter to pattern', async () => {
    const result = await registry.execute({
      id: 'test-4',
      name: 'grep',
      input: { query: 'test' },
    });
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('Mapped');
    expect(result.content).toContain('query→pattern');
  });

  it('maps multiple parameters', async () => {
    const result = await registry.execute({
      id: 'test-5',
      name: 'grep',
      input: { query: 'test', max_results: 10, file_path: '/src' },
    });
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('query→pattern');
    expect(result.content).toContain('max_results→head_limit');
    expect(result.content).toContain('file_path→path');
  });

  it('respects disabled fallback', async () => {
    registry.setFallbackConfig({ enabled: false });
    const result = await registry.execute({
      id: 'test-6',
      name: 'search',
      input: { pattern: 'test' },
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toBe('Error: Unknown tool "search"');
    expect(result.content).not.toContain('Did you mean');
  });

  it('respects disabled parameter aliasing', async () => {
    registry.setFallbackConfig({ parameterAliasing: false });
    const result = await registry.execute({
      id: 'test-7',
      name: 'grep',
      input: { query: 'test' }, // query won't be mapped to pattern
    });
    // Should fail because 'pattern' is required but 'query' wasn't mapped
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Missing required parameter');
  });

  it('getFallbackConfig returns current config', () => {
    const config = registry.getFallbackConfig();
    expect(config.enabled).toBe(true);
    expect(config.autoCorrectThreshold).toBe(0.85);
    expect(config.suggestionThreshold).toBe(0.6);
  });

  it('setFallbackConfig updates config', () => {
    registry.setFallbackConfig({ suggestionThreshold: 0.8 });
    const config = registry.getFallbackConfig();
    expect(config.suggestionThreshold).toBe(0.8);
    // Other values should still have defaults
    expect(config.enabled).toBe(true);
  });
});
