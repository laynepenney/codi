// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  extractEntities,
  compressContext,
  generateEntityLegend,
  decompressText,
  decompressWithBuffer,
  getCompressionStats,
  type Entity,
} from '../src/compression.js';
import type { Message } from '../src/types.js';

describe('compression', () => {
  describe('extractEntities', () => {
    it('should extract file paths that appear multiple times', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Look at src/components/Button.tsx' },
        { role: 'assistant', content: 'The file src/components/Button.tsx contains a Button component.' },
        { role: 'user', content: 'Update src/components/Button.tsx to add a loading prop.' },
      ];

      const entities = extractEntities(messages);

      expect(entities.size).toBeGreaterThan(0);

      // Should have extracted the file path
      const pathEntity = [...entities.values()].find(e => e.value === 'src/components/Button.tsx');
      expect(pathEntity).toBeDefined();
      expect(pathEntity?.type).toBe('path');
      expect(pathEntity?.count).toBeGreaterThanOrEqual(2);
    });

    it('should extract class names that appear multiple times', () => {
      const messages: Message[] = [
        { role: 'user', content: 'The UserAuthService handles authentication.' },
        { role: 'assistant', content: 'I see. The UserAuthService class should be updated.' },
        { role: 'user', content: 'Make UserAuthService also handle token refresh.' },
      ];

      const entities = extractEntities(messages);

      const classEntity = [...entities.values()].find(e => e.value === 'UserAuthService');
      expect(classEntity).toBeDefined();
      expect(classEntity?.type).toBe('class');
    });

    it('should extract function names that appear multiple times', () => {
      const messages: Message[] = [
        { role: 'user', content: 'The handleSubmit function is broken.' },
        { role: 'assistant', content: 'Let me check handleSubmit.' },
        { role: 'user', content: 'Also check if handleSubmit validates input.' },
      ];

      const entities = extractEntities(messages);

      const funcEntity = [...entities.values()].find(e => e.value === 'handleSubmit');
      expect(funcEntity).toBeDefined();
      expect(funcEntity?.type).toBe('function');
    });

    it('should not extract entities that appear only once', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Look at src/unique-file.ts' },
        { role: 'assistant', content: 'That file does something.' },
      ];

      const entities = extractEntities(messages);

      // Should not have unique path (appears once)
      const uniqueEntity = [...entities.values()].find(e => e.value.includes('unique-file'));
      expect(uniqueEntity).toBeUndefined();
    });

    it('should extract URLs that appear multiple times', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Check https://api.example.com/v1/users' },
        { role: 'assistant', content: 'The endpoint https://api.example.com/v1/users returns user data.' },
        { role: 'user', content: 'What about https://api.example.com/v1/users with auth?' },
      ];

      const entities = extractEntities(messages);

      const urlEntity = [...entities.values()].find(e => e.value.includes('api.example.com'));
      expect(urlEntity).toBeDefined();
      expect(urlEntity?.type).toBe('url');
    });
  });

  describe('compressContext', () => {
    it('should replace repeated entities with references', () => {
      const messages: Message[] = [
        { role: 'user', content: 'The UserAuthService in src/services/auth.ts handles auth.' },
        { role: 'assistant', content: 'I see UserAuthService is defined in src/services/auth.ts.' },
        { role: 'user', content: 'Update UserAuthService in src/services/auth.ts to add tokens.' },
      ];

      const result = compressContext(messages);

      expect(result.entities.size).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeGreaterThan(1);

      // Check that entities are replaced in compressed messages
      const compressedText = result.messages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .join(' ');

      // Should contain entity references like E1, E2
      expect(compressedText).toMatch(/E\d+/);
    });

    it('should return original messages if no entities to compress', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = compressContext(messages);

      expect(result.entities.size).toBe(0);
      expect(result.compressionRatio).toBe(1);
      expect(result.messages).toEqual(messages);
    });

    it('should handle array content blocks', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'The UserAuthService is important.' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Yes, UserAuthService handles authentication.' },
          ],
        },
        {
          role: 'user',
          content: 'Update UserAuthService please.',
        },
      ];

      const result = compressContext(messages);

      // Should still extract entities from array content
      expect(result.entities.size).toBeGreaterThan(0);
    });

    it('should calculate compression statistics correctly', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Check src/components/LongComponentName.tsx for issues.' },
        { role: 'assistant', content: 'The file src/components/LongComponentName.tsx looks fine.' },
        { role: 'user', content: 'Also review src/components/LongComponentName.tsx for performance.' },
      ];

      const result = compressContext(messages);

      expect(result.originalSize).toBeGreaterThan(result.compressedSize);
      expect(result.compressionRatio).toBeGreaterThan(1);
    });
  });

  describe('generateEntityLegend', () => {
    it('should generate markdown legend grouped by type', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'src/services/auth.ts', type: 'path', count: 3, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'UserAuthService', type: 'class', count: 5, firstSeen: 0 }],
        ['E3', { id: 'E3', value: 'handleSubmit', type: 'function', count: 2, firstSeen: 0 }],
      ]);

      const legend = generateEntityLegend(entities);

      expect(legend).toContain('## Entity References');
      expect(legend).toContain('### Files');
      expect(legend).toContain('### Classes');
      expect(legend).toContain('### Functions');
      expect(legend).toContain('E1: src/services/auth.ts');
      expect(legend).toContain('E2: UserAuthService');
      expect(legend).toContain('E3: handleSubmit');
    });

    it('should return empty string for no entities', () => {
      const entities = new Map<string, Entity>();
      const legend = generateEntityLegend(entities);
      expect(legend).toBe('');
    });
  });

  describe('decompressText', () => {
    it('should replace entity references with original values', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserAuthService', type: 'class', count: 3, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'src/auth.ts', type: 'path', count: 2, firstSeen: 0 }],
      ]);

      const compressed = 'The E1 class is defined in E2.';
      const decompressed = decompressText(compressed, entities);

      expect(decompressed).toBe('The UserAuthService class is defined in src/auth.ts.');
    });

    it('should handle multiple occurrences of same entity', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'MyClass', type: 'class', count: 3, firstSeen: 0 }],
      ]);

      const compressed = 'E1 extends BaseClass. E1 is important.';
      const decompressed = decompressText(compressed, entities);

      expect(decompressed).toBe('MyClass extends BaseClass. MyClass is important.');
    });
  });

  describe('getCompressionStats', () => {
    it('should calculate detailed statistics', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Check UserAuthenticationService in src/services/auth.ts.' },
        { role: 'assistant', content: 'The UserAuthenticationService in src/services/auth.ts is good.' },
        { role: 'user', content: 'Update UserAuthenticationService in src/services/auth.ts.' },
      ];

      const result = compressContext(messages);
      const stats = getCompressionStats(result);

      expect(stats.originalChars).toBeGreaterThan(0);
      expect(stats.compressedChars).toBeLessThan(stats.originalChars);
      expect(stats.legendChars).toBeGreaterThan(0);
      expect(stats.entityCount).toBeGreaterThan(0);
      expect(stats.topEntities.length).toBeGreaterThan(0);
      expect(stats.savingsPercent).toBeDefined();
    });

    it('should show top entities sorted by savings', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Check VeryLongClassNameForTesting in short.ts' },
        { role: 'assistant', content: 'VeryLongClassNameForTesting in short.ts looks fine.' },
        { role: 'user', content: 'Update VeryLongClassNameForTesting in short.ts' },
      ];

      const result = compressContext(messages);
      const stats = getCompressionStats(result);

      // Top entities should be sorted by savings (length * count)
      if (stats.topEntities.length >= 2) {
        expect(stats.topEntities[0].savings).toBeGreaterThanOrEqual(stats.topEntities[1].savings);
      }
    });
  });

  describe('end-to-end compression', () => {
    it('should compress and decompress back to original meaning', () => {
      const originalMessages: Message[] = [
        { role: 'user', content: 'The PaymentProcessingService in src/payments/processor.ts handles Stripe.' },
        { role: 'assistant', content: 'I see PaymentProcessingService integrates with Stripe API in src/payments/processor.ts.' },
        { role: 'user', content: 'Add refund support to PaymentProcessingService in src/payments/processor.ts.' },
      ];

      // Compress
      const compressed = compressContext(originalMessages);

      // Get compressed text
      const compressedText = compressed.messages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .join('\n');

      // Decompress
      const decompressed = decompressText(compressedText, compressed.entities);

      // Original text (combined)
      const originalText = originalMessages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .join('\n');

      // Decompressed should match original
      expect(decompressed).toBe(originalText);
    });
  });

  describe('decompressWithBuffer', () => {
    it('should decompress complete text without buffering', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 2, firstSeen: 0 }],
        ['E2', { id: 'E2', value: 'src/auth.ts', type: 'path', count: 2, firstSeen: 0 }],
      ]);

      const { decompressed, remaining } = decompressWithBuffer('The E1 is in E2.', entities);

      expect(decompressed).toBe('The UserService is in src/auth.ts.');
      expect(remaining).toBe('');
    });

    it('should buffer partial entity reference at end', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 2, firstSeen: 0 }],
        ['E12', { id: 'E12', value: 'AuthService', type: 'class', count: 2, firstSeen: 0 }],
      ]);

      // "E" at end could be start of E1 or E12
      const { decompressed, remaining } = decompressWithBuffer('Look at E', entities);

      expect(decompressed).toBe('Look at ');
      expect(remaining).toBe('E');
    });

    it('should buffer partial entity with digits at end', () => {
      const entities = new Map<string, Entity>([
        ['E12', { id: 'E12', value: 'AuthService', type: 'class', count: 2, firstSeen: 0 }],
        ['E123', { id: 'E123', value: 'TokenService', type: 'class', count: 2, firstSeen: 0 }],
      ]);

      // "E1" could be start of E12 or E123
      const { decompressed, remaining } = decompressWithBuffer('Use E1', entities);

      expect(decompressed).toBe('Use ');
      expect(remaining).toBe('E1');
    });

    it('should not buffer if entity is complete', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'UserService', type: 'class', count: 2, firstSeen: 0 }],
      ]);

      // E1 is complete, no need to buffer
      const { decompressed, remaining } = decompressWithBuffer('Use E1', entities);

      expect(decompressed).toBe('Use UserService');
      expect(remaining).toBe('');
    });

    it('should handle streaming chunks correctly', () => {
      const entities = new Map<string, Entity>([
        ['E1', { id: 'E1', value: 'MyClass', type: 'class', count: 2, firstSeen: 0 }],
      ]);

      // Simulate streaming: first chunk ends with partial entity
      const chunk1 = decompressWithBuffer('The E', entities);
      expect(chunk1.remaining).toBe('E');

      // Second chunk completes the entity
      const chunk2 = decompressWithBuffer(chunk1.remaining + '1 is ready', entities);
      expect(chunk2.decompressed).toBe('MyClass is ready');
      expect(chunk2.remaining).toBe('');
    });
  });
});
