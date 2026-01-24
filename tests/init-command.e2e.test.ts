// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for the /init command using MockProvider with file-based responses.
 *
 * These tests verify that /init correctly creates configuration files
 * and provides appropriate feedback to users.
 *
 * Uses child_process.spawn instead of PTY for broader environment compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { setupMockE2E, cleanupMockE2E, textResponse, type MockE2ESession } from './helpers/mock-e2e.js';
import { ProcessHarness, TEST_TIMEOUT, distEntry } from './helpers/process-harness.js';

vi.setConfig({ testTimeout: TEST_TIMEOUT });

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-init-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

describe('/init command E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness;

  beforeEach(() => {
    projectDir = createTempProjectDir();

    // Set up mock provider with file-based responses
    mockSession = setupMockE2E([
      textResponse('Configuration initialized successfully.'),
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

  it('should create both config files with /init', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    // Wait for prompt
    await proc.waitFor(/>|codi/i);

    // Run /init command
    proc.writeLine('/init');

    // Wait for success output
    await proc.waitFor(/Created.*\.codi\.json|config:created/i);

    // Give it a moment to write files
    await new Promise(r => setTimeout(r, 100));

    // Verify files were created
    expect(fs.existsSync(path.join(projectDir, '.codi.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'codi-models.yaml'))).toBe(true);

    // Verify .codi.json has valid content
    const codiConfig = JSON.parse(fs.readFileSync(path.join(projectDir, '.codi.json'), 'utf-8'));
    expect(codiConfig).toHaveProperty('autoApprove');

    // Verify codi-models.yaml is valid
    const modelMapContent = fs.readFileSync(path.join(projectDir, 'codi-models.yaml'), 'utf-8');
    expect(modelMapContent).toContain('version:');

    // Exit
    proc.writeLine('/exit');
    await proc.waitForExit();
  });

  it('should create only .codi.json with /init --config', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/init --config');

    await proc.waitFor(/Created.*\.codi\.json|config:created/i);
    await new Promise(r => setTimeout(r, 100));

    // Only .codi.json should exist
    expect(fs.existsSync(path.join(projectDir, '.codi.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'codi-models.yaml'))).toBe(false);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });

  it('should create only codi-models.yaml with /init --modelmap', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/init --modelmap');

    await proc.waitFor(/Created.*codi-models\.yaml|modelmap:created/i);
    await new Promise(r => setTimeout(r, 100));

    // Only codi-models.yaml should exist
    expect(fs.existsSync(path.join(projectDir, '.codi.json'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'codi-models.yaml'))).toBe(true);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });

  it('should report existing files on second /init', async () => {
    // Pre-create the config files
    fs.writeFileSync(path.join(projectDir, '.codi.json'), '{}');
    fs.writeFileSync(path.join(projectDir, 'codi-models.yaml'), 'version: "1"');

    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/init');

    // Should report files already exist
    await proc.waitFor(/already exists|exists/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });

  it('should show help with /init --help', async () => {
    proc = new ProcessHarness(process.execPath, [distEntry(), '--provider', 'mock'], {
      cwd: projectDir,
      env: mockSession.env,
    });

    await proc.waitFor(/>|codi/i);
    proc.writeLine('/init --help');

    // Should show usage information
    await proc.waitFor(/Usage:.*\/init|--config|--modelmap/i);

    proc.writeLine('/exit');
    await proc.waitForExit();
  });
});
