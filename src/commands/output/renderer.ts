// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Command output renderer.
 * Converts typed command outputs to formatted console output.
 */

import chalk from 'chalk';
import type {
  CommandOutput,
  SessionOutput,
  ConfigOutput,
  HistoryOutput,
  UsageOutput,
  PluginOutput,
} from './types.js';

/**
 * Render a typed command output to the console.
 * Returns true if output was rendered, false if the output was null or unrecognized.
 */
export function renderOutput(output: CommandOutput): boolean {
  if (output === null) {
    return false;
  }

  switch (output.type) {
    case 'session':
      renderSessionOutput(output);
      return true;
    case 'config':
      renderConfigOutput(output);
      return true;
    case 'history':
      renderHistoryOutput(output);
      return true;
    case 'usage':
      renderUsageOutput(output);
      return true;
    case 'plugin':
      renderPluginOutput(output);
      return true;
    case 'prompt':
      // Prompt outputs are handled specially - they go to the AI
      return false;
    default:
      return false;
  }
}

// ============================================================================
// Session Output Renderers
// ============================================================================

function renderSessionOutput(output: SessionOutput): void {
  switch (output.action) {
    case 'saved':
      console.log(chalk.green(`Session "${output.name}" ${output.isNew ? 'created' : 'updated'} (${output.messageCount} messages)`));
      break;

    case 'loaded':
      console.log(chalk.green(`Loaded session "${output.name}" (${output.messageCount} messages${output.hasSummary ? ', has summary' : ''})`));
      break;

    case 'not_found':
      console.log(chalk.yellow(`Session "${output.name}" not found`));
      break;

    case 'list':
      if (output.sessions.length === 0) {
        console.log(chalk.yellow('No saved sessions found'));
      } else {
        console.log(chalk.bold('Saved sessions:'));
        for (const session of output.sessions) {
          const current = session.isCurrent ? chalk.green(' (current)') : '';
          console.log(`  ${chalk.cyan(session.name)}${current} - ${session.messages} messages, updated ${session.updatedAt}`);
        }
      }
      break;

    case 'multiple':
      console.log(chalk.yellow(`Multiple sessions match "${output.query}":`));
      for (const match of output.matches) {
        console.log(`  ${chalk.cyan(match)}`);
      }
      console.log(chalk.dim('Please be more specific'));
      break;

    case 'deleted':
      console.log(chalk.green(`Session "${output.name}" deleted`));
      break;

    case 'info':
      console.log(chalk.bold(`Session: ${output.info.name}`));
      console.log(`  Provider: ${output.info.provider}`);
      console.log(`  Model: ${output.info.model}`);
      console.log(`  Messages: ${output.info.messages}`);
      if (output.info.projectName) {
        console.log(`  Project: ${output.info.projectName}`);
      }
      console.log(`  Has Summary: ${output.info.hasSummary ? 'Yes' : 'No'}`);
      console.log(`  Created: ${output.info.createdAt}`);
      console.log(`  Updated: ${output.info.updatedAt}`);
      break;

    case 'cleared':
      console.log(chalk.green(`Cleared ${output.count} session(s)`));
      break;

    case 'dir':
      console.log(`Sessions directory: ${chalk.cyan(output.path)}`);
      break;

    case 'error':
      switch (output.error) {
        case 'no_name':
          console.log(chalk.red('Please specify a session name to delete'));
          break;
        case 'no_current':
          console.log(chalk.yellow('No current session'));
          break;
        case 'unknown_action':
          console.log(chalk.red(`Unknown sessions action: ${output.details}`));
          break;
      }
      break;
  }
}

// ============================================================================
// Config Output Renderers
// ============================================================================

function renderConfigOutput(output: ConfigOutput): void {
  switch (output.action) {
    case 'init':
      if (output.success) {
        console.log(chalk.green(`Created config file: ${output.path}`));
      } else {
        console.log(chalk.red(`Failed to create config: ${output.error}`));
      }
      break;

    case 'show':
      console.log(chalk.bold(`Config: ${output.path}`));
      if (output.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        for (const warning of output.warnings) {
          console.log(chalk.yellow(`  - ${warning}`));
        }
      }
      console.log();
      console.log(JSON.stringify(output.config, null, 2));
      break;

    case 'example':
      console.log(chalk.bold('Example configuration (.codi.json):'));
      console.log(output.content);
      break;

    case 'not_found':
      console.log(chalk.yellow('No workspace config found. Use /config init to create one.'));
      break;
  }
}

// ============================================================================
// History Output Renderers
// ============================================================================

