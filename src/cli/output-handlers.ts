// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Output Handlers for CLI Commands
 *
 * Centralized handling of command output formatting.
 * Each handler processes output strings from commands and formats them for display.
 */

import chalk from 'chalk';

/**
 * Output handler function type.
 * Returns true if the output was handled, false otherwise.
 */
type OutputHandler = (output: string) => boolean;

/**
 * Registry of output handlers by prefix.
 */
const handlers = new Map<string, OutputHandler>();

/**
 * Register an output handler for a specific prefix.
 */
export function registerHandler(prefix: string, handler: OutputHandler): void {
  handlers.set(prefix, handler);
}

/**
 * Dispatch output to the appropriate handler.
 * Returns true if handled, false if no handler matched.
 */
export function dispatch(output: string): boolean {
  for (const [prefix, handler] of handlers) {
    if (output.startsWith(prefix)) {
      return handler(output);
    }
  }
  return false;
}

// ============================================
// Session Output Handlers
// ============================================

registerHandler('__SESSION_SAVED__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  const status = parts[2];
  const count = parts[3];
  console.log(chalk.green(`\nSession ${status === 'new' ? 'saved' : 'updated'}: ${name}`));
  console.log(chalk.dim(`${count} messages saved.`));
  return true;
});

registerHandler('__SESSION_LOADED__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  const count = parts[2];
  const hasSummary = parts[3] === 'yes';
  console.log(chalk.green(`\nSession loaded: ${name}`));
  console.log(chalk.dim(`${count} messages restored.`));
  if (hasSummary) {
    console.log(chalk.dim('Session includes conversation summary.'));
  }
  return true;
});

registerHandler('__SESSION_NOT_FOUND__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  console.log(chalk.yellow(`\nSession not found: ${name}`));
  console.log(chalk.dim('Use /sessions to list available sessions.'));
  return true;
});

registerHandler('__SESSION_LIST__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nSaved Sessions:'));
  for (const line of lines) {
    console.log(chalk.dim(`  ${line}`));
  }
  return true;
});

registerHandler('__SESSION_LIST_EMPTY__', () => {
  console.log(chalk.dim('\nNo saved sessions found.'));
  console.log(chalk.dim('Use /save [name] to save the current conversation.'));
  return true;
});

registerHandler('__SESSION_MULTIPLE__', (output) => {
  const parts = output.split(':');
  const pattern = parts[1];
  const lines = output.split('\n').slice(1);
  console.log(chalk.yellow(`\nMultiple sessions match "${pattern}":`));
  for (const line of lines) {
    console.log(chalk.dim(`  ${line}`));
  }
  console.log(chalk.dim('\nPlease specify more precisely.'));
  return true;
});

registerHandler('__SESSION_DELETED__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  console.log(chalk.green(`\nSession deleted: ${name}`));
  return true;
});

registerHandler('__SESSION_DELETE_NO_NAME__', () => {
  console.log(chalk.yellow('\nPlease specify a session name to delete.'));
  console.log(chalk.dim('Usage: /sessions delete <name>'));
  return true;
});

registerHandler('__SESSION_NO_CURRENT__', () => {
  console.log(chalk.dim('\nNo session currently loaded.'));
  console.log(chalk.dim('Use /load <name> to load a session.'));
  return true;
});

registerHandler('__SESSION_INFO__', (output) => {
  const parts = output.split(':');
  const infoJson = parts.slice(1).join(':');
  try {
    const info = JSON.parse(infoJson);
    console.log(chalk.bold('\nSession Info:'));
    console.log(chalk.dim(`  Name: ${info.name}`));
    if (info.label) console.log(chalk.dim(`  Label: ${info.label}`));
    console.log(chalk.dim(`  Messages: ${info.messages}`));
    console.log(chalk.dim(`  Has summary: ${info.hasSummary ? 'yes' : 'no'}`));
    if (info.project) console.log(chalk.dim(`  Project: ${info.project}`));
    if (info.provider) console.log(chalk.dim(`  Provider: ${info.provider}`));
    if (info.model) console.log(chalk.dim(`  Model: ${info.model}`));
    console.log(chalk.dim(`  Created: ${new Date(info.created).toLocaleString()}`));
    console.log(chalk.dim(`  Updated: ${new Date(info.updated).toLocaleString()}`));
  } catch {
    console.log(chalk.dim('\nSession info unavailable.'));
  }
  return true;
});

registerHandler('__SESSION_CLEARED__', (output) => {
  const parts = output.split(':');
  const count = parts[1];
  console.log(chalk.green(`\nCleared ${count} sessions.`));
  return true;
});

registerHandler('__SESSION_DIR__', (output) => {
  const parts = output.split(':');
  const dir = parts.slice(1).join(':');
  console.log(chalk.dim(`\nSessions directory: ${dir}`));
  return true;
});

registerHandler('__SESSION_UNKNOWN_ACTION__', (output) => {
  const parts = output.split(':');
  const action = parts[1];
  console.log(chalk.yellow(`\nUnknown sessions action: ${action}`));
  console.log(chalk.dim('Usage: /sessions [list|delete <name>|info <name>|clear|dir]'));
  return true;
});

// ============================================
// Config Output Handlers
// ============================================

