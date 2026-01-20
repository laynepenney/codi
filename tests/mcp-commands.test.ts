// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpCommand, registerMCPCommands } from '../src/commands/mcp-commands.js';

// Mock the config module
vi.mock('../src/config.js', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, callback) => {
    if (callback) callback(null, '', '');
  }),
}));

// Mock the commands/index module
vi.mock('../src/commands/index.js', async () => {
  const actual = await vi.importActual<typeof import('../src/commands/index.js')>('../src/commands/index.js');
  return {
    ...actual,
    registerCommand: vi.fn(),
  };
});

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../src/config.js';
import { exec } from 'child_process';
import { registerCommand } from '../src/commands/index.js';

const mockLoadWorkspaceConfig = vi.mocked(loadWorkspaceConfig);
const mockSaveWorkspaceConfig = vi.mocked(saveWorkspaceConfig);
const mockExec = vi.mocked(exec);

describe('MCP Commands', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(a => String(a)).join(' '));
    });
    mockLoadWorkspaceConfig.mockReturnValue({ config: null, configPath: null });
    mockSaveWorkspaceConfig.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('mcpCommand properties', () => {
    it('has correct name and aliases', () => {
      expect(mcpCommand.name).toBe('mcp');
      expect(mcpCommand.aliases).toContain('mcp-server');
    });

    it('has correct subcommands', () => {
      expect(mcpCommand.subcommands).toEqual(['add', 'remove', 'list', 'servers', 'auth']);
    });

    it('has description and usage', () => {
      expect(mcpCommand.description).toBe('Manage MCP server connections');
      expect(mcpCommand.usage).toContain('/mcp add');
      expect(mcpCommand.usage).toContain('/mcp remove');
      expect(mcpCommand.usage).toContain('/mcp auth');
    });
  });

  describe('/mcp list', () => {
    it('shows empty message when no servers configured', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: null, configPath: null });

      const result = await mcpCommand.execute('list');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('No MCP servers configured'))).toBe(true);
    });

    it('shows empty message with default subcommand', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      const result = await mcpCommand.execute('');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('No MCP servers configured'))).toBe(true);
    });

    it('lists configured servers', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({
        config: {
          mcpServers: {
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
              enabled: true,
            },
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              enabled: false,
            },
          },
        },
        configPath: '.codi.json',
      });

      const result = await mcpCommand.execute('list');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Configured MCP Servers'))).toBe(true);
      expect(logs.some(l => l.includes('filesystem'))).toBe(true);
      expect(logs.some(l => l.includes('github'))).toBe(true);
    });
  });

  describe('/mcp servers', () => {
    it('shows available server templates', async () => {
      const result = await mcpCommand.execute('servers');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Available MCP Server Templates'))).toBe(true);
      expect(logs.some(l => l.includes('filesystem'))).toBe(true);
      expect(logs.some(l => l.includes('github'))).toBe(true);
      expect(logs.some(l => l.includes('supabase'))).toBe(true);
    });

    it('accepts "available" alias', async () => {
      const result = await mcpCommand.execute('available');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Available MCP Server Templates'))).toBe(true);
    });

    it('shows required args for servers that need them', async () => {
      await mcpCommand.execute('servers');

      expect(logs.some(l => l.includes('Requires:') && l.includes('path'))).toBe(true);
    });

    it('shows env vars for servers that need them', async () => {
      await mcpCommand.execute('servers');

      expect(logs.some(l => l.includes('Env vars:') && l.includes('GITHUB_TOKEN'))).toBe(true);
    });
  });

  describe('/mcp add', () => {
    it('requires server name', async () => {
      const result = await mcpCommand.execute('add');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Please specify a server name'))).toBe(true);
    });

    it('rejects unknown server', async () => {
      const result = await mcpCommand.execute('add unknown-server');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Unknown server'))).toBe(true);
    });

    it('requires arg for servers that need it', async () => {
      const result = await mcpCommand.execute('add filesystem');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('requires:'))).toBe(true);
      expect(logs.some(l => l.includes('Example:'))).toBe(true);
    });

    it('shows correct example for sqlite', async () => {
      await mcpCommand.execute('add sqlite');

      expect(logs.some(l => l.includes('./data.db'))).toBe(true);
    });

    it('shows correct example for supabase', async () => {
      await mcpCommand.execute('add supabase');

      expect(logs.some(l => l.includes('abcdefghijklmnop'))).toBe(true);
    });

    it('adds server without required arg', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      const result = await mcpCommand.execute('add memory');

      expect(result).toBeNull();
      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            memory: expect.objectContaining({
              command: 'npx',
              args: expect.arrayContaining(['-y', '@modelcontextprotocol/server-memory']),
              enabled: true,
            }),
          }),
        })
      );
      expect(logs.some(l => l.includes('Added MCP server'))).toBe(true);
    });

    it('adds server with extra arg', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      const result = await mcpCommand.execute('add filesystem /home/user');

      expect(result).toBeNull();
      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            filesystem: expect.objectContaining({
              args: expect.arrayContaining(['/home/user']),
            }),
          }),
        })
      );
    });

    it('formats supabase project ID with prefix', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      await mcpCommand.execute('add supabase myprojectid123');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            supabase: expect.objectContaining({
              args: expect.arrayContaining(['--project-ref=myprojectid123']),
            }),
          }),
        })
      );
    });

    it('adds env var references for servers that need them', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      await mcpCommand.execute('add github');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            github: expect.objectContaining({
              env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
            }),
          }),
        })
      );
    });

    it('warns about missing env vars', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });
      // GITHUB_TOKEN is not set in test environment

      await mcpCommand.execute('add github');

      expect(logs.some(l => l.includes('Missing environment variable'))).toBe(true);
    });

    it('preserves existing mcpServers', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({
        config: {
          mcpServers: {
            existing: { command: 'test', args: [], enabled: true },
          },
        },
        configPath: '.codi.json',
      });

      await mcpCommand.execute('add memory');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            existing: expect.anything(),
            memory: expect.anything(),
          }),
        })
      );
    });

    it('handles save error gracefully', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });
      mockSaveWorkspaceConfig.mockRejectedValue(new Error('Write failed'));

      await mcpCommand.execute('add memory');

      expect(logs.some(l => l.includes('Failed to save config'))).toBe(true);
    });
  });

  describe('/mcp remove', () => {
    it('requires server name', async () => {
      const result = await mcpCommand.execute('remove');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Please specify a server name'))).toBe(true);
    });

    it('reports when server not found', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      const result = await mcpCommand.execute('remove nonexistent');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Server not found'))).toBe(true);
    });

    it('removes existing server', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({
        config: {
          mcpServers: {
            filesystem: { command: 'npx', args: [], enabled: true },
            github: { command: 'npx', args: [], enabled: true },
          },
        },
        configPath: '.codi.json',
      });

      const result = await mcpCommand.execute('remove filesystem');

      expect(result).toBeNull();
      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.not.objectContaining({
            filesystem: expect.anything(),
          }),
        })
      );
      expect(logs.some(l => l.includes('Removed MCP server'))).toBe(true);
    });

    it('accepts "rm" alias', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({
        config: {
          mcpServers: {
            memory: { command: 'npx', args: [], enabled: true },
          },
        },
        configPath: '.codi.json',
      });

      await mcpCommand.execute('rm memory');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalled();
      expect(logs.some(l => l.includes('Removed MCP server'))).toBe(true);
    });

    it('handles save error gracefully', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({
        config: {
          mcpServers: {
            memory: { command: 'npx', args: [], enabled: true },
          },
        },
        configPath: '.codi.json',
      });
      mockSaveWorkspaceConfig.mockRejectedValue(new Error('Write failed'));

      await mcpCommand.execute('remove memory');

      expect(logs.some(l => l.includes('Failed to save config'))).toBe(true);
    });
  });

  describe('/mcp auth', () => {
    it('lists available services when no service specified', async () => {
      const result = await mcpCommand.execute('auth');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Services with auth helpers'))).toBe(true);
      expect(logs.some(l => l.includes('github'))).toBe(true);
      expect(logs.some(l => l.includes('supabase'))).toBe(true);
      expect(logs.some(l => l.includes('brave'))).toBe(true);
    });

    it('shows env var for each service', async () => {
      await mcpCommand.execute('auth');

      expect(logs.some(l => l.includes('GITHUB_TOKEN'))).toBe(true);
      expect(logs.some(l => l.includes('SUPABASE_ACCESS_TOKEN'))).toBe(true);
    });

    it('reports unknown service', async () => {
      const result = await mcpCommand.execute('auth unknown');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('No auth helper for'))).toBe(true);
      expect(logs.some(l => l.includes('Available services'))).toBe(true);
    });

    it('opens browser for known service', async () => {
      const result = await mcpCommand.execute('auth github');

      expect(result).toBeNull();
      expect(mockExec).toHaveBeenCalled();
      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('github.com/settings/tokens');
    });

    it('shows instructions after opening browser', async () => {
      await mcpCommand.execute('auth github');

      expect(logs.some(l => l.includes('Opening browser'))).toBe(true);
      expect(logs.some(l => l.includes('After getting your token'))).toBe(true);
      expect(logs.some(l => l.includes('GITHUB_TOKEN'))).toBe(true);
      expect(logs.some(l => l.includes('export'))).toBe(true);
    });

    it('handles browser open error gracefully', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        if (typeof callback === 'function') {
          callback(new Error('Cannot open browser'), '', '');
        }
        return {} as any;
      });

      await mcpCommand.execute('auth github');

      // Should not throw, and should still show instructions
      expect(logs.some(l => l.includes('After getting your token'))).toBe(true);
    });

    it('opens correct URL for supabase', async () => {
      await mcpCommand.execute('auth supabase');

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('supabase.com/dashboard/account/tokens');
    });

    it('opens correct URL for brave', async () => {
      await mcpCommand.execute('auth brave');

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('brave.com/search/api');
    });
  });

  describe('unknown subcommand', () => {
    it('shows error for unknown subcommand', async () => {
      const result = await mcpCommand.execute('invalid');

      expect(result).toBeNull();
      expect(logs.some(l => l.includes('Unknown subcommand'))).toBe(true);
      expect(logs.some(l => l.includes('/mcp --help'))).toBe(true);
    });
  });

  describe('registerMCPCommands', () => {
    it('registers the mcp command', () => {
      registerMCPCommands();

      expect(registerCommand).toHaveBeenCalledWith(mcpCommand);
    });
  });

  describe('server template configurations', () => {
    it('filesystem server has correct config', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      await mcpCommand.execute('add filesystem /test/path');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/test/path'],
              enabled: true,
            },
          }),
        })
      );
    });

    it('github server has correct config with env', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      await mcpCommand.execute('add github');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              enabled: true,
              env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
            },
          }),
        })
      );
    });

    it('supabase server has correct config with project-ref and env', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      await mcpCommand.execute('add supabase proj123');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            supabase: {
              command: 'npx',
              args: ['-y', '@supabase/mcp-server-supabase@latest', '--project-ref=proj123'],
              enabled: true,
              env: { SUPABASE_ACCESS_TOKEN: '${SUPABASE_ACCESS_TOKEN}' },
            },
          }),
        })
      );
    });

    it('postgres server has DATABASE_URL env', async () => {
      mockLoadWorkspaceConfig.mockReturnValue({ config: {}, configPath: '.codi.json' });

      await mcpCommand.execute('add postgres');

      expect(mockSaveWorkspaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            postgres: expect.objectContaining({
              env: { DATABASE_URL: '${DATABASE_URL}' },
            }),
          }),
        })
      );
    });
  });
});
