// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for workflow and miscellaneous slash commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { setupMockE2E, cleanupMockE2E, textResponse, type MockE2ESession } from './helpers/mock-e2e.js';

// Skip orchestrator tests on Windows (Unix domain sockets not supported)
const isWindows = process.platform === 'win32';

// Platform-aware timeouts - macOS CI is slower
const isMacOS = process.platform === 'darwin';
const TEST_TIMEOUT = isMacOS ? 90000 : 20000;
const WAIT_TIMEOUT = isMacOS ? 60000 : 15000;

vi.setConfig({ testTimeout: TEST_TIMEOUT });

function distEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-workflow-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

describe('/new command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('I will create a new component for you.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should create new component', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/new component Button');

    await proc.waitFor(/create|component|Button/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/scaffold command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('I will scaffold the project structure.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should scaffold project', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/scaffold express-api');

    await proc.waitFor(/scaffold|project|structure/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/debug command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'buggy.ts'), 'function test() { throw new Error("bug"); }');
    mockSession = setupMockE2E([
      textResponse('I found the issue - the function always throws an error.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should debug code', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/debug buggy.ts');

    await proc.waitFor(/debug|issue|error|found/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/remember command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Memory saved.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should remember a fact', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/remember I prefer TypeScript over JavaScript');

    await proc.waitFor(/Remembered|saved|memory|TypeScript/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/profile command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Profile updated.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show profile', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/profile');

    // Should show profile or empty message
    await proc.waitFor(/Profile|No profile|name|preferences/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/compress command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('First response.'),
      textResponse('Second response.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show compression status', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/compress');

    // Should show compression info
    await proc.waitFor(/Compress|compression|enabled|disabled|status/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/approvals command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Approvals shown.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list approvals', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/approvals list');

    // Should show approval patterns
    await proc.waitFor(/Approval|patterns|categories|No.*patterns/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/index command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'src.ts'), 'export const x = 1;');
    mockSession = setupMockE2E([
      textResponse('Indexing complete.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show index status', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/index status');

    // Should show index status
    await proc.waitFor(/Index|index|chunks|files|status/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/symbols command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'module.ts'), 'export function myFunction() {}');
    mockSession = setupMockE2E([
      textResponse('Symbols shown.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show symbol stats', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/symbols stats');

    // Should show symbol statistics
    await proc.waitFor(/Symbol|symbols|stats|files|index/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/modelmap command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Model map shown.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show model map or not found', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/modelmap');

    // Should show model map info or not found
    await proc.waitFor(/Model Map|No model map|models|tasks|codi-models/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/switch command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Model switched.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show switch help without args', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/switch --help');

    // Should show usage
    await proc.waitFor(/Usage|switch|provider|model/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/filehistory command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('History shown.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show file history', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/filehistory');

    // Should show history or empty message
    await proc.waitFor(/History|history|No.*history|empty|changes/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/plan command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Planning the implementation.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should create a plan', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/plan add user authentication');

    // Should start planning
    await proc.waitFor(/plan|Planning|implementation|authentication/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/plans command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Plans listed.'),
    ]);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list plans', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/plans');

    // Should show plans or empty
    await proc.waitFor(/Plans|plans|No.*plans|saved/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
