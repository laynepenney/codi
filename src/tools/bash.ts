import { exec } from 'child_process';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { getBlockingPatterns } from '../utils/index.js';

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

    const startTime = Date.now();

    try {
      const result = await this.execCommand(command, cwd);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      return this.formatOutput({
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        duration,
      });
    } catch (error: unknown) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const execError = error as {
        code?: number;
        killed?: boolean;
        signal?: string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      // Check for timeout
      if (execError.killed && execError.signal === 'SIGTERM') {
        throw new Error(`Command timed out after ${TIMEOUT_MS / 1000} seconds`);
      }

      return this.formatOutput({
        exitCode: execError.code ?? 1,
        stdout: execError.stdout || '',
        stderr: execError.stderr || execError.message || '',
        duration,
      });
    }
  }

  /**
   * Execute command and return stdout/stderr.
   */
  private execCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(
        command,
        {
          cwd,
          timeout: TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        },
        (error, stdout, stderr) => {
          if (error) {
            // Attach stdout/stderr to error for access in catch block
            (error as any).stdout = stdout;
            (error as any).stderr = stderr;
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        }
      );
    });
  }

  /**
   * Format command output with clear structure.
   */
  private formatOutput(result: {
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: string;
  }): string {
    const { exitCode, stdout, stderr, duration } = result;
    const status = exitCode === 0 ? 'SUCCESS' : 'FAILED';

    let output = `[Exit Code: ${exitCode}] [Status: ${status}] [Duration: ${duration}s]\n`;

    // Add stdout if present
    if (stdout && stdout.trim()) {
      output += `\n${stdout}`;
    }

    // Add stderr if present (clearly marked)
    if (stderr && stderr.trim()) {
      if (stdout && stdout.trim()) {
        output += '\n';
      }
      output += `\n[STDERR]\n${stderr}`;
    }

    // Handle no output case
    if (!stdout?.trim() && !stderr?.trim()) {
      output += '\n(Command completed with no output)';
    }

    // Truncate if too long
    if (output.length > MAX_OUTPUT_LENGTH) {
      const half = Math.floor(MAX_OUTPUT_LENGTH / 2);
      output = output.slice(0, half) +
        `\n\n... [${output.length - MAX_OUTPUT_LENGTH} characters truncated] ...\n\n` +
        output.slice(-half);
    }

    return output;
  }
}
