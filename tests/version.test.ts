// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { VERSION } from '../src/version.js';

describe('version', () => {
  it('VERSION matches package.json version', () => {
    const packageJsonPath = join(import.meta.dirname, '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    expect(VERSION).toBe(packageJson.version);
  });
});
