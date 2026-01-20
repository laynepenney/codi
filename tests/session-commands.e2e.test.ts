// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for session-related slash commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { setupMockE2E, cleanupMockE2E, textResponse, type MockE2ESession } from './helpers/mock-e2e.js';

vi.setConfig({ testTimeout: 20000 });

function distEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-session-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

function createTempHomeDir(): string {
  const baseDir = path.join(process.cwd(), '.tmp');
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, 'codi-home-'));
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

class ProcessHarness {
  private proc: ChildProcess;
  private output = '';
  private exitPromise: Promise<number | null>;

  constructor(command: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    this.proc = spawn(command, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (data) => { this.output += data.toString(); });
    this.proc.stderr?.on('data', (data) => { this.output += data.toString(); });

    this.exitPromise = new Promise((resolve) => {
      this.proc.on('exit', (code) => resolve(code));
      this.proc.on('error', () => resolve(null));
    });
  }

  writeLine(data: string): void { this.proc.stdin?.write(data + '\n'); }
  getOutput(): string { return this.output; }

  async waitFor(pattern: string | RegExp, timeoutMs = 10000): Promise<string> {
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

  kill(): void { this.proc.kill('SIGTERM'); }

  async waitForExit(timeoutMs = 5000): Promise<number | null> {
    const timeout = new Promise<number | null>((resolve) => {
      setTimeout(() => { this.kill(); resolve(null); }, timeoutMs);
    });
    return Promise.race([this.exitPromise, timeout]);
  }
}

function writeSessionFile(
  sessionsDir: string,
  data: {
    name: string;
    projectPath: string;
    createdAt: string;
    updatedAt: string;
  }
): void {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const session = {
    name: data.name,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    projectPath: data.projectPath,
    projectName: 'test-project',
    provider: 'mock',
    model: 'mock-model',
    messages: [{ role: 'user', content: 'Hello' }],
    conversationSummary: null,
  };
  fs.writeFileSync(path.join(sessionsDir, `${data.name}.json`), JSON.stringify(session, null, 2));
}

describe('/save command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let homeDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    homeDir = createTempHomeDir();
    mockSession = setupMockE2E([
      textResponse('First response for session.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
    cleanupTempDir(homeDir);
  });

  it('should save session', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: {
        ...mockSession.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
    });

    await proc.waitFor(/>|codi/i);

    // Have a conversation first
    proc.writeLine('Hello');
    await proc.waitFor(/First response/i);

    // Save the session
    proc.writeLine('/save test-session');
    await proc.waitFor(/Saved|saved|Session/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('auto-save and resume E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let homeDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    homeDir = createTempHomeDir();
    mockSession = setupMockE2E([
      textResponse('Auto-save response.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
    cleanupTempDir(homeDir);
  });

  it('auto-saves sessions after a response', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: {
        ...mockSession.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Hello');
    await proc.waitFor(/Auto-save response/i);
    proc.writeLine('/exit');
    await proc.waitForExit();

    const sessionsDir = path.join(homeDir, '.codi', 'sessions');
    const sessionFiles = fs.readdirSync(sessionsDir).filter(file => file.endsWith('.json'));
    expect(sessionFiles.length).toBe(1);

    const sessionData = JSON.parse(
      fs.readFileSync(path.join(sessionsDir, sessionFiles[0]), 'utf-8')
    );
    expect(fs.realpathSync(sessionData.projectPath)).toBe(fs.realpathSync(projectDir));
    expect(sessionData.messages.length).toBeGreaterThan(0);
  });

  it('resumes the most recent session for the current directory', async () => {
    const sessionsDir = path.join(homeDir, '.codi', 'sessions');
    const older = new Date('2024-01-01T00:00:00.000Z').toISOString();
    const newer = new Date('2024-01-02T00:00:00.000Z').toISOString();
    const other = new Date('2024-01-03T00:00:00.000Z').toISOString();

    writeSessionFile(sessionsDir, {
      name: 'project-old',
      projectPath: projectDir,
      createdAt: older,
      updatedAt: older,
    });
    writeSessionFile(sessionsDir, {
      name: 'project-new',
      projectPath: projectDir,
      createdAt: newer,
      updatedAt: newer,
    });
    writeSessionFile(sessionsDir, {
      name: 'other-new',
      projectPath: path.join(projectDir, 'other'),
      createdAt: other,
      updatedAt: other,
    });

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '--resume'], {
      cwd: projectDir,
      env: {
        ...mockSession.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
    });

    await proc.waitFor(/Loaded session: project-new/i);
    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/load command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let homeDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    homeDir = createTempHomeDir();
    mockSession = setupMockE2E([
      textResponse('Response in session.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
    cleanupTempDir(homeDir);
  });

  it('should report when session not found', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: {
        ...mockSession.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/load nonexistent-session');

    // Should report not found
    await proc.waitFor(/not found|No session|doesn't exist/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
