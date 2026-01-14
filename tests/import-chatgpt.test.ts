// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseConversation,
  generateConversationSummary,
  loadChatGPTExport,
  listConversations,
  searchConversations,
} from '../src/import-chatgpt.js';

// Sample ChatGPT export format
const sampleConversation = {
  title: 'Test Conversation',
  create_time: 1700000000,
  update_time: 1700001000,
  mapping: {
    'root-id': {
      id: 'root-id',
      message: null,
      parent: null,
      children: ['msg-1'],
    },
    'msg-1': {
      id: 'msg-1',
      message: {
        id: 'msg-1',
        author: { role: 'user' as const },
        content: { content_type: 'text', parts: ['Hello, how are you?'] },
        create_time: 1700000100,
      },
      parent: 'root-id',
      children: ['msg-2'],
    },
    'msg-2': {
      id: 'msg-2',
      message: {
        id: 'msg-2',
        author: { role: 'assistant' as const },
        content: { content_type: 'text', parts: ['I am doing well, thank you!'] },
        create_time: 1700000200,
      },
      parent: 'msg-1',
      children: ['msg-3'],
    },
    'msg-3': {
      id: 'msg-3',
      message: {
        id: 'msg-3',
        author: { role: 'user' as const },
        content: { content_type: 'text', parts: ['Can you help me with coding?'] },
        create_time: 1700000300,
      },
      parent: 'msg-2',
      children: ['msg-4'],
    },
    'msg-4': {
      id: 'msg-4',
      message: {
        id: 'msg-4',
        author: { role: 'assistant' as const },
        content: { content_type: 'text', parts: ['Of course! What would you like help with?'] },
        create_time: 1700000400,
      },
      parent: 'msg-3',
      children: [],
    },
  },
};

describe('ChatGPT Import', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-import-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseConversation', () => {
    it('should parse a conversation correctly', () => {
      const parsed = parseConversation(sampleConversation);

      expect(parsed.title).toBe('Test Conversation');
      expect(parsed.messages).toHaveLength(4);
      expect(parsed.messages[0].role).toBe('user');
      expect(parsed.messages[0].content).toBe('Hello, how are you?');
      expect(parsed.messages[1].role).toBe('assistant');
      expect(parsed.messages[1].content).toBe('I am doing well, thank you!');
    });

    it('should handle untitled conversations', () => {
      const untitled = { ...sampleConversation, title: '' };
      const parsed = parseConversation(untitled);
      expect(parsed.title).toBe('Untitled Conversation');
    });

    it('should convert timestamps to dates', () => {
      const parsed = parseConversation(sampleConversation);
      expect(parsed.createdAt).toBeInstanceOf(Date);
      expect(parsed.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('generateConversationSummary', () => {
    it('should generate a summary with title and topics', () => {
      const parsed = parseConversation(sampleConversation);
      const summary = generateConversationSummary(parsed);

      expect(summary).toContain('Test Conversation');
      expect(summary).toContain('Messages: 4');
      expect(summary).toContain('Hello, how are you?');
      expect(summary).toContain('Can you help me with coding?');
    });
  });

  describe('loadChatGPTExport', () => {
    it('should load an array of conversations', () => {
      const filePath = path.join(tempDir, 'conversations.json');
      fs.writeFileSync(filePath, JSON.stringify([sampleConversation]));

      const conversations = loadChatGPTExport(filePath);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].title).toBe('Test Conversation');
    });

    it('should load a single conversation', () => {
      const filePath = path.join(tempDir, 'conversation.json');
      fs.writeFileSync(filePath, JSON.stringify(sampleConversation));

      const conversations = loadChatGPTExport(filePath);
      expect(conversations).toHaveLength(1);
    });

    it('should throw on missing file', () => {
      expect(() => loadChatGPTExport('/nonexistent/file.json')).toThrow('File not found');
    });

    it('should throw on invalid format', () => {
      const filePath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(filePath, JSON.stringify({ invalid: 'format' }));

      expect(() => loadChatGPTExport(filePath)).toThrow('Invalid ChatGPT export format');
    });
  });

  describe('listConversations', () => {
    it('should list all conversations with parsed data', () => {
      const filePath = path.join(tempDir, 'conversations.json');
      const conversations = [
        sampleConversation,
        { ...sampleConversation, title: 'Second Conversation' },
      ];
      fs.writeFileSync(filePath, JSON.stringify(conversations));

      const list = listConversations(filePath);
      expect(list).toHaveLength(2);
      expect(list[0].title).toBe('Test Conversation');
      expect(list[1].title).toBe('Second Conversation');
    });
  });

  describe('searchConversations', () => {
    it('should search by title', () => {
      const filePath = path.join(tempDir, 'conversations.json');
      const conversations = [
        sampleConversation,
        { ...sampleConversation, title: 'React Hooks Discussion' },
        { ...sampleConversation, title: 'Python Tutorial' },
      ];
      fs.writeFileSync(filePath, JSON.stringify(conversations));

      const results = searchConversations(filePath, 'react');
      expect(results).toHaveLength(1);
      expect(results[0].conversation.title).toBe('React Hooks Discussion');
      expect(results[0].index).toBe(1);
    });

    it('should search by message content', () => {
      const filePath = path.join(tempDir, 'conversations.json');
      fs.writeFileSync(filePath, JSON.stringify([sampleConversation]));

      const results = searchConversations(filePath, 'coding');
      expect(results).toHaveLength(1);
      expect(results[0].index).toBe(0);
    });

    it('should be case insensitive', () => {
      const filePath = path.join(tempDir, 'conversations.json');
      fs.writeFileSync(filePath, JSON.stringify([sampleConversation]));

      const results = searchConversations(filePath, 'HELLO');
      expect(results).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty message parts', () => {
      const conversation = {
        ...sampleConversation,
        mapping: {
          'root-id': {
            id: 'root-id',
            message: null,
            parent: null,
            children: ['msg-1'],
          },
          'msg-1': {
            id: 'msg-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' as const },
              content: { content_type: 'text', parts: [] },
            },
            parent: 'root-id',
            children: [],
          },
        },
      };

      const parsed = parseConversation(conversation);
      expect(parsed.messages).toHaveLength(0); // Empty content should be skipped
    });

    it('should skip system messages', () => {
      const conversation = {
        ...sampleConversation,
        mapping: {
          'root-id': {
            id: 'root-id',
            message: null,
            parent: null,
            children: ['msg-1'],
          },
          'msg-1': {
            id: 'msg-1',
            message: {
              id: 'msg-1',
              author: { role: 'system' as const },
              content: { content_type: 'text', parts: ['System message'] },
            },
            parent: 'root-id',
            children: ['msg-2'],
          },
          'msg-2': {
            id: 'msg-2',
            message: {
              id: 'msg-2',
              author: { role: 'user' as const },
              content: { content_type: 'text', parts: ['User message'] },
            },
            parent: 'msg-1',
            children: [],
          },
        },
      };

      const parsed = parseConversation(conversation);
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0].role).toBe('user');
    });
  });
});
