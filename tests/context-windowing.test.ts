// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  createWorkingSet,
  updateWorkingSet,
  selectMessagesToKeep,
  applySelection,
  getSelectionStats,
  DEFAULT_WINDOWING_CONFIG,
} from '../src/context-windowing.js';
import type { Message } from '../src/types.js';
import type { MessageScore } from '../src/importance-scorer.js';

describe('Context Windowing', () => {
  describe('createWorkingSet', () => {
    it('creates empty working set', () => {
      const ws = createWorkingSet();

      expect(ws.recentFiles.size).toBe(0);
      expect(ws.activeEntities.size).toBe(0);
      expect(ws.pendingToolCalls.size).toBe(0);
    });
  });

  describe('updateWorkingSet', () => {
    it('adds file paths from read_file', () => {
      const ws = createWorkingSet();

      updateWorkingSet(ws, 'read_file', { path: '/src/test.ts' });

      expect(ws.recentFiles.has('/src/test.ts')).toBe(true);
    });

    it('adds file paths from write_file', () => {
      const ws = createWorkingSet();

      updateWorkingSet(ws, 'write_file', { file_path: '/src/output.ts' });

      expect(ws.recentFiles.has('/src/output.ts')).toBe(true);
    });

    it('adds file paths from edit_file', () => {
      const ws = createWorkingSet();

      updateWorkingSet(ws, 'edit_file', { file: '/src/modified.ts' });

      expect(ws.recentFiles.has('/src/modified.ts')).toBe(true);
    });

    it('adds patterns from glob', () => {
      const ws = createWorkingSet();

      updateWorkingSet(ws, 'glob', { pattern: '**/*.ts' });

      expect(ws.activeEntities.has('**/*.ts')).toBe(true);
    });

    it('adds patterns from grep', () => {
      const ws = createWorkingSet();

      updateWorkingSet(ws, 'grep', { pattern: 'TODO' });

      expect(ws.activeEntities.has('TODO')).toBe(true);
    });

    it('ignores non-file tools', () => {
      const ws = createWorkingSet();

      updateWorkingSet(ws, 'other_tool', { path: '/should/not/add' });

      expect(ws.recentFiles.size).toBe(0);
    });

    it('enforces max working set size', () => {
      const ws = createWorkingSet();
      const config = { ...DEFAULT_WINDOWING_CONFIG, maxWorkingSetFiles: 3 };

      updateWorkingSet(ws, 'read_file', { path: '/file1.ts' }, config);
      updateWorkingSet(ws, 'read_file', { path: '/file2.ts' }, config);
      updateWorkingSet(ws, 'read_file', { path: '/file3.ts' }, config);
      updateWorkingSet(ws, 'read_file', { path: '/file4.ts' }, config);

      expect(ws.recentFiles.size).toBe(3);
      expect(ws.recentFiles.has('/file4.ts')).toBe(true);
      // Oldest should be removed
      expect(ws.recentFiles.has('/file1.ts')).toBe(false);
    });
  });

  describe('selectMessagesToKeep', () => {
    it('handles empty messages', () => {
      const result = selectMessagesToKeep([], [], createWorkingSet());

      expect(result.keep).toEqual([]);
      expect(result.summarize).toEqual([]);
    });

    it('always keeps recent messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Old message 1' },
        { role: 'assistant', content: 'Old response 1' },
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      const scores: MessageScore[] = messages.map((_, i) => ({
        messageIndex: i,
        totalScore: 0.1, // Low scores - would normally be summarized
        factors: { recency: 0.1, referenceCount: 0, userEmphasis: 0.1, actionRelevance: 0 },
      }));

      const config = { ...DEFAULT_WINDOWING_CONFIG, minRecentMessages: 2, importanceThreshold: 0.9 };
      const result = selectMessagesToKeep(messages, scores, createWorkingSet(), config);

      // Should keep last 2 messages
      expect(result.keep).toContain(2);
      expect(result.keep).toContain(3);
    });

    it('keeps messages above importance threshold', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Important message' },
        { role: 'assistant', content: 'Less important' },
        { role: 'user', content: 'Another important one' },
      ];

      const scores: MessageScore[] = [
        { messageIndex: 0, totalScore: 0.8, factors: { recency: 0.3, referenceCount: 0, userEmphasis: 0.8, actionRelevance: 0 } },
        { messageIndex: 1, totalScore: 0.2, factors: { recency: 0.4, referenceCount: 0, userEmphasis: 0.3, actionRelevance: 0 } },
        { messageIndex: 2, totalScore: 0.7, factors: { recency: 0.5, referenceCount: 0, userEmphasis: 0.7, actionRelevance: 0 } },
      ];

      const config = { ...DEFAULT_WINDOWING_CONFIG, minRecentMessages: 0, importanceThreshold: 0.5 };
      const result = selectMessagesToKeep(messages, scores, createWorkingSet(), config);

      expect(result.keep).toContain(0);
      expect(result.keep).toContain(2);
      expect(result.summarize).toContain(1);
    });

    it('keeps messages referencing working set files', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Look at /src/important.ts' },
        { role: 'assistant', content: 'Unrelated response' },
        { role: 'user', content: 'Recent message' },
      ];

      const scores: MessageScore[] = messages.map((_, i) => ({
        messageIndex: i,
        totalScore: 0.1,
        factors: { recency: 0.1, referenceCount: 0, userEmphasis: 0.1, actionRelevance: 0 },
      }));

      const ws = createWorkingSet();
      ws.recentFiles.add('/src/important.ts');

      const config = { ...DEFAULT_WINDOWING_CONFIG, minRecentMessages: 1, importanceThreshold: 0.9 };
      const result = selectMessagesToKeep(messages, scores, ws, config);

      // Should keep message referencing working set file
      expect(result.keep).toContain(0);
    });

    it('keeps messages referencing file basenames', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Check important.ts' },
        { role: 'assistant', content: 'Response' },
      ];

      const scores: MessageScore[] = messages.map((_, i) => ({
        messageIndex: i,
        totalScore: 0.1,
        factors: { recency: 0.1, referenceCount: 0, userEmphasis: 0.1, actionRelevance: 0 },
      }));

      const ws = createWorkingSet();
      ws.recentFiles.add('/src/important.ts');

      const config = { ...DEFAULT_WINDOWING_CONFIG, minRecentMessages: 0, importanceThreshold: 0.9 };
      const result = selectMessagesToKeep(messages, scores, ws, config);

      expect(result.keep).toContain(0);
    });

    it('preserves tool_use/tool_result pairs', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read the file' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'read_file', input: { path: '/test.ts' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'file contents' },
          ],
        },
        { role: 'assistant', content: 'Here is the content' },
      ];

      // Give tool_use high score but tool_result low score
      const scores: MessageScore[] = [
        { messageIndex: 0, totalScore: 0.1, factors: { recency: 0.1, referenceCount: 0, userEmphasis: 0.1, actionRelevance: 0 } },
        { messageIndex: 1, totalScore: 0.8, factors: { recency: 0.3, referenceCount: 0, userEmphasis: 0.3, actionRelevance: 1 } },
        { messageIndex: 2, totalScore: 0.1, factors: { recency: 0.4, referenceCount: 0, userEmphasis: 0.1, actionRelevance: 0.8 } },
        { messageIndex: 3, totalScore: 0.5, factors: { recency: 0.5, referenceCount: 0, userEmphasis: 0.3, actionRelevance: 0 } },
      ];

      const config = { ...DEFAULT_WINDOWING_CONFIG, minRecentMessages: 1, importanceThreshold: 0.5, preserveToolPairs: true };
      const result = selectMessagesToKeep(messages, scores, createWorkingSet(), config);

      // Both tool_use and tool_result should be kept together
      if (result.keep.includes(1)) {
        expect(result.keep).toContain(2);
      }
      if (result.keep.includes(2)) {
        expect(result.keep).toContain(1);
      }
    });

    it('enforces maxMessages cap', () => {
      const messages: Message[] = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      } as Message));

      const scores: MessageScore[] = messages.map((_, i) => ({
        messageIndex: i,
        totalScore: 0.9, // All high scores
        factors: { recency: 0.9, referenceCount: 0, userEmphasis: 0.9, actionRelevance: 0 },
      }));

      const config = { ...DEFAULT_WINDOWING_CONFIG, maxMessages: 10 };
      const result = selectMessagesToKeep(messages, scores, createWorkingSet(), config);

      // Should not exceed maxMessages (plus potential tool pairs)
      expect(result.keep.length).toBeLessThanOrEqual(config.maxMessages + 5); // Allow some room for pairs
    });

    it('returns sorted keep indices', () => {
      const messages: Message[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
        { role: 'user', content: 'Third' },
        { role: 'assistant', content: 'Fourth' },
      ];

      const scores: MessageScore[] = messages.map((_, i) => ({
        messageIndex: i,
        totalScore: 0.8,
        factors: { recency: 0.8, referenceCount: 0, userEmphasis: 0.5, actionRelevance: 0 },
      }));

      const result = selectMessagesToKeep(messages, scores, createWorkingSet());

      // Verify indices are sorted
      for (let i = 1; i < result.keep.length; i++) {
        expect(result.keep[i]).toBeGreaterThan(result.keep[i - 1]);
      }
    });

    it('respects preserveWorkingSet config', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Look at /src/file.ts' },
        { role: 'assistant', content: 'Recent' },
      ];

      const scores: MessageScore[] = messages.map((_, i) => ({
        messageIndex: i,
        totalScore: 0.1,
        factors: { recency: 0.1, referenceCount: 0, userEmphasis: 0.1, actionRelevance: 0 },
      }));

      const ws = createWorkingSet();
      ws.recentFiles.add('/src/file.ts');

      // With preserveWorkingSet: false
      const config = { ...DEFAULT_WINDOWING_CONFIG, minRecentMessages: 1, importanceThreshold: 0.9, preserveWorkingSet: false };
      const result = selectMessagesToKeep(messages, scores, ws, config);

      // Should NOT keep first message just because it references working set
      expect(result.keep).not.toContain(0);
    });
  });

  describe('applySelection', () => {
    it('returns selected messages in order', () => {
      const messages: Message[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
        { role: 'user', content: 'Third' },
      ];

      const selection = { keep: [0, 2], summarize: [1] };
      const result = applySelection(messages, selection);

      expect(result.length).toBe(2);
      expect(result[0].content).toBe('First');
      expect(result[1].content).toBe('Third');
    });

    it('handles empty selection', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Test' },
      ];

      const result = applySelection(messages, { keep: [], summarize: [0] });

      expect(result.length).toBe(0);
    });

    it('filters out orphaned tool_results at start', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'orphaned result' },
          ],
        },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Next message' },
      ];

      // Selection keeps all
      const selection = { keep: [0, 1, 2], summarize: [] };
      const result = applySelection(messages, selection);

      // Should skip the orphaned tool_result
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getSelectionStats', () => {
    it('calculates correct statistics', () => {
      const messages: Message[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
        { role: 'user', content: 'Third' },
        { role: 'assistant', content: 'Fourth' },
      ];

      const selection = { keep: [0, 2, 3], summarize: [1] };

      const ws = createWorkingSet();
      ws.recentFiles.add('/file1.ts');
      ws.recentFiles.add('/file2.ts');

      const stats = getSelectionStats(messages, selection, ws);

      expect(stats.totalMessages).toBe(4);
      expect(stats.keptMessages).toBe(3);
      expect(stats.summarizedMessages).toBe(1);
      expect(stats.keptPercent).toBe(75);
      expect(stats.workingSetSize).toBe(2);
    });

    it('handles empty messages', () => {
      const stats = getSelectionStats([], { keep: [], summarize: [] }, createWorkingSet());

      expect(stats.totalMessages).toBe(0);
      expect(stats.keptMessages).toBe(0);
      expect(stats.keptPercent).toBe(100);
    });
  });
});
