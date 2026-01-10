import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveCommand,
  loadCommand,
  sessionsCommand,
  setSessionAgent,
  getCurrentSessionName,
  setCurrentSessionName,
  registerSessionCommands,
} from '../src/commands/session-commands.js';
import type { CommandContext } from '../src/commands/index.js';

// Mock the session module
vi.mock('../src/session.js', () => ({
  saveSession: vi.fn().mockReturnValue({ path: '/test/session.json', isNew: true }),
  loadSession: vi.fn(),
  listSessions: vi.fn().mockReturnValue([]),
  deleteSession: vi.fn().mockReturnValue(true),
  findSessions: vi.fn().mockReturnValue([]),
  generateSessionName: vi.fn().mockReturnValue('session-2024-01-15-10-30-00'),
  formatSessionInfo: vi.fn().mockImplementation(info => `${info.name} (${info.messageCount} msgs)`),
  getSessionsDir: vi.fn().mockReturnValue('/home/user/.codi/sessions'),
}));

// Mock the commands/index module
vi.mock('../src/commands/index.js', async () => {
  const actual = await vi.importActual<typeof import('../src/commands/index.js')>('../src/commands/index.js');
  return {
    ...actual,
    registerCommand: vi.fn(),
  };
});

import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  findSessions,
  generateSessionName,
  getSessionsDir,
} from '../src/session.js';
import { registerCommand } from '../src/commands/index.js';

const mockSaveSession = vi.mocked(saveSession);
const mockLoadSession = vi.mocked(loadSession);
const mockListSessions = vi.mocked(listSessions);
const mockDeleteSession = vi.mocked(deleteSession);
const mockFindSessions = vi.mocked(findSessions);

// Create a mock agent
const createMockAgent = () => ({
  getHistory: vi.fn().mockReturnValue([
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ]),
  getSummary: vi.fn().mockReturnValue('Test summary'),
  loadSession: vi.fn(),
});

const createContext = (): CommandContext => ({
  workingDirectory: '/test/project',
  projectInfo: { type: 'node', name: 'test-project', language: 'TypeScript', rootPath: '/test', mainFiles: [] },
});

