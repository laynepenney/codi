// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Plugin system for extending Codi with custom tools, commands, and providers.
 */
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import type { BaseTool } from './tools/base.js';
import type { Command } from './commands/index.js';
import type { BaseProvider } from './providers/base.js';
import type { ProviderConfig } from './types.js';
import { globalRegistry } from './tools/index.js';
import { registerCommand } from './commands/index.js';
import { registerProviderFactory } from './providers/index.js';

/** Directory where user plugins are stored */
const PLUGINS_DIR = path.join(homedir(), '.codi', 'plugins');

/**
 * Plugin interface that third-party extensions must implement.
 */
export interface CodiPlugin {
  /** Unique plugin name */
  name: string;
  /** Plugin version (semver) */
  version: string;
  /** Optional description */
  description?: string;

  /** Tools to register */
  tools?: BaseTool[];

  /** Commands to register */
  commands?: Command[];

  /** Providers to register */
  providers?: {
    /** Provider type name (e.g., 'gemini', 'azure') */
    type: string;
    /** Factory function to create provider instances */
    factory: (options: ProviderConfig) => BaseProvider;
  }[];

  /** Called after plugin is loaded and registered */
  onLoad?: () => Promise<void>;

  /** Called when plugin is unloaded */
  onUnload?: () => Promise<void>;
}

/** Loaded plugin with metadata */
interface LoadedPlugin {
  plugin: CodiPlugin;
  path: string;
  loadedAt: Date;
}

/** Registry of loaded plugins */
const loadedPlugins: Map<string, LoadedPlugin> = new Map();

/**
 * Validate that an object implements the CodiPlugin interface.
 */
function validatePlugin(obj: unknown, sourcePath: string): CodiPlugin {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`Plugin at ${sourcePath} does not export a valid object`);
  }

  const plugin = obj as Record<string, unknown>;

  if (typeof plugin.name !== 'string' || !plugin.name) {
    throw new Error(`Plugin at ${sourcePath} missing required 'name' field`);
  }

  if (typeof plugin.version !== 'string' || !plugin.version) {
    throw new Error(`Plugin at ${sourcePath} missing required 'version' field`);
  }

  // Validate tools array if present
  if (plugin.tools !== undefined && !Array.isArray(plugin.tools)) {
    throw new Error(`Plugin ${plugin.name}: 'tools' must be an array`);
  }

  // Validate commands array if present
  if (plugin.commands !== undefined && !Array.isArray(plugin.commands)) {
    throw new Error(`Plugin ${plugin.name}: 'commands' must be an array`);
  }

  // Validate providers array if present
  if (plugin.providers !== undefined) {
    if (!Array.isArray(plugin.providers)) {
      throw new Error(`Plugin ${plugin.name}: 'providers' must be an array`);
    }
    for (const p of plugin.providers) {
      if (typeof p.type !== 'string' || typeof p.factory !== 'function') {
        throw new Error(`Plugin ${plugin.name}: each provider must have 'type' (string) and 'factory' (function)`);
      }
    }
  }

  return plugin as unknown as CodiPlugin;
}

/**
 * Load a plugin from a directory.
 */
export async function loadPlugin(pluginDir: string): Promise<CodiPlugin> {
  // Check for package.json
  const packagePath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Plugin directory ${pluginDir} missing package.json`);
  }

  // Read package.json to find entry point
  let packageJson: { main?: string };
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to parse package.json in ${pluginDir}: ${error}`);
  }

  // Determine entry point
  const entryPoint = packageJson.main || 'index.js';
  const entryPath = path.join(pluginDir, entryPoint);

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Plugin entry point not found: ${entryPath}`);
  }

  // Dynamic import (ESM)
  const moduleUrl = pathToFileURL(entryPath).href;
  const module = await import(moduleUrl);

  // Get plugin export (default export or named 'plugin' export)
  const pluginExport = module.default || module.plugin;

  if (!pluginExport) {
    throw new Error(`Plugin at ${pluginDir} does not export a default or 'plugin' export`);
  }

  return validatePlugin(pluginExport, pluginDir);
}

/**
 * Register a plugin's tools, commands, and providers.
 */
export async function registerPlugin(plugin: CodiPlugin, pluginPath: string): Promise<void> {
  // Check for duplicate
  if (loadedPlugins.has(plugin.name)) {
    throw new Error(`Plugin '${plugin.name}' is already loaded`);
  }

  // Register tools
  if (plugin.tools && plugin.tools.length > 0) {
    for (const tool of plugin.tools) {
      globalRegistry.register(tool);
    }
  }

  // Register commands
  if (plugin.commands && plugin.commands.length > 0) {
    for (const command of plugin.commands) {
      registerCommand(command);
    }
  }

  // Register providers
  if (plugin.providers && plugin.providers.length > 0) {
    for (const { type, factory } of plugin.providers) {
      registerProviderFactory(type, factory);
    }
  }

  // Call onLoad hook
  if (plugin.onLoad) {
    await plugin.onLoad();
  }

  // Track loaded plugin
  loadedPlugins.set(plugin.name, {
    plugin,
    path: pluginPath,
    loadedAt: new Date(),
  });
}

/**
 * Load all plugins from the plugins directory.
 */
export async function loadPluginsFromDirectory(directory: string = PLUGINS_DIR): Promise<LoadedPlugin[]> {
  // Create directory if it doesn't exist
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    return [];
  }

  const loaded: LoadedPlugin[] = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(directory, entry.name);

    try {
      const plugin = await loadPlugin(pluginDir);
      await registerPlugin(plugin, pluginDir);
      loaded.push(loadedPlugins.get(plugin.name)!);
    } catch (error) {
      console.warn(`Warning: Failed to load plugin from ${entry.name}: ${error}`);
    }
  }

  return loaded;
}

/**
 * Get all loaded plugins.
 */
export function getLoadedPlugins(): LoadedPlugin[] {
  return Array.from(loadedPlugins.values());
}

/**
 * Get a loaded plugin by name.
 */
export function getPlugin(name: string): LoadedPlugin | undefined {
  return loadedPlugins.get(name);
}

/**
 * Unload a plugin by name.
 */
export async function unloadPlugin(name: string): Promise<boolean> {
  const loaded = loadedPlugins.get(name);
  if (!loaded) {
    return false;
  }

  // Call onUnload hook
  if (loaded.plugin.onUnload) {
    await loaded.plugin.onUnload();
  }

  // Note: We can't easily unregister tools/commands/providers
  // since the registries don't support removal. The plugin will
  // be inactive until restart.

  loadedPlugins.delete(name);
  return true;
}

/**
 * Get the plugins directory path.
 */
export function getPluginsDir(): string {
  return PLUGINS_DIR;
}
