// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeAll } from 'vitest';
import {
  gitCommand,
  commitAlias,
  branchAlias,
  prAlias,
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
    it('registers git command and aliases', () => {
      const commands = getAllCommands();
      const names = commands.map((c) => c.name);

      expect(names).toContain('git');
      expect(names).toContain('commit');
      expect(names).toContain('branch');
      expect(names).toContain('pr');
    });

    it('registers aliases correctly', () => {
      expect(getCommand('g')).toBe(getCommand('git'));
      expect(getCommand('ci')).toBe(getCommand('commit'));
      expect(getCommand('br')).toBe(getCommand('branch'));
      expect(getCommand('pull-request')).toBe(getCommand('pr'));
    });
  });

  describe('gitCommand', () => {
    it('has correct metadata', () => {
      expect(gitCommand.name).toBe('git');
      expect(gitCommand.aliases).toContain('g');
      expect(gitCommand.subcommands).toContain('commit');
      expect(gitCommand.subcommands).toContain('branch');
    });

    it('shows help for unknown subcommand', async () => {
      const result = await gitCommand.execute('', mockContext);
      expect(result).toContain('Available actions');
      expect(result).toContain('commit');
      expect(result).toContain('branch');
    });
  });

  describe('git commit', () => {
    it('generates prompt for basic commit', async () => {
      const result = await gitCommand.execute('commit', mockContext);
      expect(result).toContain('git commit');
      expect(result).toContain('git status');
      expect(result).toContain('git diff');
      expect(result).toContain('conventional commits');
    });

    it('includes commit type when specified', async () => {
      const result = await gitCommand.execute('commit feat', mockContext);
      expect(result).toContain('feat');
      expect(result).toContain('A new feature');
    });

    it('handles fix commit type', async () => {
      const result = await gitCommand.execute('commit fix', mockContext);
      expect(result).toContain('fix');
      expect(result).toContain('bug fix');
    });
  });

  describe('commitAlias', () => {
    it('has correct metadata', () => {
      expect(commitAlias.name).toBe('commit');
      expect(commitAlias.aliases).toContain('ci');
    });

    it('generates same output as git commit', async () => {
      const aliasResult = await commitAlias.execute('feat', mockContext);
      const gitResult = await gitCommand.execute('commit feat', mockContext);
      expect(aliasResult).toBe(gitResult);
    });
  });

  describe('git branch', () => {
    it('defaults to list action', async () => {
      const result = await gitCommand.execute('branch', mockContext);
      expect(result).toContain('git branch');
      expect(result.toLowerCase()).toContain('list');
    });

    it('handles create action', async () => {
      const result = await gitCommand.execute('branch create feature/test', mockContext);
      expect(result).toContain('Create');
      expect(result).toContain('feature/test');
    });

    it('handles switch action', async () => {
      const result = await gitCommand.execute('branch switch main', mockContext);
      expect(result).toContain('Switch');
      expect(result).toContain('main');
    });

    it('handles delete action', async () => {
      const result = await gitCommand.execute('branch delete old-branch', mockContext);
      expect(result).toContain('Delete');
      expect(result).toContain('old-branch');
    });

    it('handles rename action', async () => {
      const result = await gitCommand.execute('branch rename new-name', mockContext);
      expect(result).toContain('Rename');
      expect(result).toContain('new-name');
    });

    it('treats unknown action as branch name to switch to', async () => {
      const result = await gitCommand.execute('branch feature-x', mockContext);
      expect(result).toContain('Switch');
      expect(result).toContain('feature-x');
    });
  });

  describe('branchAlias', () => {
    it('has correct metadata', () => {
      expect(branchAlias.name).toBe('branch');
      expect(branchAlias.aliases).toContain('br');
    });

    it('generates same output as git branch', async () => {
      const aliasResult = await branchAlias.execute('create test', mockContext);
      const gitResult = await gitCommand.execute('branch create test', mockContext);
      expect(aliasResult).toBe(gitResult);
    });
  });

  describe('git diff', () => {
    it('shows all diffs when no target specified', async () => {
      const result = await gitCommand.execute('diff', mockContext);
      expect(result).toContain('git diff');
      expect(result).toContain('git diff --cached');
    });

    it('handles file path target', async () => {
      const result = await gitCommand.execute('diff src/index.ts', mockContext);
      expect(result).toContain('src/index.ts');
    });

    it('handles branch/commit target', async () => {
      const result = await gitCommand.execute('diff main', mockContext);
      expect(result).toContain('main');
      expect(result).toContain('differences');
    });
  });

  describe('git pr', () => {
    it('defaults to main base branch', async () => {
      const result = await gitCommand.execute('pr', mockContext);
      expect(result).toContain('main');
      expect(result).toContain('pull request');
    });

    it('uses specified base branch', async () => {
      const result = await gitCommand.execute('pr develop', mockContext);
      expect(result).toContain('develop');
    });

    it('includes PR template structure', async () => {
      const result = await gitCommand.execute('pr', mockContext);
      expect(result).toContain('Summary');
      expect(result).toContain('Changes');
      expect(result).toContain('Testing');
    });
  });

  describe('prAlias', () => {
    it('has correct metadata', () => {
      expect(prAlias.name).toBe('pr');
      expect(prAlias.aliases).toContain('pull-request');
    });

    it('generates same output as git pr', async () => {
      const aliasResult = await prAlias.execute('develop', mockContext);
      const gitResult = await gitCommand.execute('pr develop', mockContext);
      expect(aliasResult).toBe(gitResult);
    });
  });

  describe('git stash', () => {
    it('defaults to save action', async () => {
      const result = await gitCommand.execute('stash', mockContext);
      expect(result).toContain('Stash');
      expect(result).toContain('git stash');
    });

    it('handles list action', async () => {
      const result = await gitCommand.execute('stash list', mockContext);
      expect(result).toContain('git stash list');
    });

    it('handles pop action', async () => {
      const result = await gitCommand.execute('stash pop', mockContext);
      expect(result).toContain('git stash pop');
    });

    it('handles apply action', async () => {
      const result = await gitCommand.execute('stash apply stash@{0}', mockContext);
      expect(result).toContain('git stash apply');
    });

    it('handles drop action', async () => {
      const result = await gitCommand.execute('stash drop', mockContext);
      expect(result).toContain('git stash drop');
    });

    it('handles clear action with warning', async () => {
      const result = await gitCommand.execute('stash clear', mockContext);
      expect(result).toContain('WARNING');
      expect(result).toContain('git stash clear');
    });

    it('handles save with message', async () => {
      const result = await gitCommand.execute('stash save WIP feature', mockContext);
      expect(result).toContain('WIP feature');
    });
  });

  describe('git log', () => {
    it('shows recent history when no target', async () => {
      const result = await gitCommand.execute('log', mockContext);
      expect(result).toContain('git log');
    });

    it('handles file path target', async () => {
      const result = await gitCommand.execute('log src/index.ts', mockContext);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('history');
    });

    it('handles branch target', async () => {
      const result = await gitCommand.execute('log feature-branch', mockContext);
      expect(result).toContain('feature-branch');
    });
  });

  describe('git status', () => {
    it('generates comprehensive status prompt', async () => {
      const result = await gitCommand.execute('status', mockContext);
      expect(result).toContain('git status');
      expect(result).toContain('git branch');
      expect(result).toContain('git stash list');
    });
  });

  describe('git undo', () => {
    it('shows options when no target', async () => {
      const result = await gitCommand.execute('undo', mockContext);
      expect(result).toContain('last commit');
      expect(result).toContain('staged');
      expect(result).toContain('changes');
    });

    it('handles last commit', async () => {
      const result = await gitCommand.execute('undo last commit', mockContext);
      expect(result).toContain('git reset');
      expect(result).toContain('HEAD~1');
    });

    it('handles staged', async () => {
      const result = await gitCommand.execute('undo staged', mockContext);
      expect(result).toContain('Unstage');
      expect(result).toContain('git reset');
    });

    it('handles changes with warning', async () => {
      const result = await gitCommand.execute('undo changes', mockContext);
      expect(result).toContain('WARNING');
      expect(result).toContain('DESTRUCTIVE');
    });

    it('handles merge', async () => {
      const result = await gitCommand.execute('undo merge', mockContext);
      expect(result).toContain('git merge --abort');
    });

    it('handles file undo', async () => {
      const result = await gitCommand.execute('undo file src/index.ts', mockContext);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('git checkout');
    });
  });

  describe('git merge', () => {
    it('asks for branch when not specified', async () => {
      const result = await gitCommand.execute('merge', mockContext);
      expect(result).toContain('git branch');
      expect(result).toContain('which branch');
    });

    it('generates merge prompt for specified branch', async () => {
      const result = await gitCommand.execute('merge feature-branch', mockContext);
      expect(result).toContain('feature-branch');
      expect(result).toContain('git merge');
      expect(result).toContain('--no-ff');
    });
  });

  describe('git rebase', () => {
    it('defaults to main branch', async () => {
      const result = await gitCommand.execute('rebase', mockContext);
      expect(result).toContain('main');
      expect(result).toContain('rebase');
    });

    it('includes warning about history rewriting', async () => {
      const result = await gitCommand.execute('rebase develop', mockContext);
      expect(result).toContain('WARNING');
      expect(result).toContain('rewrites history');
    });

    it('mentions force push requirement', async () => {
      const result = await gitCommand.execute('rebase main', mockContext);
      expect(result).toContain('force push');
      expect(result).toContain('--force-with-lease');
    });
  });
});
