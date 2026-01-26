// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Command Auto-Completion
 *
 * Provides tab-completion for slash commands in the REPL.
 * Supports:
 * - Command name completion (/br<TAB> -> /branch)
 * - Subcommand completion (/branch cr<TAB> -> /branch create)
 * - Static argument completion (/models an<TAB> -> /models anthropic)
 * - Flag completion (/models --<TAB> -> /models --local)
 * - Dynamic completion (git branches, session names)
 */

import { execSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { getAllCommands } from './commands/index.js';
import { CodiPaths } from './paths.js';

/**
 * Pre-defined subcommands for commands that support them.
 */
const COMMAND_SUBCOMMANDS: Record<string, string[]> = {
  // Consolidated commands
  git: ['commit', 'branch', 'diff', 'pr', 'stash', 'log', 'status', 'undo', 'merge', 'rebase'],
  code: ['refactor', 'fix', 'test', 'doc', 'optimize'],
  prompt: ['explain', 'review', 'analyze', 'summarize', 'help'],
  // Alias commands with subcommands
  branch: ['list', 'create', 'switch', 'delete', 'rename'],
  stash: ['save', 'list', 'pop', 'apply', 'drop', 'clear'],
  undo: ['commits', 'staged', 'file'],
  // Other commands
  config: ['init', 'show', 'example'],
  modelmap: ['init', 'show', 'example'],
  usage: ['session', 'today', 'week', 'month', 'all', 'recent', 'reset', 'clear'],
  sessions: ['info', 'delete', 'clear'],
  rag: ['rebuild', 'update', 'stats', 'search', 'clear'],
  index: ['rebuild', 'update', 'stats', 'search', 'clear'],
  symbols: ['rebuild', 'update', 'stats', 'search', 'clear'],
  filehistory: ['clear'],
  plugins: ['info', 'dir'],
  profile: ['set'],
  compact: ['status', 'summarize', 'compress'],
};

/**
 * Static arguments for commands.
 */
const COMMAND_STATIC_ARGS: Record<string, string[]> = {
  models: ['anthropic', 'openai', 'ollama'],
  switch: ['anthropic', 'openai', 'ollama'],
  commit: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore'],
  new: ['component', 'hook', 'page', 'api', 'service', 'util', 'test'],
};

/**
 * Command-specific flags.
 */
const COMMAND_FLAGS: Record<string, string[]> = {
  models: ['--local'],
  symbols: [],
  pipeline: ['--provider', '--all'],
};

/**
 * Commands that support git branch completion.
 */
const GIT_BRANCH_COMMANDS = ['git', 'branch', 'merge', 'rebase', 'checkout', 'diff'];

/**
 * Commands that support session name completion.
 */
const SESSION_COMMANDS = ['load', 'sessions'];

/**
 * Get git branch names synchronously.
 * Returns empty array if not in a git repo or on error.
 */
function getGitBranches(): string[] {
  try {
    const output = execSync('git branch --format="%(refname:short)"', {
      encoding: 'utf-8',
      timeout: 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output
      .split('\n')
      .map(b => b.trim())
      .filter(b => b.length > 0);
  } catch {
    return [];
  }
}

/**
 * Get session names from ~/.codi/sessions/.
 */
function getSessionNames(): string[] {
  const sessionsDir = CodiPaths.sessions();
  if (!existsSync(sessionsDir)) return [];
  try {
    return readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

/**
 * Create a completer function for readline.
 * The completer is called on TAB press and returns matching completions.
 *
 * @returns A completer function compatible with readline's completer option
 */
export function createCompleter(): (line: string) => [string[], string] {
  // Cache command names at creation time for performance
  const allCommands = getAllCommands();
  const commandNames: string[] = [];

  for (const cmd of allCommands) {
    commandNames.push(cmd.name);
    if (cmd.aliases) {
      commandNames.push(...cmd.aliases);
    }
  }

  // Sort for consistent ordering
  commandNames.sort();

  return (line: string): [string[], string] => {
    // Only complete slash commands
    if (!line.startsWith('/')) {
      return [[], line];
    }

    const trimmed = line.slice(1); // Remove leading /
    const parts = trimmed.split(/\s+/);
    const isTypingArg = trimmed.endsWith(' ') || parts.length > 1;

    // Complete command names
    if (!isTypingArg) {
      const partial = parts[0].toLowerCase();
      const matches = commandNames
        .filter(name => name.startsWith(partial))
        .map(name => `/${name} `);
      return [matches.length > 0 ? matches : [], line];
    }

    // Complete arguments for the command
    const cmdName = parts[0].toLowerCase();
    const argParts = parts.slice(1).filter(p => p.length > 0); // Filter out empty strings
    const currentArg = trimmed.endsWith(' ') ? '' : (argParts[argParts.length - 1] || '');
    const completedArgs = trimmed.endsWith(' ') ? argParts : argParts.slice(0, -1);

    // Collect all possible completions
    const completions: string[] = [];

    // Add subcommands (only for first argument position)
    if (completedArgs.length === 0) {
      const subcommands = COMMAND_SUBCOMMANDS[cmdName] || [];
      completions.push(...subcommands.filter(s => s.startsWith(currentArg)));
    }

    // Add static args
    const staticArgs = COMMAND_STATIC_ARGS[cmdName] || [];
    completions.push(...staticArgs.filter(s => s.startsWith(currentArg)));

    // Add flags (when typing something that starts with -)
    if (currentArg.startsWith('-') || currentArg === '') {
      const flags = COMMAND_FLAGS[cmdName] || [];
      completions.push(...flags.filter(f => f.startsWith(currentArg)));

      // Add universal -h and --help flags
      if ('-h'.startsWith(currentArg) && !completions.includes('-h')) {
        completions.push('-h');
      }
      if ('--help'.startsWith(currentArg) && !completions.includes('--help')) {
        completions.push('--help');
      }
    }

    // Dynamic completions: git branches
    if (GIT_BRANCH_COMMANDS.includes(cmdName)) {
      const branches = getGitBranches();
      completions.push(...branches.filter(b => b.startsWith(currentArg)));
    }

    // Dynamic completions: session names
    if (SESSION_COMMANDS.includes(cmdName)) {
      const sessions = getSessionNames();
      completions.push(...sessions.filter(s => s.startsWith(currentArg)));
    }

    // Remove duplicates and sort
    const uniqueCompletions = [...new Set(completions)].sort();

    // Build full completions with command prefix
    let prefix = `/${cmdName}`;
    if (completedArgs.length > 0) {
      prefix += ' ' + completedArgs.join(' ');
    }
    prefix += ' ';
    const fullCompletions = uniqueCompletions.map(c => prefix + c);

    return [fullCompletions, line];
  };
}

/**
 * Complete a single line and return the completed value or null if no completion.
 * This is designed for Ink UI where we need a simpler interface.
 *
 * @param line - The current input line
 * @returns The completed value, the common prefix, or null if no completion
 */
export function completeLine(line: string): string | null {
  const [matches] = createCompleter()(line);
  
  if (matches.length === 0) {
    return null;
  }
  
  if (matches.length === 1) {
    return matches[0].trim(); // Remove trailing space for single match
  }
  
  // Return the common prefix without trailing space
  return getCommonPrefix(matches).trim();
}

/**
 * Get all completion matches for a line.
 * This is useful for showing completion hints.
 *
 * @param line - The current input line
 * @returns Array of completion matches
 */
export function getCompletionMatches(line: string): string[] {
  const [matches] = createCompleter()(line);
  return matches;
}

/**
 * Get the common prefix of all completion matches.
 *
 * @param matches - Array of completion strings
 * @returns The common prefix
 */
export function getCommonPrefix(matches: string[]): string {
  if (matches.length === 0) return '';
  if (matches.length === 1) return matches[0];
  
  let prefix = matches[0];
  for (let i = 1; i < matches.length; i++) {
    const value = matches[i];
    let j = 0;
    while (j < prefix.length && j < value.length && prefix[j] === value[j]) {
      j += 1;
    }
    prefix = prefix.slice(0, j);
    if (!prefix) return '';
  }
  return prefix;
}

/**
 * Get all available command names (including aliases).
 * Useful for external tools that need command list.
 */
export function getCommandNames(): string[] {
  const allCommands = getAllCommands();
  const names: string[] = [];

  for (const cmd of allCommands) {
    names.push(cmd.name);
    if (cmd.aliases) {
      names.push(...cmd.aliases);
    }
  }

  return names.sort();
}

/**
 * Get subcommands for a specific command.
 */
export function getSubcommands(cmdName: string): string[] {
  return COMMAND_SUBCOMMANDS[cmdName.toLowerCase()] || [];
}

/**
 * Get static args for a specific command.
 */
export function getStaticArgs(cmdName: string): string[] {
  return COMMAND_STATIC_ARGS[cmdName.toLowerCase()] || [];
}

/**
 * Get flags for a specific command.
 */
export function getFlags(cmdName: string): string[] {
  return COMMAND_FLAGS[cmdName.toLowerCase()] || [];
}
