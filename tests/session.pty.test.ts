// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { PtyHarness } from './helpers/pty.js';

// node-pty doesn't work in some CI/sandboxes (and Node 25 seems especially problematic).
// Keep the tests, but skip unless explicitly enabled.
const RUN_PTY_TESTS = process.env.CODI_RUN_PTY_TESTS === '1';

function distEntry(): string {
  // tests run from repo root in this project
  return path.resolve(process.cwd(), 'dist', 'index.js');
}

describe.skipIf(!RUN_PTY_TESTS)('session command (PTY integration)', () => {
  it('prints help in a real TTY', async () => {
    const pty = new PtyHarness(process.execPath, [distEntry(), 'session', '--help'], {
      env: {
        // Ensure we exercise TTY paths while keeping output stable.
        CI: '1',
      },
    });

    try {
      const out = await pty.waitFor(/session/i);
      expect(out).toMatch(/session/i);
      expect(out).toMatch(/help/i);

      const { exitCode } = await pty.waitForExit();
      // Some CLIs exit 0 on --help.
      expect(exitCode).toBe(0);
    } finally {
      pty.kill();
    }
  });

  it('errors on unknown option in a real TTY', async () => {
    const pty = new PtyHarness(process.execPath, [distEntry(), 'session', '--definitely-not-a-flag'], {
      env: {
        CI: '1',
      },
    });

    try {
      const out = await pty.waitFor(/unknown option|unknown argument|options?:/i);
      expect(out).toMatch(/unknown/i);

      const { exitCode } = await pty.waitForExit();
      expect(exitCode).not.toBe(0);
    } finally {
      pty.kill();
    }
  });
});
