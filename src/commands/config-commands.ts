// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Configuration management commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  loadWorkspaceConfig,
  validateConfig,
  initConfig,
  getExampleConfig,
} from '../config.js';

/**
 * /config command - View or initialize workspace configuration.
 */
export const configCommand: Command = {
  name: 'config',
  aliases: ['cfg'],
  description: 'View or initialize workspace configuration',
  usage: '/config [init|show|example]',
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim();

    // Handle help flag locally without API call
    if (trimmed === '-h' || trimmed === '--help') {
      console.log('\nUsage: /config [init|show|example]');
      console.log('\nView or initialize workspace configuration (.codi.json).');
      console.log('\nActions:');
      console.log('  show      Show current configuration (default)');
      console.log('  init      Create a new .codi.json file');
      console.log('  example   Show example configuration');
      console.log('\nExamples:');
      console.log('  /config          Show current configuration');
      console.log('  /config init     Create .codi.json');
      console.log('  /config example  Show example JSON');
      console.log();
      return null;
    }

    const action = trimmed.split(/\s+/)[0] || 'show';

    switch (action) {
      case 'init': {
        const result = initConfig();
        if (result.success) {
          return `__CONFIG_INIT__:${result.path}`;
        } else {
          return `__CONFIG_INIT_FAILED__:${result.error}`;
        }
      }

      case 'example': {
        return `__CONFIG_EXAMPLE__:${getExampleConfig()}`;
      }

      case 'show':
      default: {
        const { config, configPath } = loadWorkspaceConfig();
        if (!config || !configPath) {
          return '__CONFIG_NOT_FOUND__';
        }

        const warnings = validateConfig(config);
        const warningsJson = JSON.stringify(warnings);
        const configJson = JSON.stringify(config, null, 2);

        return `__CONFIG_SHOW__:${configPath}:${warningsJson}:${configJson}`;
      }
    }
  },
};

/**
 * Register all config commands.
 */
export function registerConfigCommands(): void {
  registerCommand(configCommand);
}
