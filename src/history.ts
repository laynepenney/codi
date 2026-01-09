/**
 * File change history system for undo/redo functionality.
 * Tracks file modifications and allows reverting changes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

/** Maximum number of history entries to keep */
const MAX_HISTORY_SIZE = 50;

/** Directory where history is stored */
const HISTORY_DIR = path.join(homedir(), '.codi', 'history');

/**
 * Types of file operations that can be undone.
 */
export type OperationType = 'write' | 'edit' | 'delete' | 'create';

/**
 * A single history entry representing a file change.
 */
export interface HistoryEntry {
  /** Unique ID for this entry */
  id: string;
  /** Type of operation */
  operation: OperationType;
  /** Absolute path to the file */
  filePath: string;
  /** Original content before the change (null for create) */
  originalContent: string | null;
  /** New content after the change (null for delete) */
  newContent: string | null;
  /** Timestamp of the operation */
  timestamp: string;
  /** Description of the change */
  description: string;
  /** Whether this change has been undone */
  undone: boolean;
}

/**
 * History index file structure.
 */
interface HistoryIndex {
  entries: HistoryEntry[];
  version: number;
}

/**
 * Get the path to the history index file.
 */
function getIndexPath(): string {
  return path.join(HISTORY_DIR, 'index.json');
}

/**
 * Get the path to a backup file.
 */
function getBackupPath(id: string): string {
  return path.join(HISTORY_DIR, 'backups', `${id}.backup`);
}

/**
 * Ensure the history directory exists.
 */
function ensureHistoryDir(): void {
  const backupsDir = path.join(HISTORY_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
}

/**
 * Load the history index.
 */
function loadIndex(): HistoryIndex {
  ensureHistoryDir();
  const indexPath = getIndexPath();

  if (!fs.existsSync(indexPath)) {
    return { entries: [], version: 1 };
  }

  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(content) as HistoryIndex;
  } catch {
    return { entries: [], version: 1 };
  }
}

/**
 * Save the history index.
 */
function saveIndex(index: HistoryIndex): void {
  ensureHistoryDir();
  fs.writeFileSync(getIndexPath(), JSON.stringify(index, null, 2));
}

/**
 * Generate a unique ID for a history entry.
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Clean up old history entries beyond the maximum size.
 */
