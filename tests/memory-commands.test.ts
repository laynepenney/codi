// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  rememberCommand,
  forgetCommand,
  memoriesCommand,
  profileCommand,
  registerMemoryCommands,
} from '../src/commands/memory-commands.js';
import type { CommandContext } from '../src/commands/index.js';

// Mock the memory module
vi.mock('../src/memory.js', () => ({
  loadProfile: vi.fn().mockResolvedValue({
    name: 'TestUser',
    preferences: { language: 'TypeScript', style: 'functional' },
    expertise: ['React', 'Node.js'],
    avoid: ['jQuery'],
  }),
  updateProfile: vi.fn().mockResolvedValue({
    name: 'UpdatedUser',
    preferences: { language: 'TypeScript' },
  }),
  loadMemories: vi.fn().mockResolvedValue([
    { content: 'Prefers dark mode', category: 'preferences', timestamp: '2024-01-15T10:00:00.000Z', source: 'user' },
    { content: 'Uses pnpm', category: 'project', timestamp: '2024-01-15T11:00:00.000Z', source: 'user' },
    { content: 'No category memory', timestamp: '2024-01-15T12:00:00.000Z', source: 'user' },
  ]),
  addMemory: vi.fn().mockResolvedValue({
    content: 'New memory content',
    category: 'test',
    timestamp: '2024-01-15T13:00:00.000Z',
    source: 'user',
  }),
  removeMemories: vi.fn().mockResolvedValue(2),
  searchMemories: vi.fn().mockResolvedValue([
    { content: 'Uses pnpm', category: 'project', timestamp: '2024-01-15T11:00:00.000Z', source: 'user' },
  ]),
  clearMemories: vi.fn().mockResolvedValue(3),
  getMemoryPaths: vi.fn().mockReturnValue({
    profile: '/home/user/.codi/profile.yaml',
    memories: '/home/user/.codi/memories.md',
    sessionNotes: '/home/user/.codi/session-notes.md',
  }),
  consolidateSessionNotes: vi.fn().mockResolvedValue(5),
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
  loadProfile,
  updateProfile,
  loadMemories,
  addMemory,
  removeMemories,
  searchMemories,
  clearMemories,
  consolidateSessionNotes,
} from '../src/memory.js';
import { registerCommand } from '../src/commands/index.js';

const mockLoadProfile = vi.mocked(loadProfile);
const mockUpdateProfile = vi.mocked(updateProfile);
const mockLoadMemories = vi.mocked(loadMemories);
const mockAddMemory = vi.mocked(addMemory);
const mockRemoveMemories = vi.mocked(removeMemories);
const mockSearchMemories = vi.mocked(searchMemories);
const mockClearMemories = vi.mocked(clearMemories);
const mockConsolidateSessionNotes = vi.mocked(consolidateSessionNotes);

const createContext = (): CommandContext => ({
  workingDirectory: '/test/project',
});

describe('Memory Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rememberCommand', () => {
    it('has correct name and aliases', () => {
      expect(rememberCommand.name).toBe('remember');
      expect(rememberCommand.aliases).toContain('mem');
      expect(rememberCommand.aliases).toContain('note');
    });

    it('has taskType set to fast', () => {
      expect(rememberCommand.taskType).toBe('fast');
    });

    it('returns error when no input provided', async () => {
      const result = await rememberCommand.execute('', createContext());
      expect(result).toContain('__MEMORY_ERROR__');
      expect(result).toContain('Usage');
    });

    it('adds memory without category', async () => {
      const result = await rememberCommand.execute('Prefers TypeScript', createContext());

      expect(mockAddMemory).toHaveBeenCalledWith('Prefers TypeScript', undefined, 'user');
      expect(result).toContain('__MEMORY_ADDED__');
      expect(result).toContain('New memory content');
    });

    it('adds memory with category prefix', async () => {
      mockAddMemory.mockResolvedValueOnce({
        content: 'Uses pnpm',
        category: 'project',
        timestamp: '2024-01-15T13:00:00.000Z',
        source: 'user',
      });

      const result = await rememberCommand.execute('project: Uses pnpm', createContext());

      expect(mockAddMemory).toHaveBeenCalledWith('Uses pnpm', 'project', 'user');
      expect(result).toContain('__MEMORY_ADDED__');
      expect(result).toContain('project');
    });
  });

  describe('forgetCommand', () => {
    it('has correct name and aliases', () => {
      expect(forgetCommand.name).toBe('forget');
      expect(forgetCommand.aliases).toContain('unmem');
    });

    it('returns error when no pattern provided', async () => {
      const result = await forgetCommand.execute('', createContext());
      expect(result).toContain('__MEMORY_ERROR__');
      expect(result).toContain('Usage');
    });

    it('clears all memories when pattern is "all"', async () => {
      const result = await forgetCommand.execute('all', createContext());

      expect(mockClearMemories).toHaveBeenCalled();
      expect(result).toContain('__MEMORY_CLEARED__');
      expect(result).toContain('3');
    });

    it('removes memories matching pattern', async () => {
      const result = await forgetCommand.execute('TypeScript', createContext());

      expect(mockRemoveMemories).toHaveBeenCalledWith('TypeScript');
      expect(result).toContain('__MEMORY_REMOVED__');
      expect(result).toContain('2');
    });

    it('handles no matches found', async () => {
      mockRemoveMemories.mockResolvedValueOnce(0);
      const result = await forgetCommand.execute('NonexistentPattern', createContext());

      expect(result).toContain('__MEMORY_NOTFOUND__');
      expect(result).toContain('NonexistentPattern');
    });
  });

  describe('memoriesCommand', () => {
    it('has correct name and aliases', () => {
      expect(memoriesCommand.name).toBe('memories');
      expect(memoriesCommand.aliases).toContain('mems');
    });

    it('lists all memories when no query provided', async () => {
      const result = await memoriesCommand.execute('', createContext());

      expect(mockLoadMemories).toHaveBeenCalled();
      expect(result).toContain('__MEMORIES_LIST__');

      const parts = result!.split('|');
      const memories = JSON.parse(parts[1]);
      expect(memories).toHaveLength(3);
    });

    it('searches memories when query provided', async () => {
      const result = await memoriesCommand.execute('pnpm', createContext());

      expect(mockSearchMemories).toHaveBeenCalledWith('pnpm');
      expect(result).toContain('__MEMORIES_LIST__');

      const parts = result!.split('|');
      const memories = JSON.parse(parts[1]);
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toContain('pnpm');
    });

    it('consolidates session notes', async () => {
      const result = await memoriesCommand.execute('consolidate', createContext());

      expect(mockConsolidateSessionNotes).toHaveBeenCalled();
      expect(result).toContain('__MEMORY_CONSOLIDATED__');
      expect(result).toContain('5');
    });

    it('handles zero consolidations', async () => {
      mockConsolidateSessionNotes.mockResolvedValueOnce(0);
      const result = await memoriesCommand.execute('consolidate', createContext());

      expect(result).toContain('__MEMORY_CONSOLIDATED__');
      expect(result).toContain('0');
    });
  });

  describe('profileCommand', () => {
    it('has correct name and aliases', () => {
      expect(profileCommand.name).toBe('profile');
      expect(profileCommand.aliases).toContain('me');
    });

    it('shows profile when no args provided', async () => {
      const result = await profileCommand.execute('', createContext());

      expect(mockLoadProfile).toHaveBeenCalled();
      expect(result).toContain('__PROFILE_SHOW__');

      const parts = result!.split('|');
      const profile = JSON.parse(parts[1]);
      expect(profile.name).toBe('TestUser');
      expect(profile.preferences.language).toBe('TypeScript');
    });

    it('updates profile with set command', async () => {
      const result = await profileCommand.execute('set name NewUser', createContext());

      expect(mockUpdateProfile).toHaveBeenCalledWith('name', 'NewUser');
      expect(result).toContain('__PROFILE_UPDATED__');
      expect(result).toContain('name');
      expect(result).toContain('NewUser');
    });

    it('handles multi-word values', async () => {
      const result = await profileCommand.execute('set expertise React and TypeScript', createContext());

      expect(mockUpdateProfile).toHaveBeenCalledWith('expertise', 'React and TypeScript');
    });

    it('handles nested keys like preferences.language', async () => {
      const result = await profileCommand.execute('set preferences.language Python', createContext());

      expect(mockUpdateProfile).toHaveBeenCalledWith('preferences.language', 'Python');
    });
  });

  describe('registerMemoryCommands', () => {
    it('registers all memory commands', () => {
      registerMemoryCommands();

      expect(registerCommand).toHaveBeenCalledWith(rememberCommand);
      expect(registerCommand).toHaveBeenCalledWith(forgetCommand);
      expect(registerCommand).toHaveBeenCalledWith(memoriesCommand);
      expect(registerCommand).toHaveBeenCalledWith(profileCommand);
    });
  });
});
