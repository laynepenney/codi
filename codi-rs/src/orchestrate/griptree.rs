// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Griptree isolator for multi-repo gitgrip workspaces.
//!
//! Creates isolated parallel workspaces by creating worktrees for ALL repositories
//! in the gitgrip manifest.
//!
//! # Directory Structure
//!
//! ```text
//! /workspace/                 # Main griptree
//! ├── .gitgrip/
//! │   ├── manifests/
//! │   │   └── manifest.yaml
//! │   └── griptrees.json      # Registry of all griptrees
//! ├── codi/
//! ├── codi-private/
//! └── tooling/
//!
//! /feat-worker/               # Worker griptree (sibling to main)
//! ├── .griptree               # Pointer to main workspace
//! ├── .gitgrip/
//! │   └── griptree.json       # Griptree config
//! ├── codi/                   # Worktree on feat/worker
//! ├── codi-private/           # Worktree on feat/worker
//! └── tooling/                # Worktree on feat/worker
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::process::Command;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use super::isolation::{IsolationError, WorkspaceIsolator, sanitize_branch_name};
use super::types::{GriptreePointer, GriptreeRepoPointer, GriptreeRepoInfo, WorkspaceInfo};

/// Manifest structure for gitgrip workspaces.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GripManifest {
    /// Repository configurations.
    #[serde(default)]
    pub repos: HashMap<String, RepoConfig>,
    /// Workspace settings.
    #[serde(default)]
    pub workspace: Option<WorkspaceConfig>,
}

/// Repository configuration in manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    /// Repository URL.
    pub url: String,
    /// Local path relative to workspace root.
    pub path: String,
    /// Default branch.
    #[serde(default = "default_branch")]
    pub default_branch: String,
    /// Whether this is a reference-only repo.
    #[serde(default)]
    pub reference: bool,
}

fn default_branch() -> String {
    "main".to_string()
}

/// Workspace configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    /// Environment variables.
    #[serde(default)]
    pub env: HashMap<String, String>,
}

impl GripManifest {
    /// Load manifest from a gitgrip workspace.
    pub async fn load(workspace_root: &Path) -> Result<Self, IsolationError> {
        let manifest_path = workspace_root
            .join(".gitgrip")
            .join("manifests")
            .join("manifest.yaml");

        if !manifest_path.exists() {
            return Err(IsolationError::ManifestError(format!(
                "Manifest not found: {:?}",
                manifest_path
            )));
        }

        let content = fs::read_to_string(&manifest_path).await?;
        let manifest: GripManifest = serde_yaml::from_str(&content)
            .map_err(|e| IsolationError::ManifestError(e.to_string()))?;

        Ok(manifest)
    }

    /// Get non-reference repos.
    pub fn active_repos(&self) -> impl Iterator<Item = (&String, &RepoConfig)> {
        self.repos.iter().filter(|(_, config)| !config.reference)
    }
}

/// Registry of griptrees stored in main workspace.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GriptreeRegistry {
    /// Griptrees by branch name.
    #[serde(default)]
    pub griptrees: HashMap<String, GriptreeEntry>,
}

/// Entry in the griptree registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GriptreeEntry {
    /// Absolute path to the griptree.
    pub path: String,
    /// Branch name.
    pub branch: String,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Whether the griptree is locked.
    #[serde(default)]
    pub locked: bool,
}

impl GriptreeRegistry {
    /// Path to the registry file.
    fn path(workspace_root: &Path) -> PathBuf {
        workspace_root.join(".gitgrip").join("griptrees.json")
    }

    /// Load registry from workspace.
    pub async fn load(workspace_root: &Path) -> Self {
        let path = Self::path(workspace_root);
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path).await {
                if let Ok(registry) = serde_json::from_str(&content) {
                    return registry;
                }
            }
        }
        Self::default()
    }

    /// Save registry to workspace.
    pub async fn save(&self, workspace_root: &Path) -> Result<(), IsolationError> {
        let path = Self::path(workspace_root);
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| IsolationError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
        fs::write(&path, content).await?;
        Ok(())
    }
}

/// Griptree isolator for multi-repo workspaces.
pub struct GriptreeIsolator {
    /// Path to the main workspace root.
    main_workspace: PathBuf,
    /// Loaded manifest.
    manifest: Arc<RwLock<Option<GripManifest>>>,
    /// Tracked griptrees by branch name.
    griptrees: Arc<RwLock<HashMap<String, WorkspaceInfo>>>,
}

