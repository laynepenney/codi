import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Message } from './types.js';

const SESSIONS_DIR = path.join(os.homedir(), '.codi', 'sessions');

/**
 * Represents a saved conversation session.
 */
export interface Session {
  name: string;
  createdAt: string;
  updatedAt: string;
  projectPath: string;
  projectName?: string;
  provider?: string;
  model?: string;
  messages: Message[];
  conversationSummary: string | null;
}

/**
 * Session metadata for listing (without full message history).
 */
export interface SessionInfo {
  name: string;
  createdAt: string;
  updatedAt: string;
  projectPath: string;
  projectName?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  hasSummary: boolean;
}

/**
 * Ensure the sessions directory exists.
 */
function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Get the file path for a session.
 */
function getSessionPath(name: string): string {
  // Sanitize name for filesystem
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(SESSIONS_DIR, `${safeName}.json`);
}

/**
 * Generate a default session name based on timestamp.
 */
export function generateSessionName(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `session-${date}-${time}`;
}

/**
 * Save a session to disk.
 */
export function saveSession(
  name: string,
  messages: Message[],
  conversationSummary: string | null,
  options: {
    projectPath?: string;
    projectName?: string;
    provider?: string;
    model?: string;
  } = {}
): { path: string; isNew: boolean } {
  ensureSessionsDir();

  const sessionPath = getSessionPath(name);
  const isNew = !fs.existsSync(sessionPath);
  const now = new Date().toISOString();

  // Load existing session to preserve createdAt
  let createdAt = now;
  if (!isNew) {
    try {
      const existing = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as Session;
      createdAt = existing.createdAt;
    } catch {
      // Ignore errors, use current time
    }
  }

  const session: Session = {
    name,
    createdAt,
    updatedAt: now,
    projectPath: options.projectPath || process.cwd(),
    projectName: options.projectName,
    provider: options.provider,
    model: options.model,
    messages,
    conversationSummary,
  };

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

  return { path: sessionPath, isNew };
}

/**
 * Load a session from disk.
 */
export function loadSession(name: string): Session | null {
  const sessionPath = getSessionPath(name);

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(sessionPath, 'utf-8');
    return JSON.parse(content) as Session;
  } catch {
    return null;
  }
}

/**
 * Delete a session from disk.
 */
export function deleteSession(name: string): boolean {
  const sessionPath = getSessionPath(name);

  if (!fs.existsSync(sessionPath)) {
    return false;
  }

  try {
    fs.unlinkSync(sessionPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all saved sessions.
 */
export function listSessions(): SessionInfo[] {
  ensureSessionsDir();

  const sessions: SessionInfo[] = [];

  try {
    const files = fs.readdirSync(SESSIONS_DIR);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(SESSIONS_DIR, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const session = JSON.parse(content) as Session;

        sessions.push({
          name: session.name,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          projectPath: session.projectPath,
          projectName: session.projectName,
          provider: session.provider,
          model: session.model,
          messageCount: session.messages.length,
          hasSummary: session.conversationSummary !== null,
        });
      } catch {
        // Skip invalid session files
      }
    }
  } catch {
    // Return empty array if directory can't be read
  }

  // Sort by updatedAt descending (most recent first)
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return sessions;
}

/**
 * Find sessions matching a pattern.
 */
export function findSessions(pattern: string): SessionInfo[] {
  const all = listSessions();
  const lowerPattern = pattern.toLowerCase();

  return all.filter(s =>
    s.name.toLowerCase().includes(lowerPattern) ||
    s.projectName?.toLowerCase().includes(lowerPattern) ||
    s.projectPath.toLowerCase().includes(lowerPattern)
  );
}

/**
 * Get the sessions directory path.
 */
export function getSessionsDir(): string {
  return SESSIONS_DIR;
}

/**
 * Format a session info for display.
 */
export function formatSessionInfo(info: SessionInfo): string {
  const date = new Date(info.updatedAt);
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let display = `${info.name}`;
  display += ` (${info.messageCount} msgs`;
  if (info.hasSummary) display += ', has summary';
  display += ')';
  display += ` - ${dateStr} ${timeStr}`;

  if (info.projectName) {
    display += ` [${info.projectName}]`;
  }

  return display;
}
