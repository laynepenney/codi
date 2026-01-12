/**
 * Memory commands for persistent user context and personalization.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  loadProfile,
  updateProfile,
  loadMemories,
  addMemory,
  removeMemories,
  searchMemories,
  clearMemories,
  getMemoryPaths,
  consolidateSessionNotes,
  type UserProfile,
  type MemoryEntry,
} from '../memory.js';

/**
 * Format profile for display.
 */
function formatProfile(profile: UserProfile): string {
  if (Object.keys(profile).length === 0) {
    return 'No profile set. Use /profile set <key> <value> to add information.';
  }

  const lines: string[] = [];

  if (profile.name) {
    lines.push(`Name: ${profile.name}`);
  }

  if (profile.preferences) {
    lines.push('Preferences:');
    for (const [key, value] of Object.entries(profile.preferences)) {
      if (value) lines.push(`  ${key}: ${value}`);
    }
  }

  if (profile.expertise && profile.expertise.length > 0) {
    lines.push(`Expertise: ${profile.expertise.join(', ')}`);
  }

  if (profile.avoid && profile.avoid.length > 0) {
    lines.push(`Avoid: ${profile.avoid.join(', ')}`);
  }

  if (profile.custom) {
    for (const [key, value] of Object.entries(profile.custom)) {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format memories for display.
 */
function formatMemories(memories: MemoryEntry[]): string {
  if (memories.length === 0) {
    return 'No memories stored. Use /remember <fact> to add one.';
  }

  const lines: string[] = [`${memories.length} memories:`];

  // Group by category
  const byCategory = new Map<string, MemoryEntry[]>();
  const uncategorized: MemoryEntry[] = [];

  for (const memory of memories) {
    if (memory.category) {
      const list = byCategory.get(memory.category) || [];
      list.push(memory);
      byCategory.set(memory.category, list);
    } else {
      uncategorized.push(memory);
    }
  }

  for (const [category, items] of byCategory) {
    lines.push(`\n[${category}]`);
    for (const item of items) {
      lines.push(`  - ${item.content}`);
    }
  }

  if (uncategorized.length > 0) {
    if (byCategory.size > 0) lines.push('\n[General]');
    for (const item of uncategorized) {
      lines.push(`  - ${item.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * /remember command - Add a memory.
 */
export const rememberCommand: Command = {
  name: 'remember',
  aliases: ['mem', 'note'],
  description: 'Remember a fact or preference for future sessions',
  usage: `/remember [category:] <fact>

Examples:
  /remember Prefers TypeScript over JavaScript
  /remember project: Uses pnpm instead of npm
  /remember style: Likes functional programming
  /remember avoid: Don't use class components`,
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const input = args.trim();

    if (!input) {
      return '__MEMORY_ERROR__|Usage: /remember <fact> or /remember category: <fact>';
    }

    // Check for category prefix
    let category: string | undefined;
    let content = input;

    const categoryMatch = input.match(/^(\w+):\s*(.+)$/);
    if (categoryMatch) {
      category = categoryMatch[1];
      content = categoryMatch[2];
    }

    const entry = addMemory(content, category, 'user');

    return `__MEMORY_ADDED__|${entry.content}|${entry.category || ''}|${entry.timestamp}`;
  },
};

/**
 * /forget command - Remove memories.
 */
export const forgetCommand: Command = {
  name: 'forget',
  aliases: ['unmem'],
  description: 'Remove memories matching a pattern',
  usage: `/forget <pattern>

Examples:
  /forget TypeScript
  /forget all (clears all memories)`,
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const pattern = args.trim();

    if (!pattern) {
      return '__MEMORY_ERROR__|Usage: /forget <pattern> or /forget all';
    }

    if (pattern.toLowerCase() === 'all') {
      const count = clearMemories();
      return `__MEMORY_CLEARED__|${count}`;
    }

    const removed = removeMemories(pattern);

    if (removed === 0) {
      return `__MEMORY_NOTFOUND__|${pattern}`;
    }

    return `__MEMORY_REMOVED__|${removed}|${pattern}`;
  },
};

/**
 * /memories command - List or search memories.
 */
export const memoriesCommand: Command = {
  name: 'memories',
  aliases: ['mems'],
  description: 'List or search stored memories',
  usage: `/memories [search query]

Examples:
  /memories           - List all memories
  /memories react     - Search for memories about React
  /memories consolidate - Merge session notes into memories`,
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const query = args.trim();

    if (query.toLowerCase() === 'consolidate') {
      const count = consolidateSessionNotes();
      if (count === 0) {
        return '__MEMORY_CONSOLIDATED__|0';
      }
      return `__MEMORY_CONSOLIDATED__|${count}`;
    }

    let memories: MemoryEntry[];
    if (query) {
      memories = searchMemories(query);
    } else {
      memories = loadMemories();
    }

    const paths = getMemoryPaths();
    return `__MEMORIES_LIST__|${JSON.stringify(memories)}|${paths.memories}`;
  },
};

/**
 * /profile command - View or update user profile.
 */
export const profileCommand: Command = {
  name: 'profile',
  aliases: ['me'],
  description: 'View or update your user profile',
  usage: `/profile [set <key> <value>]

Keys:
  name                  - Your name
  preferences.language  - Preferred programming language
  preferences.style     - Coding style (functional, oop, etc.)
  preferences.verbosity - Response verbosity (concise, normal, detailed)
  expertise             - Add an area of expertise
  avoid                 - Add something to avoid

Examples:
  /profile                           - View current profile
  /profile set name Layne
  /profile set preferences.language TypeScript
  /profile set expertise React
  /profile set avoid class components`,
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const parts = args.trim().split(/\s+/);

    if (parts[0] === 'set' && parts.length >= 3) {
      const key = parts[1];
      const value = parts.slice(2).join(' ');
      const profile = updateProfile(key, value);
      return `__PROFILE_UPDATED__|${key}|${value}|${JSON.stringify(profile)}`;
    }

    const profile = loadProfile();
    const paths = getMemoryPaths();
    return `__PROFILE_SHOW__|${JSON.stringify(profile)}|${paths.profile}`;
  },
};

/**
 * Register all memory commands.
 */
export function registerMemoryCommands(): void {
  registerCommand(rememberCommand);
  registerCommand(forgetCommand);
  registerCommand(memoriesCommand);
  registerCommand(profileCommand);
}
