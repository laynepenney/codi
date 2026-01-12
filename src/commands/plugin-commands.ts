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
  description: 'List loaded plugins and plugin information',
  usage: '/plugins [info <name>]',
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim();
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    // /plugins info <name>
    if (subcommand === 'info' && parts[1]) {
      const name = parts[1];
      const loaded = getPlugin(name);

      if (!loaded) {
        return `__PLUGIN_NOT_FOUND__:${name}`;
      }

      const { plugin, path, loadedAt } = loaded;
      const toolCount = plugin.tools?.length || 0;
      const commandCount = plugin.commands?.length || 0;
      const providerCount = plugin.providers?.length || 0;

      return `__PLUGIN_INFO__:${plugin.name}:${plugin.version}:${plugin.description || ''}:${toolCount}:${commandCount}:${providerCount}:${path}:${loadedAt.toISOString()}`;
    }

    // /plugins dir
    if (subcommand === 'dir') {
      return `__PLUGINS_DIR__:${getPluginsDir()}`;
    }

    // /plugins (list all)
    const plugins = getLoadedPlugins();

    if (plugins.length === 0) {
      return `__PLUGINS_EMPTY__:${getPluginsDir()}`;
    }

    const lines = plugins.map(({ plugin }) => {
      const toolCount = plugin.tools?.length || 0;
      const commandCount = plugin.commands?.length || 0;
      const providerCount = plugin.providers?.length || 0;
      return `${plugin.name}:${plugin.version}:${toolCount}:${commandCount}:${providerCount}`;
    });

    return `__PLUGINS_LIST__\n${lines.join('\n')}`;
  },
};

/**
 * Register all plugin commands.
 */
export function registerPluginCommands(): void {
  registerCommand(pluginsCommand);
}
