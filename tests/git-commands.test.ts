// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, beforeAll } from 'vitest';
import {
  commitCommand,
  branchCommand,
  diffCommand,
  prCommand,
  stashCommand,
  logCommand,
  statusCommand,
  undoCommand,
  mergeCommand,
  rebaseCommand,
  registerGitCommands,
} from '../src/commands/git-commands';
import { getCommand, getAllCommands } from '../src/commands/index';

// Mock command context
const mockContext = {
  projectInfo: {
    type: 'node' as const,
    name: 'test-project',
    language: 'TypeScript',
    rootPath: '/test',
    mainFiles: [],
  },
};

describe('Git Commands', () => {
  beforeAll(() => {
    registerGitCommands();
  });

  describe('registerGitCommands', () => {
    it('registers all git commands', () => {
      const commands = getAllCommands();
      const names = commands.map((c) => c.name);

      expect(names).toContain('commit');
      expect(names).toContain('branch');
      expect(names).toContain('diff');
      expect(names).toContain('pr');
      expect(names).toContain('stash');
      expect(names).toContain('log');
      expect(names).toContain('gitstatus');
      expect(names).toContain('undo');
      expect(names).toContain('merge');
      expect(names).toContain('rebase');
    });

    it('registers aliases correctly', () => {
      expect(getCommand('ci')).toBe(getCommand('commit'));
      expect(getCommand('br')).toBe(getCommand('branch'));
      expect(getCommand('gs')).toBe(getCommand('gitstatus'));
      expect(getCommand('history')).toBe(getCommand('log'));
      expect(getCommand('pull-request')).toBe(getCommand('pr'));
      expect(getCommand('revert')).toBe(getCommand('undo'));
    });
  });

  describe('commitCommand', () => {
    it('has correct metadata', () => {
      expect(commitCommand.name).toBe('commit');
      expect(commitCommand.aliases).toContain('ci');
      expect(commitCommand.description).toContain('commit');
    });

    it('generates prompt for basic commit', async () => {
      const result = await commitCommand.execute('', mockContext);
      expect(result).toContain('git commit');
      expect(result).toContain('git status');
      expect(result).toContain('git diff');
      expect(result).toContain('conventional commits');
    });

    it('includes commit type when specified', async () => {
      const result = await commitCommand.execute('feat', mockContext);
      expect(result).toContain('feat');
      expect(result).toContain('A new feature');
    });

    it('handles fix commit type', async () => {
      const result = await commitCommand.execute('fix', mockContext);
      expect(result).toContain('fix');
      expect(result).toContain('bug fix');
    });
  });

  describe('branchCommand', () => {
    it('has correct metadata', () => {
      expect(branchCommand.name).toBe('branch');
      expect(branchCommand.aliases).toContain('br');
    });

    it('defaults to list action', async () => {
      const result = await branchCommand.execute('', mockContext);
      expect(result).toContain('git branch');
      expect(result.toLowerCase()).toContain('list');
    });

    it('handles create action', async () => {
      const result = await branchCommand.execute('create feature/test', mockContext);
      expect(result).toContain('Create');
      expect(result).toContain('feature/test');
    });

    it('handles switch action', async () => {
      const result = await branchCommand.execute('switch main', mockContext);
      expect(result).toContain('Switch');
      expect(result).toContain('main');
    });

    it('handles delete action', async () => {
      const result = await branchCommand.execute('delete old-branch', mockContext);
      expect(result).toContain('Delete');
      expect(result).toContain('old-branch');
    });

    it('handles rename action', async () => {
      const result = await branchCommand.execute('rename new-name', mockContext);
      expect(result).toContain('Rename');
      expect(result).toContain('new-name');
    });

    it('treats unknown action as branch name to switch to', async () => {
      const result = await branchCommand.execute('feature-x', mockContext);
      expect(result).toContain('Switch');
      expect(result).toContain('feature-x');
    });
  });

  describe('diffCommand', () => {
    it('has correct metadata', () => {
      expect(diffCommand.name).toBe('diff');
    });

    it('shows all diffs when no target specified', async () => {
      const result = await diffCommand.execute('', mockContext);
      expect(result).toContain('git diff');
      expect(result).toContain('git diff --cached');
    });

    it('handles file path target', async () => {
      const result = await diffCommand.execute('src/index.ts', mockContext);
      expect(result).toContain('src/index.ts');
    });

    it('handles branch/commit target', async () => {
      const result = await diffCommand.execute('main', mockContext);
      expect(result).toContain('main');
      expect(result).toContain('differences');
    });
  });

  describe('prCommand', () => {
    it('has correct metadata', () => {
      expect(prCommand.name).toBe('pr');
      expect(prCommand.aliases).toContain('pull-request');
    });

    it('defaults to main base branch', async () => {
      const result = await prCommand.execute('', mockContext);
      expect(result).toContain('main');
      expect(result).toContain('pull request');
    });

    it('uses specified base branch', async () => {
      const result = await prCommand.execute('develop', mockContext);
      expect(result).toContain('develop');
    });

    it('includes PR template structure', async () => {
      const result = await prCommand.execute('', mockContext);
      expect(result).toContain('Summary');
      expect(result).toContain('Changes');
      expect(result).toContain('Testing');
    });
  });

  describe('stashCommand', () => {
    it('has correct metadata', () => {
      expect(stashCommand.name).toBe('stash');
    });

    it('defaults to save action', async () => {
      const result = await stashCommand.execute('', mockContext);
      expect(result).toContain('Stash');
      expect(result).toContain('git stash');
    });

    it('handles list action', async () => {
      const result = await stashCommand.execute('list', mockContext);
      expect(result).toContain('git stash list');
    });

    it('handles pop action', async () => {
      const result = await stashCommand.execute('pop', mockContext);
      expect(result).toContain('git stash pop');
    });

    it('handles apply action', async () => {
      const result = await stashCommand.execute('apply stash@{0}', mockContext);
      expect(result).toContain('git stash apply');
    });

    it('handles drop action', async () => {
      const result = await stashCommand.execute('drop', mockContext);
      expect(result).toContain('git stash drop');
    });

    it('handles clear action with warning', async () => {
      const result = await stashCommand.execute('clear', mockContext);
      expect(result).toContain('WARNING');
      expect(result).toContain('git stash clear');
    });

    it('handles save with message', async () => {
      const result = await stashCommand.execute('save WIP feature', mockContext);
      expect(result).toContain('WIP feature');
    });
  });

  describe('logCommand', () => {
    it('has correct metadata', () => {
      expect(logCommand.name).toBe('log');
      expect(logCommand.aliases).toContain('history');
    });

    it('shows recent history when no target', async () => {
      const result = await logCommand.execute('', mockContext);
      expect(result).toContain('git log');
    });

    it('handles file path target', async () => {
      const result = await logCommand.execute('src/index.ts', mockContext);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('history');
    });

    it('handles branch target', async () => {
      const result = await logCommand.execute('feature-branch', mockContext);
      expect(result).toContain('feature-branch');
    });
  });

  describe('statusCommand (gitstatus)', () => {
    it('has correct metadata', () => {
      expect(statusCommand.name).toBe('gitstatus');
      expect(statusCommand.aliases).toContain('gs');
    });

    it('generates comprehensive status prompt', async () => {
      const result = await statusCommand.execute('', mockContext);
      expect(result).toContain('git status');
      expect(result).toContain('git branch');
      expect(result).toContain('git stash list');
    });
  });

  describe('undoCommand', () => {
    it('has correct metadata', () => {
      expect(undoCommand.name).toBe('undo');
      expect(undoCommand.aliases).toContain('revert');
    });

    it('shows options when no target', async () => {
      const result = await undoCommand.execute('', mockContext);
      expect(result).toContain('last commit');
      expect(result).toContain('staged');
      expect(result).toContain('changes');
    });

    it('handles last commit', async () => {
      const result = await undoCommand.execute('last commit', mockContext);
      expect(result).toContain('git reset');
      expect(result).toContain('HEAD~1');
    });

    it('handles staged', async () => {
      const result = await undoCommand.execute('staged', mockContext);
      expect(result).toContain('Unstage');
      expect(result).toContain('git reset');
    });

    it('handles changes with warning', async () => {
      const result = await undoCommand.execute('changes', mockContext);
      expect(result).toContain('WARNING');
      expect(result).toContain('DESTRUCTIVE');
    });

    it('handles merge', async () => {
      const result = await undoCommand.execute('merge', mockContext);
      expect(result).toContain('git merge --abort');
    });

    it('handles file undo', async () => {
      const result = await undoCommand.execute('file src/index.ts', mockContext);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('git checkout');
    });
  });

  describe('mergeCommand', () => {
    it('has correct metadata', () => {
      expect(mergeCommand.name).toBe('merge');
    });

    it('asks for branch when not specified', async () => {
      const result = await mergeCommand.execute('', mockContext);
      expect(result).toContain('git branch');
      expect(result).toContain('which branch');
    });

    it('generates merge prompt for specified branch', async () => {
      const result = await mergeCommand.execute('feature-branch', mockContext);
      expect(result).toContain('feature-branch');
      expect(result).toContain('git merge');
      expect(result).toContain('--no-ff');
    });
  });

  describe('rebaseCommand', () => {
    it('has correct metadata', () => {
      expect(rebaseCommand.name).toBe('rebase');
    });

    it('defaults to main branch', async () => {
      const result = await rebaseCommand.execute('', mockContext);
      expect(result).toContain('main');
      expect(result).toContain('rebase');
    });

    it('includes warning about history rewriting', async () => {
      const result = await rebaseCommand.execute('develop', mockContext);
      expect(result).toContain('WARNING');
      expect(result).toContain('rewrites history');
    });

    it('mentions force push requirement', async () => {
      const result = await rebaseCommand.execute('main', mockContext);
      expect(result).toContain('force push');
      expect(result).toContain('--force-with-lease');
    });
  });
});
