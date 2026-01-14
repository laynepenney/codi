import type { Agent } from '../agent.js';

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  taskType?: string; // Task type for model map routing
  execute: (args: string, context: CommandContext) => Promise<string | null>;
}

function shouldShowHelp(args: string): boolean {
  const trimmed = args.trim().toLowerCase();
  return trimmed === 'help' || trimmed === '--help' || trimmed === '-h' || trimmed === '?';
}

/**
 * Session state passed to commands via context.
 * This replaces the global state pattern in session-commands.ts.
 */
export interface SessionState {
  currentName: string | null;
  provider: string;
  model: string;
}

export interface CommandContext {
  projectInfo: ProjectInfo | null;
  /** Agent reference for commands that need access to conversation history */
  agent?: Agent;
  /** Session state for session-related commands */
  sessionState?: SessionState;
  /** Callback to update session name after save/load */
  setSessionName?: (name: string | null) => void;
}

export interface ProjectInfo {
  type: 'node' | 'python' | 'rust' | 'go' | 'unknown';
  name: string;
  framework?: string;
  language: string;
  rootPath: string;
  mainFiles: string[];
}

// Command registry
const commands: Map<string, Command> = new Map();

export function registerCommand(command: Command): void {
  // Wrap the command so every command supports a standard help subcommand.
  // This avoids duplicating help logic across individual command files.
  const wrapped: Command = {
    ...command,
    execute: async (args: string, context: CommandContext): Promise<string | null> => {
      if (shouldShowHelp(args)) {
        // Display help locally and return null to avoid API calls
        const usage = command.usage?.trim();
        if (usage) {
          console.log(`\nUsage: ${usage}`);
          if (command.description) {
            console.log(`\n${command.description}`);
          }
          console.log();
        } else {
          console.log(`\nNo help available for /${command.name}.\n`);
        }
        return null;
      }

      return command.execute(args, context);
    },
  };

  commands.set(command.name, wrapped);
  if (command.aliases) {
    for (const alias of command.aliases) {
      commands.set(alias, wrapped);
    }
  }
}

export function getCommand(name: string): Command | undefined {
  return commands.get(name);
}

export function getAllCommands(): Command[] {
  // Return unique commands (filter out aliases)
  const seen = new Set<string>();
  const result: Command[] = [];
  for (const cmd of commands.values()) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      result.push(cmd);
    }
  }
  return result;
}

export function isCommand(input: string): boolean {
  return input.startsWith('/') && !input.startsWith('//');
}

export function parseCommand(input: string): { name: string; args: string } | null {
  if (!isCommand(input)) return null;

  const trimmed = input.slice(1).trim(); // Remove leading /
  const spaceIndex = trimmed.indexOf(' ');

  if (spaceIndex === -1) {
    return { name: trimmed.toLowerCase(), args: '' };
  }

  return {
    name: trimmed.slice(0, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}
