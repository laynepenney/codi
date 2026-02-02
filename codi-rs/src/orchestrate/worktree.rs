// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Git worktree isolator for single-repo workspaces.
//!
//! Uses `git worktree` to create isolated branches in sibling directories.
//!
//! # Directory Structure
//!
//! ```text
//! /project/                   # Main repo
//! ├── .git/
//! ├── src/
//! └── ...
//!
//! /codi-feat-auth/            # Worker worktree (sibling directory)
//! ├── .git                    # Worktree link file
//! ├── src/
//! └── ...
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::process::Command;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use super::isolation::{IsolationError, WorkspaceIsolator, worktree_path_for_branch};
use super::types::WorkspaceInfo;

/// Default prefix for worktree directories.
const WORKTREE_PREFIX: &str = "codi-";

/// Git worktree isolator for single-repo projects.
pub struct GitWorktreeIsolator {
    /// Path to the main repository root.
    repo_root: PathBuf,
    /// Prefix for worktree directories.
    prefix: String,
    /// Tracked worktrees by branch name.
    worktrees: Arc<RwLock<HashMap<String, WorkspaceInfo>>>,
}

impl GitWorktreeIsolator {
    /// Create a new Git worktree isolator.
    pub fn new(repo_root: impl AsRef<Path>) -> Self {
        Self {
            repo_root: repo_root.as_ref().to_path_buf(),
            prefix: WORKTREE_PREFIX.to_string(),
            worktrees: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Set a custom prefix for worktree directories.
    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = prefix.into();
        self
    }

    /// Get the path where a worktree would be created for a branch.
    fn worktree_path(&self, branch: &str) -> PathBuf {
        worktree_path_for_branch(&self.repo_root, branch, Some(&self.prefix))
    }

    /// Run a git command and return stdout.
    async fn git(&self, args: &[&str]) -> Result<String, IsolationError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(IsolationError::Git(stderr.to_string()))
        }
    }

    /// Check if a branch exists locally.
    async fn branch_exists(&self, branch: &str) -> bool {
        self.git(&["rev-parse", "--verify", branch])
            .await
            .is_ok()
    }

    /// Check if a branch is checked out in any worktree.
    async fn is_branch_checked_out(&self, branch: &str) -> bool {
        // List all worktrees
        if let Ok(output) = self.git(&["worktree", "list", "--porcelain"]).await {
            // Look for the branch in worktree output
            for line in output.lines() {
                if line.starts_with("branch refs/heads/") {
                    let checked_branch = line.trim_start_matches("branch refs/heads/");
                    if checked_branch == branch {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Get the current branch of the main repo.
    pub async fn current_branch(&self) -> Result<String, IsolationError> {
        self.git(&["branch", "--show-current"]).await
    }

    /// List all existing worktrees.
    async fn list_git_worktrees(&self) -> Result<Vec<WorktreeInfo>, IsolationError> {
        let output = self.git(&["worktree", "list", "--porcelain"]).await?;
        let mut worktrees = Vec::new();
        let mut current = WorktreeInfo::default();

        for line in output.lines() {
            if line.starts_with("worktree ") {
                if !current.path.as_os_str().is_empty() {
                    worktrees.push(std::mem::take(&mut current));
                }
                current.path = PathBuf::from(line.trim_start_matches("worktree "));
            } else if line.starts_with("HEAD ") {
                current.head = line.trim_start_matches("HEAD ").to_string();
            } else if line.starts_with("branch refs/heads/") {
                current.branch = Some(line.trim_start_matches("branch refs/heads/").to_string());
            } else if line == "bare" {
                current.is_bare = true;
            } else if line == "detached" {
                current.is_detached = true;
            }
        }

        if !current.path.as_os_str().is_empty() {
            worktrees.push(current);
        }

        Ok(worktrees)
    }

    /// Get commits since branching from base.
    pub async fn commits_since_base(&self, worktree_path: &Path, base_branch: &str) -> Result<Vec<String>, IsolationError> {
        let output = Command::new("git")
            .args(["log", "--oneline", &format!("{}..HEAD", base_branch)])
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await?;

        if output.status.success() {
            let commits: Vec<String> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|s| s.to_string())
                .collect();
            Ok(commits)
        } else {
            Ok(Vec::new())
        }
    }

    /// Get files changed since branching from base.
    pub async fn changed_files(&self, worktree_path: &Path, base_branch: &str) -> Result<Vec<String>, IsolationError> {
        let output = Command::new("git")
            .args(["diff", "--name-only", base_branch])
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await?;

        if output.status.success() {
            let files: Vec<String> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|s| s.to_string())
                .collect();
            Ok(files)
        } else {
            Ok(Vec::new())
        }
    }
}

/// Information about a git worktree.
#[derive(Debug, Clone, Default)]
struct WorktreeInfo {
    path: PathBuf,
    head: String,
    branch: Option<String>,
    is_bare: bool,
    is_detached: bool,
}

#[async_trait]
impl WorkspaceIsolator for GitWorktreeIsolator {
    async fn create(&self, branch: &str, base_branch: &str) -> Result<WorkspaceInfo, IsolationError> {
        let worktree_path = self.worktree_path(branch);

        // Check if branch is already in use
        if self.is_branch_in_use(branch).await {
            return Err(IsolationError::BranchInUse(branch.to_string()));
        }

        // Check if worktree path already exists
        if worktree_path.exists() {
            return Err(IsolationError::InvalidWorkspace(format!(
                "Directory already exists: {:?}",
                worktree_path
            )));
        }

        // Create the worktree with a new branch
        // git worktree add -b <branch> <path> <base>
        info!("Creating worktree for {} at {:?}", branch, worktree_path);

        let result = if self.branch_exists(branch).await {
            // Branch exists, just add worktree
            self.git(&[
                "worktree",
                "add",
                worktree_path.to_str().unwrap(),
                branch,
            ])
            .await
        } else {
            // Create new branch from base
            self.git(&[
                "worktree",
                "add",
                "-b",
                branch,
                worktree_path.to_str().unwrap(),
                base_branch,
            ])
            .await
        };

        match result {
            Ok(_) => {
                let workspace = WorkspaceInfo::GitWorktree {
                    path: worktree_path.clone(),
                    branch: branch.to_string(),
                    base_branch: base_branch.to_string(),
                };

                // Track in our map
                {
                    let mut worktrees = self.worktrees.write().await;
                    worktrees.insert(branch.to_string(), workspace.clone());
                }

                debug!("Created worktree for {} at {:?}", branch, worktree_path);
                Ok(workspace)
            }
            Err(e) => {
                error!("Failed to create worktree: {}", e);
                Err(IsolationError::WorktreeCreationFailed(e.to_string()))
            }
        }
    }

    async fn remove(&self, workspace: &WorkspaceInfo, delete_branch: bool) -> Result<(), IsolationError> {
        if let WorkspaceInfo::GitWorktree { path, branch, .. } = workspace {
            info!("Removing worktree for {} at {:?}", branch, path);

            // Remove worktree
            let result = self
                .git(&["worktree", "remove", "--force", path.to_str().unwrap()])
                .await;

            if let Err(e) = result {
                warn!("Failed to remove worktree via git: {}", e);
                // Try manual removal as fallback
                if path.exists() {
                    std::fs::remove_dir_all(path)?;
                }
                // Prune worktree references
                let _ = self.git(&["worktree", "prune"]).await;
            }

            // Optionally delete the branch
            if delete_branch {
                let _ = self.git(&["branch", "-D", branch]).await;
            }

            // Remove from our tracking
            {
                let mut worktrees = self.worktrees.write().await;
                worktrees.remove(branch);
            }

            Ok(())
        } else {
            Err(IsolationError::InvalidWorkspace(
                "Expected GitWorktree workspace".to_string(),
            ))
        }
    }

    async fn list(&self) -> Result<Vec<WorkspaceInfo>, IsolationError> {
        let git_worktrees = self.list_git_worktrees().await?;
        let tracked = self.worktrees.read().await;

        // Return tracked worktrees that still exist
        let mut result = Vec::new();
        for (_, ws) in tracked.iter() {
            if ws.path().exists() {
                result.push(ws.clone());
            }
        }

        // Also check for any untracked worktrees created by us
        for wt in git_worktrees {
            if let Some(branch) = &wt.branch {
                // Skip the main worktree
                if wt.path == self.repo_root {
                    continue;
                }

                // Check if this looks like one of our worktrees
                let expected_path = self.worktree_path(branch);
                if wt.path == expected_path && !tracked.contains_key(branch) {
                    result.push(WorkspaceInfo::GitWorktree {
                        path: wt.path,
                        branch: branch.clone(),
                        base_branch: "main".to_string(), // Assume main
                    });
                }
            }
        }

        Ok(result)
    }

    async fn is_branch_in_use(&self, branch: &str) -> bool {
        self.is_branch_checked_out(branch).await
    }

    async fn get(&self, branch: &str) -> Result<Option<WorkspaceInfo>, IsolationError> {
        let worktrees = self.worktrees.read().await;
        Ok(worktrees.get(branch).cloned())
    }

    async fn cleanup(&self) -> Result<(), IsolationError> {
        let worktrees: Vec<WorkspaceInfo> = {
            let tracked = self.worktrees.read().await;
            tracked.values().cloned().collect()
        };

        for workspace in worktrees {
            if let Err(e) = self.remove(&workspace, true).await {
                warn!("Failed to cleanup workspace {:?}: {}", workspace.path(), e);
            }
        }

        // Prune any stale worktree references
        let _ = self.git(&["worktree", "prune"]).await;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worktree_path() {
        let isolator = GitWorktreeIsolator::new("/workspace/project");
        let path = isolator.worktree_path("feat/auth");
        assert_eq!(path, PathBuf::from("/workspace/codi-feat-auth"));
    }

    #[test]
    fn test_custom_prefix() {
        let isolator = GitWorktreeIsolator::new("/workspace/project")
            .with_prefix("worker-");
        let path = isolator.worktree_path("feat/auth");
        assert_eq!(path, PathBuf::from("/workspace/worker-feat-auth"));
    }
}
