// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { validateGitActionStep } from '../src/workflow/steps/git.js';
import { validatePrActionStep } from '../src/workflow/steps/pr.js';
import { GitActionStep, PrActionStep, WorkflowState } from '../src/workflow/types.js';

// We'll mock the fs module to simulate Git repository existence
vi.mock('node:fs', () => ({
  existsSync: vi.fn((path) => {
    // Default: assume we're in a Git repository
    return path.includes('.git');
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn()
}));

// Mock child_process.execSync
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn((command) => {
      // Mock responses for different commands
      if (command.includes('git commit')) {
        return '[main abc1234] Test commit\n 1 file changed, 1 insertion(+)';
      }
      if (command.includes('git push')) {
        return 'To github.com:user/repo.git\n   abc1234..def5678  main -> main';
      }
      if (command.includes('git pull')) {
        return 'Already up to date.';
      }
      if (command.includes('gh --version')) {
        return 'gh version 2.0.0';
      }
      if (command.includes('gh auth status')) {
        return 'Logged in to github.com';
      }
      if (command.includes('gh pr list')) {
        return '[{"number": 1, "title": "Test PR", "state": "open"}]';
      }
      if (command.includes('gh pr create')) {
        return 'https://github.com/user/repo/pull/1';
      }
      if (command.includes('gh pr merge')) {
        return 'Merged pull request #1';
      }
      return '';
    })
  };
});

describe('Git Actions Validation', () => {
  describe('validateGitActionStep', () => {
    it('validates commit action with message', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit',
        message: 'Test commit message'
      };
      
      expect(() => validateGitActionStep(step)).not.toThrow();
    });

    it('rejects commit action without message', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit'
      };
      
      expect(() => validateGitActionStep(step)).toThrow('Git commit action must have a message');
    });

    it('rejects invalid Git action', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'invalid-action'
      };
      
      expect(() => validateGitActionStep(step)).toThrow('Git action must be one of: commit, push, pull, sync');
    });

    it('validates branch name format', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit',
        message: 'Test commit',
        base: 'feature/valid-branch-name'
      };
      
      expect(() => validateGitActionStep(step)).not.toThrow();
    });

    it('accepts branch name with underscores and hyphens', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit',
        message: 'Test commit',
        base: 'feature/my_feature-123'
      };
      
      expect(() => validateGitActionStep(step)).not.toThrow();
    });
  });
});

describe('PR Actions Validation', () => {
  describe('validatePrActionStep', () => {
    it('validates create-pr action with title', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr',
        title: 'Test PR Title'
      };
      
      expect(() => validatePrActionStep(step)).not.toThrow();
    });

    it('rejects create-pr action without title', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr'
      };
      
      expect(() => validatePrActionStep(step)).toThrow('PR create action must have a title');
    });

    it('rejects invalid PR action', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'invalid-action'
      };
      
      expect(() => validatePrActionStep(step)).toThrow('PR action must be one of: create-pr, review-pr, merge-pr');
    });

    it('validates PR title format', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr',
        title: 'Valid PR Title Without Control Chars'
      };
      
      expect(() => validatePrActionStep(step)).not.toThrow();
    });

    it('rejects PR title with newline characters', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr',
        title: 'Invalid\nPR Title'
      };
      
      expect(() => validatePrActionStep(step)).toThrow('Invalid PR title');
    });

    it('rejects PR title with tab characters', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr',
        title: 'Invalid\tPR Title'
      };
      
      expect(() => validatePrActionStep(step)).toThrow('Invalid PR title');
    });

    it('accepts review-pr action', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'review-pr'
      };
      
      expect(() => validatePrActionStep(step)).not.toThrow();
    });

    it('accepts merge-pr action', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'merge-pr'
      };
      
      expect(() => validatePrActionStep(step)).not.toThrow();
    });
  });
});

describe('Variable Substitution Tests', () => {
  let state: WorkflowState;
  
  beforeEach(() => {
    state = {
      name: 'test',
      currentStep: 'test-step',
      variables: {
        username: 'testuser',
        feature: 'new-feature',
        branch: 'develop'
      },
      history: [],
      iterationCount: 0,
      paused: false,
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });

  describe('Git Variable Substitution', () => {
    it('validates step with variable substitution syntax', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit',
        message: 'Commit by {{username}} for {{feature}}'
      };
      
      expect(() => validateGitActionStep(step)).not.toThrow();
    });
  });

  describe('PR Variable Substitution', () => {
    it('validates step with variable substitution syntax', () => {
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr',
        title: 'Implement {{feature}}',
        base: '{{branch}}'
      };
      
      expect(() => validatePrActionStep(step)).not.toThrow();
    });
  });
});

describe('Security Validation', () => {
  describe('Git Branch Name Security', () => {
    it('rejects branch names with special characters', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit',
        message: 'Test commit',
        base: 'feature/branch;rm -rf /'
      };
      
      expect(() => validateGitActionStep(step)).toThrow('Invalid branch name');
    });

    it('rejects branch names with pipe characters', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit',
        message: 'Test commit',
        base: 'feature/branch|cat /etc/passwd'
      };
      
      expect(() => validateGitActionStep(step)).toThrow('Invalid branch name');
    });

    it('rejects branch names with command substitution', () => {
      const step: GitActionStep = {
        id: 'git-1',
        action: 'commit',
        message: 'Test commit',
        base: 'feature/$(echo malicious)'
      };
      
      expect(() => validateGitActionStep(step)).toThrow('Invalid branch name');
    });
  });

  describe('PR Title Security', () => {
    it('rejects PR titles exceeding 256 characters', () => {
      const longTitle = 'A'.repeat(300);
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr',
        title: longTitle
      };
      
      expect(() => validatePrActionStep(step)).toThrow('Invalid PR title');
    });

    it('accepts PR title with exactly 256 characters', () => {
      const validLongTitle = 'A'.repeat(256);
      const step: PrActionStep = {
        id: 'pr-1',
        action: 'create-pr',
        title: validLongTitle
      };
      
      expect(() => validatePrActionStep(step)).not.toThrow();
    });
  });
});