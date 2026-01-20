// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Plugin management commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import { getLoadedPlugins, getPlugin, getPluginsDir } from '../plugins.js';

/**
 * /plugins command - List and manage plugins.
 */
export const pluginsCommand: Command = {
  name: 'plugins',
  aliases: ['plugin'],
  description: 'List loaded plugins and plugin information (currently disabled)',
  usage: '/plugins',
  taskType: 'fast',
  execute: async (_args: string, _context: CommandContext): Promise<string | null> => {
    // Plugin system is disabled pending further investigation
    // See: https://github.com/laynepenney/codi/issues/17
    return '__PLUGINS_DISABLED__';
  },
};

/**
 * Register all plugin commands.
 */
export function registerPluginCommands(): void {
  registerCommand(pluginsCommand);
}
