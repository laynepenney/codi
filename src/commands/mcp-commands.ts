// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { registerCommand, type Command } from './index.js';
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../config.js';
import chalk from 'chalk';

/**
 * Well-known MCP servers with their configurations.
 */
const KNOWN_SERVERS: Record<string, {
  command: string;
  args: string[];
  description: string;
  envVars?: string[];
  requiresArg?: string;
  /** Args that take value from env var: ['--flag', 'ENV_VAR'] pairs */
  envArgs?: [string, string][];
}> = {
  filesystem: {
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem'],
    description: 'File system operations (read, write, search)',
    requiresArg: 'path to allow (e.g., . or /home/user)',
  },
  github: {
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    description: 'GitHub API (repos, issues, PRs)',
    envVars: ['GITHUB_TOKEN'],
  },
  postgres: {
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
    description: 'PostgreSQL database queries',
    envVars: ['DATABASE_URL'],
  },
  sqlite: {
    command: 'npx',
    args: ['@modelcontextprotocol/server-sqlite'],
    description: 'SQLite database operations',
    requiresArg: 'path to database file',
  },
  puppeteer: {
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer'],
    description: 'Browser automation and screenshots',
  },
  brave: {
    command: 'npx',
    args: ['@anthropics/server-brave-search'],
    description: 'Brave web search',
    envVars: ['BRAVE_API_KEY'],
  },
  memory: {
    command: 'npx',
    args: ['@modelcontextprotocol/server-memory'],
    description: 'Persistent memory/knowledge graph',
  },
  fetch: {
    command: 'npx',
    args: ['@anthropics/server-fetch'],
    description: 'HTTP fetch and web scraping',
  },
  supabase: {
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase'],
    description: 'Supabase database and API (uses OAuth login)',
  },
};

export const mcpCommand: Command = {
  name: 'mcp',
  aliases: ['mcp-server'],
  description: 'Manage MCP server connections',
  usage: `/mcp add <server> [args]   Add an MCP server
/mcp remove <name>        Remove an MCP server
/mcp list                 List configured servers
/mcp servers              Show available server templates

Examples:
  /mcp add filesystem .
  /mcp add github
  /mcp add sqlite ./data.db
  /mcp remove filesystem`,
  subcommands: ['add', 'remove', 'list', 'servers'],

  execute: async (args: string): Promise<string | null> => {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    if (!subcommand || subcommand === 'list') {
      return listServers();
    }

    if (subcommand === 'servers' || subcommand === 'available') {
      return showAvailableServers();
    }

    if (subcommand === 'add') {
      const serverName = parts[1]?.toLowerCase();
      const extraArg = parts.slice(2).join(' ');
      return addServer(serverName, extraArg);
    }

    if (subcommand === 'remove' || subcommand === 'rm') {
      const serverName = parts[1];
      return removeServer(serverName);
    }

    console.log(chalk.yellow(`Unknown subcommand: ${subcommand}`));
    console.log('Use /mcp --help for usage');
    return null;
  },
};

async function listServers(): Promise<string | null> {
  const { config } = loadWorkspaceConfig();
  const servers = config?.mcpServers || {};
  const entries = Object.entries(servers);

  if (entries.length === 0) {
    console.log(chalk.dim('No MCP servers configured.'));
    console.log(chalk.dim('Use /mcp add <server> to add one.'));
    console.log(chalk.dim('Use /mcp servers to see available templates.'));
  } else {
    console.log(chalk.bold('\nConfigured MCP Servers:\n'));
    for (const [name, cfg] of entries) {
      const enabled = cfg.enabled !== false;
      const status = enabled ? chalk.green('●') : chalk.dim('○');
      console.log(`  ${status} ${chalk.cyan(name)}`);
      console.log(`    ${chalk.dim(cfg.command)} ${chalk.dim(cfg.args?.join(' ') || '')}`);
    }
    console.log();
  }
  return null;
}

