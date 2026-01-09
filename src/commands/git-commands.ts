import { registerCommand, type Command, type CommandContext } from './index.js';

export const commitCommand: Command = {
  name: 'commit',
  aliases: ['ci'],
  description: 'Generate a commit message and create a commit',
  usage: '/commit [type]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const commitType = args.trim().toLowerCase();

    let typeGuidance = '';
    if (commitType) {
      const types: Record<string, string> = {
        feat: 'A new feature',
        fix: 'A bug fix',
        docs: 'Documentation only changes',
        style: 'Changes that do not affect the meaning of the code',
        refactor: 'A code change that neither fixes a bug nor adds a feature',
        perf: 'A code change that improves performance',
        test: 'Adding missing tests or correcting existing tests',
        chore: 'Changes to the build process or auxiliary tools',
      };

      if (types[commitType]) {
        typeGuidance = `\n\nCommit type requested: "${commitType}" (${types[commitType]})`;
      }
    }

    return `Help me create a git commit for the current changes.${typeGuidance}

Steps:
1. First, run \`git status\` to see what files have changed
2. Run \`git diff\` to see the actual changes (for staged files use \`git diff --cached\`)
3. Analyze the changes and generate a clear, concise commit message following conventional commits format:
   - Format: <type>(<scope>): <description>
   - Types: feat, fix, docs, style, refactor, perf, test, chore
   - Keep the first line under 72 characters
   - Add a body if the changes need more explanation
4. Show me the proposed commit message and ask for confirmation
5. If I approve, stage all relevant files (or ask which files to stage) and create the commit

Important:
- Do NOT commit files that look like they contain secrets (.env, credentials, API keys)
- Ask for confirmation before running the actual git commit command`;
  },
};

export const branchCommand: Command = {
  name: 'branch',
  aliases: ['br'],
  description: 'Create, switch, or manage git branches',
  usage: '/branch [action] [name]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase() || 'list';
    const branchName = parts.slice(1).join('-');

    const actions: Record<string, string> = {
      list: `List and manage git branches.

Steps:
1. Run \`git branch -a\` to show all branches (local and remote)
2. Run \`git branch -vv\` to show branches with tracking info
3. Highlight the current branch
4. Suggest cleanup for merged branches if any`,

      create: `Create a new git branch${branchName ? ` named "${branchName}"` : ''}.

Steps:
1. Run \`git status\` to check for uncommitted changes
2. If there are changes, ask if I want to stash them first
3. ${branchName ? `Create branch "${branchName}"` : 'Ask for the branch name'}
4. Follow naming convention: <type>/<description> (e.g., feature/user-auth, fix/login-bug)
5. Switch to the new branch
6. Confirm the branch was created with \`git branch --show-current\``,

      switch: `Switch to ${branchName ? `branch "${branchName}"` : 'another branch'}.

Steps:
1. Run \`git status\` to check for uncommitted changes
2. If there are uncommitted changes, ask if I want to:
   - Stash them
   - Commit them
   - Discard them (requires confirmation)
3. ${branchName ? `Switch to "${branchName}"` : 'Show available branches and ask which one to switch to'}
4. Confirm the switch with \`git branch --show-current\``,

      delete: `Delete ${branchName ? `branch "${branchName}"` : 'a branch'}.

Steps:
1. ${branchName ? `Check if "${branchName}" exists` : 'List branches and ask which to delete'}
2. Check if the branch has been merged
3. If not merged, warn me and ask for confirmation to force delete
4. Do NOT delete main/master without explicit confirmation
5. Run the appropriate delete command (\`git branch -d\` or \`git branch -D\`)`,

      rename: `Rename ${branchName ? `to "${branchName}"` : 'the current branch'}.

Steps:
1. Show the current branch name
2. ${branchName ? `Rename to "${branchName}"` : 'Ask for the new name'}
3. Run \`git branch -m <old-name> <new-name>\`
4. Confirm the rename`,
    };

    if (actions[action]) {
      return actions[action];
    }

    // If action looks like a branch name, assume they want to switch
    if (action && !actions[action]) {
      return `Switch to branch "${action}".

Steps:
1. Run \`git status\` to check for uncommitted changes
2. Handle any uncommitted changes appropriately
3. Switch to "${action}" using \`git checkout\` or \`git switch\`
4. Confirm the switch`;
    }

    return `Unknown branch action. Available actions: list, create, switch, delete, rename

Examples:
  /branch                    - List all branches
  /branch create feature/x   - Create new branch
  /branch switch main        - Switch to main
  /branch delete old-branch  - Delete a branch`;
  },
};