describe('Session Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentSessionName(null);
  });

  describe('setSessionAgent and getCurrentSessionName', () => {
    it('sets and gets session name', () => {
      setCurrentSessionName('my-session');
      expect(getCurrentSessionName()).toBe('my-session');
    });

    it('returns null when no session name set', () => {
      setCurrentSessionName(null);
      expect(getCurrentSessionName()).toBeNull();
    });
  });

  describe('saveCommand', () => {
    it('returns null when no agent is set', async () => {
      // Create fresh command without setting agent
      const result = await saveCommand.execute('', createContext());
      // Note: Agent ref would be null before setSessionAgent is called
    });

    it('saves session with provided name', async () => {
      const mockAgent = createMockAgent();
      setSessionAgent(mockAgent as any, 'Anthropic', 'claude-3', 'test-project');

      const result = await saveCommand.execute('my-session', createContext());

      expect(mockSaveSession).toHaveBeenCalledWith(
        'my-session',
        expect.any(Array),
        'Test summary',
        expect.objectContaining({
          provider: 'Anthropic',
          model: 'claude-3',
        })
      );
      expect(result).toContain('__SESSION_SAVED__');
      expect(result).toContain('my-session');
    });

    it('generates session name when not provided', async () => {
      const mockAgent = createMockAgent();
      setSessionAgent(mockAgent as any, 'OpenAI', 'gpt-4');

      const result = await saveCommand.execute('', createContext());

      expect(result).toContain('session-2024-01-15-10-30-00');
    });

    it('uses current session name if available', async () => {
      const mockAgent = createMockAgent();
      setSessionAgent(mockAgent as any, 'Anthropic', 'claude-3');
      setCurrentSessionName('existing-session');

      const result = await saveCommand.execute('', createContext());

      expect(mockSaveSession).toHaveBeenCalledWith(
        'existing-session',
        expect.any(Array),
        expect.any(String),
        expect.any(Object)
      );
    });

    it('returns null when no messages to save', async () => {
      const mockAgent = createMockAgent();
      mockAgent.getHistory.mockReturnValue([]);
      setSessionAgent(mockAgent as any, 'Anthropic', 'claude-3');

      const result = await saveCommand.execute('test', createContext());

      expect(result).toBeNull();
    });

    it('indicates new vs updated session', async () => {
      const mockAgent = createMockAgent();
      setSessionAgent(mockAgent as any, 'Anthropic', 'claude-3');
      mockSaveSession.mockReturnValueOnce({ path: '/test.json', isNew: true });

      const result1 = await saveCommand.execute('new-session', createContext());
      expect(result1).toContain(':new:');

      mockSaveSession.mockReturnValueOnce({ path: '/test.json', isNew: false });
      const result2 = await saveCommand.execute('existing', createContext());
      expect(result2).toContain(':updated:');
    });
  });

  describe('loadCommand', () => {
    beforeEach(() => {
      const mockAgent = createMockAgent();
      setSessionAgent(mockAgent as any, 'Anthropic', 'claude-3');
    });

    it('lists recent sessions when no name provided', async () => {
      mockListSessions.mockReturnValue([
        { name: 'session-1', createdAt: '', updatedAt: '', projectPath: '', messageCount: 5, hasSummary: false },
        { name: 'session-2', createdAt: '', updatedAt: '', projectPath: '', messageCount: 10, hasSummary: true },
      ]);

      const result = await loadCommand.execute('', createContext());

      expect(result).toContain('__SESSION_LIST__');
    });

    it('returns empty message when no sessions exist', async () => {
      mockListSessions.mockReturnValue([]);

      const result = await loadCommand.execute('', createContext());

      expect(result).toBe('__SESSION_LIST_EMPTY__');
    });

    it('loads session by exact name', async () => {
      mockLoadSession.mockReturnValue({
        name: 'my-session',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        projectPath: '/test',
        messages: [{ role: 'user', content: 'Hello' }],
        conversationSummary: 'Summary',
      });

      const result = await loadCommand.execute('my-session', createContext());

      expect(result).toContain('__SESSION_LOADED__');
      expect(result).toContain('my-session');
    });

    it('finds session by pattern when exact match fails', async () => {
      mockLoadSession.mockReturnValueOnce(null).mockReturnValueOnce({
        name: 'feature-auth',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        projectPath: '/test',
        messages: [],
        conversationSummary: null,
      });
      mockFindSessions.mockReturnValue([
        { name: 'feature-auth', createdAt: '', updatedAt: '', projectPath: '', messageCount: 5, hasSummary: false },
      ]);

      const result = await loadCommand.execute('auth', createContext());

      expect(result).toContain('__SESSION_LOADED__');
    });

    it('shows multiple matches when pattern is ambiguous', async () => {
      mockLoadSession.mockReturnValue(null);
      mockFindSessions.mockReturnValue([
        { name: 'feature-auth', createdAt: '', updatedAt: '', projectPath: '', messageCount: 5, hasSummary: false },
        { name: 'feature-api', createdAt: '', updatedAt: '', projectPath: '', messageCount: 3, hasSummary: false },
      ]);

      const result = await loadCommand.execute('feature', createContext());

      expect(result).toContain('__SESSION_MULTIPLE__');
    });

    it('returns not found when session does not exist', async () => {
      mockLoadSession.mockReturnValue(null);
      mockFindSessions.mockReturnValue([]);

      const result = await loadCommand.execute('nonexistent', createContext());

      expect(result).toContain('__SESSION_NOT_FOUND__');
    });
  });

  describe('sessionsCommand', () => {
    beforeEach(() => {
      const mockAgent = createMockAgent();
      setSessionAgent(mockAgent as any, 'Anthropic', 'claude-3');
    });

    it('lists all sessions by default', async () => {
      mockListSessions.mockReturnValue([
        { name: 'session-1', createdAt: '', updatedAt: '', projectPath: '', messageCount: 5, hasSummary: false },
      ]);

      const result = await sessionsCommand.execute('', createContext());

      expect(result).toContain('__SESSION_LIST__');
    });

    it('lists sessions with "list" subcommand', async () => {
      mockListSessions.mockReturnValue([
        { name: 'session-1', createdAt: '', updatedAt: '', projectPath: '', messageCount: 5, hasSummary: false },
      ]);

      const result = await sessionsCommand.execute('list', createContext());

      expect(result).toContain('__SESSION_LIST__');
    });

    it('filters sessions with pattern', async () => {
      mockFindSessions.mockReturnValue([
        { name: 'feature-x', createdAt: '', updatedAt: '', projectPath: '', messageCount: 2, hasSummary: false },
      ]);

      const result = await sessionsCommand.execute('list feature', createContext());

      expect(mockFindSessions).toHaveBeenCalledWith('feature');
    });

    it('deletes session with "delete" subcommand', async () => {
      mockDeleteSession.mockReturnValue(true);

      const result = await sessionsCommand.execute('delete my-session', createContext());

      expect(mockDeleteSession).toHaveBeenCalledWith('my-session');
      expect(result).toContain('__SESSION_DELETED__');
    });

    it('returns error when delete has no name', async () => {
      const result = await sessionsCommand.execute('delete', createContext());

      expect(result).toBe('__SESSION_DELETE_NO_NAME__');
    });

    it('returns not found when deleting nonexistent session', async () => {
      mockDeleteSession.mockReturnValue(false);

      const result = await sessionsCommand.execute('delete nonexistent', createContext());

      expect(result).toContain('__SESSION_NOT_FOUND__');
    });

    it('shows session info with "info" subcommand', async () => {
      mockLoadSession.mockReturnValue({
        name: 'my-session',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        projectPath: '/test',
        projectName: 'test',
        provider: 'Anthropic',
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hello' }],
        conversationSummary: 'Summary',
      });

      const result = await sessionsCommand.execute('info my-session', createContext());

      expect(result).toContain('__SESSION_INFO__');
      expect(result).toContain('my-session');
    });

    it('shows current session info when no name provided', async () => {
      setCurrentSessionName('current');
      mockLoadSession.mockReturnValue({
        name: 'current',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        projectPath: '/test',
        messages: [],
        conversationSummary: null,
      });

      const result = await sessionsCommand.execute('info', createContext());

      expect(result).toContain('__SESSION_INFO__');
    });

    it('returns no current session message when none loaded', async () => {
      setCurrentSessionName(null);

      const result = await sessionsCommand.execute('info', createContext());

      expect(result).toBe('__SESSION_NO_CURRENT__');
    });

    it('clears all sessions with "clear" subcommand', async () => {
      mockListSessions.mockReturnValue([
        { name: 'session-1', createdAt: '', updatedAt: '', projectPath: '', messageCount: 1, hasSummary: false },
        { name: 'session-2', createdAt: '', updatedAt: '', projectPath: '', messageCount: 2, hasSummary: false },
      ]);
      mockDeleteSession.mockReturnValue(true);

      const result = await sessionsCommand.execute('clear', createContext());

      expect(result).toContain('__SESSION_CLEARED__');
      expect(mockDeleteSession).toHaveBeenCalledTimes(2);
    });

    it('shows sessions directory with "dir" subcommand', async () => {
      const result = await sessionsCommand.execute('dir', createContext());

      expect(result).toContain('__SESSION_DIR__');
      expect(result).toContain('.codi/sessions');
    });

    it('treats unknown action as session name', async () => {
      mockLoadSession.mockReturnValue({
        name: 'some-session',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        projectPath: '/test',
        messages: [],
        conversationSummary: null,
      });

      const result = await sessionsCommand.execute('some-session', createContext());

      expect(result).toContain('__SESSION_INFO__');
    });

    it('returns unknown action for invalid session name', async () => {
      mockLoadSession.mockReturnValue(null);

      const result = await sessionsCommand.execute('unknown-action', createContext());

      expect(result).toContain('__SESSION_UNKNOWN_ACTION__');
    });

    it('supports "rm" alias for delete', async () => {
      mockDeleteSession.mockReturnValue(true);

      const result = await sessionsCommand.execute('rm my-session', createContext());

      expect(result).toContain('__SESSION_DELETED__');
    });

    it('supports "ls" alias for list', async () => {
      mockListSessions.mockReturnValue([]);

      const result = await sessionsCommand.execute('ls', createContext());

      expect(result).toBe('__SESSION_LIST_EMPTY__');
    });

    it('truncates list to 20 sessions with count of remaining', async () => {
      const manySessions = Array.from({ length: 25 }, (_, i) => ({
        name: `session-${i}`,
        createdAt: '',
        updatedAt: '',
        projectPath: '',
        messageCount: 1,
        hasSummary: false,
      }));
      mockListSessions.mockReturnValue(manySessions);

      const result = await sessionsCommand.execute('list', createContext());

      expect(result).toContain('and 5 more');
    });
  });

  describe('registerSessionCommands', () => {
    it('registers all session commands', () => {
      registerSessionCommands();

      expect(registerCommand).toHaveBeenCalledTimes(3);
      expect(registerCommand).toHaveBeenCalledWith(saveCommand);
      expect(registerCommand).toHaveBeenCalledWith(loadCommand);
      expect(registerCommand).toHaveBeenCalledWith(sessionsCommand);
    });
  });
});
