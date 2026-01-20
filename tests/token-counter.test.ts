// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateTokens,
  estimateSystemPromptTokens,
  estimateToolDefinitionTokens,
  estimateTotalContextTokens,
  countMessageTokens,
  getMessageText,
  updateCalibration,
  getCalibrationData,
  resetCalibration,
} from '../src/utils/token-counter.js';
import type { Message, ToolDefinition } from '../src/types.js';

describe('Token Counter', () => {
  beforeEach(() => {
    resetCalibration();
  });

  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('estimates prose at ~4 chars/token', () => {
      const prose = 'This is a normal English sentence with some words.';
      const tokens = estimateTokens(prose);
      // 50 chars / 4 = 12.5, ceil = 13
      expect(tokens).toBe(13);
    });

    it('estimates code at ~3 chars/token', () => {
      const code = 'function test() { return x.map(y => y + 1); }';
      const tokens = estimateTokens(code);
      // Should use code heuristic (3 chars/token) due to code indicators
      // 45 chars / 3 = 15
      expect(tokens).toBe(15);
    });

    it('detects code blocks in markdown', () => {
      const codeBlock = '```typescript\nconst x = 1;\n```';
      const tokens = estimateTokens(codeBlock);
      // 30 chars / 3 = 10
      expect(tokens).toBe(10);
    });

    it('estimates JSON at ~3.5 chars/token', () => {
      const json = '{"name": "test", "value": 123, "nested": {"key": "val"}}';
      const tokens = estimateTokens(json);
      // 55 chars / 3.5 = 15.7, ceil = 16
      expect(tokens).toBe(16);
    });

    it('detects arrow functions as code', () => {
      const code = 'const handler = () => { console.log("test"); }';
      const tokens = estimateTokens(code);
      // Should detect => { as code indicator
      expect(tokens).toBe(Math.ceil(code.length / 3));
    });

    it('detects import statements as code', () => {
      const code = "import { something } from './module.js';";
      const tokens = estimateTokens(code);
      expect(tokens).toBe(Math.ceil(code.length / 3));
    });
  });

  describe('estimateSystemPromptTokens', () => {
    it('uses prose heuristic (4 chars/token)', () => {
      const systemPrompt = 'You are a helpful assistant that writes code.';
      const tokens = estimateSystemPromptTokens(systemPrompt);
      expect(tokens).toBe(Math.ceil(systemPrompt.length / 4));
    });
  });

  describe('estimateToolDefinitionTokens', () => {
    it('returns 0 for empty tools array', () => {
      expect(estimateToolDefinitionTokens([])).toBe(0);
    });

    it('estimates tokens for tool definitions', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'read_file',
          description: 'Read the contents of a file',
          input_schema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
        },
      ];

      const tokens = estimateToolDefinitionTokens(tools);
      expect(tokens).toBeGreaterThan(0);
      // Should include name, description, schema, and overhead
      expect(tokens).toBeGreaterThan(20);
    });

    it('scales with number of tools', () => {
      const oneTool: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Description',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      ];

      const twoTools: ToolDefinition[] = [
        ...oneTool,
        {
          name: 'tool2',
          description: 'Another description',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      ];

      const oneToolTokens = estimateToolDefinitionTokens(oneTool);
      const twoToolTokens = estimateToolDefinitionTokens(twoTools);

      expect(twoToolTokens).toBeGreaterThan(oneToolTokens);
    });
  });

  describe('countMessageTokens', () => {
    it('includes message overhead', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hi' },
      ];

      const tokens = countMessageTokens(messages);
      // 2 chars / 4 = 0.5, ceil = 1, plus 4 overhead = 5
      expect(tokens).toBe(5);
    });

    it('handles multiple messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const tokens = countMessageTokens(messages);
      // Each message has content + 4 overhead
      expect(tokens).toBeGreaterThan(8);
    });

    it('handles content blocks', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is the result:' },
            { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: '/test.ts' } },
          ],
        },
      ];

      const tokens = countMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateTotalContextTokens', () => {
    it('combines messages, system prompt, and tools', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];
      const systemPrompt = 'You are a helpful assistant.';
      const tools: ToolDefinition[] = [
        {
          name: 'test',
          description: 'Test tool',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      ];

      const messageOnly = countMessageTokens(messages);
      const total = estimateTotalContextTokens(messages, systemPrompt, tools);

      expect(total).toBeGreaterThan(messageOnly);
    });

    it('works without system prompt or tools', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];

      const total = estimateTotalContextTokens(messages);
      expect(total).toBe(countMessageTokens(messages));
    });
  });

  describe('calibration', () => {
    it('starts with no calibration data', () => {
      expect(getCalibrationData()).toBeNull();
    });

    it('updates calibration with actual token counts', () => {
      updateCalibration(400, 100); // 4 chars/token

      const data = getCalibrationData();
      expect(data).not.toBeNull();
      expect(data!.averageCharsPerToken).toBe(4);
      expect(data!.sampleCount).toBe(1);
    });

    it('uses exponential moving average for multiple samples', () => {
      updateCalibration(400, 100); // 4 chars/token
      updateCalibration(300, 100); // 3 chars/token

      const data = getCalibrationData();
      expect(data).not.toBeNull();
      // Second sample with alpha = min(0.1, 1/1) = 0.1
      // 0.1 * 3 + 0.9 * 4 = 0.3 + 3.6 = 3.9
      expect(data!.averageCharsPerToken).toBeCloseTo(3.9, 5);
      expect(data!.sampleCount).toBe(2);
    });

    it('rejects outliers', () => {
      updateCalibration(100, 100); // 1 char/token (borderline)
      updateCalibration(50, 100);  // 0.5 chars/token (rejected)
      updateCalibration(1100, 100); // 11 chars/token (rejected)

      const data = getCalibrationData();
      expect(data!.sampleCount).toBe(1); // Only the first valid sample
    });

    it('ignores invalid inputs', () => {
      updateCalibration(0, 100);
      updateCalibration(100, 0);
      updateCalibration(-100, 100);

      expect(getCalibrationData()).toBeNull();
    });

    it('resets calibration', () => {
      updateCalibration(400, 100);
      expect(getCalibrationData()).not.toBeNull();

      resetCalibration();
      expect(getCalibrationData()).toBeNull();
    });
  });

  describe('getMessageText', () => {
    it('handles string content', () => {
      const message: Message = { role: 'user', content: 'Hello world' };
      expect(getMessageText(message)).toBe('Hello world');
    });

    it('handles text blocks', () => {
      const message: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Response text' }],
      };
      expect(getMessageText(message)).toBe('Response text');
    });

    it('handles tool_use blocks', () => {
      const message: Message = {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'test', input: { key: 'value' } },
        ],
      };
      expect(getMessageText(message)).toContain('key');
      expect(getMessageText(message)).toContain('value');
    });

    it('handles tool_result blocks', () => {
      const message: Message = {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'Result content' },
        ],
      };
      expect(getMessageText(message)).toBe('Result content');
    });

    it('joins multiple blocks with newlines', () => {
      const message: Message = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      };
      expect(getMessageText(message)).toBe('First\nSecond');
    });
  });
});