impl GriptreeIsolator {
    /// Create a new griptree isolator.
    pub fn new(main_workspace: impl AsRef<Path>) -> Self {
        Self {
            main_workspace: main_workspace.as_ref().to_path_buf(),
            manifest: Arc::new(RwLock::new(None)),
            griptrees: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get or load the manifest.
    async fn get_manifest(&self) -> Result<GripManifest, IsolationError> {
        {
            let manifest = self.manifest.read().await;
            if let Some(ref m) = *manifest {
                return Ok(m.clone());
            }
        }

        let loaded = GripManifest::load(&self.main_workspace).await?;
        {
            let mut manifest = self.manifest.write().await;
            *manifest = Some(loaded.clone());
        }
        Ok(loaded)
    }

    /// Get the path for a griptree.
    fn griptree_path(&self, branch: &str) -> PathBuf {
        let sanitized = sanitize_branch_name(branch);
        self.main_workspace
            .parent()
            .unwrap_or(&self.main_workspace)
            .join(sanitized)
    }

    /// Run a git command in a specific directory.
    async fn git(&self, cwd: &Path, args: &[&str]) -> Result<String, IsolationError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
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

    /// Get the current branch of a repo.
    async fn current_branch(&self, repo_path: &Path) -> Result<String, IsolationError> {
        self.git(repo_path, &["branch", "--show-current"]).await
    }

    /// Check if a branch exists in a repo.
    async fn branch_exists(&self, repo_path: &Path, branch: &str) -> bool {
        self.git(repo_path, &["rev-parse", "--verify", branch])
            .await
            .is_ok()
    }

    /// Check if a branch is checked out in any worktree.
    async fn is_branch_checked_out(&self, repo_path: &Path, branch: &str) -> bool {
        if let Ok(output) = self.git(repo_path, &["worktree", "list", "--porcelain"]).await {
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

    /// Register a griptree in the registry.
    async fn register_griptree(&self, branch: &str, path: &Path) -> Result<(), IsolationError> {
        let mut registry = GriptreeRegistry::load(&self.main_workspace).await;
        registry.griptrees.insert(
            branch.to_string(),
            GriptreeEntry {
                path: path.to_string_lossy().to_string(),
                branch: branch.to_string(),
                created_at: Utc::now(),
                locked: false,
            },
        );
        registry.save(&self.main_workspace).await
    }

    /// Unregister a griptree from the registry.
    async fn unregister_griptree(&self, branch: &str) -> Result<(), IsolationError> {
        let mut registry = GriptreeRegistry::load(&self.main_workspace).await;
        registry.griptrees.remove(branch);
        registry.save(&self.main_workspace).await
    }
}

#[async_trait]
impl WorkspaceIsolator for GriptreeIsolator {
    async fn create(&self, branch: &str, base_branch: &str) -> Result<WorkspaceInfo, IsolationError> {
        let manifest = self.get_manifest().await?;
        let tree_path = self.griptree_path(branch);

        // Check if griptree already exists
        if tree_path.exists() {
            return Err(IsolationError::InvalidWorkspace(format!(
                "Griptree directory already exists: {:?}",
                tree_path
            )));
        }

        info!("Creating griptree for {} at {:?}", branch, tree_path);

        // Create griptree root directory
        fs::create_dir_all(&tree_path).await?;

        // Create worktrees for each non-reference repo
        let mut repos = Vec::new();
        for (name, repo_config) in manifest.active_repos() {
            let repo_path = self.main_workspace.join(&repo_config.path);
            let worktree_path = tree_path.join(&repo_config.path);

            // Get original branch
            let original_branch = self.current_branch(&repo_path).await.unwrap_or_else(|_| base_branch.to_string());

            // Check if branch is already checked out
            if self.is_branch_checked_out(&repo_path, branch).await {
                // Cleanup and fail
                let _ = fs::remove_dir_all(&tree_path).await;
                return Err(IsolationError::BranchInUse(format!(
                    "Branch {} is already checked out in {}",
                    branch, name
                )));
            }

            // Create worktree
            let worktree_path_str = worktree_path.to_string_lossy().to_string();
            let create_args = if self.branch_exists(&repo_path, branch).await {
                vec!["worktree", "add", &worktree_path_str, branch]
            } else {
                vec![
                    "worktree",
                    "add",
                    "-b",
                    branch,
                    &worktree_path_str,
                    base_branch,
                ]
            };

            match self.git(&repo_path, &create_args).await {
                Ok(_) => {
                    debug!("Created worktree for {} at {:?}", name, worktree_path);
                    repos.push(GriptreeRepoInfo {
                        name: name.clone(),
                        original_branch,
                        worktree_path: worktree_path.clone(),
                        is_reference: false,
                    });
                }
                Err(e) => {
                    error!("Failed to create worktree for {}: {}", name, e);
                    // Cleanup partially created griptree
                    let _ = self.cleanup_partial_griptree(&tree_path, &repos).await;
                    return Err(IsolationError::WorktreeCreationFailed(format!(
                        "Failed to create worktree for {}: {}",
                        name, e
                    )));
                }
            }
        }

        // Create .griptree pointer file
        let pointer = GriptreePointer {
            main_workspace: self.main_workspace.to_string_lossy().to_string(),
            branch: branch.to_string(),
            locked: false,
            created_at: Some(Utc::now()),
            repos: repos
                .iter()
                .map(|r| GriptreeRepoPointer {
                    name: r.name.clone(),
                    original_branch: r.original_branch.clone(),
                })
                .collect(),
        };
        pointer.save(&tree_path.join(".griptree"))?;

        // Create .gitgrip directory structure
        let gitgrip_dir = tree_path.join(".gitgrip");
        fs::create_dir_all(&gitgrip_dir).await?;

        // Register in main workspace
        self.register_griptree(branch, &tree_path).await?;

        let workspace = WorkspaceInfo::Griptree {
            path: tree_path.clone(),
            branch: branch.to_string(),
            main_workspace: self.main_workspace.clone(),
            repos,
        };

        // Track in memory
        {
            let mut griptrees = self.griptrees.write().await;
            griptrees.insert(branch.to_string(), workspace.clone());
        }

        info!("Created griptree for {} at {:?}", branch, tree_path);
        Ok(workspace)
    }

    async fn remove(&self, workspace: &WorkspaceInfo, delete_branch: bool) -> Result<(), IsolationError> {
        if let WorkspaceInfo::Griptree { path, branch, repos, .. } = workspace {
            info!("Removing griptree for {} at {:?}", branch, path);

            // Remove each worktree
            for repo in repos {
                if repo.worktree_path.exists() {
                    // Find the main repo path
                    if let Ok(manifest) = self.get_manifest().await {
                        if let Some(repo_config) = manifest.repos.get(&repo.name) {
                            let main_repo_path = self.main_workspace.join(&repo_config.path);

                            let worktree_path_str = repo.worktree_path.to_string_lossy().to_string();
                            let result = self
                                .git(
                                    &main_repo_path,
                                    &[
                                        "worktree",
                                        "remove",
                                        "--force",
                                        &worktree_path_str,
                                    ],
                                )
                                .await;

                            if let Err(e) = result {
                                warn!("Failed to remove worktree for {}: {}", repo.name, e);
                            }

                            // Optionally delete branch
                            if delete_branch {
                                let _ = self.git(&main_repo_path, &["branch", "-D", branch]).await;
                            }
                        }
                    }
                }
            }

            // Remove griptree directory
            if path.exists() {
                fs::remove_dir_all(path).await?;
            }

            // Unregister from registry
            self.unregister_griptree(branch).await?;

            // Remove from memory tracking
            {
                let mut griptrees = self.griptrees.write().await;
                griptrees.remove(branch);
            }

            Ok(())
        } else {
            Err(IsolationError::InvalidWorkspace(
                "Expected Griptree workspace".to_string(),
            ))
        }
    }

    async fn list(&self) -> Result<Vec<WorkspaceInfo>, IsolationError> {
        let registry = GriptreeRegistry::load(&self.main_workspace).await;
        let tracked = self.griptrees.read().await;

        let mut result = Vec::new();

        // Return tracked griptrees that exist
        for (_, ws) in tracked.iter() {
            if ws.path().exists() {
                result.push(ws.clone());
            }
        }

        // Check registry for any untracked
        for (branch, entry) in registry.griptrees.iter() {
            if !tracked.contains_key(branch) {
                let path = PathBuf::from(&entry.path);
                if path.exists() {
                    // Load pointer to get repo info
                    if let Ok(pointer) = GriptreePointer::load(&path.join(".griptree")) {
                        let repos = pointer
                            .repos
                            .iter()
                            .map(|r| GriptreeRepoInfo {
                                name: r.name.clone(),
                                original_branch: r.original_branch.clone(),
                                worktree_path: path.join(&r.name),
                                is_reference: false,
                            })
                            .collect();

                        result.push(WorkspaceInfo::Griptree {
                            path: path.clone(),
                            branch: branch.clone(),
                            main_workspace: self.main_workspace.clone(),
                            repos,
                        });
                    }
                }
            }
        }

        Ok(result)
    }

    async fn is_branch_in_use(&self, branch: &str) -> bool {
        // Check if griptree exists
        let tree_path = self.griptree_path(branch);
        if tree_path.exists() {
            return true;
        }

        // Check if branch is checked out in any repo
        if let Ok(manifest) = self.get_manifest().await {
            for (_, repo_config) in manifest.active_repos() {
                let repo_path = self.main_workspace.join(&repo_config.path);
                if self.is_branch_checked_out(&repo_path, branch).await {
                    return true;
                }
            }
        }

        false
    }

    async fn get(&self, branch: &str) -> Result<Option<WorkspaceInfo>, IsolationError> {
        let griptrees = self.griptrees.read().await;
        Ok(griptrees.get(branch).cloned())
    }

    async fn cleanup(&self) -> Result<(), IsolationError> {
        let griptrees: Vec<WorkspaceInfo> = {
            let tracked = self.griptrees.read().await;
            tracked.values().cloned().collect()
        };

        for workspace in griptrees {
            if let Err(e) = self.remove(&workspace, true).await {
                warn!("Failed to cleanup griptree {:?}: {}", workspace.path(), e);
            }
        }

        Ok(())
    }
}

impl GriptreeIsolator {
    /// Cleanup a partially created griptree.
    async fn cleanup_partial_griptree(
        &self,
        tree_path: &Path,
        repos: &[GriptreeRepoInfo],
    ) -> Result<(), IsolationError> {
        // Remove worktrees that were created
        for repo in repos {
            if repo.worktree_path.exists() {
                if let Ok(manifest) = self.get_manifest().await {
                    if let Some(repo_config) = manifest.repos.get(&repo.name) {
                        let main_repo_path = self.main_workspace.join(&repo_config.path);
                        let worktree_path_str = repo.worktree_path.to_string_lossy().to_string();
                        let _ = self
                            .git(
                                &main_repo_path,
                                &[
                                    "worktree",
                                    "remove",
                                    "--force",
                                    &worktree_path_str,
                                ],
                            )
                            .await;
                    }
                }
            }
        }

        // Remove the griptree directory
        if tree_path.exists() {
            fs::remove_dir_all(tree_path).await?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_griptree_path() {
        let isolator = GriptreeIsolator::new("/workspace/main");
        let path = isolator.griptree_path("feat/auth");
        assert_eq!(path, PathBuf::from("/workspace/feat-auth"));
    }

    #[test]
    fn test_manifest_parse() {
        let yaml = r#"
repos:
  codi:
    url: git@github.com:org/codi.git
    path: ./codi
    default_branch: main
  private:
    url: git@github.com:org/private.git
    path: ./private
    reference: true
"#;
        let manifest: GripManifest = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(manifest.repos.len(), 2);
        assert!(!manifest.repos.get("codi").unwrap().reference);
        assert!(manifest.repos.get("private").unwrap().reference);

        let active: Vec<_> = manifest.active_repos().collect();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].0, "codi");
    }

    #[test]
    fn test_griptree_registry_serialization() {
        let mut registry = GriptreeRegistry::default();
        registry.griptrees.insert(
            "feat/test".to_string(),
            GriptreeEntry {
                path: "/workspace/feat-test".to_string(),
                branch: "feat/test".to_string(),
                created_at: Utc::now(),
                locked: false,
            },
        );

        let json = serde_json::to_string(&registry).unwrap();
        let parsed: GriptreeRegistry = serde_json::from_str(&json).unwrap();
        assert!(parsed.griptrees.contains_key("feat/test"));
    }
}