registerHandler('__CONFIG_HELP__', () => {
  console.log(chalk.bold('\nUsage:'));
  console.log(chalk.dim('  /config <subcommand>'));
  console.log(chalk.bold('\nSubcommands:'));
  console.log(chalk.dim('  init      Create a starter config file'));
  console.log(chalk.dim('  show      Display the current effective configuration'));
  console.log(chalk.dim('  example   Print an example configuration'));
  console.log(chalk.bold('\nOptions:'));
  console.log(chalk.dim('  -h, --help  Show this help'));
  return true;
});

registerHandler('__CONFIG_UNKNOWN_OPTION__', (output) => {
  const parts = output.split(':');
  const option = parts.slice(1).join(':');
  console.log(chalk.red(`\nUnknown option: ${option}`));
  console.log(chalk.dim('Run /config --help for usage.'));
  return true;
});

registerHandler('__CONFIG_INIT__', (output) => {
  const parts = output.split(':');
  const path = parts.slice(1).join(':');
  console.log(chalk.green(`\nCreated config file: ${path}`));
  console.log(chalk.dim('Edit this file to customize Codi for your project.'));
  return true;
});

registerHandler('__CONFIG_INIT_FAILED__', (output) => {
  const parts = output.split(':');
  const error = parts.slice(1).join(':');
  console.log(chalk.red(`\nFailed to create config: ${error}`));
  return true;
});

registerHandler('__CONFIG_NOT_FOUND__', () => {
  console.log(chalk.yellow('\nNo workspace configuration found.'));
  console.log(chalk.dim('Run /config init to create a .codi.json file.'));
  return true;
});

registerHandler('__CONFIG_EXAMPLE__', (output) => {
  const parts = output.split(':');
  const example = parts.slice(1).join(':');
  console.log(chalk.bold('\nExample configuration (.codi.json):'));
  console.log(chalk.dim(example));
  return true;
});

registerHandler('__CONFIG_SHOW__', (output) => {
  const parts = output.split(':');
  const configPath = parts[1];
  const warnings = JSON.parse(parts[2]) as string[];
  const configJson = parts.slice(3).join(':');

  console.log(chalk.bold('\nWorkspace Configuration:'));
  console.log(chalk.dim(`File: ${configPath}`));

  if (warnings.length > 0) {
    console.log(chalk.yellow('\nWarnings:'));
    for (const w of warnings) {
      console.log(chalk.yellow(`  - ${w}`));
    }
  }

  console.log(chalk.dim('\nCurrent settings:'));
  console.log(chalk.dim(configJson));
  return true;
});

// ============================================
// Init Output Handlers
// ============================================

registerHandler('__INIT_RESULT__|', (output) => {
  const parts = output.split('|');
  const results = parts.slice(1);

  console.log(chalk.bold('\nCodi Initialization:'));

  let createdCount = 0;
  let existsCount = 0;

  for (const result of results) {
    const [fileType, status, filePath] = result.split(':');
    const fileNames: Record<string, string> = {
      config: '.codi.json',
      modelmap: 'codi-models.yaml',
      context: 'CODI.md',
    };
    const fileName = fileNames[fileType] || fileType;

    switch (status) {
      case 'created':
        console.log(chalk.green(`  ✓ Created ${fileName}`));
        console.log(chalk.dim(`    ${filePath}`));
        createdCount++;
        break;
      case 'exists':
        console.log(chalk.yellow(`  ○ ${fileName} already exists`));
        console.log(chalk.dim(`    ${filePath}`));
        existsCount++;
        break;
      case 'error':
        console.log(chalk.red(`  ✗ Failed to create ${fileName}: ${filePath}`));
        break;
    }
  }

  if (createdCount > 0) {
    console.log(chalk.dim('\nEdit these files to customize Codi for your project.'));
  } else if (existsCount > 0 && createdCount === 0) {
    console.log(chalk.dim('\nAll config files already exist.'));
  }
  return true;
});

// ============================================
// History Output Handlers
// ============================================

registerHandler('__UNDO_NOTHING__', () => {
  console.log(chalk.yellow('\nNothing to undo.'));
  console.log(chalk.dim('No file changes recorded in history.'));
  return true;
});

registerHandler('__UNDO_SUCCESS__', (output) => {
  const parts = output.split(':');
  const fileName = parts[1];
  const operation = parts[2];
  const description = parts.slice(3).join(':');
  console.log(chalk.green(`\nUndone: ${operation} ${fileName}`));
  console.log(chalk.dim(description));
  return true;
});

registerHandler('__REDO_NOTHING__', () => {
  console.log(chalk.yellow('\nNothing to redo.'));
  console.log(chalk.dim('No undone changes to restore.'));
  return true;
});

registerHandler('__REDO_SUCCESS__', (output) => {
  const parts = output.split(':');
  const fileName = parts[1];
  const operation = parts[2];
  const description = parts.slice(3).join(':');
  console.log(chalk.green(`\nRedone: ${operation} ${fileName}`));
  console.log(chalk.dim(description));
  return true;
});

registerHandler('__HISTORY_EMPTY__', () => {
  console.log(chalk.dim('\nNo file changes recorded.'));
  console.log(chalk.dim('Changes will be tracked when you use write, edit, or patch operations.'));
  return true;
});

