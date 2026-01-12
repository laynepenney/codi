/**
 * Import commands for loading external conversation data.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  listConversations,
  importAllConversations,
  importConversationsByIndex,
  searchConversations,
  type ParsedConversation,
} from '../import-chatgpt.js';

/**
 * Format a conversation for display in the list.
 */
function formatConversation(conv: ParsedConversation, index: number): string {
  const date = conv.createdAt.toLocaleDateString();
  const title = conv.title.length > 50 ? conv.title.slice(0, 47) + '...' : conv.title;
  return `${index.toString().padStart(3)}. ${title.padEnd(50)} ${conv.messageCount.toString().padStart(4)} msgs  ${date}`;
}

/**
 * /import command - Import conversations from external sources.
 */
export const importCommand: Command = {
  name: 'import',
  aliases: ['import-chatgpt'],
  description: 'Import conversations from ChatGPT export',
  usage: `/import <file> [options]

Options:
  list                    List all conversations in the export file
  search <query>          Search conversations by title or content
  all [--summary]         Import all conversations (--summary for summaries only)
  <n> [--summary]         Import conversation at index n
  <n,m,o> [--summary]     Import multiple conversations by index

Examples:
  /import conversations.json list
  /import conversations.json search "react hooks"
  /import conversations.json all --summary
  /import conversations.json 0
  /import conversations.json 1,5,12 --summary`,
  taskType: 'complex',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const parts = args.trim().split(/\s+/);

    if (parts.length < 2 || !parts[0]) {
      return '__IMPORT_ERROR__|Usage: /import <file.json> <list|search|all|indices>';
    }

    const filePath = parts[0];
    const action = parts[1];
    const summaryOnly = args.includes('--summary');

    try {
      if (action === 'list') {
        // List all conversations
        const conversations = listConversations(filePath);
        const lines = [
          '__IMPORT_LIST__',
          `Found ${conversations.length} conversations in ${filePath}:`,
          '',
          'Idx  Title                                              Msgs  Date',
          '─'.repeat(75),
        ];

        for (let i = 0; i < conversations.length; i++) {
          lines.push(formatConversation(conversations[i], i));
        }

        lines.push('');
        lines.push('Use /import <file> <index> to import a specific conversation');
        lines.push('Use /import <file> all to import all conversations');

        return lines.join('\n');
      }

      if (action === 'search') {
        const query = parts.slice(2).join(' ').replace('--summary', '').trim();
        if (!query) {
          return '__IMPORT_ERROR__|Usage: /import <file> search <query>';
        }

        const results = searchConversations(filePath, query);
        const lines = [
          '__IMPORT_LIST__',
          `Found ${results.length} conversations matching "${query}":`,
          '',
          'Idx  Title                                              Msgs  Date',
          '─'.repeat(75),
        ];

        for (const { index, conversation } of results) {
          lines.push(formatConversation(conversation, index));
        }

        return lines.join('\n');
      }

      if (action === 'all') {
        // Import all conversations
        const results = importAllConversations(filePath, { summaryOnly });
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        const lines = [
          '__IMPORT_SUCCESS__',
          `Imported ${successful.length}/${results.length} conversations${summaryOnly ? ' (summaries only)' : ''}:`,
          '',
        ];

        for (const result of successful) {
          lines.push(`✓ ${result.title} → ${result.sessionName} (${result.messageCount} msgs)`);
        }

        if (failed.length > 0) {
          lines.push('');
          lines.push('Failed:');
          for (const result of failed) {
            lines.push(`✗ ${result.title}: ${result.error}`);
          }
        }

        lines.push('');
        lines.push('Use /sessions to see imported sessions');
        lines.push('Use /load <session-name> to load a session');

        return lines.join('\n');
      }

      // Try to parse as indices (e.g., "0" or "1,5,12")
      const indicesStr = action.replace('--summary', '').trim();
      const indices = indicesStr.split(',').map(s => parseInt(s.trim(), 10));

      if (indices.some(isNaN)) {
        return `__IMPORT_ERROR__|Unknown action: ${action}. Use list, search, all, or indices.`;
      }

      const results = importConversationsByIndex(filePath, indices, { summaryOnly });
      const successful = results.filter(r => r.success);

      if (successful.length === 0) {
        return '__IMPORT_ERROR__|No conversations imported. Check the indices.';
      }

      const lines = [
        '__IMPORT_SUCCESS__',
        `Imported ${successful.length} conversation${successful.length > 1 ? 's' : ''}${summaryOnly ? ' (summaries only)' : ''}:`,
        '',
      ];

      for (const result of successful) {
        lines.push(`✓ ${result.title} → ${result.sessionName} (${result.messageCount} msgs)`);
      }

      lines.push('');
      lines.push(`Use /load ${successful[0].sessionName} to load the session`);

      return lines.join('\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `__IMPORT_ERROR__|${message}`;
    }
  },
};

/**
 * Register all import commands.
 */
export function registerImportCommands(): void {
  registerCommand(importCommand);
}