function renderHistoryOutput(output: HistoryOutput): void {
  switch (output.action) {
    case 'undo':
      if (output.success) {
        console.log(chalk.green(`Undone: ${output.operation} ${output.fileName}`));
        console.log(chalk.dim(output.description));
      } else {
        console.log(chalk.yellow('Nothing to undo'));
      }
      break;

    case 'redo':
      if (output.success) {
        console.log(chalk.green(`Redone: ${output.operation} ${output.fileName}`));
        console.log(chalk.dim(output.description));
      } else {
        console.log(chalk.yellow('Nothing to redo'));
      }
      break;

    case 'list':
      if (output.entries.length === 0) {
        console.log(chalk.yellow('No file history'));
      } else {
        console.log(chalk.bold(`File History (${output.undoCount} undo, ${output.redoCount} redo):`));
        for (const entry of output.entries) {
          const time = new Date(entry.timestamp).toLocaleString();
          console.log(`  ${chalk.cyan(entry.operation)} ${entry.fileName}`);
          console.log(`    ${chalk.dim(entry.description)} - ${time}`);
        }
      }
      break;

    case 'file':
      if (output.entries.length === 0) {
        console.log(chalk.yellow(`No history for ${output.fileName}`));
      } else {
        console.log(chalk.bold(`History for ${output.fileName}:`));
        for (const entry of output.entries) {
          const time = new Date(entry.timestamp).toLocaleString();
          console.log(`  ${chalk.cyan(entry.operation)}: ${entry.description} - ${time}`);
        }
      }
      break;

    case 'cleared':
      console.log(chalk.green(`Cleared ${output.count} history entries`));
      break;

    case 'dir':
      console.log(`History directory: ${chalk.cyan(output.path)}`);
      break;

    case 'status':
      console.log(`Undo stack: ${output.undoCount} | Redo stack: ${output.redoCount}`);
      break;
  }
}

// ============================================================================
// Usage Output Renderers
// ============================================================================

function renderUsageOutput(output: UsageOutput): void {
  switch (output.action) {
    case 'session':
      console.log(chalk.bold('Session Usage:'));
      console.log(`  Requests: ${output.requests}`);
      console.log(`  Input tokens: ${output.inputTokens.toLocaleString()}`);
      console.log(`  Output tokens: ${output.outputTokens.toLocaleString()}`);
      console.log(`  Estimated cost: $${output.cost.toFixed(4)}`);
      console.log(`  Started: ${new Date(output.startTime).toLocaleString()}`);
      break;

    case 'stats':
      console.log(chalk.bold(`Usage Statistics (${output.period}):`));
      console.log(`  Total requests: ${output.requests}`);
      console.log(`  Input tokens: ${output.inputTokens.toLocaleString()}`);
      console.log(`  Output tokens: ${output.outputTokens.toLocaleString()}`);
      console.log(`  Total cost: $${output.cost.toFixed(4)}`);
      if (output.days > 0) {
        console.log(`  Days: ${output.days}`);
        console.log(`  Avg cost/day: $${output.avgCostPerDay.toFixed(4)}`);
        console.log(`  Avg requests/day: ${output.avgRequestsPerDay.toFixed(1)}`);
      }
      if (output.modelBreakdown.length > 0) {
        console.log(chalk.bold('\n  By Model:'));
        for (const model of output.modelBreakdown) {
          console.log(`    ${chalk.cyan(model.key)}: ${model.requests} requests, $${model.cost.toFixed(4)}`);
        }
      }
      break;

    case 'recent':
      if (output.records.length === 0) {
        console.log(chalk.yellow('No recent usage records'));
      } else {
        console.log(chalk.bold('Recent Usage:'));
        for (const record of output.records) {
          const time = new Date(record.timestamp).toLocaleString();
          console.log(`  ${time} - ${record.provider}/${record.model}`);
          console.log(`    ${record.inputTokens + record.outputTokens} tokens, $${record.cost.toFixed(4)}`);
        }
      }
      break;

    case 'reset':
      console.log(chalk.green('Session usage reset'));
      break;

    case 'cleared':
      console.log(chalk.green(`Cleared ${output.count} usage records`));
      break;

    case 'path':
      console.log(`Usage file: ${chalk.cyan(output.path)}`);
      break;
  }
}

// ============================================================================
// Plugin Output Renderers
// ============================================================================

function renderPluginOutput(output: PluginOutput): void {
  switch (output.action) {
    case 'list':
      if (output.plugins.length === 0) {
        console.log(chalk.yellow('No plugins loaded'));
      } else {
        console.log(chalk.bold('Loaded Plugins:'));
        for (const plugin of output.plugins) {
          const features = [];
          if (plugin.tools > 0) features.push(`${plugin.tools} tools`);
          if (plugin.commands > 0) features.push(`${plugin.commands} commands`);
          if (plugin.providers > 0) features.push(`${plugin.providers} providers`);
          console.log(`  ${chalk.cyan(plugin.name)} v${plugin.version}`);
          if (features.length > 0) {
            console.log(`    ${features.join(', ')}`);
          }
        }
      }
      break;

    case 'info':
      console.log(chalk.bold(`Plugin: ${output.name}`));
      console.log(`  Version: ${output.version}`);
      if (output.description) {
        console.log(`  Description: ${output.description}`);
      }
      console.log(`  Tools: ${output.toolCount}`);
      console.log(`  Commands: ${output.commandCount}`);
      console.log(`  Providers: ${output.providerCount}`);
      console.log(`  Path: ${output.path}`);
      console.log(`  Loaded: ${new Date(output.loadedAt).toLocaleString()}`);
      break;

    case 'not_found':
      console.log(chalk.yellow(`Plugin "${output.name}" not found`));
      break;

    case 'dir':
      console.log(`Plugins directory: ${chalk.cyan(output.path)}`);
      break;
  }
}
