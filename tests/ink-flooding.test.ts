// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Integration test for Ink UI flooding bug.
 *
 * Uses macOS `script` command to create a PTY and test terminal rendering.
 * This tests the real behavior when input text wraps to a new line.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, ChildProcess, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper to wait
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Ink UI flooding', () => {
  let childProcess: ChildProcess | null = null;
  let outputFile: string | null = null;

  afterEach(() => {
    if (childProcess) {
      childProcess.kill('SIGKILL');
      childProcess = null;
    }
    if (outputFile && existsSync(outputFile)) {
      try { unlinkSync(outputFile); } catch {}
    }
  });

  it('should not produce excessive output when typing long input', async () => {
    const cwd = join(__dirname, '..');
    const scriptPath = join(cwd, 'dist', 'index.js');
    outputFile = join(cwd, 'test-output.txt');

    // Use script command to capture PTY output
    // -q = quiet, doesn't print "Script started/done" messages
    // Using COLUMNS to set terminal width
    childProcess = spawn('script', ['-q', outputFile], {
      cwd,
      env: {
        ...process.env,
        COLUMNS: '40',
        LINES: '24',
        TERM: 'xterm-256color',
        ANTHROPIC_API_KEY: 'test-key-for-testing',
        CODI_NO_PLUGINS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for script to start
    await wait(500);

    // Start codi inside the script session
    childProcess.stdin?.write(`node ${scriptPath}\n`);

    // Wait for codi to start
    await wait(2000);

    // Type a long string that will wrap (40 cols terminal)
    const longInput = 'a'.repeat(60);
    for (const char of longInput) {
      childProcess.stdin?.write(char);
      await wait(10);
    }

    // Wait for output to settle
    await wait(1000);

    // Exit codi and script
    childProcess.stdin?.write('\x03'); // Ctrl+C
    await wait(500);
    childProcess.stdin?.write('exit\n');
    await wait(500);

    // Read the output file
    const output = existsSync(outputFile) ? readFileSync(outputFile, 'utf-8') : '';

    // Count occurrences of status line indicators
    // If flooding occurs, we'll see many duplicate status lines
    const sessionMatches = output.match(/Session/g) || [];
    const modelMatches = output.match(/Model/g) || [];

    console.log('Total output length:', output.length);
    console.log('Session occurrences:', sessionMatches.length);
    console.log('Model occurrences:', modelMatches.length);

    // In a healthy UI, status lines should appear a limited number of times
    // With flooding, they would appear once per keystroke after wrap
    // Allow reasonable amount for startup + a few re-renders, but not 60+
    const maxExpected = 20;

    expect(sessionMatches.length).toBeLessThan(maxExpected);
    expect(modelMatches.length).toBeLessThan(maxExpected);
  }, 30000);

  it('should render correctly with ink-testing-library simulation', async () => {
    // This test uses ink-testing-library to verify component behavior
    // without needing a real PTY
    const { render } = await import('ink-testing-library');
    const React = await import('react');
    const { CompletableInput } = await import('../src/ui/ink/completable-input.js');

    const frames: string[] = [];
    const onChange = () => {};
    const onSubmit = () => {};

    const { lastFrame, rerender } = render(
      React.createElement(CompletableInput, {
        value: '',
        onChange,
        onSubmit,
        focus: true,
      })
    );

    frames.push(lastFrame() || '');

    // Simulate typing a long string that would wrap in a narrow terminal
    // Each rerender represents a keystroke
    let value = '';
    for (let i = 0; i < 100; i++) {
      value += 'a';
      rerender(
        React.createElement(CompletableInput, {
          value,
          onChange,
          onSubmit,
          focus: true,
        })
      );
      frames.push(lastFrame() || '');
    }

    // Verify each frame only contains the input once
    // This checks for render duplication at the component level
    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i];
      const expectedAs = i; // Should have i 'a' characters
      const actualAs = (frame.match(/a/g) || []).length;

      // Each frame should have exactly the right number of 'a's
      expect(actualAs).toBe(expectedAs);
    }
  }, 10000);
});
