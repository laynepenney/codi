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
import { initModelMapFile } from '../model-map/index.js';
import { initContextFile } from '../context.js';

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
 * /init command - Initialize Codi in the current project.
 * Creates configuration files if they don't exist.
 */
export const initCommand: Command = {
  name: 'init',
  aliases: ['setup'],
  description: 'Initialize Codi in the current project',
  usage: '/init [--config] [--modelmap] [--context] [--all]',
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim().toLowerCase();

    // Handle help flag locally without API call
    if (trimmed === '-h' || trimmed === '--help') {
      console.log('\nUsage: /init [--config] [--modelmap] [--context] [--all]');
      console.log('\nInitialize Codi configuration files in the current project.');
      console.log('\nOptions:');
      console.log('  --config    Create .codi.json only');
      console.log('  --modelmap  Create codi-models.yaml only');
      console.log('  --context   Create CODI.md only');
      console.log('  --all       Create all config files (default)');
      console.log('\nFiles created:');
      console.log('  .codi.json        Workspace configuration (providers, auto-approve, RAG)');
      console.log('  codi-models.yaml  Model map (named models, pipelines, roles)');
      console.log('  CODI.md           Project context for AI assistants');
      console.log('\nExamples:');
      console.log('  /init              Initialize all config files');
      console.log('  /init --config     Create only .codi.json');
      console.log('  /init --modelmap   Create only codi-models.yaml');
      console.log('  /init --context    Create only CODI.md');
      console.log();
      return null;
    }

    const configOnly = trimmed === '--config';
    const modelMapOnly = trimmed === '--modelmap';
    const contextOnly = trimmed === '--context';
    const createAll = !configOnly && !modelMapOnly && !contextOnly;

    const results: string[] = [];

    // Create .codi.json
    if (createAll || configOnly) {
      const configResult = initConfig();
      if (configResult.success) {
        results.push(`config:created:${configResult.path}`);
      } else if (configResult.error?.includes('already exists')) {
        results.push(`config:exists:${configResult.path}`);
      } else {
        results.push(`config:error:${configResult.error}`);
      }
    }

    // Create codi-models.yaml
    if (createAll || modelMapOnly) {
      const modelMapResult = initModelMapFile(process.cwd());
      if (modelMapResult.success) {
        results.push(`modelmap:created:${modelMapResult.path}`);
      } else if (modelMapResult.error?.includes('already exists')) {
        results.push(`modelmap:exists:${modelMapResult.path}`);
      } else {
        results.push(`modelmap:error:${modelMapResult.error}`);
      }
    }

    // Create CODI.md
    if (createAll || contextOnly) {
      const contextResult = initContextFile(process.cwd());
      if (contextResult.success) {
        results.push(`context:created:${contextResult.path}`);
      } else if (contextResult.error?.includes('already exists')) {
        results.push(`context:exists:${contextResult.path}`);
      } else {
        results.push(`context:error:${contextResult.error}`);
      }
    }

    return `__INIT_RESULT__|${results.join('|')}`;
  },
};

/**
 * Register all config commands.
 */
export function registerConfigCommands(): void {
  registerCommand(configCommand);
  registerCommand(initCommand);
}
