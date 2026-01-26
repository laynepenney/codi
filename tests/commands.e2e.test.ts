// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for slash commands using MockProvider with file-based responses.
 *
 * These tests verify that commands execute correctly and produce expected output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { setupMockE2E, cleanupMockE2E, textResponse, type MockE2ESession } from './helpers/mock-e2e.js';
import { ProcessHarness, TEST_TIMEOUT, distEntry } from './helpers/process-harness.js';

// Set longer timeout for E2E tests
vi.setConfig({ testTimeout: TEST_TIMEOUT });

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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);

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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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
    // Need multiple responses for the conversation before compact.
    // Auto-label generation and RAG/context checks may consume responses,
    // so we use extra buffer responses with generic patterns for robustness.
    mockSession = setupMockE2E([
      textResponse('Response A from mock.'),
      textResponse('Response B from mock.'),
      textResponse('Response C from mock.'),
      textResponse('Response D from mock.'),
      textResponse('Response E from mock.'),
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

    await proc.waitFor(/Tips:|You:/i);

    // Build up some conversation history
    // We use generic patterns to match any mock response (A, B, C, etc.)
    // Some responses may be consumed by RAG/context checks, so we use buffer
    proc.writeLine('First message');
    await proc.waitFor(/Response [A-E] from mock/i);
    proc.clearOutput(); // Clear to avoid matching previous response

    proc.writeLine('Second message');
    await proc.waitFor(/Response [A-E] from mock/i);
    proc.clearOutput();

    proc.writeLine('Third message');
    await proc.waitFor(/Response [A-E] from mock/i);
    proc.clearOutput();

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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
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

    await proc.waitFor(/Tips:|You:/i);
    proc.writeLine('/plugins');

    // Plugin system is currently disabled
    await proc.waitFor(/__PLUGINS_DISABLED__|Plugin.*disabled/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
