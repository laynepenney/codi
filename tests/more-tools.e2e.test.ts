// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for additional tools using MockProvider.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  setupMockE2E,
  cleanupMockE2E,
  textResponse,
  toolResponse,
  toolCall,
  type MockE2ESession,
} from './helpers/mock-e2e.js';

// Platform-aware timeouts - macOS CI is slower
const isMacOS = process.platform === 'darwin';
const TEST_TIMEOUT = isMacOS ? 90000 : 20000;
const WAIT_TIMEOUT = isMacOS ? 60000 : 15000;

vi.setConfig({ testTimeout: TEST_TIMEOUT });

function distEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-more-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

describe('insert_line tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'file.ts'), 'line1\nline2\nline3');
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should insert a line at specified position', async () => {
    const filePath = path.join(projectDir, 'file.ts');

    mockSession = setupMockE2E([
      toolResponse([toolCall('insert_line', { path: filePath, line: 2, content: 'inserted' })]),
      textResponse('Inserted a new line at position 2.'),
    ]);

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Insert a line in file.ts');

    await proc.waitFor(/Inserted|line|position/i, 15000);

    // Verify file was modified
    await new Promise(r => setTimeout(r, 200));
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('inserted');

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('patch_file tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'code.ts'), 'const old = 1;\nconst value = 2;');
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should apply a patch to file', async () => {
    const filePath = path.join(projectDir, 'code.ts');
    const patch = `--- a/code.ts
+++ b/code.ts
@@ -1,2 +1,2 @@
-const old = 1;
+const new = 1;
 const value = 2;`;

    mockSession = setupMockE2E([
      toolResponse([toolCall('patch_file', { path: filePath, patch })]),
      textResponse('Applied the patch to update the variable name.'),
    ]);

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Apply a patch to code.ts');

    await proc.waitFor(/patch|Applied|update/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('run_tests tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    // Create a minimal package.json with test script
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: { test: 'echo "tests passed"' },
    }));
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should run tests', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('run_tests', {})]),
      textResponse('All tests passed successfully.'),
    ]);

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Run the tests');

    await proc.waitFor(/test|passed|success/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('shell_info tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should get shell information', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('shell_info', {})]),
      textResponse('The system is running on macOS with zsh shell.'),
    ]);

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('What shell am I using?');

    await proc.waitFor(/shell|zsh|bash|macOS|system/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('generate_docs tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'api.ts'), `
export function fetchUser(id: string): Promise<User> {
  return fetch('/users/' + id).then(r => r.json());
}
`);
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should generate documentation', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('generate_docs', { path: path.join(projectDir, 'api.ts') })]),
      textResponse('Generated JSDoc documentation for the fetchUser function.'),
    ]);

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Generate docs for api.ts');

    await proc.waitFor(/doc|JSDoc|Generated|fetchUser/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('refactor tool E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'old.ts'), 'export function oldName() { return 1; }');
    fs.writeFileSync(path.join(projectDir, 'user.ts'), 'import { oldName } from "./old";');
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should refactor code', async () => {
    mockSession = setupMockE2E([
      toolResponse([toolCall('refactor', {
        action: 'rename',
        path: path.join(projectDir, 'old.ts'),
        oldName: 'oldName',
        newName: 'newName',
      })]),
      textResponse('Renamed oldName to newName across the codebase.'),
    ]);

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Rename oldName to newName');

    await proc.waitFor(/Rename|oldName|newName|refactor/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('Multiple tools in sequence E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    fs.writeFileSync(path.join(projectDir, 'src.ts'), 'export const VERSION = "1.0.0";');
  });

  afterEach(async () => {
    if (proc) { proc.kill(); await proc.waitForExit().catch(() => {}); }
    if (mockSession) cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should handle read -> edit -> verify sequence', async () => {
    const filePath = path.join(projectDir, 'src.ts');

    mockSession = setupMockE2E([
      // First read the file
      toolResponse([toolCall('read_file', { path: filePath })]),
      // Then edit it
      toolResponse([toolCall('edit_file', {
        path: filePath,
        old_string: '"1.0.0"',
        new_string: '"2.0.0"',
      })]),
      // Then read again to verify
      toolResponse([toolCall('read_file', { path: filePath })]),
      // Final response
      textResponse('Updated VERSION from 1.0.0 to 2.0.0 and verified the change.'),
    ]);

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock', '-y'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('Update the version to 2.0.0 and verify');

    await proc.waitFor(/Updated|VERSION|2\.0\.0|verified/i, 20000);

    // Verify file was updated
    await new Promise(r => setTimeout(r, 200));
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('"2.0.0"');

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