registerHandler('__HISTORY_LIST__', (output) => {
  const parts = output.split(':');
  const undoCount = parts[1];
  const redoCount = parts[2];
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nFile Change History:'));
  console.log(chalk.dim(`  ${undoCount} undo, ${redoCount} redo available`));
  console.log();
  for (const line of lines) {
    if (line.includes('(undone)')) {
      console.log(chalk.dim(`  ${line}`));
    } else {
      console.log(`  ${line}`);
    }
  }
  return true;
});

registerHandler('__HISTORY_FILE__', (output) => {
  const parts = output.split(':');
  const fileName = parts[1];
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold(`\nHistory for ${fileName}:`));
  for (const line of lines) {
    console.log(chalk.dim(`  ${line}`));
  }
  return true;
});

registerHandler('__HISTORY_FILE_EMPTY__', (output) => {
  const parts = output.split(':');
  const fileName = parts[1];
  console.log(chalk.dim(`\nNo history for ${fileName}`));
  return true;
});

registerHandler('__HISTORY_CLEARED__', (output) => {
  const parts = output.split(':');
  const count = parts[1];
  console.log(chalk.green(`\nCleared ${count} history entries.`));
  return true;
});

registerHandler('__HISTORY_DIR__', (output) => {
  const parts = output.split(':');
  const dir = parts.slice(1).join(':');
  console.log(chalk.dim(`\nHistory directory: ${dir}`));
  return true;
});

registerHandler('__HISTORY_STATUS__', (output) => {
  const parts = output.split(':');
  const undoCount = parts[1];
  const redoCount = parts[2];
  console.log(chalk.bold('\nHistory Status:'));
  console.log(chalk.dim(`  Undo available: ${undoCount}`));
  console.log(chalk.dim(`  Redo available: ${redoCount}`));
  return true;
});

// ============================================
// Usage Output Handlers
// ============================================

registerHandler('__USAGE_SESSION__', (output) => {
  const parts = output.split(':');
  const inputTokens = parseInt(parts[1], 10);
  const outputTokens = parseInt(parts[2], 10);
  const totalCost = parseFloat(parts[3]);

  console.log(chalk.bold('\nSession Usage:'));
  console.log(chalk.dim(`  Input tokens:  ${inputTokens.toLocaleString()}`));
  console.log(chalk.dim(`  Output tokens: ${outputTokens.toLocaleString()}`));
  console.log(chalk.dim(`  Estimated cost: $${totalCost.toFixed(4)}`));
  return true;
});

registerHandler('__USAGE_PERIOD__', (output) => {
  const parts = output.split(':');
  const period = parts[1];
  const inputTokens = parseInt(parts[2], 10);
  const outputTokens = parseInt(parts[3], 10);
  const totalCost = parseFloat(parts[4]);
  const recordCount = parseInt(parts[5], 10);

  console.log(chalk.bold(`\nUsage (${period}):`));
  console.log(chalk.dim(`  Records: ${recordCount}`));
  console.log(chalk.dim(`  Input tokens:  ${inputTokens.toLocaleString()}`));
  console.log(chalk.dim(`  Output tokens: ${outputTokens.toLocaleString()}`));
  console.log(chalk.dim(`  Total cost: $${totalCost.toFixed(4)}`));
  return true;
});

registerHandler('__USAGE_RESET__', () => {
  console.log(chalk.green('\nSession usage reset.'));
  return true;
});

registerHandler('__USAGE_CLEARED__', () => {
  console.log(chalk.green('\nUsage history cleared.'));
  return true;
});

registerHandler('__USAGE_RECENT__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nRecent Usage:'));
  for (const line of lines) {
    console.log(chalk.dim(`  ${line}`));
  }
  return true;
});

registerHandler('__USAGE_EMPTY__', () => {
  console.log(chalk.dim('\nNo usage recorded yet.'));
  return true;
});

// ============================================
// Plugin Output Handlers
// ============================================

registerHandler('__PLUGINS_DISABLED__', () => {
  console.log(chalk.yellow('\nPlugins are currently disabled.'));
  console.log(chalk.dim('Plugin support is temporarily disabled pending investigation.'));
  console.log(chalk.dim('See https://github.com/anthropics/codi/issues/17 for details.'));
  return true;
});

registerHandler('__PLUGINS_EMPTY__', () => {
  console.log(chalk.dim('\nNo plugins loaded.'));
  console.log(chalk.dim(`Place plugin directories in ~/.codi/plugins/`));
  return true;
});

registerHandler('__PLUGINS_LIST__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nLoaded Plugins:'));
  for (const line of lines) {
    const parts = line.split(':');
    const name = parts[0];
    const version = parts[1];
    const description = parts.slice(2).join(':');
    console.log(`  ${chalk.cyan(name)} v${version}`);
    if (description) {
      console.log(chalk.dim(`    ${description}`));
    }
  }
  return true;
});

registerHandler('__PLUGIN_INFO__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  const version = parts[2];
  const description = parts[3] || '';
  const toolCount = parts[4];
  const commandCount = parts[5];
  const providerCount = parts[6];
  const path = parts.slice(7).join(':');

  console.log(chalk.bold(`\nPlugin: ${name}`));
  console.log(chalk.dim(`  Version: ${version}`));
  if (description) {
    console.log(chalk.dim(`  Description: ${description}`));
  }
  console.log(chalk.dim(`  Tools: ${toolCount}`));
  console.log(chalk.dim(`  Commands: ${commandCount}`));
  console.log(chalk.dim(`  Providers: ${providerCount}`));
  console.log(chalk.dim(`  Path: ${path}`));
  return true;
});

