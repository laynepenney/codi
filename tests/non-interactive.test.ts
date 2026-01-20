// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';

const CLI_PATH = join(__dirname, '../dist/index.js');

/**
 * Helper to run CLI and capture output.
 */
function runCli(args: string[], env: Record<string, string> = {}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        stdout,
        stderr,
        exitCode: -1,
      });
    }, 30000);
  });
}

describe('Non-Interactive Mode', () => {
  describe('CLI flags', () => {
    it('shows help with --help', async () => {
      const result = await runCli(['--help']);
      expect(result.stdout).toContain('--prompt');
      expect(result.stdout).toContain('--output-format');
      expect(result.stdout).toContain('--quiet');
    });

    it('accepts -P as short form for --prompt', async () => {
      const result = await runCli(['--help']);
      expect(result.stdout).toContain('-P, --prompt');
    });
  });

  describe('output format', () => {
    // Note: These tests would require a valid API key to fully test
    // They serve as integration test templates

    it('defaults to text format', async () => {
      // This would test with a mock provider or real API
      // Skipping actual execution without API key
    });

    it('supports json output format', async () => {
      // This would test JSON output structure
      // Skipping actual execution without API key
    });
  });

  describe('quiet mode', () => {
    it('suppresses progress output with --quiet', async () => {
      // This would verify spinner is disabled in quiet mode
      // Skipping actual execution without API key
    });
  });
});
