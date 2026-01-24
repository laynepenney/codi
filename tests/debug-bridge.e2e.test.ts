// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2E tests for Debug Bridge Phase 4 features.
 *
 * Tests breakpoints, checkpoints, and session replay functionality
 * by spawning actual Codi and codi-debug processes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { setupMockE2E, cleanupMockE2E, textResponse, toolResponse, toolCall, type MockE2ESession } from './helpers/mock-e2e.js';
import { ProcessHarness, TEST_TIMEOUT, WAIT_TIMEOUT, distEntry } from './helpers/process-harness.js';

// Platform-aware timeouts for debug-specific operations
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const EXEC_TIMEOUT = isWindows ? 30000 : 10000;
const STARTUP_WAIT = isWindows ? 2000 : (isMacOS ? 1000 : 500);

// Set longer timeout for E2E tests
vi.setConfig({ testTimeout: TEST_TIMEOUT });

function debugCliEntry(): string {
  return path.resolve(process.cwd(), 'dist', 'debug-cli.js');
}

function createTempProjectDir(): string {
  const dir = path.join(os.tmpdir(), `codi-debug-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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
 * Execute a debug CLI command with platform-aware timeout.
 */
function execDebugCli(command: string, opts: { cwd: string; env: NodeJS.ProcessEnv }): string {
  return execSync(command, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT,
  });
}

describe('Debug Bridge E2E', () => {
  let mockSession: MockE2ESession;
  let projectDir: string;
  let proc: ProcessHarness | null = null;
  let debugDir: string;

  beforeEach(() => {
    projectDir = createTempProjectDir();
    debugDir = path.join(projectDir, '.codi', 'debug');

    // Set up mock responses for a simple conversation with tool use
    mockSession = setupMockE2E([
      toolResponse([toolCall('read_file', { path: 'test.txt' })]),
      textResponse('I read the file and it contains test content.'),
      textResponse('Goodbye!'),
    ], { enableLogging: true });
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.waitForExit().catch(() => {});
      proc = null;
    }
    cleanupMockE2E(mockSession);
    cleanupTempDir(projectDir);
  });

  describe('Debug bridge startup', () => {
    it('should start with --debug-bridge flag and create session', async () => {
      // Create a test file
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      // Wait for debug bridge startup message
      await proc.waitFor(/Debug bridge enabled/i);
      await proc.waitFor(/Events:/i);
      await proc.waitFor(/Session:/i);

      // Verify session directory was created
      await new Promise(r => setTimeout(r, STARTUP_WAIT));
      expect(fs.existsSync(debugDir)).toBe(true);
      expect(fs.existsSync(path.join(debugDir, 'sessions'))).toBe(true);

      proc.writeLine('/exit');
      await proc.waitForExit();
    });

    it('should create events.jsonl with session_start event', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Debug bridge enabled/i);
      await proc.waitFor(/Orchestrator: ready/i);

      // Give time for events to be written
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      // Find the session directory
      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      expect(sessions.length).toBeGreaterThan(0);

      const sessionDir = path.join(sessionsDir, sessions[0]);
      const eventsFile = path.join(sessionDir, 'events.jsonl');
      expect(fs.existsSync(eventsFile)).toBe(true);

      // Read and verify events
      const content = fs.readFileSync(eventsFile, 'utf8');
      const events = content.trim().split('\n').filter(l => l).map(l => JSON.parse(l));

      // Should have at least session_start
      const sessionStart = events.find(e => e.type === 'session_start');
      expect(sessionStart).toBeDefined();
      expect(sessionStart.data.provider.toLowerCase()).toBe('mock');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Breakpoint commands via codi-debug', () => {
    it('should add breakpoint via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      // Find the session
      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      // Run codi-debug to add breakpoint
      const result = execSync(`${process.execPath} ${debugCliEntry()} breakpoint add tool read_file -s ${sessionId}`, {
        cwd: projectDir,
        env: {
          ...process.env,
          HOME: projectDir,
          NO_COLOR: '1',
        },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: breakpoint_add');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });

    it('should list breakpoints via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      // Add a breakpoint first
      execSync(`${process.execPath} ${debugCliEntry()} breakpoint add tool write_file -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      // List breakpoints
      const result = execSync(`${process.execPath} ${debugCliEntry()} breakpoint list -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: breakpoint_list');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });

    it('should clear breakpoints via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} breakpoint clear -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: breakpoint_clear');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Checkpoint commands via codi-debug', () => {
    it('should create checkpoint via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} checkpoint create "test checkpoint" -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: checkpoint_create');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });

    it('should list checkpoints via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} checkpoint list -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: checkpoint_list');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Session replay', () => {
    it('should replay session events', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      // Start a session and generate some events
      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
        '-y', // Auto-approve tools
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);

      // Send a message to trigger tool use
      proc.writeLine('read test.txt');

      // Wait for tool execution
      await proc.waitFor(/read_file/i, 10000);
      await new Promise(r => setTimeout(r, STARTUP_WAIT * 2));

      // Exit cleanly
      proc.writeLine('/exit');
      await proc.waitForExit();
      proc = null;

      // Now replay the session
      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const replayResult = execSync(`${process.execPath} ${debugCliEntry()} replay ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      // Should show session events
      expect(replayResult).toContain('SESSION START');
      expect(replayResult).toContain('Replay complete');
    });

    it('should filter events during replay', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
        '-y',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      proc.writeLine('read test.txt');
      await proc.waitFor(/read_file/i, 10000);
      await new Promise(r => setTimeout(r, STARTUP_WAIT * 2));

      proc.writeLine('/exit');
      await proc.waitForExit();
      proc = null;

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      // Filter only for session start/end
      const replayResult = execSync(`${process.execPath} ${debugCliEntry()} replay ${sessionId} --filter session_start,session_end`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(replayResult).toContain('SESSION START');
      // Should NOT contain tool events when filtered
      expect(replayResult).not.toContain('TOOL START');
    });
  });

  describe('Pause/Resume with breakpoints', () => {
    it('should pause and resume via codi-debug', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      // Pause
      const pauseResult = execSync(`${process.execPath} ${debugCliEntry()} pause -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });
      expect(pauseResult).toContain('Sent: pause');

      // Resume
      const resumeResult = execSync(`${process.execPath} ${debugCliEntry()} resume -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });
      expect(resumeResult).toContain('Sent: resume');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Sessions command', () => {
    it('should list sessions via codi-debug', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const result = execSync(`${process.execPath} ${debugCliEntry()} sessions -a`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      // Should list the active session
      expect(result).toContain('Debug Sessions');
      expect(result).toContain('debug_');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Status command', () => {
    it('should show status via codi-debug', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} status -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Session Status');
      expect(result).toContain('ACTIVE');
      expect(result).toContain('Events:');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Inspect command', () => {
    it('should inspect via codi-debug', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} inspect all -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: inspect');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  // ============================================
  // Phase 5: Time Travel Debugging
  // ============================================

  describe('Branch commands via codi-debug', () => {
    it('should create branch via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} branch create test-branch -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: branch_create');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });

    it('should switch branch via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} branch switch main -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: branch_switch');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });

    it('should list branches via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} branch list -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: branch_list');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Rewind command via codi-debug', () => {
    it('should rewind via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} rewind cp_0_test -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      expect(result).toContain('Sent: rewind');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });

  describe('Timeline command via codi-debug', () => {
    it('should show timeline via codi-debug command', async () => {
      fs.writeFileSync(path.join(projectDir, 'test.txt'), 'test content');

      proc = new ProcessHarness(process.execPath, [
        distEntry(),
        '--provider', 'mock',
        '--debug-bridge',
      ], {
        cwd: projectDir,
        env: {
          ...mockSession.env,
          HOME: projectDir,
        },
      });

      await proc.waitFor(/Orchestrator: ready/i);
      await new Promise(r => setTimeout(r, STARTUP_WAIT));

      const sessionsDir = path.join(debugDir, 'sessions');
      const sessions = fs.readdirSync(sessionsDir);
      const sessionId = sessions[0];

      const result = execSync(`${process.execPath} ${debugCliEntry()} timeline -s ${sessionId}`, {
        cwd: projectDir,
        env: { ...process.env, HOME: projectDir, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
      });

      // Output may say "Timeline" or "No timeline data" depending on whether checkpoints exist
      expect(result.toLowerCase()).toContain('timeline');

      proc.writeLine('/exit');
      await proc.waitForExit();
    });
  });
});
