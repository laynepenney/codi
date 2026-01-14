// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Message, ContentBlock } from './types.js';

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

  /**
   * Persistent list of user/agent "open" files (pinned + recent).
   * Used for context injection and for preserving relevant history.
   */
  openFilesState?: import('./open-files.js').OpenFilesState;
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
    openFilesState?: import('./open-files.js').OpenFilesState;
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
    openFilesState: options.openFilesState,
  };

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

  return { path: sessionPath, isNew };
}

/**
 * Load a session from disk.
 * Automatically repairs broken sessions (e.g., tool_use without tool_result).
 */
export function loadSession(name: string): Session | null {
  const sessionPath = getSessionPath(name);

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(sessionPath, 'utf-8');
    const session = JSON.parse(content) as Session;

    // Repair the session if needed
    const { messages, repaired } = repairSession(session.messages);
    if (repaired) {
      session.messages = messages;
      // Save the repaired session
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Repair a session by fixing broken tool_use/tool_result pairs.
 * This can happen when the session is saved after a crash during tool execution.
 *
 * The Anthropic API requires that every tool_use block in an assistant message
 * must have a corresponding tool_result block in the immediately following user message.
 *
 * @param messages - The message history to repair
 * @returns The repaired messages and whether any repairs were made
 */
export function repairSession(messages: Message[]): { messages: Message[]; repaired: boolean } {
  if (messages.length === 0) {
    return { messages, repaired: false };
  }

  const repairedMessages = [...messages];
  let repaired = false;

  // Check if the last message is from the assistant with tool_use blocks
  const lastMessage = repairedMessages[repairedMessages.length - 1];

  if (lastMessage.role === 'assistant' && Array.isArray(lastMessage.content)) {
    // Find all tool_use blocks in the last assistant message
    const toolUseBlocks = lastMessage.content.filter(
      (block): block is ContentBlock & { type: 'tool_use'; id: string; name: string } =>
        block.type === 'tool_use' && !!block.id
    );

    if (toolUseBlocks.length > 0) {
      // The session ends with tool_use blocks but no tool_result
      // Add a synthetic user message with error results for each tool_use
      const toolResults: ContentBlock[] = toolUseBlocks.map(toolUse => ({
        type: 'tool_result' as const,
        tool_use_id: toolUse.id,
        content: `[Session interrupted] Tool "${toolUse.name}" was not executed. The session was saved before the tool could complete.`,
        is_error: true,
      }));

      repairedMessages.push({
        role: 'user',
        content: toolResults,
      });

      repaired = true;
    }
  }

  // Also check for any assistant messages in the middle that have unmatched tool_use
  for (let i = 0; i < repairedMessages.length - 1; i++) {
    const msg = repairedMessages[i];
    const nextMsg = repairedMessages[i + 1];

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter(
        (block): block is ContentBlock & { type: 'tool_use'; id: string; name: string } =>
          block.type === 'tool_use' && !!block.id
      );

      if (toolUseBlocks.length > 0) {
        // Get tool_use IDs that need results
        const toolUseIds = new Set(toolUseBlocks.map(b => b.id));

        // Check if next message has corresponding tool_results
        if (nextMsg.role === 'user' && Array.isArray(nextMsg.content)) {
          const resultIds = new Set(
            nextMsg.content
              .filter(b => b.type === 'tool_result' && b.tool_use_id)
              .map(b => b.tool_use_id)
          );

          // Find missing results
          const missingIds = [...toolUseIds].filter(id => !resultIds.has(id));

          if (missingIds.length > 0) {
            // Add missing tool_results to the user message
            const missingResults: ContentBlock[] = missingIds.map(id => {
              const toolUse = toolUseBlocks.find(b => b.id === id)!;
              return {
                type: 'tool_result' as const,
                tool_use_id: id,
                content: `[Session interrupted] Tool "${toolUse.name}" was not executed.`,
                is_error: true,
              };
            });

            nextMsg.content = [...nextMsg.content, ...missingResults];
            repaired = true;
          }
        } else if (nextMsg.role === 'user' && typeof nextMsg.content === 'string') {
          // Next message is user text without tool_results - need to insert tool_results
          const toolResults: ContentBlock[] = toolUseBlocks.map(toolUse => ({
            type: 'tool_result' as const,
            tool_use_id: toolUse.id,
            content: `[Session interrupted] Tool "${toolUse.name}" was not executed.`,
            is_error: true,
          }));

          // Convert the text message to include tool_results before the text
          const textBlock: ContentBlock = { type: 'text', text: nextMsg.content };
          repairedMessages[i + 1] = {
            role: 'user',
            content: [...toolResults, textBlock],
          };

          repaired = true;
        } else if (nextMsg.role !== 'user') {
          // Next message is not a user message - this is a broken structure
          // Insert a synthetic user message with tool results
          const toolResults: ContentBlock[] = toolUseBlocks.map(toolUse => ({
            type: 'tool_result' as const,
            tool_use_id: toolUse.id,
            content: `[Session interrupted] Tool "${toolUse.name}" was not executed.`,
            is_error: true,
          }));

          repairedMessages.splice(i + 1, 0, {
            role: 'user',
            content: toolResults,
          });

          repaired = true;
        }
      }
    }
  }

  return { messages: repairedMessages, repaired };
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
