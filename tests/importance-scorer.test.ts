// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  scoreMessages,
  scoreEntities,
  buildEntityReferenceMap,
  getTopMessages,
  getMessagesAboveThreshold,
  extractFilePaths,
  DEFAULT_IMPORTANCE_WEIGHTS,
} from '../src/importance-scorer.js';
import type { Message } from '../src/types.js';
import type { Entity } from '../src/compression.js';

describe('Importance Scorer', () => {
  describe('buildEntityReferenceMap', () => {
    it('tracks entities in messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Look at UserService' },
        { role: 'assistant', content: 'UserService handles auth' },
        { role: 'user', content: 'What about AuthController?' },
      ];

      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 2, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'AuthController', type: 'class', count: 1, firstSeen: 2 }],
      ]);

      const refMap = buildEntityReferenceMap(messages, entities);

      expect(refMap.size).toBe(3);
      expect(refMap.get(0)?.entities.has('UserService')).toBe(true);
      expect(refMap.get(1)?.entities.has('UserService')).toBe(true);
      expect(refMap.get(2)?.entities.has('AuthController')).toBe(true);
    });

    it('counts forward references', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Check UserService' },
        { role: 'assistant', content: 'UserService is a class' },
        { role: 'user', content: 'Tell me more about UserService' },
      ];

      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 3, firstSeen: 0 }],
      ]);

      const refMap = buildEntityReferenceMap(messages, entities);

      // First message should have 2 forward refs (messages 1 and 2)
      expect(refMap.get(0)?.forwardReferences).toBe(2);
      // Second message should have 1 forward ref (message 2)
      expect(refMap.get(1)?.forwardReferences).toBe(1);
      // Last message has no forward refs
      expect(refMap.get(2)?.forwardReferences).toBe(0);
    });

    it('handles empty messages', () => {
      const refMap = buildEntityReferenceMap([]);
      expect(refMap.size).toBe(0);
    });

    it('handles messages without entities', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      const refMap = buildEntityReferenceMap(messages);
      expect(refMap.size).toBe(2);
      expect(refMap.get(0)?.entities.size).toBe(0);
    });
  });

  describe('scoreMessages', () => {
    it('scores empty messages', () => {
      const scores = scoreMessages([]);
      expect(scores).toEqual([]);
    });

    it('gives higher recency score to recent messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Old message' },
        { role: 'assistant', content: 'Old response' },
        { role: 'user', content: 'New message' },
        { role: 'assistant', content: 'New response' },
      ];

      const scores = scoreMessages(messages);

      // Most recent should have highest recency
      expect(scores[3].factors.recency).toBeGreaterThan(scores[0].factors.recency);
      expect(scores[2].factors.recency).toBeGreaterThan(scores[1].factors.recency);
    });

    it('gives higher emphasis score to user messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' },
      ];

      const scores = scoreMessages(messages);

      expect(scores[0].factors.userEmphasis).toBeGreaterThan(scores[1].factors.userEmphasis);
    });

    it('boosts score for questions', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Statement here' },
        { role: 'user', content: 'Is this a question?' },
      ];

      const scores = scoreMessages(messages);

      expect(scores[1].factors.userEmphasis).toBeGreaterThan(scores[0].factors.userEmphasis);
    });

    it('boosts score for emphasis markers', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Normal request' },
        { role: 'user', content: 'This is important! Must do this!' },
      ];

      const scores = scoreMessages(messages);

      expect(scores[1].factors.userEmphasis).toBeGreaterThan(scores[0].factors.userEmphasis);
    });

    it('gives high action relevance to tool_use messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read a file' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Reading file' },
            { type: 'tool_use', id: 't1', name: 'read_file', input: { path: '/test.ts' } },
          ],
        },
      ];

      const scores = scoreMessages(messages);

      expect(scores[1].factors.actionRelevance).toBe(1);
    });

    it('gives high action relevance to tool_result messages', () => {
      const messages: Message[] = [
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
      ];

      const scores = scoreMessages(messages);

      expect(scores[1].factors.actionRelevance).toBe(0.8);
    });

    it('boosts score for user message that led to tool use', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read the file test.ts' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'read_file', input: { path: '/test.ts' } },
          ],
        },
      ];

      const scores = scoreMessages(messages);

      expect(scores[0].factors.actionRelevance).toBe(0.6);
    });

    it('uses custom weights', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Test message' },
      ];

      const customWeights = {
        recency: 1,
        referenceCount: 0,
        userEmphasis: 0,
        actionRelevance: 0,
        codeRelevance: 0,
      };

      const scores = scoreMessages(messages, customWeights);

      // With only recency weight, score should equal recency factor
      expect(scores[0].totalScore).toBeCloseTo(scores[0].factors.recency, 2);
    });
  });

  describe('scoreEntities', () => {
    it('scores empty entities', () => {
      const scores = scoreEntities(new Map(), []);
      expect(scores).toEqual([]);
    });

    it('gives higher score to frequently referenced entities', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'Rare', type: 'class', count: 1, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'Common', type: 'class', count: 10, firstSeen: 0 }],
      ]);

      const messages: Message[] = [
        { role: 'user', content: 'Test' },
      ];

      const scores = scoreEntities(entities, messages);

      const rareScore = scores.find(s => s.entityId === 'E1')!;
      const commonScore = scores.find(s => s.entityId === 'E2')!;

      expect(commonScore.factors.referenceCount).toBeGreaterThan(rareScore.factors.referenceCount);
    });

    it('marks user-mentioned entities', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 2, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'InternalHelper', type: 'class', count: 2, firstSeen: 0 }],
      ]);

      const messages: Message[] = [
        { role: 'user', content: 'Check UserService' },
        { role: 'assistant', content: 'InternalHelper is used' },
      ];

      const scores = scoreEntities(entities, messages);

      const userServiceScore = scores.find(s => s.entityId === 'E1')!;
      const internalScore = scores.find(s => s.entityId === 'E2')!;

      expect(userServiceScore.factors.userMentioned).toBe(true);
      expect(internalScore.factors.userMentioned).toBe(false);
    });

    it('gives high action relevance to entities in tool inputs', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: '/src/test.ts', type: 'path', count: 1, firstSeen: 0 }],
        ['E2', { id: 'E2', value: '/other/file.ts', type: 'path', count: 1, firstSeen: 0 }],
      ]);

      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'read_file', input: { path: '/src/test.ts' } },
          ],
        },
      ];

      const scores = scoreEntities(entities, messages);

      const usedScore = scores.find(s => s.entityId === 'E1')!;
      const unusedScore = scores.find(s => s.entityId === 'E2')!;

      expect(usedScore.factors.actionRelevance).toBe(1);
      expect(unusedScore.factors.actionRelevance).toBe(0);
    });

    it('returns scores sorted by total score descending', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'Low', type: 'class', count: 1, firstSeen: 10 }],
        ['E2', { id: 'E2', value: 'High', type: 'class', count: 10, firstSeen: 0 }],
      ]);

      const messages: Message[] = [
        { role: 'user', content: 'High is important' },
      ];

      const scores = scoreEntities(entities, messages);

      expect(scores[0].entityId).toBe('E2');
      expect(scores[0].totalScore).toBeGreaterThan(scores[1].totalScore);
    });
  });

  describe('getTopMessages', () => {
    it('returns top N messages by score', () => {
      const scores = [
        { messageIndex: 0, totalScore: 0.3, factors: { recency: 0.3, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
        { messageIndex: 1, totalScore: 0.8, factors: { recency: 0.8, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
        { messageIndex: 2, totalScore: 0.5, factors: { recency: 0.5, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
      ];

      const top = getTopMessages(scores, 2);

      expect(top.length).toBe(2);
      expect(top[0].messageIndex).toBe(1);
      expect(top[1].messageIndex).toBe(2);
    });

    it('handles request for more than available', () => {
      const scores = [
        { messageIndex: 0, totalScore: 0.5, factors: { recency: 0.5, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
      ];

      const top = getTopMessages(scores, 10);

      expect(top.length).toBe(1);
    });
  });

  describe('getMessagesAboveThreshold', () => {
    it('filters messages by threshold', () => {
      const scores = [
        { messageIndex: 0, totalScore: 0.3, factors: { recency: 0.3, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
        { messageIndex: 1, totalScore: 0.5, factors: { recency: 0.5, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
        { messageIndex: 2, totalScore: 0.7, factors: { recency: 0.7, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
      ];

      const above = getMessagesAboveThreshold(scores, 0.5);

      expect(above.length).toBe(2);
      expect(above.map(s => s.messageIndex)).toContain(1);
      expect(above.map(s => s.messageIndex)).toContain(2);
    });

    it('returns empty for high threshold', () => {
      const scores = [
        { messageIndex: 0, totalScore: 0.3, factors: { recency: 0.3, referenceCount: 0, userEmphasis: 0, actionRelevance: 0 } },
      ];

      const above = getMessagesAboveThreshold(scores, 0.9);

      expect(above.length).toBe(0);
    });
  });

  describe('extractFilePaths', () => {
    it('extracts file paths with extensions', () => {
      const text = 'Check src/components/Button.tsx for the issue';
      const paths = extractFilePaths(text);
      expect(paths.has('src/components/Button.tsx')).toBe(true);
    });

    it('extracts multiple file paths', () => {
      const text = 'Look at src/index.ts and src/utils/helpers.js';
      const paths = extractFilePaths(text);
      expect(paths.has('src/index.ts')).toBe(true);
      expect(paths.has('src/utils/helpers.js')).toBe(true);
    });

    it('handles paths with dots in directory names', () => {
      const text = 'The file src/@types/node.d.ts defines types';
      const paths = extractFilePaths(text);
      expect(paths.size).toBeGreaterThan(0);
    });

    it('removes leading ./ from paths', () => {
      const text = 'Run ./scripts/build.sh';
      const paths = extractFilePaths(text);
      expect(paths.has('scripts/build.sh')).toBe(true);
    });

    it('returns empty set for text without paths', () => {
      const text = 'This is just a plain text message';
      const paths = extractFilePaths(text);
      expect(paths.size).toBe(0);
    });

    it('extracts paths from quoted strings', () => {
      const text = 'Edit "src/config.ts" to change settings';
      const paths = extractFilePaths(text);
      expect(paths.has('src/config.ts')).toBe(true);
    });
  });

  describe('code relevance scoring', () => {
    it('gives higher score to messages discussing indexed files', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Look at src/agent.ts' },
        { role: 'user', content: 'What about unrelated topic?' },
      ];

      const indexedFiles = new Set(['src/agent.ts', 'src/index.ts']);

      const scores = scoreMessages(
        messages,
        DEFAULT_IMPORTANCE_WEIGHTS,
        undefined,
        indexedFiles
      );

      // Message mentioning indexed file should have higher codeRelevance
      expect(scores[0].factors.codeRelevance).toBeGreaterThan(scores[1].factors.codeRelevance);
    });

    it('gives neutral score when no indexed files provided', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Look at src/agent.ts' },
      ];

      const scores = scoreMessages(messages, DEFAULT_IMPORTANCE_WEIGHTS);

      // Should get neutral score (0.5) when no indexed files
      expect(scores[0].factors.codeRelevance).toBe(0.5);
    });

    it('gives low score to messages not mentioning any files', () => {
      const messages: Message[] = [
        { role: 'user', content: 'What is the meaning of life?' },
      ];

      const indexedFiles = new Set(['src/agent.ts']);

      const scores = scoreMessages(
        messages,
        DEFAULT_IMPORTANCE_WEIGHTS,
        undefined,
        indexedFiles
      );

      // Should get low score (0.3) when message has no file paths
      expect(scores[0].factors.codeRelevance).toBe(0.3);
    });

    it('includes codeRelevance in total score calculation', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Check src/important.ts file' },
      ];

      const indexedFiles = new Set(['src/important.ts']);

      // Use weights that only count codeRelevance
      const customWeights = {
        recency: 0,
        referenceCount: 0,
        userEmphasis: 0,
        actionRelevance: 0,
        codeRelevance: 1,
      };

      const scores = scoreMessages(
        messages,
        customWeights,
        undefined,
        indexedFiles
      );

      // Total score should equal codeRelevance factor
      expect(scores[0].totalScore).toBeCloseTo(scores[0].factors.codeRelevance, 2);
    });
  });
});
