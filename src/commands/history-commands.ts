/**
 * Undo/Redo and history management commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  undoChange,
  redoChange,
  getHistory,
  getFileHistory,
  clearHistory,
  getUndoCount,
  getRedoCount,
  formatHistoryEntry,
  getHistoryDir,
} from '../history.js';
import * as path from 'path';

/**
 * /undo command - Undo the last file change.
 */
export const undoCommand: Command = {
  name: 'fileundo',
  aliases: ['fu'],
  description: 'Undo the last file change made by Codi',
  usage: '/fileundo',
  execute: async (_args: string, _context: CommandContext): Promise<string> => {
    const entry = undoChange();

    if (!entry) {
      return '__UNDO_NOTHING__';
    }

    const fileName = path.basename(entry.filePath);
    return `__UNDO_SUCCESS__:${fileName}:${entry.operation}:${entry.description}`;
  },
};

/**
 * /redo command - Redo an undone file change.
 */
export const redoCommand: Command = {
  name: 'redo',
  aliases: [],
  description: 'Redo an undone file change',
  usage: '/redo',
  execute: async (_args: string, _context: CommandContext): Promise<string> => {
    const entry = redoChange();

    if (!entry) {
      return '__REDO_NOTHING__';
    }

    const fileName = path.basename(entry.filePath);
    return `__REDO_SUCCESS__:${fileName}:${entry.operation}:${entry.description}`;
  },
};

/**
 * /history command - Show file change history.
 */
export const historyCommand: Command = {
  name: 'filehistory',
  aliases: ['fh'],
  description: 'Show file change history',
  usage: '/filehistory [file] | /filehistory clear',
  execute: async (args: string, _context: CommandContext): Promise<string> => {
    const trimmed = args.trim();

    // Handle subcommands
    if (trimmed === 'clear') {
      const count = clearHistory();
      return `__HISTORY_CLEARED__:${count}`;
    }

    if (trimmed === 'dir') {
      return `__HISTORY_DIR__:${getHistoryDir()}`;
    }

    if (trimmed === 'status') {
      const undoCount = getUndoCount();
      const redoCount = getRedoCount();
      return `__HISTORY_STATUS__:${undoCount}:${redoCount}`;
    }

    // If a file path is given, show history for that file
    if (trimmed) {
      const entries = getFileHistory(trimmed, 20);

      if (entries.length === 0) {
        return `__HISTORY_FILE_EMPTY__:${trimmed}`;
      }

      const lines = entries.map(formatHistoryEntry);
      return `__HISTORY_FILE__:${trimmed}\n${lines.join('\n')}`;
    }

    // Show general history
    const entries = getHistory(20, true);

    if (entries.length === 0) {
      return '__HISTORY_EMPTY__';
    }

    const lines = entries.map(formatHistoryEntry);
    const undoCount = getUndoCount();
    const redoCount = getRedoCount();

    return `__HISTORY_LIST__:${undoCount}:${redoCount}\n${lines.join('\n')}`;
  },
};

/**
 * Register all history commands.
 */
export function registerHistoryCommands(): void {
  registerCommand(undoCommand);
  registerCommand(redoCommand);
  registerCommand(historyCommand);
}
