// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveCommand,
  loadCommand,
} from '../src/commands/session-commands.js';
import type { CommandContext } from '../src/commands/index.js';
import { OpenFilesManager } from '../src/open-files.js';
import type { OpenFilesState } from '../src/open-files.js';

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

import {
  saveSession,
  loadSession,
} from '../src/session.js';

const mockSaveSession = vi.mocked(saveSession);
const mockLoadSession = vi.mocked(loadSession);

// Create a mock agent
const createMockAgent = () => ({
  getHistory: vi.fn().mockReturnValue([
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ]),
  getSummary: vi.fn().mockReturnValue('Test summary'),
  loadSession: vi.fn(),
});

// Create context with agent and openFilesManager
const createContext = (): CommandContext => {
  const openFilesManager = new OpenFilesManager();
  
  // Add some files to the manager to test persistence
  openFilesManager.open('src/index.ts', { pinned: true });
  openFilesManager.open('src/agent.ts');
  openFilesManager.open('README.md');
  
  return {
    projectInfo: { type: 'node', name: 'test-project', language: 'TypeScript', rootPath: '/test', mainFiles: [] },
    agent: createMockAgent() as any,
    sessionState: {
      currentName: null,
      provider: 'Anthropic',
      model: 'claude-3',
    },
    setSessionName: vi.fn(),
    openFilesManager,
  };
};

describe('Open Files Session Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveCommand with openFilesState', () => {
    it('passes openFilesState to saveSession when saving', async () => {
      const context = createContext();
      const result = await saveCommand.execute('test-session', context);

      // Get the openFilesState that was passed to saveSession
      const saveSessionCall = mockSaveSession.mock.calls[0];
      const options = saveSessionCall[3]; // Fourth parameter is options
      
      expect(options.openFilesState).toBeDefined();
      expect(options.openFilesState).not.toBeUndefined();
      
      // Verify the structure of openFilesState
      const openFilesState = options.openFilesState as OpenFilesState;
      expect(openFilesState.files).toBeDefined();
      
      // Should have at least the files we added
      expect(Object.keys(openFilesState.files)).toContain('src/index.ts');
      expect(Object.keys(openFilesState.files)).toContain('src/agent.ts');
      expect(Object.keys(openFilesState.files)).toContain('README.md');
      
      expect(result).toContain('__SESSION_SAVED__');
    });

    it('persists pinned file status', async () => {
      const context = createContext();
      await saveCommand.execute('test-session', context);

      // Get the openFilesState that was passed to saveSession
      const saveSessionCall = mockSaveSession.mock.calls[0];
      const options = saveSessionCall[3];
      const openFilesState = options.openFilesState as OpenFilesState;
      
      // Check that the pinned status is preserved
      const indexTsMeta = openFilesState.files['src/index.ts'];
      expect(indexTsMeta.pinned).toBe(true);
      
      const agentTsMeta = openFilesState.files['src/agent.ts'];
      expect(agentTsMeta.pinned).toBe(false);
    });

    it('handles empty openFilesManager gracefully', async () => {
      const context = createContext();
      
      // Clear the openFilesManager
      if (context.openFilesManager) {
        context.openFilesManager.clear();
      }
      
      await saveCommand.execute('empty-session', context);

      // Get the openFilesState that was passed to saveSession
      const saveSessionCall = mockSaveSession.mock.calls[0];
      const options = saveSessionCall[3];
      const openFilesState = options.openFilesState as OpenFilesState;
      
      // Should have empty files object
      expect(openFilesState.files).toEqual({});
    });
  });

  describe('loadCommand with openFilesState', () => {
    it('restores openFilesState when loading session', async () => {
      const mockOpenFilesState: OpenFilesState = {
        files: {
          'src/index.ts': {
            pinned: true,
            addedAt: '2024-01-01T00:00:00.000Z',
            lastViewedAt: '2024-01-01T00:00:00.000Z',
          },
          'src/agent.ts': {
            pinned: false,
            addedAt: '2024-01-01T00:00:00.000Z',
            lastViewedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      };

      mockLoadSession.mockReturnValue({
        name: 'loaded-session',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        projectPath: '/test',
        messages: [{ role: 'user', content: 'Hello' }],
        conversationSummary: 'Summary',
        openFilesState: mockOpenFilesState,
      });

      const context = createContext();
      const result = await loadCommand.execute('loaded-session', context);

      expect(result).toContain('__SESSION_LOADED__');
      expect(result).toContain('loaded-session');
      
      // Verify the context's openFilesManager was updated
      expect(context.openFilesManager).toBeDefined();
      if (context.openFilesManager) {
        // Check that files were restored
        expect(context.openFilesManager.has('src/index.ts')).toBe(true);
        expect(context.openFilesManager.has('src/agent.ts')).toBe(true);
        
        // Check pinned status
        const fileList = context.openFilesManager.list();
        const indexTsEntry = fileList.find(entry => entry.path === 'src/index.ts');
        expect(indexTsEntry?.meta.pinned).toBe(true);
      }
    });

    it('handles sessions without openFilesState gracefully', async () => {
      mockLoadSession.mockReturnValue({
        name: 'legacy-session',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        projectPath: '/test',
        messages: [{ role: 'user', content: 'Hello' }],
        conversationSummary: 'Summary',
        // No openFilesState field - simulates legacy sessions
      });

      const context = createContext();
      const originalManager = context.openFilesManager;
      
      const result = await loadCommand.execute('legacy-session', context);

      expect(result).toContain('__SESSION_LOADED__');
      // Manager should still exist and be the same instance
      expect(context.openFilesManager).toBe(originalManager);
    });
  });
});