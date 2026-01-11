import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 60000; // 60 second default timeout
const MAX_OUTPUT_LENGTH = 100000; // Limit output to prevent memory issues

interface TestRunnerConfig {
  command: string;
  args: string[];
  filterFlag?: string;
}

export class RunTestsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'run_tests',
      description: 'Run project tests and get results. Automatically detects test runner (npm/yarn/pnpm test, jest, vitest, pytest, etc.) based on project configuration.',
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Specific test command to run (optional). If not provided, will auto-detect based on project config.',
          },
          filter: {
            type: 'string',
            description: 'Filter tests by name or pattern (optional)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds (optional, default: 60)',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (optional, defaults to current directory)',
          },
        },
        required: [],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const command = input.command as string | undefined;
    const filter = input.filter as string | undefined;
    const timeoutSec = input.timeout as number | undefined;
    const cwd = (input.cwd as string) || process.cwd();

    const timeoutMs = timeoutSec ? timeoutSec * 1000 : DEFAULT_TIMEOUT_MS;

    if (!existsSync(cwd)) {
      throw new Error(`Directory not found: ${cwd}`);
    }

    // If command is provided, use it directly
    if (command) {
      return this.runTestCommand(command, cwd, timeoutMs);
    }

    // Auto-detect test runner
    const config = await this.detectTestRunner(cwd);
    if (!config) {
      throw new Error(
        'Could not detect test runner. Please specify a command explicitly. ' +
        'Supported runners: npm/yarn/pnpm test, jest, vitest, mocha, pytest, etc.'
      );
    }

    // Build the final command with optional filter
    const args = [...config.args];
    if (filter && config.filterFlag) {
      args.push(config.filterFlag, filter);
    }

    const finalCommand = `${config.command} ${args.join(' ')}`.trim();
    return this.runTestCommand(finalCommand, cwd, timeoutMs);
  }

  /**
   * Detect the appropriate test runner based on project configuration.
   */
  private async detectTestRunner(cwd: string): Promise<TestRunnerConfig | null> {
    // Check for package.json (JS/TS project)
    const packageJsonPath = resolve(cwd, 'package.json');
    if (existsSync(packageJsonPath)) {
      return this.detectJsTestRunner(cwd, packageJsonPath);
    }

    // Check for Python projects
    const requirementsPath = resolve(cwd, 'requirements.txt');
    const pyprojectPath = resolve(cwd, 'pyproject.toml');
    const setupPyPath = resolve(cwd, 'setup.py');

    if (existsSync(pyprojectPath) || existsSync(requirementsPath) || existsSync(setupPyPath)) {
      return this.detectPythonTestRunner(cwd);
    }

    // Check for Go projects
    const goModPath = resolve(cwd, 'go.mod');
    if (existsSync(goModPath)) {
      return {
        command: 'go',
        args: ['test', './...'],
        filterFlag: '-run',
      };
    }

    // Check for Rust projects
    const cargoPath = resolve(cwd, 'Cargo.toml');
    if (existsSync(cargoPath)) {
      return {
        command: 'cargo',
        args: ['test'],
        filterFlag: '--',
      };
    }

    return null;
  }

  /**
   * Detect JavaScript/TypeScript test runner.
   */
  private detectJsTestRunner(cwd: string, packageJsonPath: string): TestRunnerConfig | null {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Detect package manager from lock files
      const packageManager = this.detectPackageManager(cwd);

      // Check for test script in package.json
      if (packageJson.scripts?.test) {
        return {
          command: packageManager,
          args: ['test'],
          filterFlag: this.getFilterFlagForScript(packageJson.scripts.test),
        };
      }

      // Check for specific test frameworks
      if (deps['vitest'] || deps['@vitest/ui']) {
        return {
          command: 'npx',
          args: ['vitest', 'run'],
          filterFlag: '-t',
        };
      }

      if (deps['jest'] || deps['@types/jest']) {
        return {
          command: 'npx',
          args: ['jest', '--passWithNoTests'],
          filterFlag: '-t',
        };
      }

      if (deps['mocha']) {
        return {
          command: 'npx',
          args: ['mocha'],
          filterFlag: '--grep',
        };
      }

      if (deps['jasmine']) {
        return {
          command: 'npx',
          args: ['jasmine'],
          filterFlag: '--filter=',
        };
      }

      // Fallback to npm test if package.json exists
      return {
        command: packageManager,
        args: ['test'],
      };
    } catch {
      return null;
    }
  }

  /**
   * Detect the package manager based on lock files.
   */
  private detectPackageManager(cwd: string): 'npm' | 'yarn' | 'pnpm' {
    if (existsSync(resolve(cwd, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (existsSync(resolve(cwd, 'yarn.lock'))) {
      return 'yarn';
    }
    return 'npm';
  }

  /**
   * Get the appropriate filter flag based on the test script content.
   */
  private getFilterFlagForScript(script: string): string | undefined {
    if (script.includes('vitest')) return '-t';
    if (script.includes('jest')) return '-t';
    if (script.includes('mocha')) return '--grep';
    if (script.includes('pytest')) return '-k';
    return undefined;
  }

  /**
   * Detect Python test runner.
   */
  private async detectPythonTestRunner(cwd: string): Promise<TestRunnerConfig> {
    // Check if pytest is available
    try {
      await execAsync('python -c "import pytest"', { cwd, timeout: 5000 });
      return {
        command: 'python',
        args: ['-m', 'pytest'],
        filterFlag: '-k',
      };
    } catch {
      // Fall back to unittest
      return {
        command: 'python',
        args: ['-m', 'unittest', 'discover'],
        filterFlag: '-k',
      };
    }
  }

  /**
   * Execute a test command and return formatted output.
   */
  private async runTestCommand(command: string, cwd: string, timeoutMs: number): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024, // 20MB buffer
        env: {
          ...process.env,
          FORCE_COLOR: '0', // Disable color codes for cleaner output
          CI: 'true', // Many test runners behave better in CI mode
        },
      });

      return this.formatOutput(command, 0, stdout, stderr);
    } catch (error: unknown) {
      // exec errors include stdout/stderr in the error object
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
        throw new Error(`Test execution timed out after ${timeoutMs / 1000} seconds`);
      }

      // Return test output even on failure (non-zero exit code)
      const exitCode = execError.code ?? 1;
      return this.formatOutput(
        command,
        exitCode,
        execError.stdout || '',
        execError.stderr || execError.message || ''
      );
    }
  }

  /**
   * Format test output for display.
   */
  private formatOutput(command: string, exitCode: number, stdout: string, stderr: string): string {
    const status = exitCode === 0 ? 'PASSED' : 'FAILED';
    let output = `Test command: ${command}
Exit code: ${exitCode} (${status})
`;

    if (stdout) {
      output += `\nSTDOUT:\n${stdout}`;
    }

    if (stderr) {
      output += `\nSTDERR:\n${stderr}`;
    }

    if (!stdout && !stderr) {
      output += '\n(Tests completed with no output)';
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