export const diffCommand: Command = {
  name: 'diff',
  description: 'Show and explain git differences',
  usage: '/diff [file|branch|commit]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const target = args.trim();

    if (!target) {
      return `Show and explain the current git diff.

Steps:
1. Run \`git status\` to see changed files
2. Run \`git diff\` to see unstaged changes
3. Run \`git diff --cached\` to see staged changes
4. Summarize the changes:
   - What files were modified
   - What was added/removed
   - The purpose of each change
5. Highlight any potential issues or concerns`;
    }

    // Check if it looks like a file path
    if (target.includes('/') || target.includes('.')) {
      return `Show and explain changes in "${target}".

Steps:
1. Run \`git diff "${target}"\` to see changes
2. If no changes, check \`git diff --cached "${target}"\` for staged changes
3. Explain what was changed and why it might have been changed
4. Point out any potential issues`;
    }

    // Assume it's a branch or commit
    return `Show differences compared to "${target}".

Steps:
1. Run \`git diff ${target}\` to see all differences
2. If comparing branches, also run \`git log ${target}..HEAD --oneline\` to see commits
3. Summarize:
   - Files changed
   - Lines added/removed
   - Key changes and their purpose
4. Highlight breaking changes or important modifications`;
  },
};

export const prCommand: Command = {
  name: 'pr',
  aliases: ['pull-request'],
  description: 'Help create a pull request',
  usage: '/pr [base-branch]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const baseBranch = args.trim() || 'main';

    return `Help me create a pull request to merge into "${baseBranch}".

Steps:
1. Run \`git branch --show-current\` to get the current branch name
2. Run \`git log ${baseBranch}..HEAD --oneline\` to see commits in this branch
3. Run \`git diff ${baseBranch}...HEAD --stat\` to see changed files
4. Run \`git diff ${baseBranch}...HEAD\` to see actual changes

Then generate a PR description with:

## Title
A concise title following: <type>: <description>

## Summary
- Bullet points of what this PR does
- Why these changes were made

## Changes
- List of key changes organized by category

## Testing
- How to test these changes
- Any specific test cases to verify

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes (or documented)

After generating the description:
1. Ask if I want to push the branch first (if not already pushed)
2. Provide the command to create the PR via GitHub CLI if available:
   \`gh pr create --base ${baseBranch} --title "..." --body "..."\`
3. Or provide a link to create it on GitHub web`;
  },
};

export const stashCommand: Command = {
  name: 'stash',
  description: 'Manage git stash',
  usage: '/stash [action] [name]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase() || 'save';
    const stashName = parts.slice(1).join(' ');

    const actions: Record<string, string> = {
      save: `Stash current changes${stashName ? ` with message "${stashName}"` : ''}.

Steps:
1. Run \`git status\` to see what will be stashed
2. ${stashName ? `Stash with message: \`git stash push -m "${stashName}"\`` : 'Stash changes: `git stash push`'}
3. Optionally include untracked files with \`-u\` flag
4. Confirm the stash was created with \`git stash list\``,

      list: `List all stashes.

Steps:
1. Run \`git stash list\` to see all stashes
2. For each stash, show:
   - Index (stash@{n})
   - Message/description
   - Branch it was created on
3. Suggest which stashes might be safe to drop if there are many`,

      pop: `Apply and remove the ${stashName ? `stash "${stashName}"` : 'most recent stash'}.

Steps:
1. Run \`git stash list\` to show available stashes
2. Run \`git stash pop ${stashName || ''}\` to apply the stash
3. If there are conflicts, help resolve them
4. Confirm the changes were applied with \`git status\``,

      apply: `Apply (keep) the ${stashName ? `stash "${stashName}"` : 'most recent stash'}.

Steps:
1. Run \`git stash list\` to show available stashes
2. Run \`git stash apply ${stashName || ''}\` to apply without removing
3. Handle any conflicts
4. Confirm with \`git status\``,

      drop: `Delete ${stashName ? `stash "${stashName}"` : 'a stash'}.

Steps:
1. Run \`git stash list\` to show stashes
2. ${stashName ? `Drop "${stashName}"` : 'Ask which stash to drop'}
3. Confirm before dropping
4. Run \`git stash drop <stash>\``,

      clear: `Clear all stashes.

⚠️  WARNING: This will permanently delete ALL stashes!

Steps:
1. Run \`git stash list\` to show what will be deleted
2. Ask for explicit confirmation
3. Only proceed if confirmed with "yes"
4. Run \`git stash clear\``,
    };

    if (actions[action]) {
      return actions[action];
    }

    return `Unknown stash action. Available: save, list, pop, apply, drop, clear

Examples:
  /stash                     - Stash current changes
  /stash save WIP feature    - Stash with a message
  /stash list                - List all stashes
  /stash pop                 - Apply and remove latest stash
  /stash apply stash@{2}     - Apply specific stash (keep it)`;
  },
};

