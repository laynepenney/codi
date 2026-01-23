// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for slash commands using MockProvider with file-based responses.
 *
 * These tests verify that commands execute correctly and produce expected output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Platform-aware timeouts - macOS CI is slower
const isMacOS = process.platform === 'darwin';
const TEST_TIMEOUT = isMacOS ? 90000 : 20000;
const WAIT_TIMEOUT = isMacOS ? 60000 : 15000;

// Set longer timeout for E2E tests
vi.setConfig({ testTimeout: TEST_TIMEOUT });
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { setupMockE2E, cleanupMockE2E, textResponse, type MockE2ESession } from './helpers/mock-e2e.js';

function distEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

/**
 * Process harness for E2E tests without PTY.
 */
class ProcessHarness {
  private proc: ChildProcess;
  private output = '';
  private exitPromise: Promise<number | null>;

  constructor(command: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    this.proc = spawn(command, args, {
      cwd: opts?.cwd,
      env: {
        ...process.env,
        ...opts?.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        CI: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (data) => {
      this.output += data.toString();
    });

    this.proc.stderr?.on('data', (data) => {
      this.output += data.toString();
    });

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

  async waitFor(pattern: string | RegExp, timeoutMs = WAIT_TIMEOUT): Promise<string> {
    const re = typeof pattern === 'string'
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : pattern;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (re.test(this.output)) {
        return this.output;
      }
      await new Promise(r => setTimeout(r, 50));
    }

    throw new Error(`Timeout waiting for pattern: ${pattern}\n\nOutput:\n${this.output}`);
  }

  kill(): void {
    this.proc.kill('SIGTERM');
  }

  async waitForExit(timeoutMs = 5000): Promise<number | null> {
    const timeout = new Promise<number | null>((resolve) => {
      setTimeout(() => {
        this.kill();
        resolve(null);
      }, timeoutMs);
    });

    return Promise.race([this.exitPromise, timeout]);
  }
}

describe('/help command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Help displayed.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show help with /help', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/help');

    // Should show built-in commands section
    await proc.waitFor(/Built-in Commands|\/clear|\/compact|\/status/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });

  it('should show command-specific help with /help <command>', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/config --help');

    // Should show config command usage
    await proc.waitFor(/Usage:.*\/config|init|show|example/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/status command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Status checked.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show status information', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/status');

    // Should show context status with tokens and messages
    await proc.waitFor(/Context Status|Tokens:|Messages:/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/context command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Context displayed.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show context information', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/context');

    // Should show project context or "no project detected"
    await proc.waitFor(/Project Context|No project detected/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/clear command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('First response.'),
      textResponse('After clear.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should clear conversation history', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);

    // Send a message first
    proc.writeLine('Hello');
    await proc.waitFor(/First response/i);

    // Clear the conversation
    proc.writeLine('/clear');
    await proc.waitFor(/cleared|Cleared/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/models command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Models listed.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list available models', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/models');

    // Should show available models header
    await proc.waitFor(/Available Models|mock|Model/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/config command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Config shown.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show config not found when no config exists', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/config');

    // Should indicate no config found
    await proc.waitFor(/not found|No.*config|create/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });

  it('should show config when it exists', async () => {
    // Create a config file with a valid provider to avoid warning messages
    // (warnings contain colons which break the output format parsing)
    const config = {
      provider: 'anthropic',
      autoApprove: ['read_file'],
    };
    fs.writeFileSync(path.join(projectDir, '.codi.json'), JSON.stringify(config, null, 2));

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/config');

    // Should show workspace configuration header and file path
    await proc.waitFor(/Workspace Configuration|File:.*\.codi\.json/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });

  it('should show help with /config --help', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/config --help');

    // Should show usage
    await proc.waitFor(/Usage:.*\/config|init|show|example/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/sessions command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Sessions listed.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list sessions (may be empty)', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/sessions');

    // Should show sessions list or "no sessions"
    await proc.waitFor(/Saved Sessions|No saved sessions/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/compact command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    // Need multiple responses for the conversation before compact
    mockSession = setupMockE2E([
      textResponse('First message response.'),
      textResponse('Second message response.'),
      textResponse('Third message response.'),
      textResponse('Summary of conversation.'), // For the compact summarization
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should compact conversation history', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);

    // Build up some conversation history
    proc.writeLine('First message');
    await proc.waitFor(/First message response/i);

    proc.writeLine('Second message');
    await proc.waitFor(/Second message response/i);

    proc.writeLine('Third message');
    await proc.waitFor(/Third message response/i);

    // Compact the conversation - wait for compaction message
    proc.writeLine('/compact');
    // Compaction shows "Context compacted" or similar
    await proc.waitFor(/compact|Compact|Context|reduced|messages/i, 15000);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/usage command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Usage response.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show usage statistics', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/usage');

    // Should show current session usage
    await proc.waitFor(/Current Session Usage|Session Usage|Requests:/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/memories command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Memory response.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should show memories (may be empty)', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/memories');

    // Should show memories or "no memories stored"
    await proc.waitFor(/memories|No memories stored|\/remember/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});

describe('/plugins command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    mockSession = setupMockE2E([
      textResponse('Plugins response.'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  it('should list plugins (may be empty)', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/plugins');

    // Plugin system is currently disabled
    await proc.waitFor(/__PLUGINS_DISABLED__|Plugin.*disabled/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
