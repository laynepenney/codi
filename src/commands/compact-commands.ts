// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Commands for context compaction (summarization).
 */

import { registerCommand, type Command, type CommandContext } from './index.js';

export const compactCommand: Command = {
  name: 'compact',
  aliases: ['summarize'],
  description: 'Summarize old messages to reduce context size',
  usage: '/compact [--force]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    if (!context.agent) {
      return 'COMPACT_ERROR:No agent available';
    }

    const info = context.agent.getContextInfo();
    const force = args.trim().toLowerCase() === '--force';

    // Check if there are enough messages to compact
    if (!force && info.messages <= 6) {
      return `COMPACT_SKIP:${JSON.stringify({
        reason: 'Not enough messages to compact (need >6)',
        current: {
          tokens: info.tokens,
          messages: info.messages,
          hasSummary: info.hasSummary,
        },
      })}`;
    }

    // Show current state
    const before = {
      tokens: info.tokens,
      messages: info.messages,
      hasSummary: info.hasSummary,
    };

    try {
      const result = await context.agent.forceCompact();

      const afterInfo = context.agent.getContextInfo();

      return `COMPACT_SUCCESS:${JSON.stringify({
        before,
        after: {
          tokens: afterInfo.tokens,
          messages: afterInfo.messages,
          hasSummary: afterInfo.hasSummary,
        },
        tokensSaved: result.before - result.after,
        summary: result.summary ? result.summary.slice(0, 500) : null,
      })}`;
    } catch (error) {
      return `COMPACT_ERROR:${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export function registerCompactCommands(): void {
  registerCommand(compactCommand);
}