export const logCommand: Command = {
  name: 'log',
  aliases: ['history'],
  description: 'Show and explain git history',
  usage: '/log [file|branch|options]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const target = args.trim();

    if (!target) {
      return `Show recent git history.

Steps:
1. Run \`git log --oneline -20\` to see recent commits
2. Run \`git log --oneline --graph --all -15\` to see branch structure
3. Summarize:
   - Recent activity
   - Active branches
   - Key milestones or features
4. Identify any concerning patterns (e.g., many "fix" commits, WIP commits)`;
    }

    // Check if it looks like a file path
    if (target.includes('/') || target.includes('.')) {
      return `Show git history for "${target}".

Steps:
1. Run \`git log --oneline -20 -- "${target}"\` to see commits affecting this file
2. Run \`git log -p -5 -- "${target}"\` to see actual changes in recent commits
3. Summarize:
   - When the file was created
   - Major changes over time
   - Recent modifications
   - Who has worked on it`;
    }

    // Assume it's a branch or special option
    return `Show git history for "${target}".

Steps:
1. Run \`git log --oneline -20 ${target}\`
2. If it's a branch, show \`git log main..${target} --oneline\` to see unique commits
3. Provide a summary of the commits and their purpose`;
  },
};

export const statusCommand: Command = {
  name: 'gitstatus',
  aliases: ['gs'],
  description: 'Show detailed git status with explanations',
  usage: '/gitstatus',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    return `Show a detailed git status with explanations.

Steps:
1. Run \`git status\` to get current state
2. Run \`git branch -vv\` to show branch tracking status
3. Run \`git stash list\` to check for stashed changes

Explain:
- Current branch and its tracking status
- Staged changes (ready to commit)
- Unstaged changes (modified but not staged)
- Untracked files
- Any stashes that exist
- Suggested next actions based on the state`;
  },
};

