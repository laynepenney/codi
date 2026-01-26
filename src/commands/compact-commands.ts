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
  usage: '/compact [summarize|compress|status|memory|debug] [options]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string | null> => {
    if (!context.agent) {
      return 'COMPACT_ERROR:No agent available';
    }

    const parts = args.trim().toLowerCase().split(/\s+/);
    const subcommand = parts[0] || 'status';
    const subArgs = parts.slice(1).join(' ');

    // /compact debug - Show detailed context debugging info
    if (subcommand === 'debug') {
      try {
        const info = context.agent.getContextInfo();
        const messages = context.agent.getMessages();

        // Validate we have a messages array
        if (!messages || !Array.isArray(messages)) {
          return 'CONTEXT_DEBUG_ERROR:Invalid messages data';
        }

        // Build detailed debug output
        const debugInfo = {
          context: {
            tokens: info.tokens,
            messageTokens: info.messageTokens,
            systemPromptTokens: info.systemPromptTokens,
            toolDefinitionTokens: info.toolDefinitionTokens,
            messages: info.messages,
            userMessages: info.userMessages,
            assistantMessages: info.assistantMessages,
            toolResultMessages: info.toolResultMessages,
          },
          limits: {
            maxTokens: info.maxTokens,
            contextWindow: info.contextWindow,
            effectiveLimit: info.effectiveLimit,
            outputReserve: info.outputReserve,
            safetyBuffer: info.safetyBuffer,
            tierName: info.tierName,
          },
          state: {
            hasSummary: info.hasSummary,
            compressionEnabled: info.compressionEnabled,
            compressionStats: info.compression,
            workingSetFiles: info.workingSetFiles,
          },
          messagePreviews: messages.map((msg, index) => ({
            index,
            role: msg.role,
            contentPreview: typeof msg.content === 'string' 
              ? msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '')
              : `[complex content: ${msg.content.length} blocks]`,
            contentLength: typeof msg.content === 'string' ? msg.content.length : (msg.content?.length || 0),
          })),
          conversationSummary: info.hasSummary ? '[summary exists - use /compact status for token info]' : null,
        };

        return `CONTEXT_DEBUG:${JSON.stringify(debugInfo, null, 2)}`;
      } catch (error) {
        return `CONTEXT_DEBUG_ERROR:${error instanceof Error ? error.message : 'Unknown error occurred'}`;
      }
    }

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

    return `COMPACT_ERROR:Unknown subcommand "${subcommand}". Use: status, summarize, compress, memory, debug`;
  },
};

export function registerCompactCommands(): void {
  registerCommand(compactCommand);
}