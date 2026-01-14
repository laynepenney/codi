// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';

export interface OpenFileMeta {
  pinned: boolean;
  addedAt: string;
  lastViewedAt: string;
}

/**
 * Serializable representation of the open-files working set.
 *
 * Notes:
 * - JSON-friendly so it can be stored on disk as part of a Session.
 * - Backwards compatible: older sessions may not have this state.
 * - Keys are normalized paths (see normalizePath).
 */
export interface OpenFilesState {
  /** Map of normalized path -> metadata */
  files: Record<string, OpenFileMeta>;
}

export interface OpenFilesManagerOptions {
  /** Max number of non-pinned files to keep (LRU eviction). */
  maxRecent?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePath(p: string): string {
  // We intentionally keep this lightweight; we don't resolve symlinks.
  // Normalize separators for consistent keys.
  return path.normalize(p);
}

/**
 * Tracks a persistent set of "open" files.
 * - Pinned files are never evicted by LRU.
 * - Non-pinned files are evicted when exceeding maxRecent.
 */
export class OpenFilesManager {
  private files = new Map<string, OpenFileMeta>();
  private maxRecent: number;

  constructor(options: OpenFilesManagerOptions = {}) {
    this.maxRecent = options.maxRecent ?? 25;
  }

  static fromJSON(state: OpenFilesState | null | undefined, options: OpenFilesManagerOptions = {}): OpenFilesManager {
    const mgr = new OpenFilesManager(options);
    if (!state?.files) return mgr;

    for (const [filePath, meta] of Object.entries(state.files)) {
      // Defensive: accept older/bad shapes.
      if (!meta || typeof meta !== 'object') continue;
      const pinned = Boolean((meta as OpenFileMeta).pinned);
      const addedAt = (meta as OpenFileMeta).addedAt || nowIso();
      const lastViewedAt = (meta as OpenFileMeta).lastViewedAt || addedAt;
      mgr.files.set(normalizePath(filePath), { pinned, addedAt, lastViewedAt });
    }

    return mgr;
  }

  toJSON(): OpenFilesState {
    const files: Record<string, OpenFileMeta> = {};
    for (const [filePath, meta] of this.files.entries()) {
      files[filePath] = meta;
    }
    return { files };
  }

  has(filePath: string): boolean {
    return this.files.has(normalizePath(filePath));
  }

  open(filePath: string, options: { pinned?: boolean } = {}): void {
    const key = normalizePath(filePath);
    const existing = this.files.get(key);
    const ts = nowIso();

    if (existing) {
      const pinned = options.pinned ?? existing.pinned;
      this.files.set(key, { ...existing, pinned, lastViewedAt: ts });
    } else {
      this.files.set(key, { pinned: Boolean(options.pinned), addedAt: ts, lastViewedAt: ts });
    }

    this.evictIfNeeded();
  }

  close(filePath: string): boolean {
    return this.files.delete(normalizePath(filePath));
  }

  pin(filePath: string): void {
    const key = normalizePath(filePath);
    const existing = this.files.get(key);
    const ts = nowIso();

    if (existing) {
      this.files.set(key, { ...existing, pinned: true, lastViewedAt: ts });
    } else {
      this.files.set(key, { pinned: true, addedAt: ts, lastViewedAt: ts });
    }
  }

  unpin(filePath: string): void {
    const key = normalizePath(filePath);
    const existing = this.files.get(key);
    if (!existing) return;
    this.files.set(key, { ...existing, pinned: false });
    this.evictIfNeeded();
  }

  touch(filePath: string): void {
    const key = normalizePath(filePath);
    const existing = this.files.get(key);
    const ts = nowIso();

    if (!existing) {
      // Treat touching an unknown file as opening it.
      this.files.set(key, { pinned: false, addedAt: ts, lastViewedAt: ts });
    } else {
      this.files.set(key, { ...existing, lastViewedAt: ts });
    }

    this.evictIfNeeded();
  }

  clear(): void {
    this.files.clear();
  }

  /**
   * Returns entries sorted: pinned first, then by lastViewedAt desc.
   */
  list(): Array<{ path: string; meta: OpenFileMeta }> {
    const entries = [...this.files.entries()].map(([p, meta]) => ({ path: p, meta }));
    entries.sort((a, b) => {
      if (a.meta.pinned !== b.meta.pinned) return a.meta.pinned ? -1 : 1;
      return new Date(b.meta.lastViewedAt).getTime() - new Date(a.meta.lastViewedAt).getTime();
    });
    return entries;
  }

  private evictIfNeeded(): void {
    // Only evict non-pinned files.
    const nonPinned = [...this.files.entries()]
      .filter(([, meta]) => !meta.pinned)
      .sort((a, b) => new Date(a[1].lastViewedAt).getTime() - new Date(b[1].lastViewedAt).getTime());

    while (nonPinned.length > this.maxRecent) {
      const [oldestPath] = nonPinned.shift()!;
      this.files.delete(oldestPath);
    }
  }
}
