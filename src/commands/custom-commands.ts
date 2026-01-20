// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { registerCommand, type Command, type CommandContext } from './index.js';

/**
 * Custom command template argument definition.
 */
interface CommandArg {
  name: string;
  required?: boolean;
  description?: string;
  default?: string;
}

/**
 * Parsed custom command metadata from YAML frontmatter.
 */
interface CustomCommandMeta {
  name: string;
  description?: string;
  aliases?: string[];
  args?: CommandArg[];
}

/**
 * Parsed custom command with metadata and template.
 */
interface CustomCommand {
  meta: CustomCommandMeta;
  template: string;
  filePath: string;
}

// Directory where custom commands are stored
const CUSTOM_COMMANDS_DIR = join(homedir(), '.codi', 'commands');

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the parsed metadata and the remaining content.
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { meta: {}, body: content };
  }

  const [, yamlContent, body] = match;
  const meta: Record<string, unknown> = {};

  // Simple YAML parser for our specific format
  const lines = yamlContent.split('\n');
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for array item
    if (trimmed.startsWith('- ')) {
      if (currentArray !== null) {
        const itemContent = trimmed.slice(2).trim();
        // Check if it's a simple value or an object
        if (itemContent.includes(':')) {
          // It's an inline object like "- name: foo"
          const obj: Record<string, string | boolean | number> = {};
          // Parse the first key-value on this line
          const colonIdx = itemContent.indexOf(':');
          const key = itemContent.slice(0, colonIdx).trim();
          const value = itemContent.slice(colonIdx + 1).trim();
          obj[key] = parseYamlValue(value);
          currentArray.push(obj);
        } else {
          currentArray.push(parseYamlValue(itemContent));
        }
      }
      continue;
    }

    // Check for key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (value === '') {
        // Start of an array or nested object
        currentKey = key;
        currentArray = [];
        meta[key] = currentArray;
      } else {
        currentKey = null;
        currentArray = null;
        meta[key] = parseYamlValue(value);
      }
    }
  }

  return { meta, body };
}

/**
 * Parse a simple YAML value (string, boolean, number).
 */
function parseYamlValue(value: string): string | boolean | number {
  // Handle quoted strings
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Handle booleans
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Handle numbers
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value;
}

/**
 * Parse a custom command file.
 */
function parseCustomCommand(filePath: string): CustomCommand | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(content);

    // Validate required fields
    const name = meta.name as string;
    if (!name) {
      console.warn(`Custom command at ${filePath} missing 'name' in frontmatter`);
      return null;
    }

    return {
      meta: {
        name,
        description: meta.description as string | undefined,
        aliases: meta.aliases as string[] | undefined,
        args: meta.args as CommandArg[] | undefined,
      },
      template: body.trim(),
      filePath,
    };
  } catch (error) {
    console.warn(`Failed to parse custom command at ${filePath}:`, error);
    return null;
  }
}

/**
 * Substitute argument values into the template.
 * Supports $ARG_NAME and ${ARG_NAME} syntax.
 */
function substituteArgs(template: string, argValues: Map<string, string>): string {
  let result = template;

  for (const [name, value] of argValues) {
    // Replace both $ARG_NAME and ${ARG_NAME} formats
    const upperName = name.toUpperCase();
    result = result.replace(new RegExp(`\\$\\{${upperName}\\}`, 'g'), value);
    result = result.replace(new RegExp(`\\$${upperName}`, 'g'), value);
    // Also support lowercase
    result = result.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), value);
    result = result.replace(new RegExp(`\\$${name}`, 'g'), value);
  }

  return result;
}

/**
 * Parse arguments from the command input.
 * Supports both positional args and named args (--name=value or --name value).
 */
