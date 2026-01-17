// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Interactive Command Picker
 *
 * Provides a searchable, navigable list of available commands
 * when the user types just "/" in the REPL.
 */

import { search } from '@inquirer/prompts';
import { getAllCommands, type Command } from './commands/index.js';

interface CommandChoice {
  name: string;
  value: string;
  description: string;
}

/**
 * Built-in commands that aren't in the registry but should be shown.
 */
const BUILTIN_COMMANDS: CommandChoice[] = [
  { name: '/help', value: '/help', description: 'Show help message and available commands' },
  { name: '/clear', value: '/clear', description: 'Clear conversation history and start fresh' },
  { name: '/compact', value: '/compact', description: 'Summarize old messages to save context tokens' },
  { name: '/status', value: '/status', description: 'Show current context usage and token count' },
  { name: '/context', value: '/context', description: 'Show detected project context' },
  { name: '/exit', value: '/exit', description: 'Exit the assistant' },
];

/**
 * Get all commands as choices for the picker.
 */
function getCommandChoices(): CommandChoice[] {
  const registeredCommands = getAllCommands();

  const commandChoices: CommandChoice[] = registeredCommands.map((cmd: Command) => ({
    name: `/${cmd.name}`,
    value: `/${cmd.name} `,
    description: cmd.description,
  }));

  // Combine built-in and registered commands
  const allChoices = [...BUILTIN_COMMANDS, ...commandChoices];

  // Sort alphabetically by name
  allChoices.sort((a, b) => a.name.localeCompare(b.name));

  return allChoices;
}

/**
 * Show an interactive command picker and return the selected command.
 *
 * @returns The selected command string, or null if cancelled
 */
export async function showCommandPicker(): Promise<string | null> {
  const choices = getCommandChoices();

  try {
    const selected = await search({
      message: 'Select a command',
      source: async (input) => {
        const searchTerm = (input || '').toLowerCase();

        return choices
          .filter(
            (choice) =>
              choice.name.toLowerCase().includes(searchTerm) ||
              choice.description.toLowerCase().includes(searchTerm),
          )
          .map((choice) => ({
            name: `${choice.name.padEnd(20)} ${choice.description}`,
            value: choice.value,
            description: choice.description,
          }));
      },
    });

    return selected;
  } catch {
    // User cancelled (Ctrl+C) or other error
    return null;
  }
}
