// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Git Worktree Manager for Multi-Agent Orchestration
 *
 * Manages git worktrees for worker agents, providing isolated working
 * directories for parallel development.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';
import type { WorktreeInfo } from './types.js';

const execAsync = promisify(exec);

/**
 * Configuration for the worktree manager.
 */
export interface WorktreeManagerConfig {
  /** Root directory of the main repository */
  repoRoot: string;
  /** Directory where worktrees will be created (default: parent of repoRoot) */
  worktreeDir?: string;
  /** Prefix for worktree directory names (default: 'codi-worker-') */
  prefix?: string;
  /** Base branch to create feature branches from (default: 'main') */
  baseBranch?: string;
}

/**
 * Manages git worktrees for worker agents.
 */
export class WorktreeManager {
  private repoRoot: string;
  private worktreeDir: string;
  private prefix: string;
  private baseBranch: string;
  private activeWorktrees: Map<string, WorktreeInfo> = new Map();

  constructor(config: WorktreeManagerConfig) {
    this.repoRoot = config.repoRoot;
    this.worktreeDir = config.worktreeDir || dirname(config.repoRoot);
    this.prefix = config.prefix || 'codi-worker-';
    this.baseBranch = config.baseBranch || 'main';
  }

  /**
   * Create a new worktree with a feature branch.
   */
  async create(branchName: string): Promise<WorktreeInfo> {
    // Validate branch name
    if (!branchName || branchName.includes(' ')) {
      throw new Error(`Invalid branch name: ${branchName}`);
    }

    // Check if worktree already exists
    if (this.activeWorktrees.has(branchName)) {
      throw new Error(`Worktree for branch '${branchName}' already exists`);
    }

    const worktreePath = join(this.worktreeDir, `${this.prefix}${branchName}`);

    // Check if directory already exists
    if (existsSync(worktreePath)) {
      throw new Error(`Directory already exists: ${worktreePath}`);
    }

    // Check if branch already exists
    const branchExists = await this.branchExists(branchName);

    try {
      if (branchExists) {
        // Use existing branch
        await execAsync(`git worktree add "${worktreePath}" ${branchName}`, {
          cwd: this.repoRoot,
        });
      } else {
        // Create new branch from base
        await execAsync(
          `git worktree add -b ${branchName} "${worktreePath}" ${this.baseBranch}`,
          { cwd: this.repoRoot }
        );
      }
    } catch (err) {
      throw new Error(
        `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const info: WorktreeInfo = {
      path: worktreePath,
      branch: branchName,
      managed: true,
      createdAt: new Date(),
    };

    this.activeWorktrees.set(branchName, info);
    return info;
  }

  /**
   * Remove a worktree.
   */
  async remove(branchName: string, options?: { force?: boolean; deleteBranch?: boolean }): Promise<void> {
    const info = this.activeWorktrees.get(branchName);
    if (!info) {
      // Try to remove anyway in case it exists but isn't tracked
      const worktreePath = join(this.worktreeDir, `${this.prefix}${branchName}`);
      if (existsSync(worktreePath)) {
        await this.removeWorktreePath(worktreePath, options?.force);
      }
      return;
    }

    await this.removeWorktreePath(info.path, options?.force);
    this.activeWorktrees.delete(branchName);

    // Optionally delete the branch
    if (options?.deleteBranch) {
      try {
        await execAsync(`git branch -D ${branchName}`, { cwd: this.repoRoot });
      } catch {
        // Ignore if branch doesn't exist or can't be deleted
      }
    }
  }

  /**
   * Remove a worktree by path.
   */
  private async removeWorktreePath(worktreePath: string, force?: boolean): Promise<void> {
    try {
      const forceFlag = force ? ' --force' : '';
      await execAsync(`git worktree remove "${worktreePath}"${forceFlag}`, {
        cwd: this.repoRoot,
      });
    } catch (err) {
      // If git worktree remove fails, try manual cleanup
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      // Prune worktree list
      await execAsync('git worktree prune', { cwd: this.repoRoot }).catch(() => {});
    }
  }

  /**
   * Get information about a worktree.
   */
  get(branchName: string): WorktreeInfo | undefined {
    return this.activeWorktrees.get(branchName);
  }

  /**
   * List all managed worktrees.
   */
  list(): WorktreeInfo[] {
    return Array.from(this.activeWorktrees.values());
  }

  /**
   * List all git worktrees (including unmanaged ones).
   */
  async listAll(): Promise<WorktreeInfo[]> {
    const { stdout } = await execAsync('git worktree list --porcelain', {
      cwd: this.repoRoot,
    });

    const worktrees: WorktreeInfo[] = [];
    const lines = stdout.trim().split('\n');

    let currentPath = '';
    let currentBranch = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice(9);
      } else if (line.startsWith('branch refs/heads/')) {
        currentBranch = line.slice(18);
      } else if (line === '') {
        // End of worktree entry
        if (currentPath && currentBranch) {
          const managed = this.activeWorktrees.has(currentBranch);
          worktrees.push({
            path: currentPath,
            branch: currentBranch,
            managed,
            createdAt: managed
              ? this.activeWorktrees.get(currentBranch)!.createdAt
              : new Date(),
          });
        }
        currentPath = '';
        currentBranch = '';
      }
    }

    // Handle last entry
    if (currentPath && currentBranch) {
      const managed = this.activeWorktrees.has(currentBranch);
      worktrees.push({
        path: currentPath,
        branch: currentBranch,
        managed,
        createdAt: managed
          ? this.activeWorktrees.get(currentBranch)!.createdAt
          : new Date(),
      });
    }

    return worktrees;
  }

  /**
   * Cleanup all managed worktrees.
   */
  async cleanup(options?: { deleteBranches?: boolean }): Promise<void> {
    const branches = Array.from(this.activeWorktrees.keys());
    for (const branch of branches) {
      await this.remove(branch, {
        force: true,
        deleteBranch: options?.deleteBranches,
      });
    }
  }

  /**
   * Check if a branch exists.
   */
  private async branchExists(branchName: string): Promise<boolean> {
    try {
      await execAsync(`git rev-parse --verify ${branchName}`, {
        cwd: this.repoRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current branch of the main repository.
   */
  async getCurrentBranch(): Promise<string> {
    const { stdout } = await execAsync('git branch --show-current', {
      cwd: this.repoRoot,
    });
    return stdout.trim();
  }

  /**
   * Get git status for a worktree.
   */
  async getStatus(branchName: string): Promise<{
    branch: string;
    ahead: number;
    behind: number;
    modified: number;
    untracked: number;
  }> {
    const info = this.activeWorktrees.get(branchName);
    if (!info) {
      throw new Error(`Worktree not found: ${branchName}`);
    }

    const { stdout: statusOutput } = await execAsync('git status --porcelain', {
      cwd: info.path,
    });

    const lines = statusOutput.trim().split('\n').filter(Boolean);
    const modified = lines.filter((l) => !l.startsWith('??')).length;
    const untracked = lines.filter((l) => l.startsWith('??')).length;

    // Get ahead/behind count
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout: revOutput } = await execAsync(
        `git rev-list --left-right --count ${this.baseBranch}...HEAD`,
        { cwd: info.path }
      );
      const [b, a] = revOutput.trim().split('\t').map(Number);
      ahead = a || 0;
      behind = b || 0;
    } catch {
      // Ignore if comparison fails
    }

    return {
      branch: branchName,
      ahead,
      behind,
      modified,
      untracked,
    };
  }

  /**
   * Get commits made in a worktree (since branching from base).
   */
  async getCommits(branchName: string): Promise<string[]> {
    const info = this.activeWorktrees.get(branchName);
    if (!info) {
      throw new Error(`Worktree not found: ${branchName}`);
    }

    try {
      const { stdout } = await execAsync(
        `git log ${this.baseBranch}..HEAD --oneline`,
        { cwd: info.path }
      );
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get files changed in a worktree (since branching from base).
   */
  async getChangedFiles(branchName: string): Promise<string[]> {
    const info = this.activeWorktrees.get(branchName);
    if (!info) {
      throw new Error(`Worktree not found: ${branchName}`);
    }

    try {
      const { stdout } = await execAsync(
        `git diff ${this.baseBranch}...HEAD --name-only`,
        { cwd: info.path }
      );
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}
