// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Usage tracking and cost estimation commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  getSessionUsage,
  getUsageStats,
  getRecentUsage,
  clearUsageHistory,
  resetSessionUsage,
  formatCost,
  formatTokens,
  getUsageFilePath,
} from '../usage.js';

/**
 * /usage command - Show usage statistics.
 */
export const usageCommand: Command = {
  name: 'usage',
  aliases: ['cost', 'tokens'],
  description: 'Show API usage and cost statistics',
  usage: '/usage [session|today|week|month|all|reset|clear]',
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string> => {
    const trimmed = args.trim().toLowerCase();

    // Handle subcommands
    if (trimmed === 'reset') {
      resetSessionUsage();
      return '__USAGE_RESET__';
    }

    if (trimmed === 'clear') {
      const count = clearUsageHistory();
      return `__USAGE_CLEARED__:${count}`;
    }

    if (trimmed === 'path' || trimmed === 'file') {
      return `__USAGE_PATH__:${getUsageFilePath()}`;
    }

    // Session usage (default)
    if (trimmed === '' || trimmed === 'session') {
      const session = getSessionUsage();
      return `__USAGE_SESSION__:${session.inputTokens}:${session.outputTokens}:${session.cost}:${session.requests}:${session.startTime}`;
    }

    // Today's usage
    if (trimmed === 'today') {
      const stats = getUsageStats(1);
      return formatUsageStats('Today', stats);
    }

    // Week's usage
    if (trimmed === 'week') {
      const stats = getUsageStats(7);
      return formatUsageStats('Last 7 days', stats);
    }

    // Month's usage (default historical)
    if (trimmed === 'month') {
      const stats = getUsageStats(30);
      return formatUsageStats('Last 30 days', stats);
    }

    // All time usage
    if (trimmed === 'all') {
      const stats = getUsageStats(365 * 10); // 10 years = "all"
      return formatUsageStats('All time', stats);
    }

    // Recent usage records
    if (trimmed === 'recent') {
      const records = getRecentUsage(10);
      if (records.length === 0) {
        return '__USAGE_RECENT_EMPTY__';
      }
      const lines = records.map(r => {
        const time = new Date(r.timestamp).toLocaleString();
        return `${time} | ${r.provider}/${r.model} | ${formatTokens(r.inputTokens)}/${formatTokens(r.outputTokens)} | ${formatCost(r.cost)}`;
      });
      return `__USAGE_RECENT__\n${lines.join('\n')}`;
    }

    // Unknown subcommand - show session usage
    const session = getSessionUsage();
    return `__USAGE_SESSION__:${session.inputTokens}:${session.outputTokens}:${session.cost}:${session.requests}:${session.startTime}`;
  },
};

/**
 * Format usage stats for display.
 */
function formatUsageStats(period: string, stats: ReturnType<typeof getUsageStats>): string {
  const lines: string[] = [];
  lines.push(`__USAGE_STATS__:${period}`);
  lines.push(`total:${stats.totalInputTokens}:${stats.totalOutputTokens}:${stats.totalCost}:${stats.requestCount}`);

  // By provider
  for (const [provider, data] of Object.entries(stats.byProvider)) {
    lines.push(`provider:${provider}:${data.inputTokens}:${data.outputTokens}:${data.cost}:${data.requests}`);
  }

  // By model
  for (const [model, data] of Object.entries(stats.byModel)) {
    lines.push(`model:${model}:${data.inputTokens}:${data.outputTokens}:${data.cost}:${data.requests}`);
  }

  return lines.join('\n');
}

/**
 * Register all usage commands.
 */
export function registerUsageCommands(): void {
  registerCommand(usageCommand);
}
