import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  findSessions,
  generateSessionName,
  formatSessionInfo,
  getSessionsDir,
  type Session,
} from '../session.js';

/**
 * Current session name - persists across commands.
 * Updated via context.setSessionName callback.
 */
let currentSessionName: string | null = null;

export function getCurrentSessionName(): string | null {
  return currentSessionName;
}

export function setCurrentSessionName(name: string | null): void {
  currentSessionName = name;
}

/**
 * @deprecated Use context.agent instead. This remains for backward compatibility.
 */
export function setSessionAgent(): void {
  // No-op - agent is now passed via context
}

export const saveCommand: Command = {
  name: 'save',
  description: 'Save current conversation to a session',
  usage: '/save [name]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    if (!context.agent) {
      return null; // Will show error message in index.ts
    }

    const name = args.trim() || currentSessionName || generateSessionName();
    const messages = context.agent.getHistory();
    const summary = context.agent.getSummary();

    if (messages.length === 0) {
      return null; // Return null to indicate this is a direct command, not an AI prompt
    }

    const result = saveSession(name, messages, summary, {
      projectPath: process.cwd(),
      projectName: context.projectInfo?.name || '',
      provider: context.sessionState?.provider || '',
      model: context.sessionState?.model || '',
      openFilesState: undefined,
    });

    // Update session name via callback or local state
    currentSessionName = name;
    context.setSessionName?.(name);

    return `__SESSION_SAVED__:${name}:${result.isNew ? 'new' : 'updated'}:${messages.length}`;
  },
};

export const loadCommand: Command = {
  name: 'load',
  description: 'Load a saved conversation session',
  usage: '/load <name>',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    if (!context.agent) {
      return null;
    }

    const name = args.trim();
    if (!name) {
      // List recent sessions if no name provided
      const sessions = listSessions().slice(0, 10);
      if (sessions.length === 0) {
        return '__SESSION_LIST_EMPTY__';
      }

      let list = '__SESSION_LIST__:';
      for (const info of sessions) {
        list += `\n${formatSessionInfo(info)}`;
      }
      return list;
    }

    // Try exact match first
    let session = loadSession(name);

    // If not found, try to find by pattern
    if (!session) {
      const matches = findSessions(name);
      if (matches.length === 1) {
        session = loadSession(matches[0].name);
      } else if (matches.length > 1) {
        let list = `__SESSION_MULTIPLE__:${name}:`;
        for (const info of matches.slice(0, 5)) {
          list += `\n${formatSessionInfo(info)}`;
        }
        return list;
      }
    }

    if (!session) {
      return `__SESSION_NOT_FOUND__:${name}`;
    }

    // Load the session into the agent
    context.agent.loadSession(session.messages, session.conversationSummary);
    currentSessionName = session.name;
    context.setSessionName?.(session.name);

    return `__SESSION_LOADED__:${session.name}:${session.messages.length}:${session.conversationSummary ? 'yes' : 'no'}`;
  },
};

export const sessionsCommand: Command = {
  name: 'sessions',
  aliases: ['session'],
  description: 'List or manage saved sessions',
  usage: '/sessions [list|delete <name>|info <name>|clear]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase() || 'list';
    const target = parts.slice(1).join(' ');

    switch (action) {
      case 'list':
      case 'ls': {
        const sessions = target ? findSessions(target) : listSessions();
        if (sessions.length === 0) {
          return '__SESSION_LIST_EMPTY__';
        }

        let list = '__SESSION_LIST__:';
        for (const info of sessions.slice(0, 20)) {
          list += `\n${formatSessionInfo(info)}`;
        }
        if (sessions.length > 20) {
          list += `\n... and ${sessions.length - 20} more`;
        }
        return list;
      }

      case 'delete':
      case 'rm':
      case 'remove': {
        if (!target) {
          return '__SESSION_DELETE_NO_NAME__';
        }

        const deleted = deleteSession(target);
        if (deleted) {
          if (currentSessionName === target) {
            currentSessionName = null;
            context.setSessionName?.(null);
          }
          return `__SESSION_DELETED__:${target}`;
        } else {
          return `__SESSION_NOT_FOUND__:${target}`;
        }
      }

      case 'info':
      case 'show': {
        if (!target) {
          // Show current session info
          if (!currentSessionName) {
            return '__SESSION_NO_CURRENT__';
          }
          const session = loadSession(currentSessionName);
          if (session) {
            return `__SESSION_INFO__:${JSON.stringify({
              name: session.name,
              messages: session.messages.length,
              hasSummary: !!session.conversationSummary,
              project: session.projectName,
              provider: session.provider,
              model: session.model,
              created: session.createdAt,
              updated: session.updatedAt,
            })}`;
          }
        }

        const session = loadSession(target);
        if (!session) {
          return `__SESSION_NOT_FOUND__:${target}`;
        }

        return `__SESSION_INFO__:${JSON.stringify({
          name: session.name,
          messages: session.messages.length,
          hasSummary: !!session.conversationSummary,
          project: session.projectName,
          provider: session.provider,
          model: session.model,
          created: session.createdAt,
          updated: session.updatedAt,
        })}`;
      }

      case 'clear': {
        const sessions = listSessions();
        let deleted = 0;
        for (const s of sessions) {
          if (deleteSession(s.name)) deleted++;
        }
        currentSessionName = null;
        context.setSessionName?.(null);
        return `__SESSION_CLEARED__:${deleted}`;
      }

      case 'dir':
      case 'path': {
        return `__SESSION_DIR__:${getSessionsDir()}`;
      }

      default: {
        // Assume it's a session name to show
        const session = loadSession(action);
        if (session) {
          return `__SESSION_INFO__:${JSON.stringify({
            name: session.name,
            messages: session.messages.length,
            hasSummary: !!session.conversationSummary,
            project: session.projectName,
            provider: session.provider,
            model: session.model,
            created: session.createdAt,
            updated: session.updatedAt,
          })}`;
        }
        return `__SESSION_UNKNOWN_ACTION__:${action}`;
      }
    }
  },
};

// Register all session commands
export function registerSessionCommands(): void {
  registerCommand(saveCommand);
  registerCommand(loadCommand);
  registerCommand(sessionsCommand);
}
