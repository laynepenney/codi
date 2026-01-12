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
  execute: async (args: string, _context: CommandContext): Promise<string> => {
    const action = args.trim().split(/\s+/)[0] || 'show';

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
