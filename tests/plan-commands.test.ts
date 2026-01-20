// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { planCommand, planListCommand } from '../src/commands/plan-commands.js';

describe('Plan Commands', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `.codi-plan-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('planCommand', () => {
    it('has correct metadata', () => {
      expect(planCommand.name).toBe('plan');
      expect(planCommand.aliases).toContain('p');
      expect(planCommand.taskType).toBe('complex');
    });

    it('shows help with -h flag', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await planCommand.execute('-h', {} as never);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('Usage: /plan');

      consoleSpy.mockRestore();
    });

    it('shows help with --help flag', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await planCommand.execute('--help', {} as never);

      expect(result).toBeNull();

      consoleSpy.mockRestore();
    });

    it('returns error message when no task provided', async () => {
      const result = await planCommand.execute('', {} as never);

      expect(result).toContain('Please describe what you want to accomplish');
    });

    it('creates plan file in .codi/plans directory', async () => {
      const result = await planCommand.execute('Add user authentication', {} as never);

      // Check plan directory was created
      const plansDir = join(testDir, '.codi', 'plans');
      expect(existsSync(plansDir)).toBe(true);

      // Check a plan file was created
      const files = readdirSync(plansDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^plan-.*\.md$/);

      // Check plan file content
      const planContent = readFileSync(join(plansDir, files[0]), 'utf-8');
      expect(planContent).toContain('# Plan: Add user authentication');
      expect(planContent).toContain('**Status:** Planning');
      expect(planContent).toContain('## Task');
      expect(planContent).toContain('## Analysis');
      expect(planContent).toContain('## Steps');
      expect(planContent).toContain('## Progress');
    });

    it('returns plan mode instructions', async () => {
      const result = await planCommand.execute('Implement dark mode', {} as never);

      expect(result).toContain('PLAN MODE');
      expect(result).toContain('Implement dark mode');
      expect(result).toContain('Phase 1: Exploration');
      expect(result).toContain('Phase 2: Planning');
      expect(result).toContain('Phase 3: Confirmation');
      expect(result).toContain('Phase 4: Execution');
      expect(result).toContain('Phase 5: Summary');
    });

    it('includes plan file path in response', async () => {
      const result = await planCommand.execute('Test task', {} as never);

      expect(result).toContain('.codi/plans/plan-');
      expect(result).toContain('.md');
    });

    it('generates unique plan IDs', async () => {
      await planCommand.execute('Task 1', {} as never);
      await planCommand.execute('Task 2', {} as never);

      const plansDir = join(testDir, '.codi', 'plans');
      const files = readdirSync(plansDir);
      expect(files.length).toBe(2);
      expect(files[0]).not.toBe(files[1]);
    });
  });

  describe('planListCommand', () => {
    it('has correct metadata', () => {
      expect(planListCommand.name).toBe('plans');
      expect(planListCommand.aliases).toContain('plan-list');
    });

    it('shows message when no plans exist (no directory)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await planListCommand.execute('', {} as never);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No plans found'));

      consoleSpy.mockRestore();
    });

    it('shows message when no plans exist (empty directory)', async () => {
      mkdirSync(join(testDir, '.codi', 'plans'), { recursive: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await planListCommand.execute('', {} as never);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No plans found'));

      consoleSpy.mockRestore();
    });

    it('lists existing plans', async () => {
      // Create a plan first
      await planCommand.execute('My test task', {} as never);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await planListCommand.execute('', {} as never);

      expect(result).toBeNull();

      // Check output contains plan info
      const allOutput = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(allOutput).toContain('Saved Plans');
      expect(allOutput).toContain('My test task');
      expect(allOutput).toContain('Planning');

      consoleSpy.mockRestore();
    });

    it('shows plans directory path', async () => {
      await planCommand.execute('Test', {} as never);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await planListCommand.execute('', {} as never);

      const allOutput = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(allOutput).toContain('Plans directory:');
      expect(allOutput).toContain('.codi/plans');

      consoleSpy.mockRestore();
    });

    it('handles multiple plans', async () => {
      await planCommand.execute('Task Alpha', {} as never);
      await planCommand.execute('Task Beta', {} as never);
      await planCommand.execute('Task Gamma', {} as never);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await planListCommand.execute('', {} as never);

      const allOutput = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(allOutput).toContain('Task Alpha');
      expect(allOutput).toContain('Task Beta');
      expect(allOutput).toContain('Task Gamma');

      consoleSpy.mockRestore();
    });
  });
});