export const undoCommand: Command = {
  name: 'undo',
  aliases: ['revert'],
  description: 'Help undo git changes safely',
  usage: '/undo [what]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const what = args.trim().toLowerCase();

    if (!what) {
      return `Help undo git changes.

First, let me understand what you want to undo:
1. Run \`git status\` to see current state
2. Run \`git log --oneline -5\` to see recent commits

Tell me what you'd like to undo:
- "last commit" - Undo the most recent commit
- "staged" - Unstage all staged files
- "changes" - Discard all uncommitted changes
- "file <path>" - Discard changes to a specific file
- "merge" - Abort a merge in progress

⚠️  Some undo operations are destructive. I'll always ask for confirmation.`;
    }

    const undoActions: Record<string, string> = {
      'last commit': `Undo the last commit.

Steps:
1. Run \`git log --oneline -3\` to confirm which commit
2. Check if the commit has been pushed: \`git status\`
3. Options:
   - Keep changes staged: \`git reset --soft HEAD~1\`
   - Keep changes unstaged: \`git reset HEAD~1\`
   - Discard changes entirely: \`git reset --hard HEAD~1\` (DESTRUCTIVE)
4. Ask which option you prefer
5. ⚠️  If already pushed, suggest \`git revert\` instead`,

      'staged': `Unstage all staged files.

Steps:
1. Run \`git diff --cached --name-only\` to see staged files
2. Run \`git reset HEAD\` to unstage all files
3. Confirm with \`git status\`
4. Files will remain modified but unstaged`,

      'changes': `Discard all uncommitted changes.

⚠️  WARNING: This is DESTRUCTIVE and cannot be undone!

Steps:
1. Run \`git status\` to show what will be discarded
2. Ask for explicit confirmation
3. If confirmed:
   - \`git checkout -- .\` to discard tracked file changes
   - \`git clean -fd\` to remove untracked files (optional)
4. Confirm with \`git status\``,

      'merge': `Abort a merge in progress.

Steps:
1. Check if a merge is in progress: \`git status\`
2. If merge in progress, run \`git merge --abort\`
3. Confirm the merge was aborted
4. Show the resulting state`,
    };

    // Check for exact matches first
    if (undoActions[what]) {
      return undoActions[what];
    }

    // Check for partial matches
    for (const [key, value] of Object.entries(undoActions)) {
      if (key.includes(what) || what.includes(key)) {
        return value;
      }
    }

    // Handle "file <path>" case
    if (what.startsWith('file ')) {
      const filePath = what.slice(5).trim();
      return `Discard changes to "${filePath}".

⚠️  WARNING: This will permanently discard your changes to this file!

Steps:
1. Run \`git diff "${filePath}"\` to show what will be discarded
2. Ask for confirmation
3. If confirmed, run \`git checkout -- "${filePath}"\`
4. Confirm the file is restored with \`git status\``;
    }

    return `I'm not sure what you want to undo. Options:
- /undo last commit
- /undo staged
- /undo changes
- /undo file <path>
- /undo merge

What would you like to undo?`;
  },
};

export const mergeCommand: Command = {
  name: 'merge',
  description: 'Help merge branches',
  usage: '/merge <branch>',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const branch = args.trim();

    if (!branch) {
      return `Help merge a branch.

Steps:
1. Run \`git branch -a\` to show available branches
2. Ask which branch to merge
3. Then I'll guide you through the merge process`;
    }

    return `Help merge "${branch}" into the current branch.

Steps:
1. Run \`git branch --show-current\` to confirm current branch
2. Run \`git status\` to ensure working directory is clean
3. Run \`git log --oneline ${branch} -10\` to preview what will be merged
4. Run \`git diff HEAD...${branch} --stat\` to see files that will change

Before merging:
- Fetch latest: \`git fetch origin\`
- Ensure both branches are up to date

Merge options:
- Standard merge: \`git merge ${branch}\`
- No fast-forward (keeps branch history): \`git merge --no-ff ${branch}\`
- Squash (combine commits): \`git merge --squash ${branch}\`

Ask which merge strategy you prefer, then:
1. Execute the merge
2. Handle any conflicts if they arise
3. Confirm the merge with \`git log --oneline -5\``;
  },
};

export const rebaseCommand: Command = {
  name: 'rebase',
  description: 'Help rebase branches',
  usage: '/rebase <branch>',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const branch = args.trim() || 'main';

    return `Help rebase current branch onto "${branch}".

⚠️  WARNING: Rebase rewrites history. Don't rebase commits that have been pushed and shared with others.

Steps:
1. Run \`git branch --show-current\` to confirm current branch
2. Run \`git status\` to ensure working directory is clean
3. Run \`git log --oneline ${branch}..HEAD\` to see commits that will be rebased

Rebase process:
1. \`git fetch origin\` to get latest changes
2. \`git rebase ${branch}\`
3. If conflicts occur:
   - Fix conflicts in each file
   - \`git add <file>\` for each resolved file
   - \`git rebase --continue\`
   - Or \`git rebase --abort\` to cancel
4. Confirm with \`git log --oneline -10\`

⚠️  After rebasing, you'll need to force push: \`git push --force-with-lease\`
Only do this if the branch hasn't been shared, or coordinate with your team.`;
  },
};

// Register all git commands
export function registerGitCommands(): void {
  registerCommand(commitCommand);
  registerCommand(branchCommand);
  registerCommand(diffCommand);
  registerCommand(prCommand);
  registerCommand(stashCommand);
  registerCommand(logCommand);
  registerCommand(statusCommand);
  registerCommand(undoCommand);
  registerCommand(mergeCommand);
  registerCommand(rebaseCommand);
}
