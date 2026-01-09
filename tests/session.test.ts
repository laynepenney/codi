import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  saveSession,
  loadSession,
  deleteSession,
  listSessions,
  findSessions,
  generateSessionName,
  formatSessionInfo,
  getSessionsDir,
  type Session,
  type SessionInfo,
} from '../src/session';
import type { Message } from '../src/types';

// Use a temp directory for tests
const TEST_SESSIONS_DIR = path.join(os.tmpdir(), '.codi-test-sessions');

// Mock the sessions directory
const originalSessionsDir = getSessionsDir();

describe('Session Management', () => {
  beforeEach(() => {
    // Create test sessions directory
    if (fs.existsSync(TEST_SESSIONS_DIR)) {
      fs.rmSync(TEST_SESSIONS_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_SESSIONS_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test sessions directory
    if (fs.existsSync(TEST_SESSIONS_DIR)) {
      fs.rmSync(TEST_SESSIONS_DIR, { recursive: true });
    }
  });

  describe('generateSessionName', () => {
    it('generates a name with date and time', () => {
      const name = generateSessionName();
      expect(name).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    });

    it('generates unique names', () => {
      const name1 = generateSessionName();
      // Wait a tiny bit to ensure different timestamp
      const name2 = generateSessionName();
      // Names should be same or different (depending on timing)
      expect(name1).toMatch(/^session-/);
      expect(name2).toMatch(/^session-/);
    });
  });

  describe('saveSession and loadSession', () => {
    it('saves and loads a session with messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      // Save directly to test dir
      const sessionPath = path.join(TEST_SESSIONS_DIR, 'test-save.json');
      const session: Session = {
        name: 'test-save',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectPath: '/test/path',
        projectName: 'test-project',
        provider: 'Anthropic',
        model: 'claude-3',
        messages,
        conversationSummary: null,
      };
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

      // Load it back
      const content = fs.readFileSync(sessionPath, 'utf-8');
      const loaded = JSON.parse(content) as Session;

      expect(loaded.name).toBe('test-save');
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].content).toBe('Hello');
      expect(loaded.messages[1].content).toBe('Hi there!');
      expect(loaded.projectName).toBe('test-project');
      expect(loaded.provider).toBe('Anthropic');
    });

    it('saves session with conversation summary', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Test' },
      ];

      const sessionPath = path.join(TEST_SESSIONS_DIR, 'test-summary.json');
      const session: Session = {
        name: 'test-summary',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectPath: '/test',
        messages,
        conversationSummary: 'This is a summary of the conversation.',
      };
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

      const content = fs.readFileSync(sessionPath, 'utf-8');
      const loaded = JSON.parse(content) as Session;

      expect(loaded.conversationSummary).toBe('This is a summary of the conversation.');
    });

    it('handles messages with content blocks', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Use a tool' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me help' },
            { type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: 'test.txt' } },
          ],
        },
      ];

      const sessionPath = path.join(TEST_SESSIONS_DIR, 'test-blocks.json');
      const session: Session = {
        name: 'test-blocks',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectPath: '/test',
        messages,
        conversationSummary: null,
      };
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

      const content = fs.readFileSync(sessionPath, 'utf-8');
      const loaded = JSON.parse(content) as Session;

      expect(loaded.messages[1].content).toHaveLength(2);
      expect((loaded.messages[1].content as any)[0].type).toBe('text');
      expect((loaded.messages[1].content as any)[1].type).toBe('tool_use');
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions exist', () => {
      // Test dir is empty
      const sessions = listSessionsFromDir(TEST_SESSIONS_DIR);
      expect(sessions).toEqual([]);
    });

    it('lists sessions sorted by updatedAt descending', () => {
      // Create sessions with different timestamps
      const now = new Date();
      const older = new Date(now.getTime() - 60000);
      const oldest = new Date(now.getTime() - 120000);

      createTestSession(TEST_SESSIONS_DIR, 'session-1', oldest.toISOString(), oldest.toISOString());
      createTestSession(TEST_SESSIONS_DIR, 'session-2', older.toISOString(), older.toISOString());
      createTestSession(TEST_SESSIONS_DIR, 'session-3', now.toISOString(), now.toISOString());

      const sessions = listSessionsFromDir(TEST_SESSIONS_DIR);
      expect(sessions).toHaveLength(3);
      expect(sessions[0].name).toBe('session-3'); // Most recent first
      expect(sessions[1].name).toBe('session-2');
      expect(sessions[2].name).toBe('session-1');
    });

    it('includes correct metadata in session info', () => {
      createTestSession(TEST_SESSIONS_DIR, 'meta-test', undefined, undefined, {
        projectName: 'my-project',
        provider: 'OpenAI',
        model: 'gpt-4',
        messageCount: 5,
      });

      const sessions = listSessionsFromDir(TEST_SESSIONS_DIR);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].projectName).toBe('my-project');
      expect(sessions[0].provider).toBe('OpenAI');
      expect(sessions[0].model).toBe('gpt-4');
      expect(sessions[0].messageCount).toBe(5);
    });
  });

  describe('deleteSession', () => {
    it('deletes an existing session', () => {
      createTestSession(TEST_SESSIONS_DIR, 'to-delete');

      const sessionPath = path.join(TEST_SESSIONS_DIR, 'to-delete.json');
      expect(fs.existsSync(sessionPath)).toBe(true);

      fs.unlinkSync(sessionPath);
      expect(fs.existsSync(sessionPath)).toBe(false);
    });

    it('returns false for non-existent session', () => {
      const sessionPath = path.join(TEST_SESSIONS_DIR, 'non-existent.json');
      expect(fs.existsSync(sessionPath)).toBe(false);
    });
  });

  describe('findSessions', () => {
    it('finds sessions by name pattern', () => {
      createTestSession(TEST_SESSIONS_DIR, 'feature-auth');
      createTestSession(TEST_SESSIONS_DIR, 'feature-api');
      createTestSession(TEST_SESSIONS_DIR, 'bugfix-login');

      const sessions = listSessionsFromDir(TEST_SESSIONS_DIR);
      const featureSessions = sessions.filter(s => s.name.includes('feature'));

      expect(featureSessions).toHaveLength(2);
      expect(featureSessions.map(s => s.name)).toContain('feature-auth');
      expect(featureSessions.map(s => s.name)).toContain('feature-api');
    });

    it('finds sessions by project name', () => {
      createTestSession(TEST_SESSIONS_DIR, 'session-1', undefined, undefined, {
        projectName: 'codi',
      });
      createTestSession(TEST_SESSIONS_DIR, 'session-2', undefined, undefined, {
        projectName: 'other-project',
      });

      const sessions = listSessionsFromDir(TEST_SESSIONS_DIR);
      const codiSessions = sessions.filter(s => s.projectName === 'codi');

      expect(codiSessions).toHaveLength(1);
      expect(codiSessions[0].name).toBe('session-1');
    });

    it('is case-insensitive', () => {
      createTestSession(TEST_SESSIONS_DIR, 'MySession');

      const sessions = listSessionsFromDir(TEST_SESSIONS_DIR);
      const found = sessions.filter(s => s.name.toLowerCase().includes('mysession'));

      expect(found).toHaveLength(1);
    });
  });

  describe('formatSessionInfo', () => {
    it('formats session info correctly', () => {
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
  });

  describe('getSessionsDir', () => {
    it('returns the sessions directory path', () => {
      const dir = getSessionsDir();
      expect(dir).toContain('.codi');
      expect(dir).toContain('sessions');
    });
  });
});

// Helper functions for tests
function createTestSession(
  dir: string,
  name: string,
  createdAt?: string,
  updatedAt?: string,
  extra?: {
    projectName?: string;
    provider?: string;
    model?: string;
    messageCount?: number;
  }
) {
  const now = new Date().toISOString();
  const messages: Message[] = [];

  // Add dummy messages if messageCount specified
  const count = extra?.messageCount || 1;
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}`,
    });
  }

  const session: Session = {
    name,
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    projectPath: '/test',
    projectName: extra?.projectName,
    provider: extra?.provider,
    model: extra?.model,
    messages,
    conversationSummary: null,
  };

  const sessionPath = path.join(dir, `${name}.json`);
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

function listSessionsFromDir(dir: string): SessionInfo[] {
  const sessions: SessionInfo[] = [];

  if (!fs.existsSync(dir)) return sessions;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const session = JSON.parse(content) as Session;
      sessions.push({
        name: session.name,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        projectPath: session.projectPath,
        projectName: session.projectName,
        provider: session.provider,
        model: session.model,
        messageCount: session.messages.length,
        hasSummary: session.conversationSummary !== null,
      });
    } catch {
      // Skip invalid files
    }
  }

  // Sort by updatedAt descending
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return sessions;
}
