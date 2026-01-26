// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared ProcessHarness for E2E tests.
 *
 * Automatically isolates HOME to prevent loading user's global config.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Platform-aware timeouts - macOS CI is slower
const isMacOS = process.platform === 'darwin';
export const TEST_TIMEOUT = isMacOS ? 90000 : 20000;
export const WAIT_TIMEOUT = isMacOS ? 60000 : 15000;

/**
 * Get the path to the built codi entry point.
 */
export function distEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

/**
 * Process harness for E2E testing of the CLI.
 *
 * Key features:
 * - Automatically isolates HOME to prevent loading user's global config
 * - Captures stdout and stderr
 * - Provides waitFor() for pattern matching
 * - Manages temp directories
 */
export class ProcessHarness {
  private proc: ChildProcess;
  private output = '';
  private exitPromise: Promise<number | null>;
  private tempHome: string | null;

  constructor(command: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    // Create isolated HOME directory to prevent loading user's global config
    // Only if the test doesn't provide its own HOME
    const userProvidedHome = opts?.env?.HOME || opts?.env?.USERPROFILE;
    if (userProvidedHome) {
      // User manages their own HOME
      this.tempHome = null;
    } else {
      // Create isolated temp HOME
      this.tempHome = path.join(os.tmpdir(), `codi-e2e-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      fs.mkdirSync(this.tempHome, { recursive: true });
    }

    this.proc = spawn(command, args, {
      cwd: opts?.cwd,
      env: {
        ...process.env,
        // Set default isolated HOME if we created one
        ...(this.tempHome ? { HOME: this.tempHome, USERPROFILE: this.tempHome } : {}),
        ...opts?.env, // User env comes after to allow overriding
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        CI: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (data) => { this.output += data.toString(); });
    this.proc.stderr?.on('data', (data) => { this.output += data.toString(); });

    this.exitPromise = new Promise((resolve) => {
      this.proc.on('exit', (code) => resolve(code));
      this.proc.on('error', () => resolve(null));
    });
  }

  write(data: string): void {
    this.proc.stdin?.write(data);
  }

  writeLine(data: string): void {
    this.write(data + '\n');
  }

  getOutput(): string {
    return this.output;
  }

  clearOutput(): void {
    this.output = '';
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  async waitFor(pattern: string | RegExp, timeoutMs = WAIT_TIMEOUT): Promise<string> {
    const re = typeof pattern === 'string'
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : pattern;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (re.test(this.output)) return this.output;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for pattern: ${pattern}\n\nOutput:\n${this.output}`);
  }

  /**
   * Wait for output buffer to flush. Use between sequential operations
   * to prevent race conditions where responses arrive before being captured.
   */
  async waitForOutputFlush(ms = 100): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }

  kill(): void {
    this.proc.kill('SIGTERM');
  }

  async waitForExit(timeoutMs = 5000): Promise<number | null> {
    const timeout = new Promise<number | null>((resolve) => {
      setTimeout(() => { this.kill(); resolve(null); }, timeoutMs);
    });
    const result = await Promise.race([this.exitPromise, timeout]);

    // Cleanup temp home directory (only if we created it)
    if (this.tempHome) {
      try {
        fs.rmSync(this.tempHome, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return result;
  }
}