registerHandler('__PLUGIN_NOT_FOUND__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  console.log(chalk.yellow(`\nPlugin not found: ${name}`));
  return true;
});

registerHandler('__PLUGINS_DIR__', (output) => {
  const parts = output.split(':');
  const dir = parts.slice(1).join(':');
  console.log(chalk.dim(`\nPlugins directory: ${dir}`));
  return true;
});

// ============================================
// Models Output Handler
// ============================================

registerHandler('__MODELS__', (output) => {
  const lines = output.split('\n');
  const notes: string[] = [];

  // First pass: collect notes
  for (const line of lines) {
    if (line.startsWith('note|')) {
      notes.push(line.slice(5));
    }
  }

  // Print header
  console.log(chalk.bold('\nAvailable Models:'));

  // Second pass: print models by provider
  for (const line of lines) {
    if (line === '__MODELS__') continue;

    if (line.startsWith('provider|')) {
      const providerName = line.slice(9);
      console.log();
      console.log(chalk.bold.cyan(providerName));
      console.log(chalk.dim('─'.repeat(75)));

      // Header row
      const header = `${'Model'.padEnd(30)} ${'Vision'.padEnd(8)} ${'Tools'.padEnd(8)} ${'Context'.padEnd(10)} ${'Input'.padEnd(10)} Output`;
      console.log(chalk.dim(header));
    } else if (line.startsWith('model|')) {
      const parts = line.slice(6).split('|');
      const id = parts[0];
      const name = parts[1];
      const vision = parts[2] === '1' ? chalk.green('✓') : chalk.red('✗');
      const tools = parts[3] === '1' ? chalk.green('✓') : chalk.red('✗');
      const contextWindow = parseInt(parts[4], 10);
      const inputPrice = parseFloat(parts[5]);
      const outputPrice = parseFloat(parts[6]);

      // Format context window
      let contextStr = '-';
      if (contextWindow > 0) {
        if (contextWindow >= 1000000) {
          contextStr = `${(contextWindow / 1000000).toFixed(1)}M`;
        } else if (contextWindow >= 1000) {
          contextStr = `${Math.round(contextWindow / 1000)}K`;
        } else {
          contextStr = contextWindow.toString();
        }
      }

      // Format pricing
      let inputStr = 'free';
      let outputStr = 'free';
      if (inputPrice > 0) {
        inputStr = `$${inputPrice.toFixed(2)}`;
      }
      if (outputPrice > 0) {
        outputStr = `$${outputPrice.toFixed(2)}`;
      }

      // Determine display name (use ID if shorter or same as name)
      const displayName = id.length <= 30 ? id : name;

      console.log(
        `${displayName.padEnd(30)} ${vision.padEnd(8 + vision.length - 1)} ${tools.padEnd(8 + tools.length - 1)} ${contextStr.padEnd(10)} ${inputStr.padEnd(10)} ${outputStr}`
      );
    }
  }

  // Print notes/warnings
  if (notes.length > 0) {
    console.log();
    for (const note of notes) {
      console.log(chalk.dim(`  ${note}`));
    }
  }

  console.log(chalk.dim('\n  Pricing is per million tokens (MTok)'));
  return true;
});

// ============================================
// Switch Output Handlers
// ============================================

registerHandler('__SWITCH_SUCCESS__|', (output) => {
  const parts = output.split('|');
  const provider = parts[1];
  const model = parts[2];
  console.log(chalk.green(`\nSwitched to ${provider}/${model}`));
  return true;
});

registerHandler('__SWITCH_FAILED__|', (output) => {
  const parts = output.split('|');
  const error = parts.slice(1).join('|');
  console.log(chalk.red(`\nFailed to switch: ${error}`));
  return true;
});

registerHandler('__SWITCH_HELP__', () => {
  console.log(chalk.dim('\nUsage: /switch <provider> [model]'));
  console.log(chalk.dim('  or   /switch <model>'));
  console.log(chalk.dim('\nExamples:'));
  console.log(chalk.dim('  /switch anthropic claude-sonnet-4-20250514'));
  console.log(chalk.dim('  /switch openai gpt-4o'));
  console.log(chalk.dim('  /switch ollama llama3.2'));
  console.log(chalk.dim('  /switch gpt-5  (auto-detect provider)'));
  return true;
});

// ============================================
// Model Map Output Handlers
// ============================================

registerHandler('__MODELMAP_NOT_FOUND__', () => {
  console.log(chalk.yellow('\nNo model map configuration found.'));
  console.log(chalk.dim('Run /modelmap init to create a codi-models.yaml file.'));
  return true;
});