function parseArgs(
  input: string,
  argDefs: CommandArg[]
): { values: Map<string, string>; errors: string[] } {
  const values = new Map<string, string>();
  const errors: string[] = [];
  const tokens = tokenize(input);

  const positionalArgs = argDefs.filter((a) => !a.name.startsWith('--'));
  let positionalIdx = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.startsWith('--')) {
      // Named argument
      const eqIdx = token.indexOf('=');
      if (eqIdx !== -1) {
        // --name=value format
        const name = token.slice(2, eqIdx);
        const value = token.slice(eqIdx + 1);
        values.set(name, value);
      } else {
        // --name value format
        const name = token.slice(2);
        if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
          values.set(name, tokens[++i]);
        } else {
          values.set(name, 'true'); // Flag without value
        }
      }
    } else {
      // Positional argument
      if (positionalIdx < positionalArgs.length) {
        values.set(positionalArgs[positionalIdx].name, token);
        positionalIdx++;
      }
    }
  }

  // Apply defaults and check required args
  for (const arg of argDefs) {
    if (!values.has(arg.name)) {
      if (arg.default !== undefined) {
        values.set(arg.name, arg.default);
      } else if (arg.required) {
        errors.push(`Missing required argument: ${arg.name}`);
      }
    }
  }

  return { values, errors };
}

/**
 * Tokenize input string, respecting quotes.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (const char of input) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Create a Command from a CustomCommand.
 */
function createCommandFromCustom(custom: CustomCommand): Command {
  const { meta, template } = custom;

  // Build usage string
  let usage = `/${meta.name}`;
  if (meta.args) {
    for (const arg of meta.args) {
      if (arg.required) {
        usage += ` <${arg.name}>`;
      } else {
        usage += ` [${arg.name}]`;
      }
    }
  }

  return {
    name: meta.name,
    aliases: meta.aliases,
    description: meta.description || `Custom command: ${meta.name}`,
    usage,
    execute: async (args: string, _context: CommandContext): Promise<string | null> => {
      const argDefs = meta.args || [];
      const { values, errors } = parseArgs(args, argDefs);

      if (errors.length > 0) {
        console.error(`Error: ${errors.join(', ')}`);
        console.log(`Usage: ${usage}`);
        return null;
      }

      // Substitute arguments into template
      const prompt = substituteArgs(template, values);
      return prompt;
    },
  };
}

/**
 * Load all custom commands from ~/.codi/commands/.
 */
export function loadCustomCommands(): CustomCommand[] {
  const commands: CustomCommand[] = [];

  // Create directory if it doesn't exist
  if (!existsSync(CUSTOM_COMMANDS_DIR)) {
    try {
      mkdirSync(CUSTOM_COMMANDS_DIR, { recursive: true });
    } catch {
      // Ignore errors creating directory
    }
    return commands;
  }

  try {
    const files = readdirSync(CUSTOM_COMMANDS_DIR);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = join(CUSTOM_COMMANDS_DIR, file);
      const command = parseCustomCommand(filePath);

      if (command) {
        commands.push(command);
      }
    }
  } catch (error) {
    console.warn('Failed to load custom commands:', error);
  }

  return commands;
}

/**
 * Register all custom commands.
 */
export function registerCustomCommands(): void {
  const customCommands = loadCustomCommands();

  for (const custom of customCommands) {
    const command = createCommandFromCustom(custom);
    registerCommand(command);
  }

  if (customCommands.length > 0) {
    // Log loaded commands at debug level (if debug logging is enabled)
    // console.debug(`Loaded ${customCommands.length} custom command(s)`);
  }
}

/**
 * Get the path to the custom commands directory.
 */
export function getCustomCommandsDir(): string {
  return CUSTOM_COMMANDS_DIR;
}

/**
 * List all custom commands (for /commands list).
 */
export function listCustomCommands(): { name: string; description: string; filePath: string }[] {
  const commands = loadCustomCommands();
  return commands.map((cmd) => ({
    name: cmd.meta.name,
    description: cmd.meta.description || 'No description',
    filePath: cmd.filePath,
  }));
}
