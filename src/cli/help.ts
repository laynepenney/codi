// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Help Display
 *
 * Displays the interactive CLI help text for users.
 */

import chalk from 'chalk';
import type { ProjectInfo } from '../commands/index.js';

/**
 * Prints the interactive CLI help text, including built-in commands, code
 * assistance commands, workflow commands, and (if available) detected project
 * info.
 *
 * @param projectInfo - Detected information about the current project, if any.
 */
export function showHelp(projectInfo: ProjectInfo | null): void {
  console.log(chalk.bold.cyan('\n⚡ Quick Shortcuts:'));
  console.log(chalk.dim('  !<command>             - Run shell commands directly (e.g., !ls, !git status, !npm test)'));
  console.log(chalk.dim('  ?[topic]               - Get help on commands or topics'));
  console.log(chalk.dim('  Ctrl+C                 - Send current line (don\'t start new line)'));
  console.log(chalk.dim('  ESC                    - Interrupt current AI processing and return to prompt'));
  console.log();

  console.log(chalk.bold('\nBuilt-in Commands:'));
  console.log(chalk.dim('  /help              - Show this help message'));
  console.log(chalk.dim('  /clear [what]      - Clear conversation (all|context|workingset)'));
  console.log(chalk.dim('  /compact [memory]   - Summarize old messages (add "memory" to check heap)'));
  console.log(chalk.dim('  /status            - Show current context usage'));
  console.log(chalk.dim('  /context           - Show detected project context'));
  console.log(chalk.dim('  /label [text|update|clear] - Set/show/regenerate conversation label'));
  console.log(chalk.dim('  /exit              - Exit the assistant'));

  console.log(chalk.bold('\nCode Assistance:'));
  console.log(chalk.dim('  /explain <file>    - Explain code in a file'));
  console.log(chalk.dim('  /refactor <file>   - Suggest refactoring improvements'));
  console.log(chalk.dim('  /fix <file> <issue>- Fix a bug or issue'));
  console.log(chalk.dim('  /test <file>       - Generate tests'));
  console.log(chalk.dim('  /review <file>     - Code review for a local file'));
  console.log(chalk.dim('  /review-pr <num>   - Review a GitHub pull request'));
  console.log(chalk.dim('  /doc <file>        - Generate documentation'));
  console.log(chalk.dim('  /optimize <file>   - Optimize for performance'));
  console.log(chalk.dim('  /new <type> <name>     - Create new component/file'));
  console.log(chalk.dim('  /scaffold <feature>- Scaffold a complete feature'));

  console.log(chalk.bold('\nGit:'));
  console.log(chalk.dim('  /commit [type]     - Generate commit message and commit'));
  console.log(chalk.dim('  /branch [action]   - Create, switch, list, delete branches'));
  console.log(chalk.dim('  /diff [target]     - Show and explain git differences'));
  console.log(chalk.dim('  /pr [base]         - Generate pull request description'));
  console.log(chalk.dim('  /stash [action]    - Manage git stash'));
  console.log(chalk.dim('  /log [target]      - Show and explain git history'));
  console.log(chalk.dim('  /gitstatus         - Detailed git status'));
  console.log(chalk.dim('  /undo [what]       - Safely undo git changes'));
  console.log(chalk.dim('  /merge <branch>    - Merge branches'));
  console.log(chalk.dim('  /rebase <branch>   - Rebase onto branch'));

  console.log(chalk.bold('\nSessions:'));
  console.log(chalk.dim('  /save [name]       - Save conversation to session'));
  console.log(chalk.dim('  /load <name>       - Load a saved session'));
  console.log(chalk.dim('  /sessions          - List saved sessions'));
  console.log(chalk.dim('  /sessions info     - Show current session info'));
  console.log(chalk.dim('  /sessions delete   - Delete a session'));

  console.log(chalk.bold('\nConfiguration:'));
  console.log(chalk.dim('  /config            - Show current workspace config'));
  console.log(chalk.dim('  /config init       - Create a .codi.json file'));
  console.log(chalk.dim('  /config example    - Show example configuration'));

  console.log(chalk.bold('\nPlugins:'));
  console.log(chalk.dim('  /plugins           - List loaded plugins'));
  console.log(chalk.dim('  /plugins info <n>  - Show details about a plugin'));
  console.log(chalk.dim('  /plugins dir       - Show plugins directory'));

  console.log(chalk.bold('\nUndo/History:'));
  console.log(chalk.dim('  /fileundo          - Undo the last file change'));
  console.log(chalk.dim('  /redo              - Redo an undone change'));
  console.log(chalk.dim('  /filehistory       - Show file change history'));
  console.log(chalk.dim('  /filehistory clear - Clear all history'));

  console.log(chalk.bold('\nMemory:'));
  console.log(chalk.dim('  /remember [cat:] <fact> - Remember a fact for future sessions'));
  console.log(chalk.dim('  /forget <pattern>  - Remove memories matching pattern'));
  console.log(chalk.dim('  /memories [query]  - List or search stored memories'));
  console.log(chalk.dim('  /profile [set k v] - View or update user profile'));

  console.log(chalk.bold('\nModels:'));
  console.log(chalk.dim('  /models [provider] - List available models'));
  console.log(chalk.dim('  /switch <model>    - Switch to a different model'));
  console.log(chalk.dim('  /modelmap          - Show model map configuration'));
  console.log(chalk.dim('  /pipeline [name]   - Execute multi-model pipeline'));

  console.log(chalk.bold('\nUsage & Cost:'));
  console.log(chalk.dim('  /usage [period]    - Show token usage and costs'));

  console.log(chalk.bold('\nMulti-Agent:'));
  console.log(chalk.dim('  /delegate <branch> <task> - Spawn worker in new worktree'));
  console.log(chalk.dim('  /workers           - List active workers'));
  console.log(chalk.dim('  /workers cancel    - Cancel a running worker'));
  console.log(chalk.dim('  /worktrees         - List managed worktrees'));

  console.log(chalk.bold('\nCode Navigation:'));
  console.log(chalk.dim('  /symbols [action]  - Manage symbol index (rebuild, stats, search)'));
  console.log(chalk.dim('  /rag [action]      - Manage RAG semantic search index'));

  console.log(chalk.bold('\nImport:'));
  console.log(chalk.dim('  /import <file>     - Import ChatGPT conversation exports'));

  if (projectInfo) {
    console.log(chalk.bold('\nProject:'));
    console.log(
      chalk.dim(
        `  ${projectInfo.name} (${projectInfo.language}${projectInfo.framework ? ` / ${projectInfo.framework}` : ''})`,
      ),
    );
  }
}
