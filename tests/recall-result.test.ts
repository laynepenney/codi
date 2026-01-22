// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { RecallResultTool } from '../src/tools/recall-result.js';
import { cacheToolResult, clearCache } from '../src/utils/tool-result-cache.js';

describe('RecallResultTool', () => {
  let tool: RecallResultTool;

  beforeEach(() => {
    tool = new RecallResultTool();
  });

  describe('getDefinition', () => {
    it('returns valid tool definition', () => {
      const def = tool.getDefinition();

      expect(def.name).toBe('recall_result');
      expect(def.description).toBeTruthy();
      expect(def.input_schema).toBeDefined();
      expect(def.input_schema.type).toBe('object');
    });

    it('defines cache_id and action parameters', () => {
      const def = tool.getDefinition();
      const props = def.input_schema.properties as Record<string, unknown>;

      expect(props).toHaveProperty('cache_id');
      expect(props).toHaveProperty('action');
    });

    it('action parameter has valid enum values', () => {
      const def = tool.getDefinition();
      const props = def.input_schema.properties as Record<string, { enum?: string[] }>;

      expect(props.action.enum).toContain('get');
      expect(props.action.enum).toContain('list');
      expect(props.action.enum).toContain('check');
    });
  });

  describe('execute - get action', () => {
    it('retrieves cached result by ID', async () => {
      const content = 'This is the full file content\nLine 2\nLine 3';
      const id = cacheToolResult('read_file', content, '[read_file: 3 lines]', 25, false);

      const result = await tool.execute({ cache_id: id });

      expect(result).toContain('Cached Result:');
      expect(result).toContain(id);
      expect(result).toContain(content);
      expect(result).toContain('Tool: read_file');
    });

    it('returns error for missing cache_id', async () => {
      const result = await tool.execute({});

      expect(result).toContain('Error:');
      expect(result).toContain('cache_id is required');
    });

    it('returns error for non-existent ID', async () => {
      const result = await tool.execute({ cache_id: 'fake_id_12345' });

      expect(result).toContain('Error:');
      expect(result).toContain('No cached result found');
    });

    it('shows error status for error results', async () => {
      const id = cacheToolResult('bash', 'Command failed', '[bash: ERROR]', 10, true);

      const result = await tool.execute({ cache_id: id });

      expect(result).toContain('Status: ERROR');
    });
  });

  describe('execute - list action', () => {
    it('lists available cached results', async () => {
      // Add some results
      cacheToolResult('read_file', 'content1', 'summary1', 10, false);
      cacheToolResult('grep', 'content2', 'summary2', 20, false);

      const result = await tool.execute({ action: 'list' });

      expect(result).toContain('Available cached results');
      expect(result).toContain('read_file');
      expect(result).toContain('grep');
    });

    it('shows metadata for each result', async () => {
      cacheToolResult('test_tool', 'test content', 'test summary', 50, false);

      const result = await tool.execute({ action: 'list' });

      expect(result).toContain('Tool: test_tool');
      expect(result).toContain('Tokens: ~50');
    });

    it('handles empty cache', async () => {
      clearCache();

      const result = await tool.execute({ action: 'list' });

      // Should either show "No cached results" or an empty list
      expect(result).toBeTruthy();
    });
  });

  describe('execute - check action', () => {
    it('confirms existing cache ID', async () => {
      const id = cacheToolResult('read_file', 'content', 'summary', 10, false);

      const result = await tool.execute({ action: 'check', cache_id: id });

      expect(result).toContain('exists');
      expect(result).toContain('read_file');
    });

    it('reports missing cache ID', async () => {
      const result = await tool.execute({ action: 'check', cache_id: 'nonexistent_id' });

      expect(result).toContain('not found');
    });

    it('returns error without cache_id', async () => {
      const result = await tool.execute({ action: 'check' });

      expect(result).toContain('Error:');
      expect(result).toContain('cache_id is required');
    });
  });

  describe('execute - default action', () => {
    it('defaults to get action', async () => {
      const id = cacheToolResult('read_file', 'content', 'summary', 10, false);

      const result = await tool.execute({ cache_id: id });

      expect(result).toContain('Cached Result:');
      expect(result).toContain('content');
    });
  });
});
