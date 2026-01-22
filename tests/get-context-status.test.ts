// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GetContextStatusTool, ContextInfoProvider } from '../src/tools/get-context-status.js';
import * as toolResultCache from '../src/utils/tool-result-cache.js';

describe('GetContextStatusTool', () => {
  let tool: GetContextStatusTool;

  beforeEach(() => {
    tool = new GetContextStatusTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefinition', () => {
    it('should return correct tool definition', () => {
      const def = tool.getDefinition();
      expect(def.name).toBe('get_context_status');
      expect(def.description).toContain('context usage');
      expect(def.input_schema.properties).toHaveProperty('include_cached');
    });
  });

  describe('execute', () => {
    it('should return error when context provider not set', async () => {
      const result = await tool.execute({});
      expect(result).toContain('Error: Context provider not initialized');
    });

    describe('with context provider', () => {
      let mockProvider: ContextInfoProvider;

      beforeEach(() => {
        mockProvider = {
          getContextInfo: vi.fn().mockReturnValue({
            tokens: 10000,
            messageTokens: 8000,
            systemPromptTokens: 1500,
            toolDefinitionTokens: 500,
            maxTokens: 100000,
            contextWindow: 200000,
            outputReserve: 8192,
            safetyBuffer: 1000,
            tierName: 'large',
            messages: 10,
            userMessages: 5,
            assistantMessages: 4,
            toolResultMessages: 1,
            hasSummary: false,
            compression: null,
            compressionEnabled: false,
            workingSetFiles: 3,
          }),
        };
        tool.setContextProvider(mockProvider);

        // Mock listCachedResults to return empty array by default
        vi.spyOn(toolResultCache, 'listCachedResults').mockReturnValue([]);
      });

      it('should return context status for HEALTHY usage', async () => {
        const result = await tool.execute({});

        expect(result).toContain('Context Status:');
        expect(result).toContain('Tokens used: 10,000 / 100,000');
        expect(result).toContain('10.0% of budget');
        expect(result).toContain('Status: HEALTHY');
        expect(result).toContain('Token Breakdown:');
        expect(result).toContain('Messages: 8,000 tokens');
        expect(result).toContain('System prompt: 1,500 tokens');
        expect(result).toContain('Tool definitions: 500 tokens');
        expect(result).toContain('Messages: 10 total');
        expect(result).toContain('User: 5, Assistant: 4, Tool results: 1');
        expect(result).toContain('Compression: Disabled');
        expect(result).toContain('Working set: 3 recent files tracked');
        expect(result).toContain('Cached Results: None available');
        expect(result).toContain('Recommendations:');
        expect(result).toContain('Context usage is low');
      });

      it('should return MODERATE status for 50-75% usage', async () => {
        mockProvider.getContextInfo = vi.fn().mockReturnValue({
          tokens: 60000,
          messageTokens: 55000,
          systemPromptTokens: 4000,
          toolDefinitionTokens: 1000,
          maxTokens: 100000,
          contextWindow: 200000,
          outputReserve: 8192,
          safetyBuffer: 1000,
          tierName: 'large',
          messages: 50,
          userMessages: 20,
          assistantMessages: 20,
          toolResultMessages: 10,
          hasSummary: false,
          compression: null,
          compressionEnabled: false,
          workingSetFiles: 10,
        });

        const result = await tool.execute({});

        expect(result).toContain('Status: MODERATE');
        expect(result).toContain('60.0% of budget');
        expect(result).toContain('Consider using search_codebase or grep over full file reads');
      });

      it('should return HIGH status for 75-90% usage', async () => {
        mockProvider.getContextInfo = vi.fn().mockReturnValue({
          tokens: 80000,
          messageTokens: 75000,
          systemPromptTokens: 4000,
          toolDefinitionTokens: 1000,
          maxTokens: 100000,
          contextWindow: 200000,
          outputReserve: 8192,
          safetyBuffer: 1000,
          tierName: 'large',
          messages: 80,
          userMessages: 30,
          assistantMessages: 30,
          toolResultMessages: 20,
          hasSummary: true,
          compression: null,
          compressionEnabled: true,
          workingSetFiles: 15,
        });

        const result = await tool.execute({});

        expect(result).toContain('Status: HIGH');
        expect(result).toContain('80.0% of budget');
        expect(result).toContain('Prefer targeted searches');
        expect(result).toContain('Use recall_result for previously read content');
        expect(result).toContain('(Conversation summary active from previous compaction)');
        expect(result).toContain('Compression: Enabled (not yet applied)');
      });

      it('should return CRITICAL status for >90% usage', async () => {
        mockProvider.getContextInfo = vi.fn().mockReturnValue({
          tokens: 95000,
          messageTokens: 90000,
          systemPromptTokens: 4000,
          toolDefinitionTokens: 1000,
          maxTokens: 100000,
          contextWindow: 200000,
          outputReserve: 8192,
          safetyBuffer: 1000,
          tierName: 'large',
          messages: 100,
          userMessages: 40,
          assistantMessages: 40,
          toolResultMessages: 20,
          hasSummary: true,
          compression: {
            originalChars: 200000,
            compressedChars: 180000,
            legendChars: 500,
            netChars: 180500,
            savings: 19500,
            savingsPercent: 10,
            entityCount: 5,
            topEntities: [],
          },
          compressionEnabled: true,
          workingSetFiles: 20,
        });

        const result = await tool.execute({});

        expect(result).toContain('Status: CRITICAL');
        expect(result).toContain('95.0% of budget');
        expect(result).toContain('Compaction is imminent');
        expect(result).toContain('Avoid reading new files');
        expect(result).toContain('Compression: Enabled (10% savings)');
      });

      it('should show cached results when include_cached is true', async () => {
        vi.spyOn(toolResultCache, 'listCachedResults').mockReturnValue([
          {
            id: 'read_file_abc123',
            metadata: {
              toolName: 'read_file',
              estimatedTokens: 2000,
              cachedAt: Date.now(),
              contentLength: 5000,
              summary: 'File content from src/index.ts',
            },
          },
          {
            id: 'grep_def456',
            metadata: {
              toolName: 'grep',
              estimatedTokens: 500,
              cachedAt: Date.now(),
              contentLength: 1200,
              summary: 'Search results for pattern',
            },
          },
        ]);

        const result = await tool.execute({ include_cached: true });

        expect(result).toContain('Cached Results: 2 available');
        expect(result).toContain('read_file_abc123: read_file (~2000 tokens)');
        expect(result).toContain('grep_def456: grep (~500 tokens)');
        expect(result).toContain('[Use recall_result with cache_id to retrieve full content]');
      });

      it('should not show cached result IDs when include_cached is false', async () => {
        vi.spyOn(toolResultCache, 'listCachedResults').mockReturnValue([
          {
            id: 'read_file_abc123',
            metadata: {
              toolName: 'read_file',
              estimatedTokens: 2000,
              cachedAt: Date.now(),
              contentLength: 5000,
              summary: 'File content',
            },
          },
        ]);

        const result = await tool.execute({ include_cached: false });

        expect(result).toContain('Cached Results: 1 available');
        expect(result).toContain('(Use include_cached: true to see IDs)');
        expect(result).not.toContain('read_file_abc123');
      });

      it('should limit cached results to 10 entries', async () => {
        const manyResults = Array.from({ length: 15 }, (_, i) => ({
          id: `cache_${i}`,
          metadata: {
            toolName: 'read_file',
            estimatedTokens: 100,
            cachedAt: Date.now(),
            contentLength: 500,
            summary: `Result ${i}`,
          },
        }));
        vi.spyOn(toolResultCache, 'listCachedResults').mockReturnValue(manyResults);

        const result = await tool.execute({ include_cached: true });

        expect(result).toContain('Cached Results: 15 available');
        expect(result).toContain('cache_0: read_file');
        expect(result).toContain('cache_9: read_file');
        expect(result).toContain('... and 5 more');
      });

      it('should format large token numbers with commas', async () => {
        mockProvider.getContextInfo = vi.fn().mockReturnValue({
          tokens: 150000,
          messageTokens: 140000,
          systemPromptTokens: 8000,
          toolDefinitionTokens: 2000,
          maxTokens: 200000,
          contextWindow: 200000,
          outputReserve: 8192,
          safetyBuffer: 1000,
          tierName: 'xlarge',
          messages: 200,
          userMessages: 80,
          assistantMessages: 80,
          toolResultMessages: 40,
          hasSummary: true,
          compression: null,
          compressionEnabled: false,
          workingSetFiles: 50,
        });

        const result = await tool.execute({});

        expect(result).toContain('150,000 / 200,000');
        expect(result).toContain('Messages: 140,000 tokens');
        expect(result).toContain('System prompt: 8,000 tokens');
        expect(result).toContain('Tool definitions: 2,000 tokens');
      });
    });
  });
});