registerHandler('__MODELMAP_SHOW__', (output) => {
  const lines = output.split('\n');
  for (const line of lines) {
    if (line === '__MODELMAP_SHOW__') continue;
    const parts = line.split('|');

    switch (parts[0]) {
      case 'global':
        console.log(chalk.dim(`Global: ${parts[1]}`));
        break;
      case 'project':
        console.log(chalk.dim(`Project: ${parts[1]}`));
        break;
      case 'file':
        console.log(chalk.dim(`File: ${parts[1]}`));
        break;
      case 'version':
        console.log(chalk.dim(`Version: ${parts[1]}`));
        break;
      case 'models_header':
        console.log(chalk.bold.cyan(`Models (${parts[1]}):`));
        break;
      case 'model':
        console.log(`  ${chalk.cyan(parts[1])}: ${parts[2]}/${parts[3]}${parts[4] ? chalk.dim(` - ${parts[4]}`) : ''}`);
        break;
      case 'tasks_header':
        console.log(chalk.bold.green(`\nTasks (${parts[1]}):`));
        break;
      case 'task':
        console.log(`  ${chalk.green(parts[1])}: → ${parts[2]}${parts[3] ? chalk.dim(` - ${parts[3]}`) : ''}`);
        break;
      case 'pipelines_header':
        if (parts[1] !== '0') {
          console.log(chalk.bold.magenta(`\nPipelines (${parts[1]}):`));
        }
        break;
      case 'pipeline':
        console.log(`  ${chalk.magenta(parts[1])}: ${parts[2]} steps${parts[3] ? chalk.dim(` - ${parts[3]}`) : ''}`);
        break;
      case 'fallbacks_header':
        if (parts[1] !== '0') {
          console.log(chalk.bold.yellow(`\nFallback Chains (${parts[1]}):`));
        }
        break;
      case 'fallback':
        console.log(`  ${chalk.yellow(parts[1])}: ${parts[2]}`);
        break;
      case 'commands_header':
        console.log(chalk.bold.blue(`\nCommand Overrides (${parts[1]}):`));
        break;
      case 'command':
        console.log(`  /${chalk.blue(parts[1])}: ${parts[2]} → ${parts[3]}`);
        break;
    }
  }
  return true;
});

registerHandler('__MODELMAP_INIT__', (output) => {
  const parts = output.split(':');
  const path = parts.slice(1).join(':');
  console.log(chalk.green(`\nCreated model map: ${path}`));
  console.log(chalk.dim('Edit this file to configure multi-model workflows.'));
  return true;
});

registerHandler('__MODELMAP_INIT_EXISTS__', (output) => {
  const parts = output.split(':');
  const path = parts.slice(1).join(':');
  console.log(chalk.yellow(`\nModel map already exists: ${path}`));
  return true;
});

registerHandler('__MODELMAP_EXAMPLE__', (output) => {
  const example = output.split('\n').slice(1).join('\n');
  console.log(chalk.bold('\nExample model map (codi-models.yaml):'));
  console.log(chalk.dim(example));
  return true;
});

// ============================================
// Pipeline Output Handlers
// ============================================

registerHandler('__PIPELINE_LIST__', (output) => {
  const lines = output.split('\n');
  console.log(chalk.bold('\nAvailable Pipelines:'));
  for (const line of lines) {
    if (line === '__PIPELINE_LIST__') continue;
    const parts = line.split('|');
    if (parts[0] === 'pipeline') {
      console.log(`  ${chalk.magenta(parts[1])}: ${parts[2]} steps${parts[3] ? chalk.dim(` - ${parts[3]}`) : ''}`);
    }
  }
  return true;
});

registerHandler('__PIPELINE_NONE__', () => {
  console.log(chalk.dim('\nNo pipelines configured.'));
  console.log(chalk.dim('Add pipelines to codi-models.yaml to enable multi-model workflows.'));
  return true;
});

registerHandler('__PIPELINE_NOT_FOUND__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  console.log(chalk.yellow(`\nPipeline not found: ${name}`));
  console.log(chalk.dim('Use /pipeline to list available pipelines.'));
  return true;
});

registerHandler('__PIPELINE_INFO__', (output) => {
  const lines = output.split('\n');
  for (const line of lines) {
    if (line === '__PIPELINE_INFO__') continue;
    const parts = line.split('|');

    switch (parts[0]) {
      case 'name':
        console.log(chalk.bold(`\nPipeline: ${parts[1]}`));
        break;
      case 'roles':
        console.log(chalk.dim(`Available roles: ${parts[1]}`));
        break;
      case 'description':
        console.log(chalk.dim(`Description: ${parts[1]}`));
        break;
      case 'default_provider':
        console.log(chalk.dim(`Default provider: ${parts[1]}`));
        break;
      case 'steps_header':
        console.log(chalk.bold(`\nSteps (${parts[1]}):`));
        break;
      case 'step': {
        const label = parts[2].startsWith('role:')
          ? chalk.blue(parts[2])
          : chalk.cyan(`model: ${parts[2]}`);
        const value = parts[2].startsWith('role:') ? parts[2].slice(5) : parts[2];
        console.log(`  ${chalk.cyan(parts[1])} → ${label}: ${chalk.yellow(value)}, output: ${chalk.green(parts[3])}`);
        break;
      }
      case 'result':
        console.log(chalk.dim(`\nResult template: ${parts[1]}`));
        break;
      case 'usage':
        console.log(chalk.dim(`\n${parts[1]}`));
        break;
    }
  }
  return true;
});

registerHandler('__PIPELINE_RUNNING__', (output) => {
  const parts = output.split(':');
  const name = parts[1];
  const steps = parts[2];
  console.log(chalk.cyan(`\nRunning pipeline: ${name} (${steps} steps)`));
  return true;
});

