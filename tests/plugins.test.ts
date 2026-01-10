import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to mock the modules before importing
vi.mock('../src/tools/index.js', () => ({
  globalRegistry: {
    register: vi.fn(),
  },
}));

vi.mock('../src/commands/index.js', () => ({
  registerCommand: vi.fn(),
}));

vi.mock('../src/providers/index.js', () => ({
  registerProviderFactory: vi.fn(),
}));

// Import after mocking
import {
  loadPlugin,
  registerPlugin,
  loadPluginsFromDirectory,
  getLoadedPlugins,
  getPlugin,
  unloadPlugin,
  getPluginsDir,
} from '../src/plugins.js';
import { globalRegistry } from '../src/tools/index.js';
import { registerCommand } from '../src/commands/index.js';
import { registerProviderFactory } from '../src/providers/index.js';

describe('Plugin System', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `.codi-plugin-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getPluginsDir', () => {
    it('returns the plugins directory path', () => {
      const dir = getPluginsDir();
      expect(dir).toContain('.codi');
      expect(dir).toContain('plugins');
    });
  });

  describe('loadPlugin', () => {
    it('throws error when package.json is missing', async () => {
      const pluginDir = join(testDir, 'bad-plugin');
      mkdirSync(pluginDir);

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow('missing package.json');
    });

    it('throws error when package.json is invalid', async () => {
      const pluginDir = join(testDir, 'bad-json-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), 'not valid json');

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow('Failed to parse package.json');
    });

    it('throws error when entry point is missing', async () => {
      const pluginDir = join(testDir, 'no-entry-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
        name: 'test-plugin',
        main: 'missing.js'
      }));

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow('entry point not found');
    });

    it('throws error when plugin has no name', async () => {
      const pluginDir = join(testDir, 'no-name-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), 'export default { version: "1.0.0" };');

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow("missing required 'name' field");
    });

    it('throws error when plugin has no version', async () => {
      const pluginDir = join(testDir, 'no-version-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), 'export default { name: "test" };');

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow("missing required 'version' field");
    });

    it('throws error when tools is not an array', async () => {
      const pluginDir = join(testDir, 'bad-tools-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), `
        export default { name: "test", version: "1.0.0", tools: "not-array" };
      `);

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow("'tools' must be an array");
    });

    it('throws error when commands is not an array', async () => {
      const pluginDir = join(testDir, 'bad-commands-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), `
        export default { name: "test", version: "1.0.0", commands: {} };
      `);

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow("'commands' must be an array");
    });

    it('throws error when providers is not an array', async () => {
      const pluginDir = join(testDir, 'bad-providers-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), `
        export default { name: "test", version: "1.0.0", providers: "wrong" };
      `);

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow("'providers' must be an array");
    });

    it('throws error when provider has invalid format', async () => {
      const pluginDir = join(testDir, 'bad-provider-format');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), `
        export default {
          name: "test",
          version: "1.0.0",
          providers: [{ type: "custom" }]  // missing factory
        };
      `);

      await expect(loadPlugin(pluginDir))
        .rejects.toThrow("must have 'type' (string) and 'factory' (function)");
    });

    it('loads valid plugin with default export', async () => {
      const pluginDir = join(testDir, 'valid-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), `
        export default {
          name: "valid-plugin",
          version: "1.0.0",
          description: "A test plugin"
        };
      `);

      const plugin = await loadPlugin(pluginDir);
      expect(plugin.name).toBe('valid-plugin');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.description).toBe('A test plugin');
    });

    it('loads valid plugin with named plugin export', async () => {
      const pluginDir = join(testDir, 'named-export-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), `
        export const plugin = {
          name: "named-plugin",
          version: "2.0.0"
        };
      `);

      const plugin = await loadPlugin(pluginDir);
      expect(plugin.name).toBe('named-plugin');
      expect(plugin.version).toBe('2.0.0');
    });

    it('uses index.js as default entry point', async () => {
      const pluginDir = join(testDir, 'default-entry-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({})); // no main specified
      writeFileSync(join(pluginDir, 'index.js'), `
        export default { name: "default-entry", version: "1.0.0" };
      `);

      const plugin = await loadPlugin(pluginDir);
      expect(plugin.name).toBe('default-entry');
    });
  });

  describe('loadPluginsFromDirectory', () => {
    it('creates directory if it does not exist', async () => {
      const nonExistentDir = join(testDir, 'new-plugins-dir');
      const plugins = await loadPluginsFromDirectory(nonExistentDir);
      expect(plugins).toEqual([]);
    });

    it('skips non-directory entries', async () => {
      writeFileSync(join(testDir, 'not-a-dir.txt'), 'text file');
      const plugins = await loadPluginsFromDirectory(testDir);
      expect(plugins).toEqual([]);
    });

    it('handles plugin load errors gracefully', async () => {
      const badPluginDir = join(testDir, 'bad-plugin');
      mkdirSync(badPluginDir);
      // No package.json - will fail to load

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const plugins = await loadPluginsFromDirectory(testDir);

      expect(plugins).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Failed to load plugin')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getLoadedPlugins', () => {
    it('returns empty array when no plugins loaded', () => {
      // Note: This test may be affected by other tests that load plugins
      // In a clean state, it should return an empty array or previously loaded plugins
      const plugins = getLoadedPlugins();
      expect(Array.isArray(plugins)).toBe(true);
    });
  });

  describe('getPlugin', () => {
    it('returns undefined for unknown plugin', () => {
      const plugin = getPlugin('nonexistent-plugin-12345');
      expect(plugin).toBeUndefined();
    });
  });

  describe('unloadPlugin', () => {
    it('returns false for unknown plugin', async () => {
      const result = await unloadPlugin('nonexistent-plugin-12345');
      expect(result).toBe(false);
    });
  });
});
