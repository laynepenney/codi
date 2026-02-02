// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Workspace isolation trait and detection logic.
//!
//! This module provides an abstraction over different workspace isolation strategies:
//!
//! - **Git Worktrees**: For single-repo projects, uses `git worktree` to create
//!   isolated branches in sibling directories.
//!
//! - **Griptrees**: For multi-repo gitgrip workspaces, creates a parallel workspace
//!   with worktrees for all repositories.
//!
//! # Detection Logic
//!
//! ```text
//! Is current directory a gitgrip workspace?
//! ├── YES (.gitgrip/ exists) → Use GriptreeIsolator
//! │   └── Create sibling directory with worktrees for ALL repos
//! └── NO (regular git repo) → Use GitWorktreeIsolator
//!     └── Create worktree for single repo
//! ```

use std::path::{Path, PathBuf};

use async_trait::async_trait;

use super::types::WorkspaceInfo;
use super::worktree::GitWorktreeIsolator;
use super::griptree::GriptreeIsolator;

/// Error type for workspace isolation operations.
#[derive(Debug, thiserror::Error)]
pub enum IsolationError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Branch already in use: {0}")]
    BranchInUse(String),

    #[error("Branch not found: {0}")]
    BranchNotFound(String),

    #[error("Workspace not found: {0}")]
    WorkspaceNotFound(String),

    #[error("Invalid workspace: {0}")]
    InvalidWorkspace(String),

    #[error("Manifest error: {0}")]
    ManifestError(String),

    #[error("Worktree creation failed: {0}")]
    WorktreeCreationFailed(String),
}

/// Trait for workspace isolation strategies.
///
/// Implementations handle creating and managing isolated workspaces
/// for worker agents.
#[async_trait]
pub trait WorkspaceIsolator: Send + Sync {
    /// Create an isolated workspace for a worker.
    ///
    /// # Arguments
    /// * `branch` - Branch name for the new workspace
    /// * `base_branch` - Base branch to create the new branch from
    ///
    /// # Returns
    /// Information about the created workspace
    async fn create(&self, branch: &str, base_branch: &str) -> Result<WorkspaceInfo, IsolationError>;

    /// Remove an isolated workspace.
    ///
    /// # Arguments
    /// * `workspace` - The workspace to remove
    /// * `delete_branch` - Whether to also delete the branch
    async fn remove(&self, workspace: &WorkspaceInfo, delete_branch: bool) -> Result<(), IsolationError>;

    /// List all managed workspaces.
    async fn list(&self) -> Result<Vec<WorkspaceInfo>, IsolationError>;

    /// Check if a branch is already checked out in a workspace.
    async fn is_branch_in_use(&self, branch: &str) -> bool;

    /// Get information about an existing workspace.
    async fn get(&self, branch: &str) -> Result<Option<WorkspaceInfo>, IsolationError>;

    /// Clean up all managed workspaces.
    async fn cleanup(&self) -> Result<(), IsolationError>;
}

/// Detect which isolator to use based on directory structure.
///
/// Walks up from the given path looking for:
/// 1. `.gitgrip/` directory → Use GriptreeIsolator
/// 2. `.git/` directory → Use GitWorktreeIsolator
///
/// Falls back to GitWorktreeIsolator for the current directory if neither is found.
pub fn detect_isolator(path: &Path) -> Box<dyn WorkspaceIsolator> {
    for ancestor in path.ancestors() {
        // Check for gitgrip workspace first (multi-repo)
        let gitgrip_dir = ancestor.join(".gitgrip");
        if gitgrip_dir.exists() && gitgrip_dir.is_dir() {
            tracing::info!("Detected gitgrip workspace at {:?}", ancestor);
            return Box::new(GriptreeIsolator::new(ancestor));
        }

        // Check for regular git repo
        let git_dir = ancestor.join(".git");
        if git_dir.exists() {
            tracing::info!("Detected git repo at {:?}", ancestor);
            return Box::new(GitWorktreeIsolator::new(ancestor));
        }
    }

    // Fallback to current directory with worktree isolator
    tracing::warn!("No git or gitgrip workspace found, using current directory");
    Box::new(GitWorktreeIsolator::new(path))
}

/// Detect the workspace type for a given path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceType {
    /// Regular git repository.
    Git,
    /// Gitgrip multi-repo workspace.
    Gitgrip,
    /// Unknown (no .git or .gitgrip found).
    Unknown,
}

/// Detect the workspace type for a given path.
pub fn detect_workspace_type(path: &Path) -> WorkspaceType {
    for ancestor in path.ancestors() {
        if ancestor.join(".gitgrip").exists() {
            return WorkspaceType::Gitgrip;
        }
        if ancestor.join(".git").exists() {
            return WorkspaceType::Git;
        }
    }
    WorkspaceType::Unknown
}

/// Find the root of the workspace (git or gitgrip).
pub fn find_workspace_root(path: &Path) -> Option<PathBuf> {
    for ancestor in path.ancestors() {
        if ancestor.join(".gitgrip").exists() || ancestor.join(".git").exists() {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

/// Sanitize a branch name for use as a directory name.
///
/// Converts slashes to dashes and removes other problematic characters.
pub fn sanitize_branch_name(branch: &str) -> String {
    branch
        .replace('/', "-")
        .replace('\\', "-")
        .replace(':', "-")
        .replace('*', "-")
        .replace('?', "-")
        .replace('"', "-")
        .replace('<', "-")
        .replace('>', "-")
        .replace('|', "-")
        .trim_matches('-')
        .to_string()
}

/// Generate a worktree directory path for a branch.
///
/// Creates a sibling directory to the workspace root with the sanitized branch name.
pub fn worktree_path_for_branch(workspace_root: &Path, branch: &str, prefix: Option<&str>) -> PathBuf {
    let sanitized = sanitize_branch_name(branch);
    let dir_name = match prefix {
        Some(p) => format!("{}{}", p, sanitized),
        None => sanitized,
    };

    workspace_root
        .parent()
        .unwrap_or(workspace_root)
        .join(dir_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_sanitize_branch_name() {
        assert_eq!(sanitize_branch_name("feat/auth"), "feat-auth");
        assert_eq!(sanitize_branch_name("fix/bug-123"), "fix-bug-123");
        assert_eq!(sanitize_branch_name("main"), "main");
        assert_eq!(sanitize_branch_name("feat/auth/oauth"), "feat-auth-oauth");
    }

    #[test]
    fn test_worktree_path() {
        let root = PathBuf::from("/workspace/project");
        let path = worktree_path_for_branch(&root, "feat/auth", None);
        assert_eq!(path, PathBuf::from("/workspace/feat-auth"));

        let path_with_prefix = worktree_path_for_branch(&root, "feat/auth", Some("codi-"));
        assert_eq!(path_with_prefix, PathBuf::from("/workspace/codi-feat-auth"));
    }

    #[test]
    fn test_detect_workspace_type_git() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();

        assert_eq!(detect_workspace_type(dir.path()), WorkspaceType::Git);
    }

    #[test]
    fn test_detect_workspace_type_gitgrip() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".gitgrip")).unwrap();

        assert_eq!(detect_workspace_type(dir.path()), WorkspaceType::Gitgrip);
    }

    #[test]
    fn test_detect_workspace_type_unknown() {
        let dir = tempdir().unwrap();
        assert_eq!(detect_workspace_type(dir.path()), WorkspaceType::Unknown);
    }

    #[test]
    fn test_find_workspace_root() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("a/b/c");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();

        let root = find_workspace_root(&nested);
        assert_eq!(root, Some(dir.path().to_path_buf()));
    }
}