function pruneHistory(index: HistoryIndex): void {
  if (index.entries.length <= MAX_HISTORY_SIZE) {
    return;
  }

  // Remove oldest entries
  const toRemove = index.entries.slice(0, index.entries.length - MAX_HISTORY_SIZE);
  index.entries = index.entries.slice(-MAX_HISTORY_SIZE);

  // Delete backup files for removed entries
  for (const entry of toRemove) {
    const backupPath = getBackupPath(entry.id);
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Record a file change in history.
 * Call this BEFORE making the change to capture the original state.
 */
export function recordChange(options: {
  operation: OperationType;
  filePath: string;
  newContent: string | null;
  description: string;
}): string {
  const { operation, filePath, newContent, description } = options;
  const absolutePath = path.resolve(process.cwd(), filePath);

  // Read original content if file exists
  let originalContent: string | null = null;
  if (fs.existsSync(absolutePath)) {
    try {
      originalContent = fs.readFileSync(absolutePath, 'utf-8');
    } catch {
      // If we can't read it, treat as null
    }
  }

  const id = generateId();
  const entry: HistoryEntry = {
    id,
    operation,
    filePath: absolutePath,
    originalContent,
    newContent,
    timestamp: new Date().toISOString(),
    description,
    undone: false,
  };

  // Save the original content as a backup file
  if (originalContent !== null) {
    ensureHistoryDir();
    fs.writeFileSync(getBackupPath(id), originalContent);
  }

  // Add to index
  const index = loadIndex();
  index.entries.push(entry);
  pruneHistory(index);
  saveIndex(index);

  return id;
}

/**
 * Undo the most recent change (or a specific change by ID).
 * Returns the undone entry or null if nothing to undo.
 */
export function undoChange(entryId?: string): HistoryEntry | null {
  const index = loadIndex();

  let entry: HistoryEntry | undefined;

  if (entryId) {
    // Find specific entry
    entry = index.entries.find(e => e.id === entryId && !e.undone);
  } else {
    // Find most recent non-undone entry
    for (let i = index.entries.length - 1; i >= 0; i--) {
      if (!index.entries[i].undone) {
        entry = index.entries[i];
        break;
      }
    }
  }

  if (!entry) {
    return null;
  }

  // Restore the original content
  try {
    if (entry.originalContent === null) {
      // Original was a create - delete the file
      if (fs.existsSync(entry.filePath)) {
        fs.unlinkSync(entry.filePath);
      }
    } else {
      // Restore original content from backup
      const backupPath = getBackupPath(entry.id);
      let contentToRestore = entry.originalContent;

      // Prefer backup file if it exists (more reliable for large files)
      if (fs.existsSync(backupPath)) {
        contentToRestore = fs.readFileSync(backupPath, 'utf-8');
      }

      // Ensure parent directory exists
      const dir = path.dirname(entry.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(entry.filePath, contentToRestore);
    }

    // Mark as undone
    entry.undone = true;
    saveIndex(index);

    return entry;
  } catch (error) {
    throw new Error(`Failed to undo: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Redo an undone change.
 * Returns the redone entry or null if nothing to redo.
 */
export function redoChange(entryId?: string): HistoryEntry | null {
  const index = loadIndex();

  let entry: HistoryEntry | undefined;

  if (entryId) {
    // Find specific entry
    entry = index.entries.find(e => e.id === entryId && e.undone);
  } else {
    // Find oldest undone entry (redo in order)
    entry = index.entries.find(e => e.undone);
  }

  if (!entry) {
    return null;
  }

  // Reapply the change
  try {
    if (entry.newContent === null) {
      // Was a delete - delete the file again
      if (fs.existsSync(entry.filePath)) {
        fs.unlinkSync(entry.filePath);
      }
    } else {
      // Rewrite the new content
      const dir = path.dirname(entry.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(entry.filePath, entry.newContent);
    }

    // Mark as not undone
    entry.undone = false;
    saveIndex(index);

    return entry;
  } catch (error) {
    throw new Error(`Failed to redo: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Get the history of file changes.
 * @param limit - Maximum number of entries to return
 * @param includeUndone - Whether to include undone entries
 */
export function getHistory(limit: number = 20, includeUndone: boolean = true): HistoryEntry[] {
  const index = loadIndex();
  let entries = index.entries;

  if (!includeUndone) {
    entries = entries.filter(e => !e.undone);
  }

  // Return most recent first
  return entries.slice(-limit).reverse();
}

/**
 * Get history entries for a specific file.
 */
export function getFileHistory(filePath: string, limit: number = 10): HistoryEntry[] {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const index = loadIndex();

  return index.entries
    .filter(e => e.filePath === absolutePath)
    .slice(-limit)
    .reverse();
}

/**
 * Clear all history.
 */
export function clearHistory(): number {
  const index = loadIndex();
  const count = index.entries.length;

  // Delete all backup files
  const backupsDir = path.join(HISTORY_DIR, 'backups');
  if (fs.existsSync(backupsDir)) {
    try {
      fs.rmSync(backupsDir, { recursive: true });
    } catch {
      // Ignore errors
    }
  }

  // Clear index
  index.entries = [];
  saveIndex(index);

  return count;
}

/**
 * Get the number of available undo operations.
 */
export function getUndoCount(): number {
  const index = loadIndex();
  return index.entries.filter(e => !e.undone).length;
}

/**
 * Get the number of available redo operations.
 */
export function getRedoCount(): number {
  const index = loadIndex();
  return index.entries.filter(e => e.undone).length;
}

/**
 * Format a history entry for display.
 */
export function formatHistoryEntry(entry: HistoryEntry): string {
  const date = new Date(entry.timestamp);
  const timeStr = date.toLocaleTimeString();
  const fileName = path.basename(entry.filePath);
  const status = entry.undone ? ' (undone)' : '';

  return `[${timeStr}] ${entry.operation} ${fileName}${status} - ${entry.description}`;
}

/**
 * Get the history directory path.
 */
export function getHistoryDir(): string {
  return HISTORY_DIR;
}
