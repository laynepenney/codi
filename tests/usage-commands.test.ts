import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usageCommand, registerUsageCommands } from '../src/commands/usage-commands.js';
import type { CommandContext } from '../src/commands/index.js';

// Mock the usage module
vi.mock('../src/usage.js', () => ({
  getSessionUsage: vi.fn().mockReturnValue({
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.05,
    requests: 10,
    startTime: '2024-01-15T10:00:00.000Z',
  }),
  getUsageStats: vi.fn().mockReturnValue({
    totalInputTokens: 10000,
    totalOutputTokens: 5000,
    totalCost: 0.5,
    requestCount: 100,
    byProvider: {
      Anthropic: { inputTokens: 8000, outputTokens: 4000, cost: 0.4, requests: 80 },
      OpenAI: { inputTokens: 2000, outputTokens: 1000, cost: 0.1, requests: 20 },
    },
    byModel: {
      'claude-3': { inputTokens: 8000, outputTokens: 4000, cost: 0.4, requests: 80 },
      'gpt-4': { inputTokens: 2000, outputTokens: 1000, cost: 0.1, requests: 20 },
    },
  }),
  getRecentUsage: vi.fn().mockReturnValue([
    {
      timestamp: '2024-01-15T11:00:00.000Z',
      provider: 'Anthropic',
      model: 'claude-3',
      inputTokens: 500,
      outputTokens: 200,
      cost: 0.02,
    },
    {
      timestamp: '2024-01-15T10:30:00.000Z',
      provider: 'OpenAI',
      model: 'gpt-4',
      inputTokens: 300,
      outputTokens: 100,
      cost: 0.01,
    },
  ]),
  clearUsageHistory: vi.fn().mockReturnValue(50),
  resetSessionUsage: vi.fn(),
  formatCost: vi.fn().mockImplementation(cost => `$${cost.toFixed(4)}`),
  formatTokens: vi.fn().mockImplementation(tokens => tokens.toLocaleString()),
  getUsageFilePath: vi.fn().mockReturnValue('/home/user/.codi/usage.json'),
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
  getSessionUsage,
  getUsageStats,
  getRecentUsage,
  clearUsageHistory,
  resetSessionUsage,
  getUsageFilePath,
} from '../src/usage.js';
import { registerCommand } from '../src/commands/index.js';

const mockGetSessionUsage = vi.mocked(getSessionUsage);
const mockGetUsageStats = vi.mocked(getUsageStats);
const mockGetRecentUsage = vi.mocked(getRecentUsage);
const mockClearUsageHistory = vi.mocked(clearUsageHistory);
const mockResetSessionUsage = vi.mocked(resetSessionUsage);

const createContext = (): CommandContext => ({
  workingDirectory: '/test/project',
});

describe('Usage Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('usageCommand', () => {
    it('has correct name and aliases', () => {
      expect(usageCommand.name).toBe('usage');
      expect(usageCommand.aliases).toContain('cost');
      expect(usageCommand.aliases).toContain('tokens');
    });

    describe('session usage (default)', () => {
      it('shows session usage when no args provided', async () => {
        const result = await usageCommand.execute('', createContext());

        expect(result).toContain('__USAGE_SESSION__');
        expect(result).toContain('1000'); // input tokens
        expect(result).toContain('500');  // output tokens
        expect(result).toContain('0.05'); // cost
        expect(mockGetSessionUsage).toHaveBeenCalled();
      });

      it('shows session usage with "session" arg', async () => {
        const result = await usageCommand.execute('session', createContext());

        expect(result).toContain('__USAGE_SESSION__');
        expect(mockGetSessionUsage).toHaveBeenCalled();
      });

      it('shows session usage for unknown subcommand', async () => {
        const result = await usageCommand.execute('unknown-command', createContext());

        expect(result).toContain('__USAGE_SESSION__');
      });
    });

    describe('reset subcommand', () => {
      it('resets session usage', async () => {
        const result = await usageCommand.execute('reset', createContext());

        expect(result).toBe('__USAGE_RESET__');
        expect(mockResetSessionUsage).toHaveBeenCalled();
      });

      it('is case-insensitive', async () => {
        const result = await usageCommand.execute('RESET', createContext());

        expect(result).toBe('__USAGE_RESET__');
      });
    });

    describe('clear subcommand', () => {
      it('clears usage history and returns count', async () => {
        const result = await usageCommand.execute('clear', createContext());

        expect(result).toBe('__USAGE_CLEARED__:50');
        expect(mockClearUsageHistory).toHaveBeenCalled();
      });
    });

    describe('path/file subcommand', () => {
      it('shows usage file path with "path"', async () => {
        const result = await usageCommand.execute('path', createContext());

        expect(result).toContain('__USAGE_PATH__');
        expect(result).toContain('.codi/usage.json');
      });

      it('shows usage file path with "file"', async () => {
        const result = await usageCommand.execute('file', createContext());

        expect(result).toContain('__USAGE_PATH__');
      });
    });

    describe('today subcommand', () => {
      it('shows today\'s usage stats', async () => {
        const result = await usageCommand.execute('today', createContext());

        expect(result).toContain('__USAGE_STATS__:Today');
        expect(result).toContain('total:');
        expect(mockGetUsageStats).toHaveBeenCalledWith(1);
      });
    });

    describe('week subcommand', () => {
      it('shows last 7 days usage stats', async () => {
        const result = await usageCommand.execute('week', createContext());

        expect(result).toContain('__USAGE_STATS__:Last 7 days');
        expect(mockGetUsageStats).toHaveBeenCalledWith(7);
      });
    });

    describe('month subcommand', () => {
      it('shows last 30 days usage stats', async () => {
        const result = await usageCommand.execute('month', createContext());

        expect(result).toContain('__USAGE_STATS__:Last 30 days');
        expect(mockGetUsageStats).toHaveBeenCalledWith(30);
      });
    });

    describe('all subcommand', () => {
      it('shows all-time usage stats', async () => {
        const result = await usageCommand.execute('all', createContext());

        expect(result).toContain('__USAGE_STATS__:All time');
        expect(mockGetUsageStats).toHaveBeenCalledWith(3650); // 10 years
      });
    });

    describe('recent subcommand', () => {
      it('shows recent usage records', async () => {
        const result = await usageCommand.execute('recent', createContext());

        expect(result).toContain('__USAGE_RECENT__');
        expect(result).toContain('Anthropic');
        expect(result).toContain('claude-3');
        expect(result).toContain('OpenAI');
        expect(result).toContain('gpt-4');
        expect(mockGetRecentUsage).toHaveBeenCalledWith(10);
      });

      it('shows empty message when no recent records', async () => {
        mockGetRecentUsage.mockReturnValue([]);

        const result = await usageCommand.execute('recent', createContext());

        expect(result).toBe('__USAGE_RECENT_EMPTY__');
      });
    });

    describe('stats formatting', () => {
      it('includes provider breakdown', async () => {
        const result = await usageCommand.execute('today', createContext());

        expect(result).toContain('provider:Anthropic');
        expect(result).toContain('provider:OpenAI');
      });

      it('includes model breakdown', async () => {
        const result = await usageCommand.execute('today', createContext());

        expect(result).toContain('model:claude-3');
        expect(result).toContain('model:gpt-4');
      });

      it('includes total line', async () => {
        const result = await usageCommand.execute('week', createContext());

        expect(result).toContain('total:10000:5000:0.5:100');
      });
    });

    describe('whitespace handling', () => {
      it('trims whitespace from args', async () => {
        const result = await usageCommand.execute('  reset  ', createContext());

        expect(result).toBe('__USAGE_RESET__');
      });
    });
  });

  describe('registerUsageCommands', () => {
    it('registers the usage command', () => {
      registerUsageCommands();

      expect(registerCommand).toHaveBeenCalledTimes(1);
      expect(registerCommand).toHaveBeenCalledWith(usageCommand);
    });
  });
});