registerHandler('__PIPELINE_STEP__', (output) => {
  const parts = output.split(':');
  const step = parts[1];
  const total = parts[2];
  const name = parts[3];
  const model = parts[4];
  console.log(chalk.dim(`  [${step}/${total}] ${name} using ${model}...`));
  return true;
});

registerHandler('__PIPELINE_COMPLETE__', () => {
  console.log(chalk.green('\nPipeline complete.'));
  return true;
});

registerHandler('__PIPELINE_ERROR__', (output) => {
  const parts = output.split(':');
  const error = parts.slice(1).join(':');
  console.log(chalk.red(`\nPipeline error: ${error}`));
  return true;
});

// ============================================
// Import Output Handlers
// ============================================

registerHandler('__IMPORT_COMPLETE__', (output) => {
  const lines = output.split('\n');
  console.log(chalk.green('\n' + lines[0])); // "Imported X conversations"
  for (const line of lines.slice(1)) {
    if (line.trim()) {
      console.log(chalk.dim(`  ${line}`));
    }
  }
  return true;
});

registerHandler('__IMPORT_FAILED__', (output) => {
  const parts = output.split(':');
  const error = parts.slice(1).join(':');
  console.log(chalk.red(`\nImport failed: ${error}`));
  return true;
});

registerHandler('__IMPORT_PREVIEW__', (output) => {
  const lines = output.split('\n');
  console.log(chalk.bold('\n' + lines[0])); // "Found X conversations"
  for (const line of lines.slice(1)) {
    if (line.trim()) {
      console.log(chalk.dim(`  ${line}`));
    }
  }
  return true;
});

registerHandler('__IMPORT_NO_FILE__', () => {
  console.log(chalk.yellow('\nNo file specified for import.'));
  console.log(chalk.dim('Usage: /import <path-to-conversations.json>'));
  return true;
});

registerHandler('__IMPORT_FILE_NOT_FOUND__', (output) => {
  const parts = output.split(':');
  const path = parts.slice(1).join(':');
  console.log(chalk.red(`\nFile not found: ${path}`));
  return true;
});

// ============================================
// Memory Output Handlers
// ============================================

registerHandler('__MEMORY_SAVED__', (output) => {
  const parts = output.split(':');
  const category = parts[1] || 'general';
  console.log(chalk.green(`\nMemory saved to ${category}.`));
  return true;
});

registerHandler('__MEMORY_DUPLICATE__', (output) => {
  const parts = output.split(':');
  const fact = parts.slice(1).join(':');
  console.log(chalk.yellow(`\nSimilar memory already exists:`));
  console.log(chalk.dim(`  "${fact}"`));
  return true;
});

registerHandler('__MEMORY_EMPTY__', () => {
  console.log(chalk.dim('\nNo input provided.'));
  console.log(chalk.dim('Usage: /remember [category:] <fact>'));
  return true;
});

registerHandler('__MEMORY_LIST__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nStored Memories:'));
  let currentCategory = '';
  for (const line of lines) {
    if (line.startsWith('  [')) {
      const category = line.match(/\[(.*?)\]/)?.[1] || '';
      if (category !== currentCategory) {
        currentCategory = category;
        console.log(chalk.cyan(`\n[${category}]`));
      }
      const content = line.replace(/^\s*\[.*?\]\s*/, '');
      console.log(chalk.dim(`  ${content}`));
    } else {
      const byCategory = new Map<string, string[]>();
      if (byCategory.size > 0) console.log(chalk.cyan('\n[General]'));
      console.log(chalk.dim(`  ${line}`));
    }
  }
  return true;
});

registerHandler('__MEMORY_LIST_EMPTY__', () => {
  console.log(chalk.dim('\nNo memories stored.'));
  console.log(chalk.dim('Use /remember <fact> to store information.'));
  return true;
});

registerHandler('__MEMORY_FORGOT__', (output) => {
  const parts = output.split(':');
  const count = parts[1];
  console.log(chalk.green(`\nForgot ${count} memor${count === '1' ? 'y' : 'ies'}.`));
  return true;
});

registerHandler('__MEMORY_FORGOT_NONE__', (output) => {
  const parts = output.split(':');
  const pattern = parts.slice(1).join(':');
  console.log(chalk.yellow(`\nNo memories matching: ${pattern}`));
  return true;
});

registerHandler('__MEMORY_CONSOLIDATE__', (output) => {
  const parts = output.split(':');
  const count = parts[1];
  console.log(chalk.green(`\nConsolidated ${count} session notes into memories.`));
  return true;
});

registerHandler('__MEMORY_CONSOLIDATE_EMPTY__', () => {
  console.log(chalk.dim('\nNo session notes to consolidate.'));
  return true;
});

registerHandler('__PROFILE_SHOW__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nUser Profile:'));
  for (const line of lines) {
    console.log(chalk.dim(`  ${line}`));
  }
  return true;
});

registerHandler('__PROFILE_EMPTY__', () => {
  console.log(chalk.dim('\nNo profile set.'));
  console.log(chalk.dim('Use /profile set <key> <value> to set profile values.'));
  return true;
});

