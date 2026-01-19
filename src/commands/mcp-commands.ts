// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { registerCommand, type Command } from './index.js';
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../config.js';
import { exec } from 'child_process';
import chalk from 'chalk';

/**
 * URLs to get API tokens/keys for services that require them.
 */
const AUTH_URLS: Record<string, { url: string; envVar: string; description: string }> = {
  github: {
    url: 'https://github.com/settings/tokens/new?description=Codi%20MCP&scopes=repo,read:org,read:user',
    envVar: 'GITHUB_TOKEN',
    description: 'Create a personal access token with repo, read:org, read:user scopes',
  },
  brave: {
    url: 'https://brave.com/search/api/',
    envVar: 'BRAVE_API_KEY',
    description: 'Sign up for Brave Search API and get your API key',
  },
  slack: {
    url: 'https://api.slack.com/apps',
    envVar: 'SLACK_BOT_TOKEN',
    description: 'Create a Slack app, add Bot Token Scopes, then install to workspace',
  },
  linear: {
    url: 'https://linear.app/settings/api',
    envVar: 'LINEAR_API_KEY',
    description: 'Create a personal API key',
  },
  sentry: {
    url: 'https://sentry.io/settings/account/api/auth-tokens/',
    envVar: 'SENTRY_AUTH_TOKEN',
    description: 'Create an auth token with project:read and org:read scopes',
  },
  supabase: {
    url: 'https://supabase.com/dashboard/account/tokens',
    envVar: 'SUPABASE_ACCESS_TOKEN',
    description: 'Create a personal access token with read/write scopes',
  },
};

/**
 * Well-known MCP servers with their configurations.
 */
const KNOWN_SERVERS: Record<string, {
  command: string;
  args: string[];
  description: string;
  envVars?: string[];
  requiresArg?: string;
  /** Prefix to add before the extra arg (e.g., '--project-ref=' for supabase) */
  argPrefix?: string;
  /** Args that take value from env var: ['--flag', 'ENV_VAR'] pairs */
  envArgs?: [string, string][];
}> = {
  // === No auth required ===
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    description: 'File operations (read, write, search)',
    requiresArg: 'path to allow (e.g., . or ~)',
  },
  sqlite: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    description: 'SQLite database queries',
    requiresArg: 'path to .db file',
  },
  memory: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    description: 'Persistent knowledge graph',
  },
  fetch: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    description: 'Fetch URLs and convert to markdown',
  },
  puppeteer: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    description: 'Browser automation and screenshots',
  },
  git: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    description: 'Git repository operations',
    requiresArg: 'path to repo',
  },
  time: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    description: 'Time and timezone utilities',
  },

  // === Requires project ID + token ===
  supabase: {
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase@latest'],
    description: 'Supabase DB and API',
    requiresArg: 'project ID (find in Project Settings)',
    argPrefix: '--project-ref=',
    envVars: ['SUPABASE_ACCESS_TOKEN'],
  },

  // === Requires API key/token ===
  github: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    description: 'GitHub repos, issues, PRs',
    envVars: ['GITHUB_TOKEN'],
  },
  postgres: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    description: 'PostgreSQL database queries',
    envVars: ['DATABASE_URL'],
  },
  brave: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    description: 'Brave web search',
    envVars: ['BRAVE_API_KEY'],
  },
  slack: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    description: 'Slack channels and messages',
    envVars: ['SLACK_BOT_TOKEN'],
  },
  linear: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-linear'],
    description: 'Linear issues and projects',
    envVars: ['LINEAR_API_KEY'],
  },
  sentry: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    description: 'Sentry error tracking',
    envVars: ['SENTRY_AUTH_TOKEN'],
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
/mcp auth <service>       Open browser to get API token

Examples:
  /mcp add filesystem .
  /mcp auth supabase       (get access token)
  /mcp add supabase <project-id>
  /mcp auth github         (get GitHub token)
  /mcp add github          (after setting GITHUB_TOKEN)`,
  subcommands: ['add', 'remove', 'list', 'servers', 'auth'],

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

    if (subcommand === 'auth') {
      const serviceName = parts[1]?.toLowerCase();
      return openAuthPage(serviceName);
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
    // Show appropriate example based on server type
    const example = serverName === 'supabase' ? 'abcdefghijklmnop' :
                    serverName === 'sqlite' ? './data.db' : '.';
    console.log(chalk.dim(`Example: /mcp add ${serverName} ${example}`));
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

  // Add extra arg if provided (with optional prefix like --project-ref=)
  if (extraArg) {
    const formattedArg = template.argPrefix ? `${template.argPrefix}${extraArg}` : extraArg;
    serverConfig.args.push(formattedArg);
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

async function openAuthPage(serviceName: string | undefined): Promise<string | null> {
  if (!serviceName) {
    console.log(chalk.bold('\nServices with auth helpers:\n'));
    for (const [name, info] of Object.entries(AUTH_URLS)) {
      console.log(`  ${chalk.cyan(name)}`);
      console.log(`    ${info.description}`);
      console.log(`    ${chalk.yellow('Env var:')} ${info.envVar}`);
    }
    console.log(chalk.dim('\nUsage: /mcp auth <service>'));
    return null;
  }

  const authInfo = AUTH_URLS[serviceName];
  if (!authInfo) {
    console.log(chalk.yellow(`No auth helper for: ${serviceName}`));
    console.log('Available services: ' + Object.keys(AUTH_URLS).join(', '));
    return null;
  }

  console.log(chalk.bold(`\n${serviceName} Authentication\n`));
  console.log(`${authInfo.description}\n`);
  console.log(chalk.cyan('Opening browser...'));

  // Cross-platform browser open
  const platform = process.platform;
  const openCmd = platform === 'darwin' ? 'open' :
                  platform === 'win32' ? 'start' : 'xdg-open';

  exec(`${openCmd} "${authInfo.url}"`, (error) => {
    if (error) {
      console.log(chalk.yellow(`Could not open browser. Visit manually:`));
      console.log(chalk.dim(authInfo.url));
    }
  });

  console.log(`\n${chalk.yellow('After getting your token, set:')} ${chalk.bold(authInfo.envVar)}`);
  console.log(chalk.dim(`  export ${authInfo.envVar}=your-token-here`));
  console.log(chalk.dim(`  # Or add to your shell profile (~/.zshrc, ~/.bashrc)`));

  return null;
}

/**
 * Register MCP commands.
 */
export function registerMCPCommands(): void {
  registerCommand(mcpCommand);
}
