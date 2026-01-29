// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Integration tests for Ink UI flooding bug.
 *
 * These tests verify that the Ink UI doesn't produce duplicate lines
 * when input text wraps to a new line.
 */

import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import React from 'react';
import { render } from 'ink-testing-library';
import { CompletableInput } from '../src/ui/ink/completable-input.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Ink UI flooding', () => {
  describe('component-level tests', () => {
    it('should render correctly with ink-testing-library simulation', async () => {
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
    });
  });

  describe('expect-based integration tests', () => {
    it('should pass the expect flooding test', () => {
      // Check if expect is available
      try {
        execSync('which expect', { stdio: 'pipe' });
      } catch {
        console.log('Skipping: expect not available');
        return;
      }

      // Skip on CI - expect + PTY behavior varies across CI environments
      // The component-level test above still validates render stability
      if (process.env.CI || process.env.GITHUB_ACTIONS) {
        console.log('Skipping: expect-based PTY test not reliable on CI');
        return;
      }

      const cwd = join(__dirname, '..');
      const expectScript = join(__dirname, 'expect-flooding.exp');
      const outputFile = join(cwd, 'test-output-flooding.txt');

      // Clean up any previous output
      if (existsSync(outputFile)) {
        unlinkSync(outputFile);
      }

      // Run the expect script
      const result = spawnSync('expect', [expectScript, outputFile], {
        cwd,
        timeout: 60000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          COLUMNS: '40',
          LINES: '24',
        },
      });

      // Log output for debugging
      if (result.stdout) console.log('stdout:', result.stdout);
      if (result.stderr) console.log('stderr:', result.stderr);

      // Check exit code
      if (result.status !== 0) {
        // Read output file for more details if available
        if (existsSync(outputFile)) {
          const output = readFileSync(outputFile, 'utf-8');
          console.log('Captured output length:', output.length);
        }
        throw new Error(`Expect test failed with exit code ${result.status}`);
      }

      // Clean up
      if (existsSync(outputFile)) {
        unlinkSync(outputFile);
      }
    }, 90000); // 90 second timeout
  });
});