registerHandler('__PROFILE_SET__', (output) => {
  const parts = output.split(':');
  const key = parts[1];
  const value = parts.slice(2).join(':');
  console.log(chalk.green(`\nProfile updated: ${key} = ${value}`));
  return true;
});

registerHandler('__PROFILE_INVALID_KEY__', (output) => {
  const parts = output.split(':');
  const key = parts[1];
  console.log(chalk.yellow(`\nUnknown profile key: ${key}`));
  console.log(chalk.dim('Valid keys: name, preferences.language, preferences.style, preferences.verbosity, expertise, avoid'));
  return true;
});

// ============================================
// Compression Output Handlers
// ============================================

registerHandler('__COMPRESSION_STATUS__', (output) => {
  const parts = output.split(':');
  const enabled = parts[1] === 'true';
  const totalSavings = parseInt(parts[2], 10);
  const savingsPercent = parseFloat(parts[3]);
  const entityCount = parseInt(parts[4], 10);

  console.log(chalk.bold('\nCompression Status:'));
  console.log(chalk.dim(`  Enabled: ${enabled ? chalk.green('yes') : chalk.yellow('no')}`));
  if (enabled) {
    console.log(chalk.dim(`  Entities tracked: ${entityCount}`));
    console.log(chalk.dim(`  Total savings: ${totalSavings.toLocaleString()} chars (${savingsPercent.toFixed(1)}%)`));
  }
  return true;
});

registerHandler('__COMPRESSION_ENABLED__', () => {
  console.log(chalk.green('\nEntity compression enabled.'));
  console.log(chalk.dim('Long identifiers will be shortened to reduce context size.'));
  return true;
});

registerHandler('__COMPRESSION_DISABLED__', () => {
  console.log(chalk.yellow('\nEntity compression disabled.'));
  return true;
});

registerHandler('__COMPRESSION_PREVIEW__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nCompression Preview:'));
  for (const line of lines) {
    console.log(chalk.dim(`  ${line}`));
  }
  return true;
});

// ============================================
// Compact Output Handlers
// ============================================

registerHandler('__COMPACT_STATUS__', (output) => {
  const parts = output.split(':');
  const messageCount = parseInt(parts[1], 10);
  const tokenEstimate = parseInt(parts[2], 10);
  const hasSummary = parts[3] === 'true';
  const compactableCount = parseInt(parts[4], 10);

  console.log(chalk.bold('\nContext Status:'));
  console.log(chalk.dim(`  Messages: ${messageCount}`));
  console.log(chalk.dim(`  Token estimate: ${tokenEstimate.toLocaleString()}`));
  console.log(chalk.dim(`  Has summary: ${hasSummary ? 'yes' : 'no'}`));
  if (compactableCount > 0) {
    console.log(chalk.dim(`  Compactable messages: ${compactableCount}`));
  }
  return true;
});

registerHandler('__COMPACT_NOTHING__', () => {
  console.log(chalk.dim('\nNothing to compact. Context is already minimal.'));
  return true;
});

registerHandler('__COMPACT_COMPLETE__', (output) => {
  const parts = output.split(':');
  const beforeTokens = parseInt(parts[1], 10);
  const afterTokens = parseInt(parts[2], 10);
  const summarizedCount = parseInt(parts[3], 10);

  const saved = beforeTokens - afterTokens;
  const percent = ((saved / beforeTokens) * 100).toFixed(1);

  console.log(chalk.green('\nContext compacted:'));
  console.log(chalk.dim(`  Before: ${beforeTokens.toLocaleString()} tokens`));
  console.log(chalk.dim(`  After: ${afterTokens.toLocaleString()} tokens`));
  console.log(chalk.dim(`  Saved: ${saved.toLocaleString()} tokens (${percent}%)`));
  console.log(chalk.dim(`  Summarized: ${summarizedCount} messages`));
  return true;
});

registerHandler('MEMORY_STATUS:', (output) => {
  const data = JSON.parse(output.slice('MEMORY_STATUS:'.length));
  const statusText = data.status as string;
  const statusColor = statusText === 'critical' ? chalk.red :
                     statusText === 'compact' ? chalk.yellow :
                     statusText === 'warning' ? chalk.cyan : chalk.green;

  console.log(chalk.bold('\nMemory Status'));
  console.log(chalk.dim('─────────────────────────────'));
  console.log(`  Heap Usage: ${data.heap.used_mb}MB / ${data.heap.total_mb}MB`);
  console.log(`  Utilization: ${statusColor(`${data.heap.usage_percent}%`)}`);
  if (data.monitoring.compactionsTriggered > 0) {
    console.log(chalk.dim(`  Auto-compactions: ${data.monitoring.compactionsTriggered}`));
    if (data.monitoring.lastCompactionTime) {
      const lastTime = new Date(data.monitoring.lastCompactionTime);
      console.log(chalk.dim(`  Last: ${lastTime.toLocaleTimeString()}`));
    }
  }
  console.log();

  if (data.heap.status === 'critical' || data.heap.status === 'compact') {
    console.log(chalk.yellow('  Tip: Use /clear to reset session or /compact summarize to free memory'));
  }
  return true;
});

