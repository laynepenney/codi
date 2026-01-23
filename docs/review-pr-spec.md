# Spec: Add `/review-pr` Command for GitHub Pull Request Reviews

## Overview
Add a new command to review GitHub pull requests using the `gh` CLI tool.

## Requirements

### 1. New Command: `/review-pr`
- **Purpose**: Review GitHub pull requests using GitHub CLI
- **Standalone aliases**: `/review-pr` and `/review-pull-request`
- **Subcommand path**: `/git review-pr` and aliases `/git review-pull-request`

### 2. Command Behavior

**When no PR number provided:**
- Run `gh pr list` to show available pull requests
- Display: PR numbers, titles, status (open/closed), author, creation date
- Ask user which PR number to review
- Then proceed with review process for that PR

**When PR number provided:**
- Run these GitHub CLI commands:
  1. `gh pr view <number> [-R <repo>]` - Get PR details
  2. `gh pr diff <number> [-R <repo>]` - Get PR diff
  3. `gh pr checks <number> [-R <repo>]` - Get CI/CD status
  4. `gh pr comment list --number <number> [-R <repo>]` - Get existing comments
- Provide thorough review covering:
  - **Code Quality**: Clarity, maintainability, best practices
  - **Functionality**: Does it solve the intended problem?
  - **Potential Issues**: Bugs, security vulnerabilities, performance concerns
  - **Testing**: Are tests adequate and do they cover edge cases?
  - **Documentation**: Is the code properly documented?
- Include specific line references and actionable suggestions

### 3. Optional Repository Parameter
- Format: `/review-pr <pr-number> [repo]`
- Example: `/review-pr 42 owner/repo`
- Uses `-R <repo>` flag in all `gh pr` commands

## Code Changes Required

### File: src/commands/git-commands.ts
- [ ] Add `function reviewPrPrompt(args: string, _context: CommandContext): string`
- [ ] Add `'review-pr'` to `gitCommand.subcommands` array
- [ ] Add case statements in switch: `case 'review-pr'` and `case 'review-pull-request'`
- [ ] Update help text in default case to show `/git review-pr [number] [repo]`
- [ ] Add `export const reviewPrAlias: Command` object
- [ ] Register `reviewPrAlias` in `registerGitCommands()`

### File: src/index.ts
- [ ] Update help text (showHelp function) to distinguish:
  - `/review <file>` - Code review for a local file
  - `/review-pr <num>` - Review a GitHub pull request

### File: tests/git-commands.test.ts
- [ ] Import `reviewPrAlias`
- [ ] Add `'review-pr'` to names check in registration tests
- [ ] Add `'review-pull-request'` to aliases check in registration tests
- [ ] Add test suite: `describe('git review-pr', ...)`
  - Tests subcommand registration
  - Tests show available PRs (no PR number)
  - Tests review criteria presence
  - Tests review prompt generation without repo
  - Tests review prompt generation with repo
  - Tests line references directive
  - Tests alias (`review-pull-request`)
- [ ] Add test suite: `describe('reviewPrAlias', ...)`
  - Tests metadata (name, aliases, usage)
  - Tests output matches `git review-pr`
  - Tests list scenario matches

## Test Coverage
- **12 tests total** for `review-pr` functionality
- Cover all code paths and edge cases
- Ensure build passes with no errors