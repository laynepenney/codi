// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compactCommand, registerCompactCommands } from '../src/commands/compact-commands.js';
import type { CommandContext } from '../src/commands/index.js';
import type { Agent } from '../src/agent.js';

// Mock the compression module
vi.mock('../src/compression.js', () => ({
  compressContext: vi.fn().mockReturnValue({
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    entities: new Map([['__E1__', 'TypeScript']]),
    originalSize: 100,
    compressedSize: 80,
  }),
  generateEntityLegend: vi.fn().mockReturnValue('__E1__ = TypeScript'),
  getCompressionStats: vi.fn().mockReturnValue({
    originalChars: 100,
    compressedChars: 80,
    entitiesFound: 1,
    savingsPercent: 20,
  }),
}));

// Mock the commands/index module
vi.mock('../src/commands/index.js', async () => {
  const actual = await vi.importActual<typeof import('../src/commands/index.js')>('../src/commands/index.js');
  return {
    ...actual,
    registerCommand: vi.fn(),
  };
});

import { registerCommand } from '../src/commands/index.js';

// Create a mock agent
function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    getContextInfo: vi.fn().mockReturnValue({
      tokens: 5000,
      messages: 10,
      hasSummary: false,
      compressionEnabled: false,
      compression: null,
    }),
    forceCompact: vi.fn().mockResolvedValue({
      before: 5000,
      after: 3000,
      summary: 'User discussed React hooks and TypeScript types.',
    }),
    setCompression: vi.fn(),
    isCompressionEnabled: vi.fn().mockReturnValue(false),
    getMessages: vi.fn().mockReturnValue([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ]),
    ...overrides,
  } as unknown as Agent;
}

const createContext = (agent?: Agent): CommandContext => ({
  workingDirectory: '/test/project',
  agent,
});

describe('Compact Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('compactCommand', () => {
    it('has correct name and aliases', () => {
      expect(compactCommand.name).toBe('compact');
      expect(compactCommand.aliases).toContain('summarize');
      expect(compactCommand.aliases).toContain('compress');
      expect(compactCommand.aliases).toContain('compression');
    });

    it('has taskType set to fast', () => {
      expect(compactCommand.taskType).toBe('fast');
    });

    it('returns error when no agent is available', async () => {
      const result = await compactCommand.execute('', createContext());
      expect(result).toBe('COMPACT_ERROR:No agent available');
    });

    describe('status subcommand', () => {
      it('shows status by default (no args)', async () => {
        const agent = createMockAgent();
        const result = await compactCommand.execute('', createContext(agent));

        expect(result).toContain('COMPACT_STATUS:');
        expect(agent.getContextInfo).toHaveBeenCalled();

        const parsed = JSON.parse(result!.replace('COMPACT_STATUS:', ''));
        expect(parsed).toHaveProperty('tokens', 5000);
        expect(parsed).toHaveProperty('messages', 10);
        expect(parsed).toHaveProperty('hasSummary', false);
        expect(parsed).toHaveProperty('compression');
      });

      it('shows status with explicit status arg', async () => {
        const agent = createMockAgent();
        const result = await compactCommand.execute('status', createContext(agent));

        expect(result).toContain('COMPACT_STATUS:');
      });
    });

    describe('summarize subcommand', () => {
      it('skips when not enough messages', async () => {
        const agent = createMockAgent({
          getContextInfo: vi.fn().mockReturnValue({
            tokens: 1000,
            messages: 4,
            hasSummary: false,
            compressionEnabled: false,
            compression: null,
          }),
        });

        const result = await compactCommand.execute('summarize', createContext(agent));

        expect(result).toContain('COMPACT_SKIP:');
        const parsed = JSON.parse(result!.replace('COMPACT_SKIP:', ''));
        expect(parsed.reason).toContain('Not enough messages');
      });

      it('performs summarization when enough messages', async () => {
        const agent = createMockAgent({
          getContextInfo: vi.fn().mockReturnValue({
            tokens: 5000,
            messages: 10,
            hasSummary: false,
            compressionEnabled: false,
            compression: null,
          }),
        });

        const result = await compactCommand.execute('summarize', createContext(agent));

        expect(result).toContain('COMPACT_SUCCESS:');
        expect(agent.forceCompact).toHaveBeenCalled();

        const parsed = JSON.parse(result!.replace('COMPACT_SUCCESS:', ''));
        expect(parsed).toHaveProperty('before');
        expect(parsed).toHaveProperty('after');
        expect(parsed).toHaveProperty('tokensSaved', 2000);
        expect(parsed.summary).toContain('React hooks');
      });

      it('forces summarization with --force flag', async () => {
        const agent = createMockAgent({
          getContextInfo: vi.fn().mockReturnValue({
            tokens: 1000,
            messages: 4,
            hasSummary: false,
            compressionEnabled: false,
            compression: null,
          }),
        });

        const result = await compactCommand.execute('summarize --force', createContext(agent));

        expect(result).toContain('COMPACT_SUCCESS:');
        expect(agent.forceCompact).toHaveBeenCalled();
      });

      it('handles summarization errors', async () => {
        const agent = createMockAgent({
          forceCompact: vi.fn().mockRejectedValue(new Error('Summarization failed')),
        });

        const result = await compactCommand.execute('summarize', createContext(agent));

        expect(result).toContain('COMPACT_ERROR:');
        expect(result).toContain('Summarization failed');
      });
    });

    describe('compress subcommand', () => {
      it('enables compression with "on"', async () => {
        const agent = createMockAgent();
        const result = await compactCommand.execute('compress on', createContext(agent));

        expect(result).toBe('COMPRESS_TOGGLE:on');
        expect(agent.setCompression).toHaveBeenCalledWith(true);
      });

      it('disables compression with "off"', async () => {
        const agent = createMockAgent();
        const result = await compactCommand.execute('compress off', createContext(agent));

        expect(result).toBe('COMPRESS_TOGGLE:off');
        expect(agent.setCompression).toHaveBeenCalledWith(false);
      });

      it('shows compression status when no messages', async () => {
        const agent = createMockAgent({
          getMessages: vi.fn().mockReturnValue([]),
          getContextInfo: vi.fn().mockReturnValue({
            compressionEnabled: false,
            compression: null,
          }),
        });

        const result = await compactCommand.execute('compress', createContext(agent));

        expect(result).toContain('COMPRESS_STATUS:');
      });

      it('shows compression stats when messages exist', async () => {
        const agent = createMockAgent();
        const result = await compactCommand.execute('compress', createContext(agent));

        expect(result).toContain('COMPRESS_STATS:');
        const parsed = JSON.parse(result!.replace('COMPRESS_STATS:', ''));
        expect(parsed).toHaveProperty('stats');
        expect(parsed).toHaveProperty('enabled', false);
      });

      it('includes preview when --preview flag is used', async () => {
        const agent = createMockAgent();
        const result = await compactCommand.execute('compress --preview', createContext(agent));

        expect(result).toContain('COMPRESS_STATS:');
        const parsed = JSON.parse(result!.replace('COMPRESS_STATS:', ''));
        expect(parsed).toHaveProperty('preview');
        expect(parsed.preview).toHaveProperty('legend');
      });
    });

    it('returns error for unknown subcommand', async () => {
      const agent = createMockAgent();
      const result = await compactCommand.execute('invalid', createContext(agent));

      expect(result).toContain('COMPACT_ERROR:');
      expect(result).toContain('Unknown subcommand');
    });
  });

  describe('registerCompactCommands', () => {
    it('registers the compact command', () => {
      registerCompactCommands();
      expect(registerCommand).toHaveBeenCalledWith(compactCommand);
    });
  });
});
