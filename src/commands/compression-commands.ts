/**
 * Commands for testing and using context compression.
 */

import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  compressContext,
  generateEntityLegend,
  getCompressionStats,
} from '../compression.js';

export const compressCommand: Command = {
  name: 'compress',
  aliases: ['compression'],
  description: 'Manage context compression',
  usage: '/compress [on|off|status|--preview]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    if (!context.agent) {
      return 'COMPRESS_ERROR:No agent available';
    }

    const trimmedArgs = args.trim().toLowerCase();

    // Toggle compression
    if (trimmedArgs === 'on') {
      context.agent.setCompression(true);
      return 'COMPRESS_TOGGLE:on';
    }

    if (trimmedArgs === 'off') {
      context.agent.setCompression(false);
      return 'COMPRESS_TOGGLE:off';
    }

    // Show status
    if (trimmedArgs === 'status' || trimmedArgs === '') {
      const info = context.agent.getContextInfo();
      return `COMPRESS_STATUS:${JSON.stringify({
        enabled: info.compressionEnabled,
        stats: info.compression,
      })}`;
    }

    // Show analysis with preview
    const messages = context.agent.getMessages();

    if (messages.length === 0) {
      return 'COMPRESS_ERROR:No messages in conversation';
    }

    const showPreview = trimmedArgs.includes('--preview') || trimmedArgs === 'preview';

    // Run compression analysis
    const result = compressContext(messages);
    const stats = getCompressionStats(result);

    // Build output
    const output = {
      stats,
      enabled: context.agent.isCompressionEnabled(),
      preview: showPreview ? {
        legend: generateEntityLegend(result.entities),
        sampleCompressed: result.messages.slice(-3).map(m =>
          typeof m.content === 'string' ? m.content : '[complex content]'
        ),
      } : undefined,
    };

    return `COMPRESS_STATS:${JSON.stringify(output)}`;
  },
};

export function registerCompressionCommands(): void {
  registerCommand(compressCommand);
}