function showAvailableServers(): string | null {
  console.log(chalk.bold('\nAvailable MCP Server Templates:\n'));

  for (const [name, info] of Object.entries(KNOWN_SERVERS)) {
    console.log(`  ${chalk.cyan(name)}`);
    console.log(`    ${info.description}`);
    if (info.requiresArg) {
      console.log(`    ${chalk.yellow('Requires:')} ${info.requiresArg}`);
    }
    const envVars = [
      ...(info.envVars || []),
      ...(info.envArgs?.map(([_, v]) => v) || []),
    ];
    if (envVars.length > 0) {
      console.log(`    ${chalk.yellow('Env vars:')} ${envVars.join(', ')}`);
    }
  }

  console.log(chalk.dim('\nUsage: /mcp add <server> [args]'));
  console.log(chalk.dim('Example: /mcp add filesystem .'));
  console.log();
  return null;
}

async function addServer(serverName: string | undefined, extraArg: string): Promise<string | null> {
  if (!serverName) {
    console.log(chalk.yellow('Please specify a server name.'));
    console.log('Use /mcp servers to see available templates.');
    return null;
  }

  const template = KNOWN_SERVERS[serverName];

  if (!template) {
    console.log(chalk.yellow(`Unknown server: ${serverName}`));
    console.log('Use /mcp servers to see available templates.');
    console.log(chalk.dim('\nOr add a custom server by editing .codi.json'));
    return null;
  }

  if (template.requiresArg && !extraArg) {
    console.log(chalk.yellow(`${serverName} requires: ${template.requiresArg}`));
    console.log(chalk.dim(`Example: /mcp add ${serverName} .`));
    return null;
  }

  // Check for required env vars
  const requiredEnvVars = [
    ...(template.envVars || []),
    ...(template.envArgs?.map(([_, envVar]) => envVar) || []),
  ];
  if (requiredEnvVars.length > 0) {
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.log(chalk.yellow(`Missing environment variable(s): ${missing.join(', ')}`));
      console.log(chalk.dim('Set them before starting Codi.'));
    }
  }

  // Load current config
  let config = loadWorkspaceConfig().config || {};
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Build server config
  const serverConfig: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
  } = {
    command: template.command,
    args: [...template.args],
    enabled: true,
  };

  // Add extra arg if provided
  if (extraArg) {
    serverConfig.args.push(extraArg);
  }

  // Add args that reference env vars (e.g., --access-token ${SUPABASE_ACCESS_TOKEN})
  if (template.envArgs?.length) {
    for (const [flag, envVar] of template.envArgs) {
      serverConfig.args.push(flag, `\${${envVar}}`);
    }
  }

  // Add env var references if needed
  if (template.envVars?.length) {
    serverConfig.env = {};
    for (const envVar of template.envVars) {
      serverConfig.env[envVar] = `\${${envVar}}`;
    }
  }

  config.mcpServers[serverName] = serverConfig;

  // Save config
  try {
    await saveWorkspaceConfig(config);
    console.log(chalk.green(`✓ Added MCP server: ${serverName}`));
    console.log(chalk.dim('  Restart Codi to connect to the new server.'));
    if (requiredEnvVars.length > 0) {
      console.log(chalk.dim(`  Make sure these env vars are set: ${requiredEnvVars.join(', ')}`));
    }
  } catch (error) {
    console.log(chalk.red(`Failed to save config: ${error}`));
  }

  return null;
}

async function removeServer(serverName: string | undefined): Promise<string | null> {
  if (!serverName) {
    console.log(chalk.yellow('Please specify a server name to remove.'));
    return null;
  }

  let config = loadWorkspaceConfig().config;
  if (!config?.mcpServers?.[serverName]) {
    console.log(chalk.yellow(`Server not found: ${serverName}`));
    return null;
  }

  delete config.mcpServers[serverName];

  try {
    await saveWorkspaceConfig(config);
    console.log(chalk.green(`✓ Removed MCP server: ${serverName}`));
  } catch (error) {
    console.log(chalk.red(`Failed to save config: ${error}`));
  }

  return null;
}

/**
 * Register MCP commands.
 */
export function registerMCPCommands(): void {
  registerCommand(mcpCommand);
}
