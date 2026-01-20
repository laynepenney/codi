// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shell Info Tool
 *
 * Capture runtime environment information by running multiple commands.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

const execAsync = promisify(exec);
const COMMAND_TIMEOUT_MS = 5000; // 5 second timeout per command

/**
 * Common environment commands that are useful for debugging.
 */
const DEFAULT_COMMANDS = [
  'node -v',
  'npm -v',
  'pnpm -v',
  'yarn -v',
  'git --version',
  'python --version',
  'python3 --version',
  'go version',
  'rustc --version',
  'java -version',
];

export class ShellInfoTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'shell_info',
      description:
        'Get environment information by running multiple shell commands. ' +
        'Useful for debugging environment-specific issues or verifying tool versions. ' +
        'Returns the output of each command or error if not available.',
      input_schema: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            items: { type: 'string' },
            description:
              'List of commands to run (e.g., ["node -v", "pnpm -v"]). ' +
              'If not provided, runs common version checks.',
          },
          include_defaults: {
            type: 'boolean',
            description: 'Include default version checks (node, npm, git, etc.). Default: true when no commands provided.',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for commands (optional, defaults to current directory)',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const customCommands = input.commands as string[] | undefined;
    const includeDefaults = input.include_defaults as boolean | undefined;
    const cwd = (input.cwd as string) || process.cwd();

    // Determine which commands to run
    let commands: string[];

    if (customCommands && customCommands.length > 0) {
      commands = [...customCommands];
      if (includeDefaults) {
        commands = [...commands, ...DEFAULT_COMMANDS];
      }
    } else {
      commands = [...DEFAULT_COMMANDS];
    }

    // Deduplicate commands
    commands = [...new Set(commands)];

    // Run all commands in parallel
    const results = await Promise.all(
      commands.map(cmd => this.runCommand(cmd, cwd))
    );

    // Format output
    const lines: string[] = [];
    lines.push('## Environment Information\n');

    const successful: Array<{ cmd: string; output: string }> = [];
    const failed: Array<{ cmd: string; error: string }> = [];

    for (const result of results) {
      if (result.success) {
        successful.push({ cmd: result.command, output: result.output });
      } else {
        failed.push({ cmd: result.command, error: result.error });
      }
    }

    // Show successful commands
    if (successful.length > 0) {
      lines.push('### Available');
      for (const { cmd, output } of successful) {
        lines.push(`- **${cmd}**: ${output}`);
      }
      lines.push('');
    }

    // Show failed/unavailable commands
    if (failed.length > 0) {
      lines.push('### Not Available');
      for (const { cmd } of failed) {
        lines.push(`- ${cmd}`);
      }
      lines.push('');
    }

    // Summary
    lines.push(`---`);
    lines.push(`**Summary:** ${successful.length} available, ${failed.length} not available`);
    lines.push(`**Working Directory:** ${cwd}`);

    return lines.join('\n');
  }

  /**
   * Run a single command and capture output.
   */
  private async runCommand(
    command: string,
    cwd: string
  ): Promise<{ command: string; success: boolean; output: string; error: string }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        env: {
          ...process.env,
          LANG: 'en_US.UTF-8', // Ensure consistent output
        },
      });

      // Some commands output to stderr (e.g., java -version)
      const output = (stdout || stderr || '').trim().split('\n')[0];

      return {
        command,
        success: true,
        output,
        error: '',
      };
    } catch (error: unknown) {
      const execError = error as { stderr?: string; message?: string };
      return {
        command,
        success: false,
        output: '',
        error: execError.message || 'Command failed',
      };
    }
  }
}
