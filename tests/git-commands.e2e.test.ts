// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for git-related slash commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { setupMockE2E, cleanupMockE2E, textResponse, type MockE2ESession } from './helpers/mock-e2e.js';

// Platform-aware timeouts - macOS CI is slower
const isMacOS = process.platform === 'darwin';
const TEST_TIMEOUT = isMacOS ? 90000 : 20000;
const WAIT_TIMEOUT = isMacOS ? 60000 : 15000;

vi.setConfig({ testTimeout: TEST_TIMEOUT });

function distEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

function createTempGitDir(): string {
  const dir = path.join(os.tmpdir(), `codi-git-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  // Initialize git repo
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
  return dir;
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

  kill(): void { this.proc.kill('SIGTERM'); }

  async waitForExit(timeoutMs = 5000): Promise<number | null> {
    const timeout = new Promise<number | null>((resolve) => {
      setTimeout(() => { this.kill(); resolve(null); }, timeoutMs);
    });
    return Promise.race([this.exitPromise, timeout]);
  }
}

describe('/commit command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempGitDir();
    // Create and stage a file
    fs.writeFileSync(path.join(projectDir, 'test.ts'), 'export const x = 1;');
    execSync('git add test.ts', { cwd: projectDir, stdio: 'ignore' });
    mockSession = setupMockE2E([
      textResponse('Generated commit message: feat: add test module'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should generate commit message', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/commit');

    // Should generate commit message
    await proc.waitFor(/commit|feat|message/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/branch command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempGitDir();
    // Need at least one commit for branches
    fs.writeFileSync(path.join(projectDir, 'init.txt'), 'init');
    execSync('git add . && git commit -m "init"', { cwd: projectDir, stdio: 'ignore' });
    mockSession = setupMockE2E([
      textResponse('Branch operations completed.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list branches', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/branch list');

    // Should show branch list or AI response about branches
    await proc.waitFor(/Branch|branch|master|main|operations|completed/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/diff command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempGitDir();
    fs.writeFileSync(path.join(projectDir, 'file.txt'), 'original');
    execSync('git add . && git commit -m "init"', { cwd: projectDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(projectDir, 'file.txt'), 'modified');
    mockSession = setupMockE2E([
      textResponse('The diff shows changes from original to modified.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show diff', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/diff');

    // Should show diff or AI analysis
    await proc.waitFor(/diff|changes|original|modified/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/gitstatus command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempGitDir();
    fs.writeFileSync(path.join(projectDir, 'untracked.txt'), 'new file');
    mockSession = setupMockE2E([
      textResponse('Git status: 1 untracked file.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show git status', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/gitstatus');

    // Should show status
    await proc.waitFor(/status|untracked|file/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/log command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempGitDir();
    fs.writeFileSync(path.join(projectDir, 'file.txt'), 'content');
    execSync('git add . && git commit -m "Initial commit"', { cwd: projectDir, stdio: 'ignore' });
    mockSession = setupMockE2E([
      textResponse('Commit history shows 1 commit: Initial commit.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show git log', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/log');

    // Should show log
    await proc.waitFor(/commit|history|Initial/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/stash command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempGitDir();
    fs.writeFileSync(path.join(projectDir, 'file.txt'), 'content');
    execSync('git add . && git commit -m "init"', { cwd: projectDir, stdio: 'ignore' });
    mockSession = setupMockE2E([
      textResponse('Stash list is empty.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list stashes', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/stash list');

    // Should show stash list or empty message
    await proc.waitFor(/stash|empty|No stashes/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/pr command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempGitDir();
    fs.writeFileSync(path.join(projectDir, 'feature.ts'), 'export const feature = true;');
    execSync('git add . && git commit -m "Add feature"', { cwd: projectDir, stdio: 'ignore' });
    mockSession = setupMockE2E([
      textResponse('PR Description: This PR adds a new feature flag.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should generate PR description', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/pr');

    // Should generate PR description
    await proc.waitFor(/PR|pull request|feature|description/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
