// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Commands for context management (summarization and compression).
 */

import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  compressContext,
  generateEntityLegend,
  getCompressionStats,
} from '../compression.js';
import { getMemoryMonitor } from '../memory-monitor.js';

export const compactCommand: Command = {
  name: 'compact',
  aliases: ['summarize', 'compress', 'compression'],
  description: 'Manage context size through summarization and compression',
  usage: '/compact [summarize|compress|status|memory] [options]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    if (!context.agent) {
      return 'COMPACT_ERROR:No agent available';
    }

    const parts = args.trim().toLowerCase().split(/\s+/);
    const subcommand = parts[0] || 'status';
    const subArgs = parts.slice(1).join(' ');

    // /compact memory - Show memory usage
    if (subcommand === 'memory') {
      const monitor = getMemoryMonitor();
      const snapshot = monitor.getSnapshot();
      const stats = monitor.getStats();

      return `MEMORY_STATUS:${JSON.stringify({
        heap: {
          used_mb: (snapshot.heapStats.used_heap_size / 1024 / 1024).toFixed(1),
          total_mb: (snapshot.heapStats.heap_size_limit / 1024 / 1024).toFixed(1),
          usage_percent: snapshot.usagePercent.toFixed(1),
        },
        monitoring: stats,
        status: monitor.logStatus(),
      })}`;
    }

    // /compact status - Show overall context info
    if (subcommand === 'status' || subcommand === '') {
      const info = context.agent.getContextInfo();
      return `COMPACT_STATUS:${JSON.stringify({
        tokens: info.tokens,
        messages: info.messages,
        hasSummary: info.hasSummary,
        compression: {
          enabled: info.compressionEnabled,
          stats: info.compression,
        },
      })}`;
    }

    // /compact summarize [--force] - Summarize old messages
    if (subcommand === 'summarize' || subcommand === '--force') {
      const force = subcommand === '--force' || subArgs.includes('--force');
      const info = context.agent.getContextInfo();

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
    }

    // /compact compress [on|off|--preview] - Manage entity compression
    if (subcommand === 'compress') {
      if (subArgs === 'on') {
        context.agent.setCompression(true);
        return 'COMPRESS_TOGGLE:on';
      }

      if (subArgs === 'off') {
        context.agent.setCompression(false);
        return 'COMPRESS_TOGGLE:off';
      }

      // Show analysis with optional preview
      const messages = context.agent.getMessages();

      if (messages.length === 0) {
        const info = context.agent.getContextInfo();
        return `COMPRESS_STATUS:${JSON.stringify({
          enabled: info.compressionEnabled,
          stats: info.compression,
        })}`;
      }

      const showPreview = subArgs.includes('--preview') || subArgs === 'preview';

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
    }

    return `COMPACT_ERROR:Unknown subcommand "${subcommand}". Use: status, summarize, compress`;
  },
};

export function registerCompactCommands(): void {
  registerCommand(compactCommand);
}
