// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock fs module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import {
  saveSession,
  loadSession,
  deleteSession,
  listSessions,
  findSessions,
  generateSessionName,
  formatSessionInfo,
  getSessionsDir,
  repairSession,
  type SessionInfo,
} from '../src/session.js';
import type { Message } from '../src/types.js';

const mockFs = vi.mocked(fs);

describe('Session Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSessionName', () => {
    it('generates a name with date and time', () => {
      const name = generateSessionName();
      expect(name).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    });

    it('generates names starting with session prefix', () => {
      const name1 = generateSessionName();
      const name2 = generateSessionName();
      expect(name1).toMatch(/^session-/);
      expect(name2).toMatch(/^session-/);
    });
  });

  describe('getSessionsDir', () => {
    it('returns the sessions directory path', () => {
      const dir = getSessionsDir();
      expect(dir).toContain('.codi');
      expect(dir).toContain('sessions');
      expect(dir).toBe(path.join(os.homedir(), '.codi', 'sessions'));
    });
  });

  describe('saveSession', () => {
    it('creates sessions directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      saveSession('test-session', messages, null);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('sessions'),
        { recursive: true }
      );
    });

    it('saves a new session and returns isNew: true', () => {
      mockFs.existsSync.mockReturnValueOnce(true) // sessions dir exists
        .mockReturnValueOnce(false); // session file doesn't exist

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const result = saveSession('new-session', messages, null);

      expect(result.isNew).toBe(true);
      expect(result.path).toContain('new-session.json');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('updates existing session and preserves createdAt', () => {
      const existingCreatedAt = '2024-01-01T00:00:00.000Z';
      mockFs.existsSync.mockReturnValueOnce(true) // sessions dir exists
        .mockReturnValueOnce(true); // session file exists
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        name: 'existing',
        createdAt: existingCreatedAt,
        updatedAt: existingCreatedAt,
        projectPath: '/old/path',
        messages: [],
        conversationSummary: null,
      }));

      const messages: Message[] = [{ role: 'user', content: 'Updated' }];
      const result = saveSession('existing', messages, null);

      expect(result.isNew).toBe(false);
      const writtenData = JSON.parse(
        (mockFs.writeFileSync as any).mock.calls[0][1]
      );
      expect(writtenData.createdAt).toBe(existingCreatedAt);
    });

    it('saves session with all options', () => {
      mockFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];
      saveSession('full-session', messages, 'Summary text', {
        projectPath: '/my/project',
        projectName: 'my-project',
        provider: 'Anthropic',
        model: 'claude-3',
      });

      const writtenData = JSON.parse(
        (mockFs.writeFileSync as any).mock.calls[0][1]
      );
      expect(writtenData.name).toBe('full-session');
      expect(writtenData.projectPath).toBe('/my/project');
      expect(writtenData.projectName).toBe('my-project');
      expect(writtenData.provider).toBe('Anthropic');
      expect(writtenData.model).toBe('claude-3');
      expect(writtenData.conversationSummary).toBe('Summary text');
      expect(writtenData.messages).toHaveLength(1);
    });

    it('persists openFilesState when provided', () => {
      mockFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];
      const openFilesState = {
        version: 1,
        openFiles: [
          {
            path: 'src/index.ts',
            isActive: true,
            openedAt: '2026-01-14T00:00:00.000Z',
          },
        ],
      };

      saveSession('with-open-files', messages, null, {
        openFilesState: openFilesState as any,
      });

      const writtenData = JSON.parse(
        (mockFs.writeFileSync as any).mock.calls[0][1]
      );
      expect(writtenData.openFilesState).toEqual(openFilesState);
    });

    it('sanitizes session name for filesystem', () => {
      mockFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const messages: Message[] = [];
      const result = saveSession('my/session:name', messages, null);

      expect(result.path).toContain('my_session_name.json');
    });

    it('uses current directory as default projectPath', () => {
      mockFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);

      saveSession('test', [], null);

      const writtenData = JSON.parse(
        (mockFs.writeFileSync as any).mock.calls[0][1]
      );
      expect(writtenData.projectPath).toBe(process.cwd());
    });

    it('handles error when reading existing session', () => {
      mockFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      // Should not throw - uses current time instead
      const result = saveSession('error-session', [], null);
      expect(result.isNew).toBe(false);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('loadSession', () => {
    it('returns null when session does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadSession('nonexistent');

      expect(result).toBeNull();
    });

    it('loads and parses existing session', () => {
      const sessionData = {
        name: 'my-session',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T11:00:00.000Z',
        projectPath: '/test',
        messages: [{ role: 'user', content: 'Hello' }],
        conversationSummary: 'A test conversation',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

      const result = loadSession('my-session');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-session');
      expect(result?.messages).toHaveLength(1);
      expect(result?.conversationSummary).toBe('A test conversation');
    });

    it('returns null on parse error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json {{{');

      const result = loadSession('bad-session');

      expect(result).toBeNull();
    });

    it('returns null when readFileSync throws', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = loadSession('error-session');

      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('returns false when session does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = deleteSession('nonexistent');

      expect(result).toBe(false);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('deletes existing session and returns true', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = deleteSession('to-delete');

      expect(result).toBe(true);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('to-delete.json')
      );
    });

    it('returns false when unlinkSync throws', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = deleteSession('error-session');

      expect(result).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('creates sessions directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readdirSync.mockReturnValue([]);

      listSessions();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('sessions'),
        { recursive: true }
      );
    });

    it('returns empty array when no sessions', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);

      const result = listSessions();

      expect(result).toEqual([]);
    });

    it('lists sessions sorted by updatedAt descending', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'old.json' as any,
        'new.json' as any,
        'middle.json' as any,
      ]);

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify({
          name: 'old',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          projectPath: '/test',
          messages: [{ role: 'user', content: 'a' }],
          conversationSummary: null,
        }))
        .mockReturnValueOnce(JSON.stringify({
          name: 'new',
          createdAt: '2024-01-03T00:00:00.000Z',
          updatedAt: '2024-01-03T00:00:00.000Z',
          projectPath: '/test',
          messages: [{ role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }],
          conversationSummary: 'Summary',
        }))
        .mockReturnValueOnce(JSON.stringify({
          name: 'middle',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          projectPath: '/test',
          messages: [],
          conversationSummary: null,
        }));

      const result = listSessions();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('new');
      expect(result[1].name).toBe('middle');
      expect(result[2].name).toBe('old');
    });

    it('skips non-json files', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'session.json' as any,
        'readme.txt' as any,
        '.gitignore' as any,
      ]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        name: 'session',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        projectPath: '/test',
        messages: [],
        conversationSummary: null,
      }));

      const result = listSessions();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('session');
    });

    it('includes correct metadata', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['test.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        name: 'test',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        projectPath: '/my/project',
        projectName: 'my-project',
        provider: 'Anthropic',
        model: 'claude-3',
        messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
        conversationSummary: 'Test summary',
      }));

      const result = listSessions();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'test',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        projectPath: '/my/project',
        projectName: 'my-project',
        provider: 'Anthropic',
        model: 'claude-3',
        messageCount: 2,
        hasSummary: true,
      });
    });

    it('skips invalid session files', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'valid.json' as any,
        'invalid.json' as any,
      ]);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify({
          name: 'valid',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          projectPath: '/test',
          messages: [],
          conversationSummary: null,
        }))
        .mockReturnValueOnce('not valid json');

      const result = listSessions();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid');
    });

    it('returns empty array when readdirSync throws', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = listSessions();

      expect(result).toEqual([]);
    });
  });

  describe('findSessions', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'feature-auth.json' as any,
        'feature-api.json' as any,
        'bugfix-login.json' as any,
      ]);

      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify({
          name: 'feature-auth',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          projectPath: '/test/codi',
          projectName: 'codi',
          messages: [],
          conversationSummary: null,
        }))
        .mockReturnValueOnce(JSON.stringify({
          name: 'feature-api',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          projectPath: '/test/other',
          projectName: 'other',
          messages: [],
          conversationSummary: null,
        }))
        .mockReturnValueOnce(JSON.stringify({
          name: 'bugfix-login',
          createdAt: '2024-01-03T00:00:00.000Z',
          updatedAt: '2024-01-03T00:00:00.000Z',
          projectPath: '/test/codi',
          projectName: 'codi',
          messages: [],
          conversationSummary: null,
        }));
    });

    it('finds sessions by name pattern', () => {
      const result = findSessions('feature');

      expect(result).toHaveLength(2);
      expect(result.map(s => s.name)).toContain('feature-auth');
      expect(result.map(s => s.name)).toContain('feature-api');
    });

    it('finds sessions by project name', () => {
      const result = findSessions('codi');

      expect(result).toHaveLength(2);
      expect(result.map(s => s.name)).toContain('feature-auth');
      expect(result.map(s => s.name)).toContain('bugfix-login');
    });

    it('finds sessions by project path', () => {
      const result = findSessions('other');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('feature-api');
    });

    it('is case-insensitive', () => {
      const result = findSessions('FEATURE');

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no matches', () => {
      const result = findSessions('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('formatSessionInfo', () => {
    it('formats session info with all fields', () => {
      const info: SessionInfo = {
        name: 'test-session',
        createdAt: '2024-01-15T10:30:00.000Z',
        updatedAt: '2024-01-15T11:00:00.000Z',
        projectPath: '/test/path',
        projectName: 'my-project',
        provider: 'Anthropic',
        model: 'claude-3',
        messageCount: 10,
        hasSummary: true,
      };

      const formatted = formatSessionInfo(info);

      expect(formatted).toContain('test-session');
      expect(formatted).toContain('10 msgs');
      expect(formatted).toContain('has summary');
      expect(formatted).toContain('my-project');
    });

    it('excludes summary note when no summary', () => {
      const info: SessionInfo = {
        name: 'test-session',
        createdAt: '2024-01-15T10:30:00.000Z',
        updatedAt: '2024-01-15T11:00:00.000Z',
        projectPath: '/test/path',
        messageCount: 5,
        hasSummary: false,
      };

      const formatted = formatSessionInfo(info);

      expect(formatted).toContain('5 msgs');
      expect(formatted).not.toContain('has summary');
    });

    it('excludes project name when not provided', () => {
      const info: SessionInfo = {
        name: 'test-session',
        createdAt: '2024-01-15T10:30:00.000Z',
        updatedAt: '2024-01-15T11:00:00.000Z',
        projectPath: '/test/path',
        messageCount: 3,
        hasSummary: false,
      };

      const formatted = formatSessionInfo(info);

      expect(formatted).not.toContain('[');
      expect(formatted).not.toContain(']');
    });

    it('includes date and time', () => {
      const info: SessionInfo = {
        name: 'test',
        createdAt: '2024-01-15T10:30:00.000Z',
        updatedAt: '2024-06-20T14:45:00.000Z',
        projectPath: '/test',
        messageCount: 1,
        hasSummary: false,
      };

      const formatted = formatSessionInfo(info);

      // Should contain date parts (format varies by locale)
      expect(formatted).toContain(' - ');
    });
  });

  describe('repairSession', () => {
    it('returns unchanged messages when no repair needed', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const { messages: result, repaired } = repairSession(messages);

      expect(repaired).toBe(false);
      expect(result).toEqual(messages);
    });

    it('returns empty array unchanged', () => {
      const { messages: result, repaired } = repairSession([]);

      expect(repaired).toBe(false);
      expect(result).toEqual([]);
    });

    it('repairs session ending with unmatched tool_use', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Write a file' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will write a file.' },
            {
              type: 'tool_use',
              id: 'tool_123',
              name: 'write_file',
              input: { path: 'test.txt' },
            },
          ],
        },
      ];

      const { messages: result, repaired } = repairSession(messages);

      expect(repaired).toBe(true);
      expect(result).toHaveLength(3);
      expect(result[2].role).toBe('user');
      expect(Array.isArray(result[2].content)).toBe(true);
      const content = result[2].content as any[];
      expect(content[0].type).toBe('tool_result');
      expect(content[0].tool_use_id).toBe('tool_123');
      expect(content[0].is_error).toBe(true);
      expect(content[0].content).toContain('write_file');
    });

    it('repairs session with multiple unmatched tool_use blocks', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Do multiple things' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'read_file',
              input: { path: 'a.txt' },
            },
            {
              type: 'tool_use',
              id: 'tool_2',
              name: 'write_file',
              input: { path: 'b.txt' },
            },
          ],
        },
      ];

      const { messages: result, repaired } = repairSession(messages);

      expect(repaired).toBe(true);
      expect(result).toHaveLength(3);
      const content = result[2].content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].tool_use_id).toBe('tool_1');
      expect(content[1].tool_use_id).toBe('tool_2');
    });

    it('does not repair when tool_results exist', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read a file' },
        {
          role: 'assistant',
          content: [
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
              content: 'File contents here',
            },
          ],
        },
        { role: 'assistant', content: 'The file contains...' },
      ];

      const { messages: result, repaired } = repairSession(messages);

      expect(repaired).toBe(false);
      expect(result).toEqual(messages);
    });

    it('handles assistant message with only text content', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Just text, no tools' }],
        },
      ];

      const { messages: result, repaired } = repairSession(messages);

      expect(repaired).toBe(false);
      expect(result).toEqual(messages);
    });

    it('repairs when user text follows tool_use without tool_result', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Write a file' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will write a file.' },
            {
              type: 'tool_use',
              id: 'tool_123',
              name: 'write_file',
              input: { path: 'test.txt' },
            },
          ],
        },
        { role: 'user', content: 'continue' },
      ];

      const { messages: result, repaired } = repairSession(messages);

      expect(repaired).toBe(true);
      expect(result).toHaveLength(3);
      // The user message should now have tool_result + text
      expect(Array.isArray(result[2].content)).toBe(true);
      const content = result[2].content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe('tool_result');
      expect(content[0].tool_use_id).toBe('tool_123');
      expect(content[0].is_error).toBe(true);
      expect(content[1].type).toBe('text');
      expect(content[1].text).toBe('continue');
    });
  });
});