registerHandler('__COMPACT_MEMORY__', (output) => {
  const parts = output.split(':');
  const heapUsed = parseInt(parts[1], 10);
  const heapTotal = parseInt(parts[2], 10);
  const external = parseInt(parts[3], 10);

  const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

  console.log(chalk.bold('\nMemory Usage:'));
  console.log(chalk.dim(`  Heap used: ${formatMB(heapUsed)}`));
  console.log(chalk.dim(`  Heap total: ${formatMB(heapTotal)}`));
  console.log(chalk.dim(`  External: ${formatMB(external)}`));
  return true;
});

// ============================================
// Approval Output Handlers
// ============================================

registerHandler('__APPROVAL_ADDED__', (output) => {
  const parts = output.split(':');
  const pattern = parts.slice(1).join(':');
  console.log(chalk.green(`\nApproval pattern added: ${pattern}`));
  console.log(chalk.dim('This pattern will auto-approve matching tool operations.'));
  return true;
});

registerHandler('__APPROVAL_REMOVED__', (output) => {
  const parts = output.split(':');
  const pattern = parts.slice(1).join(':');
  console.log(chalk.green(`\nApproval pattern removed: ${pattern}`));
  return true;
});

registerHandler('__APPROVAL_NOT_FOUND__', (output) => {
  const parts = output.split(':');
  const pattern = parts.slice(1).join(':');
  console.log(chalk.yellow(`\nPattern not found: ${pattern}`));
  return true;
});

registerHandler('__APPROVAL_LIST__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nAuto-Approval Patterns:'));
  if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
    console.log(chalk.dim('  No patterns configured.'));
  } else {
    for (const line of lines) {
      if (line.trim()) {
        console.log(chalk.dim(`  ${line}`));
      }
    }
  }
  return true;
});

registerHandler('__APPROVAL_HELP__', () => {
  console.log(chalk.bold('\nUsage:'));
  console.log(chalk.dim('  /approve <pattern>   Add an auto-approval pattern'));
  console.log(chalk.dim('  /approve -r <pattern> Remove a pattern'));
  console.log(chalk.dim('  /approve -l          List current patterns'));
  console.log(chalk.bold('\nExamples:'));
  console.log(chalk.dim('  /approve read:*             Auto-approve all read operations'));
  console.log(chalk.dim('  /approve bash:npm test      Auto-approve specific bash command'));
  console.log(chalk.dim('  /approve write:src/**/*.ts  Auto-approve writes to TypeScript files'));
  return true;
});

// ============================================
// Symbols Output Handlers
// ============================================

registerHandler('__SYMBOLS_REBUILDING__', () => {
  console.log(chalk.cyan('\nRebuilding symbol index...'));
  return true;
});

registerHandler('__SYMBOLS_REBUILD_COMPLETE__', (output) => {
  const parts = output.split(':');
  const symbols = parts[1];
  const files = parts[2];
  const duration = parts[3];
  console.log(chalk.green(`\nSymbol index rebuilt: ${symbols} symbols in ${files} files (${duration}ms)`));
  return true;
});

registerHandler('__SYMBOLS_UPDATING__', () => {
  console.log(chalk.cyan('\nUpdating symbol index...'));
  return true;
});

registerHandler('__SYMBOLS_UPDATE_COMPLETE__', (output) => {
  const parts = output.split(':');
  const added = parts[1];
  const removed = parts[2];
  const duration = parts[3];
  console.log(chalk.green(`\nSymbol index updated: +${added} -${removed} symbols (${duration}ms)`));
  return true;
});

registerHandler('__SYMBOLS_STATS__', (output) => {
  const parts = output.split(':');
  const totalSymbols = parts[1];
  const totalFiles = parts[2];
  const byType = JSON.parse(parts.slice(3).join(':')) as Record<string, number>;

  console.log(chalk.bold('\nSymbol Index Stats:'));
  console.log(chalk.dim(`  Total symbols: ${totalSymbols}`));
  console.log(chalk.dim(`  Total files: ${totalFiles}`));
  console.log(chalk.dim('  By type:'));
  for (const [type, count] of Object.entries(byType)) {
    console.log(chalk.dim(`    ${type}: ${count}`));
  }
  return true;
});

registerHandler('__SYMBOLS_NOT_INDEXED__', () => {
  console.log(chalk.yellow('\nSymbol index not available.'));
  console.log(chalk.dim('Run /symbols rebuild to create the index.'));
  return true;
});

registerHandler('__SYMBOLS_CLEARED__', () => {
  console.log(chalk.green('\nSymbol index cleared.'));
  return true;
});

registerHandler('__SYMBOLS_SEARCH__', (output) => {
  const lines = output.split('\n').slice(1);
  console.log(chalk.bold('\nSymbol Search Results:'));
  if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
    console.log(chalk.dim('  No matches found.'));
  } else {
    for (const line of lines) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
  }
  return true;
});

registerHandler('__SYMBOLS_SEARCH_EMPTY__', () => {
  console.log(chalk.yellow('\nPlease provide a search term.'));
  console.log(chalk.dim('Usage: /symbols search <name>'));
  return true;
});

registerHandler('__SYMBOLS_HELP__', () => {
  console.log(chalk.dim('\nUsage: /symbols [rebuild|update|stats|search <name>|clear]'));
  return true;
});

/**
 * Default handler for unmatched output.
 * Simply prints the output as dim text.
 */
export function defaultHandler(output: string): void {
  console.log(chalk.dim(output));
}
