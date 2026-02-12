// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vitest global setup.
 *
 * Removes workspace-specific environment variables that interfere with
 * test isolation.  CODI_HOME is set by envsetup.sh to point at the
 * workspace .codi directory, but tests expect the default home-relative
 * path (~/.codi).
 */

delete process.env.CODI_HOME;
