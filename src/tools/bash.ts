import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { getBlockingPatterns } from '../utils/index.js';

const execAsync = promisify(exec);

const TIMEOUT_MS = 30000; // 30 second timeout
const MAX_OUTPUT_LENGTH = 50000; // Truncate output if too long

// Get blocking patterns from unified constants
const BLOCKING_PATTERNS = getBlockingPatterns();

export class BashTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'bash',
      description: 'Execute a bash command in the current working directory. Use for running scripts, git commands, npm/yarn, and other CLI tools. Be careful with destructive commands.',
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (optional, defaults to current directory)',
          },
        },
        required: ['command'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const command = input.command as string;
    const cwd = (input.cwd as string) || process.cwd();

    if (!command) {
      throw new Error('Command is required');
    }

    // Safety check using unified blocking patterns
    for (const { pattern, description } of BLOCKING_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(`Command blocked for safety: ${description}`);
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      let output = '';

      if (stdout) {
        output += stdout;
      }

      if (stderr) {
        output += (output ? '\n\nSTDERR:\n' : 'STDERR:\n') + stderr;
      }

      if (!output) {
        output = '(Command completed with no output)';
      }

      // Truncate if too long
      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (output truncated)';
      }

      return output;
    } catch (error: any) {
      // exec errors include stdout/stderr in the error object
      let errorOutput = `Command failed with exit code ${error.code || 'unknown'}\n`;

      if (error.stdout) {
        errorOutput += `\nSTDOUT:\n${error.stdout}`;
      }

      if (error.stderr) {
        errorOutput += `\nSTDERR:\n${error.stderr}`;
      }

      if (error.message && !error.stdout && !error.stderr) {
        errorOutput += `\nError: ${error.message}`;
      }

      throw new Error(errorOutput);
    }
  }
}
