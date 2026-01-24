// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for code-related slash commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { setupMockE2E, cleanupMockE2E, textResponse, type MockE2ESession } from './helpers/mock-e2e.js';

// Platform-aware timeouts - macOS CI is slower
const isMacOS = process.platform === 'darwin';
const TEST_TIMEOUT = isMacOS ? 90000 : 20000;
const WAIT_TIMEOUT = isMacOS ? 60000 : 15000;

vi.setConfig({ testTimeout: TEST_TIMEOUT });

function distEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-code-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
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

describe('/prompt explain command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'test.ts'), 'export function add(a: number, b: number) { return a + b; }');
    mockSession = setupMockE2E([
      textResponse('This function adds two numbers together and returns the result.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should explain code', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/prompt explain test.ts');

    // Should send to AI for explanation
    await proc.waitFor(/adds two numbers|function|result/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/refactor command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'legacy.ts'), 'var x = 1; var y = 2;');
    mockSession = setupMockE2E([
      textResponse('I will refactor this code to use modern const/let declarations.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should refactor code', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/refactor legacy.ts to use const');

    await proc.waitFor(/refactor|const|modern/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/fix command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'buggy.ts'), 'function broken() { return undefined.length; }');
    mockSession = setupMockE2E([
      textResponse('I found the bug - accessing length on undefined. Here is the fix.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should fix code issues', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/fix buggy.ts');

    await proc.waitFor(/bug|fix|undefined/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/test command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'utils.ts'), 'export function multiply(a: number, b: number) { return a * b; }');
    mockSession = setupMockE2E([
      textResponse('I will generate tests for the multiply function.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should generate tests', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/test utils.ts');

    await proc.waitFor(/test|multiply|generate/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/prompt review command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'code.ts'), 'function foo() { console.log("test"); }');
    mockSession = setupMockE2E([
      textResponse('Code review: The function name could be more descriptive.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should review code', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/prompt review code.ts');

    await proc.waitFor(/review|function|descriptive/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/code doc command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'api.ts'), 'export function fetchData(url: string) { return fetch(url); }');
    mockSession = setupMockE2E([
      textResponse('I will add JSDoc documentation to this function.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should generate documentation', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/code doc api.ts');

    await proc.waitFor(/doc|JSDoc|documentation/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/code optimize command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'slow.ts'), 'function slow() { for(let i=0;i<1000000;i++){} }');
    mockSession = setupMockE2E([
      textResponse('I can optimize this code by removing the empty loop.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should optimize code', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/code optimize slow.ts');

    await proc.waitFor(/optimize|loop|removing/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
