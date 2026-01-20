// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

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
  runner?: 'vitest' | 'jest' | 'pytest' | 'go' | 'cargo' | 'mocha' | 'unknown';
}

/**
 * Structured test result for machine-readable output.
 */
interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration?: number;
  failures: Array<{
    name: string;
    error?: string;
    file?: string;
    line?: number;
  }>;
  success: boolean;
}

export class RunTestsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'run_tests',
      description:
        'Run project tests and get results. Automatically detects test runner (npm/yarn/pnpm test, jest, vitest, pytest, etc.) based on project configuration. ' +
        'Use changed_files: true to automatically run tests related to files changed in git.',
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
          changed_files: {
            type: 'boolean',
            description: 'Auto-detect changed files from git and run related tests. Default: false',
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
    let filter = input.filter as string | undefined;
    const changedFiles = (input.changed_files as boolean) ?? false;
    const timeoutSec = input.timeout as number | undefined;
    const cwd = (input.cwd as string) || process.cwd();

    const timeoutMs = timeoutSec ? timeoutSec * 1000 : DEFAULT_TIMEOUT_MS;

    if (!existsSync(cwd)) {
      throw new Error(`Directory not found: ${cwd}`);
    }

    // If changed_files is true, detect changed files from git and generate filter
    if (changedFiles && !filter) {
      const detectedFilter = await this.detectChangedFilesFilter(cwd);
      if (detectedFilter) {
        filter = detectedFilter;
      }
    }

    // If command is provided, use it directly (try to detect runner from command)
    if (command) {
      const runner = this.detectRunnerFromCommand(command);
      return this.runTestCommand(command, cwd, timeoutMs, runner);
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
    return this.runTestCommand(finalCommand, cwd, timeoutMs, config.runner);
  }

  /**
   * Try to detect test runner from command string.
   */
  private detectRunnerFromCommand(command: string): TestRunnerConfig['runner'] {
    const cmd = command.toLowerCase();
    if (cmd.includes('vitest')) return 'vitest';
    if (cmd.includes('jest')) return 'jest';
    if (cmd.includes('pytest') || cmd.includes('python -m pytest')) return 'pytest';
    if (cmd.includes('go test')) return 'go';
    if (cmd.includes('cargo test')) return 'cargo';
    if (cmd.includes('mocha')) return 'mocha';
    return 'unknown';
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
        runner: 'go',
      };
    }

    // Check for Rust projects
    const cargoPath = resolve(cwd, 'Cargo.toml');
    if (existsSync(cargoPath)) {
      return {
        command: 'cargo',
        args: ['test'],
        filterFlag: '--',
        runner: 'cargo',
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
          runner: this.getRunnerFromScript(packageJson.scripts.test),
        };
      }

      // Check for specific test frameworks
      if (deps['vitest'] || deps['@vitest/ui']) {
        return {
          command: 'npx',
          args: ['vitest', 'run'],
          filterFlag: '-t',
          runner: 'vitest',
        };
      }

      if (deps['jest'] || deps['@types/jest']) {
        return {
          command: 'npx',
          args: ['jest', '--passWithNoTests'],
          filterFlag: '-t',
          runner: 'jest',
        };
      }

      if (deps['mocha']) {
        return {
          command: 'npx',
          args: ['mocha'],
          filterFlag: '--grep',
          runner: 'mocha',
        };
      }

      if (deps['jasmine']) {
        return {
          command: 'npx',
          args: ['jasmine'],
          filterFlag: '--filter=',
          runner: 'unknown',
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
   * Get the test runner type from script content.
   */
  private getRunnerFromScript(script: string): TestRunnerConfig['runner'] {
    if (script.includes('vitest')) return 'vitest';
    if (script.includes('jest')) return 'jest';
    if (script.includes('mocha')) return 'mocha';
    if (script.includes('pytest')) return 'pytest';
    return 'unknown';
  }

  /**
   * Detect changed files from git and generate a test filter pattern.
   */
  private async detectChangedFilesFilter(cwd: string): Promise<string | undefined> {
    try {
      // Get staged and unstaged changes
      const { stdout: statusOutput } = await execAsync('git status --porcelain', {
        cwd,
        timeout: 5000,
      });

      if (!statusOutput.trim()) {
        return undefined;
      }

      // Parse git status output
      const lines = statusOutput.trim().split('\n');
      const changedFiles: string[] = [];

      for (const line of lines) {
        // Git status format: "XY filename" where X=staged, Y=unstaged
        const match = line.match(/^.{2}\s+(.+)$/);
        if (match) {
          const filePath = match[1].trim();
          // Only include source files, not test files themselves
          if (this.isSourceFile(filePath) && !this.isTestFile(filePath)) {
            changedFiles.push(filePath);
          }
        }
      }

      if (changedFiles.length === 0) {
        return undefined;
      }

      // Generate filter pattern based on changed file names
      // Most test runners support filtering by filename or pattern
      const patterns = changedFiles.map(f => this.fileToTestPattern(f)).filter(Boolean);

      if (patterns.length === 0) {
        return undefined;
      }

      // Join patterns - format depends on test runner but most support regex-like patterns
      // For simplicity, return first few patterns joined with |
      return patterns.slice(0, 5).join('|');
    } catch {
      // Git not available or not a git repo
      return undefined;
    }
  }

  /**
   * Check if a file is a source file (not config, etc.)
   */
  private isSourceFile(filePath: string): boolean {
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.rb'];
    return sourceExtensions.some(ext => filePath.endsWith(ext));
  }

  /**
   * Check if a file is likely a test file.
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      '.test.', '.spec.', '_test.', '_spec.',
      '/test/', '/tests/', '/__tests__/',
      'test_', 'spec_'
    ];
    return testPatterns.some(p => filePath.includes(p));
  }

  /**
   * Convert a source file path to a test filter pattern.
   */
  private fileToTestPattern(filePath: string): string {
    // Extract the base name without extension
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    const baseName = fileName.replace(/\.[^.]+$/, '');

    // Return the base name as a pattern - this will match related tests
    // e.g., "paste-debounce" will match "paste-debounce.test.ts"
    return baseName;
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
        runner: 'pytest',
      };
    } catch {
      // Fall back to unittest
      return {
        command: 'python',
        args: ['-m', 'unittest', 'discover'],
        filterFlag: '-k',
        runner: 'unknown',
      };
    }
  }

  /**
   * Execute a test command and return formatted output.
   */
  private async runTestCommand(command: string, cwd: string, timeoutMs: number, runner?: TestRunnerConfig['runner']): Promise<string> {
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

      return this.formatOutput(command, 0, stdout, stderr, runner);
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
        execError.stderr || execError.message || '',
        runner
      );
    }
  }

  /**
   * Format test output for display with structured summary.
   */
  private formatOutput(command: string, exitCode: number, stdout: string, stderr: string, runner?: string): string {
    const status = exitCode === 0 ? 'PASSED' : 'FAILED';
    const combinedOutput = stdout + '\n' + stderr;

    // Parse test results for structured output
    const testResult = this.parseTestOutput(combinedOutput, exitCode, runner);

    // Build structured summary
    let output = `## Test Results

**Status:** ${status}
**Command:** \`${command}\`
**Exit Code:** ${exitCode}

### Summary
- **Passed:** ${testResult.passed}
- **Failed:** ${testResult.failed}
- **Skipped:** ${testResult.skipped}
- **Total:** ${testResult.total}`;

    if (testResult.duration !== undefined) {
      output += `\n- **Duration:** ${testResult.duration.toFixed(2)}s`;
    }

    // List failures if any
    if (testResult.failures.length > 0) {
      output += '\n\n### Failures\n';
      for (const failure of testResult.failures.slice(0, 10)) { // Limit to first 10 failures
        output += `\n**${failure.name}**`;
        if (failure.file) {
          output += failure.line ? ` (${failure.file}:${failure.line})` : ` (${failure.file})`;
        }
        if (failure.error) {
          output += `\n\`\`\`\n${failure.error.slice(0, 500)}${failure.error.length > 500 ? '...' : ''}\n\`\`\``;
        }
      }
      if (testResult.failures.length > 10) {
        output += `\n\n... and ${testResult.failures.length - 10} more failures`;
      }
    }

    // Include raw output for full details
    output += '\n\n### Raw Output\n```\n';

    let rawOutput = '';
    if (stdout) rawOutput += stdout;
    if (stderr) rawOutput += (rawOutput ? '\n' : '') + stderr;
    if (!rawOutput) rawOutput = '(Tests completed with no output)';

    // Truncate raw output if too long
    if (rawOutput.length > MAX_OUTPUT_LENGTH - output.length - 100) {
      const allowedLength = MAX_OUTPUT_LENGTH - output.length - 200;
      const half = Math.floor(allowedLength / 2);
      rawOutput = rawOutput.slice(0, half) +
        `\n\n... [${rawOutput.length - allowedLength} characters truncated] ...\n\n` +
        rawOutput.slice(-half);
    }

    output += rawOutput + '\n```';

    return output;
  }

  /**
   * Parse test output to extract structured results.
   */
  private parseTestOutput(output: string, exitCode: number, runner?: string): TestResult {
    // Try different parsers based on detected runner
    let result: TestResult | null = null;

    // Try Vitest parser
    if (!result && (runner === 'vitest' || output.includes('PASS') || output.includes('FAIL'))) {
      result = this.parseVitestOutput(output);
    }

    // Try Jest parser (similar to Vitest)
    if (!result && (runner === 'jest' || output.includes('Test Suites:') || output.includes('Tests:'))) {
      result = this.parseJestOutput(output);
    }

    // Try pytest parser
    if (!result && (runner === 'pytest' || output.includes('passed') || output.includes('failed') || output.includes('pytest'))) {
      result = this.parsePytestOutput(output);
    }

    // Try Go test parser
    if (!result && (runner === 'go' || output.includes('--- PASS:') || output.includes('--- FAIL:'))) {
      result = this.parseGoTestOutput(output);
    }

    // Try Cargo test parser
    if (!result && (runner === 'cargo' || output.includes('test result:'))) {
      result = this.parseCargoTestOutput(output);
    }

    // Fallback: minimal parsing
    if (!result) {
      result = {
        passed: 0,
        failed: exitCode === 0 ? 0 : 1,
        skipped: 0,
        total: 1,
        failures: [],
        success: exitCode === 0,
      };
    }

    return result;
  }

  /**
   * Parse Vitest output format.
   */
  private parseVitestOutput(output: string): TestResult | null {
    const result: TestResult = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      failures: [],
      success: true,
    };

    // Match summary line: "Tests  5 passed | 2 failed | 1 skipped (8)"
    // or "Test Files  1 passed (1)"
    const testMatch = output.match(/Tests?\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?(?:\s*\|\s*(\d+)\s+skipped)?/i);
    if (testMatch) {
      result.passed = parseInt(testMatch[1], 10) || 0;
      result.failed = parseInt(testMatch[2], 10) || 0;
      result.skipped = parseInt(testMatch[3], 10) || 0;
      result.total = result.passed + result.failed + result.skipped;
      result.success = result.failed === 0;
    }

    // Extract duration
    const durationMatch = output.match(/Duration\s+([\d.]+)s/i);
    if (durationMatch) {
      result.duration = parseFloat(durationMatch[1]);
    }

    // Extract failures
    const failurePattern = /FAIL\s+(.+?)\s*>\s*(.+?)(?:\n|$)/g;
    let match;
    while ((match = failurePattern.exec(output)) !== null) {
      const file = match[1].trim();
      const testName = match[2].trim();

      // Try to find error message after the failure
      const errorStart = output.indexOf(match[0]) + match[0].length;
      const nextSection = output.slice(errorStart, errorStart + 500);
      const errorMatch = nextSection.match(/(?:Error|AssertionError):\s*(.+?)(?=\n\s*\n|\n.*(?:FAIL|PASS|✓|✗))/s);

      result.failures.push({
        name: testName,
        file,
        error: errorMatch ? errorMatch[1].trim() : undefined,
      });
    }

    return result.total > 0 ? result : null;
  }

  /**
   * Parse Jest output format.
   */
  private parseJestOutput(output: string): TestResult | null {
    const result: TestResult = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      failures: [],
      success: true,
    };

    // Match: "Tests:       5 passed, 2 failed, 7 total"
    const testMatch = output.match(/Tests:\s+(?:(\d+)\s+passed,?\s*)?(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(\d+)\s+total/i);
    if (testMatch) {
      result.passed = parseInt(testMatch[1], 10) || 0;
      result.failed = parseInt(testMatch[2], 10) || 0;
      result.skipped = parseInt(testMatch[3], 10) || 0;
      result.total = parseInt(testMatch[4], 10) || result.passed + result.failed + result.skipped;
      result.success = result.failed === 0;
    }

    // Extract duration: "Time:        5.123 s"
    const durationMatch = output.match(/Time:\s+([\d.]+)\s*s/i);
    if (durationMatch) {
      result.duration = parseFloat(durationMatch[1]);
    }

    // Extract failures: "● test name"
    const failurePattern = /●\s+(.+?)(?:\n\n|\n\s+expect)/g;
    let match;
    while ((match = failurePattern.exec(output)) !== null) {
      const testName = match[1].trim();
      result.failures.push({ name: testName });
    }

    return result.total > 0 ? result : null;
  }

  /**
   * Parse pytest output format.
   */
  private parsePytestOutput(output: string): TestResult | null {
    const result: TestResult = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      failures: [],
      success: true,
    };

    // Match: "5 passed, 2 failed, 1 skipped in 1.23s"
    const summaryMatch = output.match(/(?:=+\s*)?((\d+)\s+passed)?(?:,?\s*(\d+)\s+failed)?(?:,?\s*(\d+)\s+skipped)?(?:,?\s*(\d+)\s+error)?.*?in\s+([\d.]+)s/i);
    if (summaryMatch) {
      result.passed = parseInt(summaryMatch[2], 10) || 0;
      result.failed = (parseInt(summaryMatch[3], 10) || 0) + (parseInt(summaryMatch[5], 10) || 0);
      result.skipped = parseInt(summaryMatch[4], 10) || 0;
      result.total = result.passed + result.failed + result.skipped;
      result.duration = parseFloat(summaryMatch[6]);
      result.success = result.failed === 0;
    }

    // Extract failures: "FAILED test_file.py::test_name"
    const failurePattern = /FAILED\s+([^:\s]+)::([^\s\n]+)/g;
    let match;
    while ((match = failurePattern.exec(output)) !== null) {
      result.failures.push({
        name: match[2],
        file: match[1],
      });
    }

    return result.total > 0 ? result : null;
  }

  /**
   * Parse Go test output format.
   */
  private parseGoTestOutput(output: string): TestResult | null {
    const result: TestResult = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      failures: [],
      success: true,
    };

    // Count passes and fails
    const passMatches = output.match(/--- PASS:/g);
    const failMatches = output.match(/--- FAIL:/g);
    const skipMatches = output.match(/--- SKIP:/g);

    result.passed = passMatches?.length || 0;
    result.failed = failMatches?.length || 0;
    result.skipped = skipMatches?.length || 0;
    result.total = result.passed + result.failed + result.skipped;
    result.success = result.failed === 0;

    // Extract duration from "ok" or "FAIL" lines
    const durationMatch = output.match(/(?:ok|FAIL)\s+\S+\s+([\d.]+)s/);
    if (durationMatch) {
      result.duration = parseFloat(durationMatch[1]);
    }

    // Extract failures
    const failurePattern = /--- FAIL:\s+(\S+)/g;
    let match;
    while ((match = failurePattern.exec(output)) !== null) {
      result.failures.push({ name: match[1] });
    }

    return result.total > 0 ? result : null;
  }

  /**
   * Parse Cargo test output format.
   */
  private parseCargoTestOutput(output: string): TestResult | null {
    const result: TestResult = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      failures: [],
      success: true,
    };

    // Match: "test result: ok. 5 passed; 0 failed; 1 ignored"
    const summaryMatch = output.match(/test result:\s*\w+\.\s*(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/i);
    if (summaryMatch) {
      result.passed = parseInt(summaryMatch[1], 10);
      result.failed = parseInt(summaryMatch[2], 10);
      result.skipped = parseInt(summaryMatch[3], 10);
      result.total = result.passed + result.failed + result.skipped;
      result.success = result.failed === 0;
    }

    // Extract duration: "finished in 1.23s"
    const durationMatch = output.match(/finished in ([\d.]+)s/i);
    if (durationMatch) {
      result.duration = parseFloat(durationMatch[1]);
    }

    // Extract failures: "test tests::test_name ... FAILED"
    const failurePattern = /test\s+(\S+)\s+\.\.\.\s+FAILED/g;
    let match;
    while ((match = failurePattern.exec(output)) !== null) {
      result.failures.push({ name: match[1] });
    }

    return result.total > 0 ? result : null;
  }
}
