// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeAll } from 'vitest';
import {
  createCompleter,
  getCommandNames,
  getSubcommands,
  getStaticArgs,
  getFlags,
  completeLine,
  getCompletionMatches,
  getCommonPrefix,
} from '../src/completions';

// Register commands before tests
import { registerGitCommands } from '../src/commands/git-commands';
import { registerCodeCommands } from '../src/commands/code-commands';
import { registerSessionCommands } from '../src/commands/session-commands';
import { registerConfigCommands } from '../src/commands/config-commands';
import { registerModelCommands } from '../src/commands/model-commands';
import { registerMemoryCommands } from '../src/commands/memory-commands';
import { registerHistoryCommands } from '../src/commands/history-commands';
import { registerUsageCommands } from '../src/commands/usage-commands';
import { registerPluginCommands } from '../src/commands/plugin-commands';
import { registerPromptCommands } from '../src/commands/prompt-commands';
import { registerCompactCommands } from '../src/commands/compact-commands';
import { registerApprovalCommands } from '../src/commands/approval-commands';
import { registerSymbolCommands } from '../src/commands/symbol-commands';
import { registerRAGCommands } from '../src/commands/rag-commands';

describe('Command Completions', () => {
  beforeAll(() => {
    // Register all commands
    registerGitCommands();
    registerCodeCommands();
    registerSessionCommands();
    registerConfigCommands();
    registerModelCommands();
    registerMemoryCommands();
    registerHistoryCommands();
    registerUsageCommands();
    registerPluginCommands();
    registerPromptCommands();
    registerCompactCommands();
    registerApprovalCommands();
    registerSymbolCommands();
    registerRAGCommands();
  });

  describe('createCompleter', () => {
    describe('command name completion', () => {
      it('completes command names starting with partial input', () => {
        const completer = createCompleter();
        const [completions] = completer('/br');
        expect(completions).toContain('/branch ');
      });

      it('completes multiple matching commands', () => {
        const completer = createCompleter();
        const [completions] = completer('/co');
        expect(completions.some(c => c.startsWith('/co'))).toBe(true);
      });

      it('returns empty for non-matching prefix', () => {
        const completer = createCompleter();
        const [completions] = completer('/xyz');
        expect(completions).toHaveLength(0);
      });

      it('completes aliases', () => {
        const completer = createCompleter();
        const [completions] = completer('/ci');
        expect(completions).toContain('/ci ');
      });

      it('returns all commands for just /', () => {
        const completer = createCompleter();
        const [completions] = completer('/');
        expect(completions.length).toBeGreaterThan(10);
      });
    });

    describe('subcommand completion', () => {
      it('completes subcommands for /branch', () => {
        const completer = createCompleter();
        const [completions] = completer('/branch ');
        expect(completions).toContain('/branch list');
        expect(completions).toContain('/branch create');
        expect(completions).toContain('/branch switch');
        expect(completions).toContain('/branch delete');
        expect(completions).toContain('/branch rename');
      });

      it('completes partial subcommands', () => {
        const completer = createCompleter();
        const [completions] = completer('/branch cr');
        expect(completions).toContain('/branch create');
        expect(completions).not.toContain('/branch list');
      });

      it('completes subcommands for /stash', () => {
        const completer = createCompleter();
        const [completions] = completer('/stash ');
        expect(completions).toContain('/stash save');
        expect(completions).toContain('/stash list');
        expect(completions).toContain('/stash pop');
      });

      it('completes subcommands for /config', () => {
        const completer = createCompleter();
        const [completions] = completer('/config ');
        expect(completions).toContain('/config init');
        expect(completions).toContain('/config show');
        expect(completions).toContain('/config example');
      });

      it('completes subcommands for /usage', () => {
        const completer = createCompleter();
        const [completions] = completer('/usage ');
        expect(completions).toContain('/usage session');
        expect(completions).toContain('/usage today');
        expect(completions).toContain('/usage week');
        expect(completions).toContain('/usage month');
      });
    });

    describe('static argument completion', () => {
      it('completes provider names for /models', () => {
        const completer = createCompleter();
        const [completions] = completer('/models ');
        expect(completions).toContain('/models anthropic');
        expect(completions).toContain('/models openai');
        expect(completions).toContain('/models ollama');
      });

      it('completes partial provider names', () => {
        const completer = createCompleter();
        const [completions] = completer('/models an');
        expect(completions).toContain('/models anthropic');
        expect(completions).not.toContain('/models openai');
      });

      it('completes commit types for /commit', () => {
        const completer = createCompleter();
        const [completions] = completer('/commit ');
        expect(completions).toContain('/commit feat');
        expect(completions).toContain('/commit fix');
        expect(completions).toContain('/commit docs');
      });

      it('completes partial commit types', () => {
        const completer = createCompleter();
        const [completions] = completer('/commit fe');
        expect(completions).toContain('/commit feat');
        expect(completions).not.toContain('/commit fix');
      });
    });

    describe('flag completion', () => {
      it('completes flags for /models', () => {
        const completer = createCompleter();
        const [completions] = completer('/models --');
        expect(completions).toContain('/models --local');
      });

      it('completes help flags for /symbols', () => {
        const completer = createCompleter();
        const [completions] = completer('/symbols -');
        expect(completions).toContain('/symbols -h');
        expect(completions).toContain('/symbols --help');
      });

      it('adds -h and --help for all commands', () => {
        const completer = createCompleter();
        const [completions] = completer('/config -');
        expect(completions).toContain('/config -h');
        expect(completions).toContain('/config --help');
      });

      it('completes partial flag', () => {
        const completer = createCompleter();
        const [completions] = completer('/models --l');
        expect(completions).toContain('/models --local');
      });
    });

    describe('non-command input', () => {
      it('returns empty for non-command input', () => {
        const completer = createCompleter();
        const [completions] = completer('hello world');
        expect(completions).toHaveLength(0);
      });

      it('returns empty for empty input', () => {
        const completer = createCompleter();
        const [completions] = completer('');
        expect(completions).toHaveLength(0);
      });

      it('does not complete double-slash comments', () => {
        const completer = createCompleter();
        const [completions] = completer('// this is a comment');
        expect(completions).toHaveLength(0);
      });
    });

    describe('edge cases', () => {
      it('handles trailing spaces correctly', () => {
        const completer = createCompleter();
        const [completions] = completer('/branch ');
        expect(completions.length).toBeGreaterThan(0);
        // All completions should start with /branch
        for (const c of completions) {
          expect(c.startsWith('/branch ')).toBe(true);
        }
      });

      it('handles multiple arguments', () => {
        const completer = createCompleter();
        // After first arg, still show flags
        const [completions] = completer('/models anthropic -');
        expect(completions).toContain('/models anthropic -h');
      });

      it('preserves case in completions', () => {
        const completer = createCompleter();
        const [completions] = completer('/Branch');
        // Command names are lowercase
        expect(completions.some(c => c.toLowerCase().includes('branch'))).toBe(true);
      });
    });
  });

  describe('getCommandNames', () => {
    it('returns all command names and aliases', () => {
      const names = getCommandNames();
      expect(names).toContain('branch');
      expect(names).toContain('br'); // alias
      expect(names).toContain('commit');
      expect(names).toContain('ci'); // alias
      expect(names).toContain('config');
      expect(names).toContain('cfg'); // alias
    });

    it('returns sorted names', () => {
      const names = getCommandNames();
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it('has no duplicate command names or aliases', () => {
      const names = getCommandNames();
      const uniqueNames = new Set(names);
      // If there are duplicates, set size will be smaller than array length
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('completer uniqueness', () => {
    it('returns no duplicate completions', () => {
      const completer = createCompleter();
      const [completions] = completer('/');
      const uniqueCompletions = new Set(completions);
      expect(uniqueCompletions.size).toBe(completions.length);
    });
  });

  describe('getSubcommands', () => {
    it('returns subcommands for branch', () => {
      const subcommands = getSubcommands('branch');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('create');
    });

    it('returns empty for command without subcommands', () => {
      const subcommands = getSubcommands('help');
      expect(subcommands).toHaveLength(0);
    });

    it('is case-insensitive', () => {
      const subcommands = getSubcommands('BRANCH');
      expect(subcommands).toContain('list');
    });
  });

  describe('getStaticArgs', () => {
    it('returns static args for models', () => {
      const args = getStaticArgs('models');
      expect(args).toContain('anthropic');
      expect(args).toContain('openai');
      expect(args).toContain('ollama');
    });

    it('returns commit types for commit', () => {
      const args = getStaticArgs('commit');
      expect(args).toContain('feat');
      expect(args).toContain('fix');
    });

    it('returns empty for command without static args', () => {
      const args = getStaticArgs('help');
      expect(args).toHaveLength(0);
    });
  });

  describe('getFlags', () => {
    it('returns flags for models', () => {
      const flags = getFlags('models');
      expect(flags).toContain('--local');
    });

    it('returns empty for symbols (no special flags)', () => {
      const flags = getFlags('symbols');
      expect(flags).toHaveLength(0);
    });

    it('returns empty for command without specific flags', () => {
      const flags = getFlags('help');
      expect(flags).toHaveLength(0);
    });
  });

  describe('completeLine - Ink UI helper', () => {
    it('returns null for non-command input', () => {
      const result = completeLine('hello world');
      expect(result).toBeNull();
    });

    it('returns common prefix when multiple matches exist', () => {
      // /br matches both /br (alias) and /branch (command)
      const result = completeLine('/br');
      expect(result).toBe('/br');
    });

    it('returns completed command for truly single match', () => {
      // /bran only matches /branch (not /br alias)
      const result = completeLine('/bran');
      expect(result).toBe('/branch');
    });

    it('returns common prefix for multiple matches', () => {
      const result = completeLine('/co');
      // /commit and /compact both start with /co
      expect(result).toBeTruthy();
      expect(result?.startsWith('/co')).toBe(true);
    });

    it('returns null for no matches', () => {
      const result = completeLine('/xyznonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getCompletionMatches - Ink UI helper', () => {
    it('returns all matches for partial command', () => {
      const matches = getCompletionMatches('/co');
      expect(matches.some(m => m.startsWith('/co'))).toBe(true);
      expect(matches.length).toBeGreaterThan(1);
    });

    it('returns empty for no matches', () => {
      const matches = getCompletionMatches('/nonexistentxyz');
      expect(matches).toHaveLength(0);
    });

    it('returns empty for non-command input', () => {
      const matches = getCompletionMatches('hello');
      expect(matches).toHaveLength(0);
    });
  });

  describe('getCommonPrefix', () => {
    it('returns empty for empty array', () => {
      expect(getCommonPrefix([])).toBe('');
    });

    it('returns single element for single element array', () => {
      expect(getCommonPrefix(['/branch'])).toBe('/branch');
    });

    it('returns common prefix for multiple strings', () => {
      // All three start with '/co' (commit, compact, config)
      const result = getCommonPrefix(['/commit', '/compact', '/config']);
      expect(result).toBe('/co');
    });

    it('returns empty when no common prefix', () => {
      const result = getCommonPrefix(['/branch', '/commit']);
      expect(result).toBe('/');
    });
  });
});
