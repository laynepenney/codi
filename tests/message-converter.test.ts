// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  blockToText,
  messageToText,
  extractTextContent,
  extractToolUseBlocks,
  extractToolResultBlocks,
  extractImageBlocks,
  hasBlockType,
  isSimpleMessage,
  hasContentBlocks,
} from '../src/providers/message-converter.js';
import type { Message, ContentBlock } from '../src/types.js';

describe('message-converter', () => {
  describe('blockToText', () => {
    it('converts text block to text', () => {
      const block: ContentBlock = { type: 'text', text: 'Hello world' };
      expect(blockToText(block)).toBe('Hello world');
    });

    it('handles empty text block', () => {
      const block: ContentBlock = { type: 'text' };
      expect(blockToText(block)).toBe('');
    });

    it('converts tool_result block to formatted text', () => {
      const block: ContentBlock = {
        type: 'tool_result',
        tool_use_id: '123',
        name: 'bash',
        content: 'file1.txt\nfile2.txt',
        is_error: false,
      };
      expect(blockToText(block)).toBe('[Result from bash]:\nfile1.txt\nfile2.txt');
    });

    it('converts error tool_result block with ERROR prefix', () => {
      const block: ContentBlock = {
        type: 'tool_result',
        tool_use_id: '123',
        name: 'bash',
        content: 'Command not found',
        is_error: true,
      };
      expect(blockToText(block)).toBe('[ERROR from bash]:\nCommand not found');
    });

    it('handles tool_result without name', () => {
      const block: ContentBlock = {
        type: 'tool_result',
        tool_use_id: '123',
        content: 'output',
      };
      expect(blockToText(block)).toBe('[Result from tool]:\noutput');
    });

    it('converts tool_use block to formatted text', () => {
      const block: ContentBlock = {
        type: 'tool_use',
        id: '123',
        name: 'read_file',
        input: { path: '/test.ts' },
      };
      expect(blockToText(block)).toBe('[Calling read_file]: {"path":"/test.ts"}');
    });

    it('handles tool_use without name', () => {
      const block: ContentBlock = {
        type: 'tool_use',
        id: '123',
        input: { command: 'ls' },
      };
      expect(blockToText(block)).toBe('[Calling tool]: {"command":"ls"}');
    });

    it('converts image block to placeholder', () => {
      const block: ContentBlock = {
        type: 'image',
        image: {
          type: 'base64',
          media_type: 'image/png',
          data: 'base64data',
        },
      };
      expect(blockToText(block)).toBe('[Image attached]');
    });
  });

  describe('messageToText', () => {
    it('passes through string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(messageToText(msg)).toBe('Hello');
    });

    it('converts single text block', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      };
      expect(messageToText(msg)).toBe('Hello');
    });

    it('converts multiple blocks with double newline separator', () => {
      const msg: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      };
      expect(messageToText(msg)).toBe('First\n\nSecond');
    });

    it('converts tool_result blocks correctly', () => {
      const msg: Message = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: '123',
            name: 'bash',
            content: 'output here',
            is_error: false,
          },
          { type: 'text', text: 'Continue with the task.' },
        ],
      };
      const result = messageToText(msg);
      expect(result).toContain('[Result from bash]:');
      expect(result).toContain('output here');
      expect(result).toContain('Continue with the task.');
    });

    it('converts mixed block types', () => {
      const msg: Message = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check that file.' },
          {
            type: 'tool_use',
            id: '456',
            name: 'read_file',
            input: { path: '/test.ts' },
          },
        ],
      };
      const result = messageToText(msg);
      expect(result).toContain('Let me check that file.');
      expect(result).toContain('[Calling read_file]:');
      expect(result).toContain('{"path":"/test.ts"}');
    });

    it('filters out empty blocks', () => {
      const msg: Message = {
        role: 'user',
        content: [
          { type: 'text', text: '' },
          { type: 'text', text: 'Hello' },
          { type: 'text', text: '' },
        ],
      };
      expect(messageToText(msg)).toBe('Hello');
    });

    it('handles real-world tool result scenario', () => {
      // This is the exact scenario that caused the bug
      const msg: Message = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_123',
            name: 'bash',
            content: 'abc123 2026-01-14 Fix bug\ndef456 2026-01-13 Add feature',
            is_error: false,
          },
          {
            type: 'text',
            text: 'Original request: "show git log"\n\nIf you have completed the task, respond.',
          },
        ],
      };
      const result = messageToText(msg);

      // The critical assertion - tool result content MUST be included
      expect(result).toContain('abc123 2026-01-14 Fix bug');
      expect(result).toContain('def456 2026-01-13 Add feature');
      expect(result).toContain('[Result from bash]:');
      expect(result).toContain('Original request:');
    });
  });

  describe('extractTextContent', () => {
    it('extracts string content directly', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(extractTextContent(msg)).toBe('Hello');
    });

    it('extracts text from text blocks only', () => {
      const msg: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_result', tool_use_id: '1', content: 'ignored' },
          { type: 'text', text: ' World' },
        ],
      };
      expect(extractTextContent(msg)).toBe('Hello World');
    });

    it('returns empty string for non-text blocks', () => {
      const msg: Message = {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: '1', content: 'result' },
        ],
      };
      expect(extractTextContent(msg)).toBe('');
    });
  });

  describe('extractToolUseBlocks', () => {
    it('returns empty array for string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(extractToolUseBlocks(msg)).toEqual([]);
    });

    it('extracts tool_use blocks', () => {
      const msg: Message = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me help' },
          { type: 'tool_use', id: '1', name: 'bash', input: { command: 'ls' } },
          { type: 'tool_use', id: '2', name: 'read_file', input: { path: '/test' } },
        ],
      };
      const blocks = extractToolUseBlocks(msg);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({ id: '1', name: 'bash', input: { command: 'ls' } });
      expect(blocks[1]).toEqual({ id: '2', name: 'read_file', input: { path: '/test' } });
    });

    it('handles missing fields with defaults', () => {
      const msg: Message = {
        role: 'assistant',
        content: [{ type: 'tool_use' }],
      };
      const blocks = extractToolUseBlocks(msg);
      expect(blocks[0]).toEqual({ id: '', name: '', input: {} });
    });
  });

  describe('extractToolResultBlocks', () => {
    it('returns empty array for string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(extractToolResultBlocks(msg)).toEqual([]);
    });

    it('extracts tool_result blocks with name', () => {
      const msg: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Result:' },
          {
            type: 'tool_result',
            tool_use_id: '1',
            name: 'bash',
            content: 'output',
            is_error: false,
          },
        ],
      };
      const blocks = extractToolResultBlocks(msg);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        tool_use_id: '1',
        name: 'bash',
        content: 'output',
        is_error: false,
      });
    });

    it('extracts error tool_result blocks', () => {
      const msg: Message = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: '1',
            content: 'error message',
            is_error: true,
          },
        ],
      };
      const blocks = extractToolResultBlocks(msg);
      expect(blocks[0].is_error).toBe(true);
      expect(blocks[0].name).toBeUndefined();
    });
  });

  describe('extractImageBlocks', () => {
    it('returns empty array for string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(extractImageBlocks(msg)).toEqual([]);
    });

    it('extracts image blocks', () => {
      const msg: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this image:' },
          {
            type: 'image',
            image: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgo...',
            },
          },
        ],
      };
      const blocks = extractImageBlocks(msg);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        media_type: 'image/png',
        data: 'iVBORw0KGgo...',
      });
    });

    it('skips image blocks without image data', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'image' }],
      };
      expect(extractImageBlocks(msg)).toEqual([]);
    });
  });

  describe('hasBlockType', () => {
    it('returns true for text type on string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(hasBlockType(msg, 'text')).toBe(true);
    });

    it('returns false for non-text types on string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(hasBlockType(msg, 'tool_use')).toBe(false);
      expect(hasBlockType(msg, 'tool_result')).toBe(false);
      expect(hasBlockType(msg, 'image')).toBe(false);
    });

    it('detects block types in array content', () => {
      const msg: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_result', tool_use_id: '1', content: 'result' },
        ],
      };
      expect(hasBlockType(msg, 'text')).toBe(true);
      expect(hasBlockType(msg, 'tool_result')).toBe(true);
      expect(hasBlockType(msg, 'tool_use')).toBe(false);
      expect(hasBlockType(msg, 'image')).toBe(false);
    });
  });

  describe('isSimpleMessage', () => {
    it('returns true for string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(isSimpleMessage(msg)).toBe(true);
    });

    it('returns false for array content', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      };
      expect(isSimpleMessage(msg)).toBe(false);
    });
  });

  describe('hasContentBlocks', () => {
    it('returns false for string content', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(hasContentBlocks(msg)).toBe(false);
    });

    it('returns true for array content', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      };
      expect(hasContentBlocks(msg)).toBe(true);
    });
  });

  describe('regression tests', () => {
    it('tool_result content is never lost (the original bug)', () => {
      // This test ensures the bug that caused infinite loops never returns
      const toolResultContent = 'abc123 Fix typo\ndef456 Add feature\nghi789 Update docs';
      const msg: Message = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_123',
            name: 'bash',
            content: toolResultContent,
            is_error: false,
          },
          {
            type: 'text',
            text: 'Please analyze the results.',
          },
        ],
      };

      const text = messageToText(msg);

      // Every line of the tool result MUST appear in the output
      expect(text).toContain('abc123 Fix typo');
      expect(text).toContain('def456 Add feature');
      expect(text).toContain('ghi789 Update docs');

      // The text content must also appear
      expect(text).toContain('Please analyze the results.');
    });

    it('handles complex multi-tool conversation', () => {
      const messages: Message[] = [
        { role: 'user', content: 'List files and read package.json' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will list files first.' },
            { type: 'tool_use', id: '1', name: 'bash', input: { command: 'ls' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: '1', name: 'bash', content: 'file1.ts\nfile2.ts' },
            { type: 'text', text: 'Continue.' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Now reading package.json.' },
            { type: 'tool_use', id: '2', name: 'read_file', input: { path: 'package.json' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: '2', name: 'read_file', content: '{"name": "test"}' },
          ],
        },
      ];

      // Convert each message and verify no content is lost
      for (const msg of messages) {
        const text = messageToText(msg);
        expect(text.length).toBeGreaterThan(0);

        // Verify tool results are included
        if (hasBlockType(msg, 'tool_result')) {
          const results = extractToolResultBlocks(msg);
          for (const result of results) {
            expect(text).toContain(result.content);
          }
        }
      }
    });
  });
});
