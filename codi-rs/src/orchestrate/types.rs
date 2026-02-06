// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Core types for multi-agent orchestration.
//!
//! This module defines the fundamental data structures for worker management,
//! workspace isolation, and IPC communication.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::hash::{Hash, Hasher};
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::process::Child;

use crate::types::TokenUsage;

// ============================================================================
// Worker Configuration
// ============================================================================

/// Configuration for a worker agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    /// Unique identifier for this worker.
    pub id: String,
    /// Branch name for this worker's isolated workspace.
    pub branch: String,
    /// Task description for the worker to execute.
    pub task: String,
    /// Optional model override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Optional provider override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Tools to auto-approve without permission requests.
    #[serde(default)]
    pub auto_approve: Vec<String>,
    /// Dangerous patterns for tool inputs (passed to workers).
    #[serde(default)]
    pub dangerous_patterns: Vec<String>,
    /// Maximum iterations before stopping.
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// Timeout in milliseconds.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_max_iterations() -> u32 {
    50
}

fn default_timeout_ms() -> u64 {
    300_000 // 5 minutes
}

impl WorkerConfig {
    /// Create a new worker config with minimal required fields.
    pub fn new(id: impl Into<String>, branch: impl Into<String>, task: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            branch: branch.into(),
            task: task.into(),
            model: None,
            provider: None,
            auto_approve: Vec::new(),
            dangerous_patterns: Vec::new(),
            max_iterations: default_max_iterations(),
            timeout_ms: default_timeout_ms(),
        }
    }

    /// Set the model for this worker.
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    /// Set the provider for this worker.
    pub fn with_provider(mut self, provider: impl Into<String>) -> Self {
        self.provider = Some(provider.into());
        self
    }

    /// Set auto-approved tools.
    pub fn with_auto_approve(mut self, tools: Vec<String>) -> Self {
        self.auto_approve = tools;
        self
    }

    /// Set dangerous patterns for tool inputs.
    pub fn with_dangerous_patterns(mut self, patterns: Vec<String>) -> Self {
        self.dangerous_patterns = patterns;
        self
    }

    /// Check if a tool should be auto-approved.
    pub fn should_auto_approve(&self, tool_name: &str) -> bool {
        self.auto_approve.iter().any(|t| t == tool_name)
    }
}

// ============================================================================
// Worker Status
// ============================================================================

/// Status of a worker agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WorkerStatus {
    /// Worker is starting up.
    Starting,
    /// Worker is idle, waiting for input.
    Idle,
    /// Worker is thinking (calling the model).
    Thinking,
    /// Worker is executing a tool.
    ToolCall {
        /// Name of the tool being executed.
        tool: String,
    },
    /// Worker is waiting for permission approval.
    WaitingPermission {
        /// Name of the tool awaiting approval.
        tool: String,
    },
    /// Worker completed successfully.
    Complete {
        /// Final result from the worker.
        result: WorkerResult,
    },
    /// Worker failed with an error.
    Failed {
        /// Error message.
        error: String,
        /// Whether the error is recoverable.
        recoverable: bool,
    },
    /// Worker was cancelled.
    Cancelled,
}

impl WorkerStatus {
    /// Check if this status represents an active (not terminal) state.
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Idle | Self::Thinking | Self::ToolCall { .. } | Self::WaitingPermission { .. }
        )
    }

    /// Check if this status represents a terminal state.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Complete { .. } | Self::Failed { .. } | Self::Cancelled
        )
    }
}

// ============================================================================
// Worker Result
// ============================================================================

/// Result from a completed worker.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkerResult {
    /// Whether the task completed successfully.
    pub success: bool,
    /// Final response text from the agent.
    pub response: String,
    /// Number of tool calls made.
    pub tool_count: u32,
    /// Total duration in milliseconds.
    pub duration_ms: u64,
    /// Git commits created (if any).
    #[serde(default)]
    pub commits: Vec<String>,
    /// Files changed (if any).
    #[serde(default)]
    pub files_changed: Vec<String>,
    /// Branch name where work was done.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// Token usage statistics.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

impl WorkerResult {
    /// Create a successful result.
    pub fn success(response: impl Into<String>) -> Self {
        Self {
            success: true,
            response: response.into(),
            tool_count: 0,
            duration_ms: 0,
            commits: Vec::new(),
            files_changed: Vec::new(),
            branch: None,
            usage: None,
        }
    }

    /// Create a failure result.
    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            response: error.into(),
            tool_count: 0,
            duration_ms: 0,
            commits: Vec::new(),
            files_changed: Vec::new(),
            branch: None,
            usage: None,
        }
    }
}

// ============================================================================
// Workspace Information
// ============================================================================

/// Information about an isolated workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkspaceInfo {
    /// Git worktree for single-repo isolation.
    GitWorktree {
        /// Path to the worktree directory.
        path: PathBuf,
        /// Branch name for this worktree.
        branch: String,
        /// Base branch from which this was created.
        base_branch: String,
    },
    /// Griptree for multi-repo workspace isolation.
    Griptree {
        /// Path to the griptree directory.
        path: PathBuf,
        /// Branch name for this griptree.
        branch: String,
        /// Path to the main workspace.
        main_workspace: PathBuf,
        /// Per-repo worktree information.
        repos: Vec<GriptreeRepoInfo>,
    },
}

impl WorkspaceInfo {
    /// Get the path to this workspace.
    pub fn path(&self) -> &PathBuf {
        match self {
            Self::GitWorktree { path, .. } => path,
            Self::Griptree { path, .. } => path,
        }
    }

    /// Get the branch name for this workspace.
    pub fn branch(&self) -> &str {
        match self {
            Self::GitWorktree { branch, .. } => branch,
            Self::Griptree { branch, .. } => branch,
        }
    }

    /// Check if this is a griptree workspace.
    pub fn is_griptree(&self) -> bool {
        matches!(self, Self::Griptree { .. })
    }
}

/// Information about a repository within a griptree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GriptreeRepoInfo {
    /// Repository name.
    pub name: String,
    /// Original branch before griptree creation.
    pub original_branch: String,
    /// Path to the worktree for this repo.
    pub worktree_path: PathBuf,
    /// Whether this is a reference-only repo.
    #[serde(default)]
    pub is_reference: bool,
}

// ============================================================================
// Worker State
// ============================================================================

/// Runtime state of a worker.
pub struct WorkerState {
    /// Worker configuration.
    pub config: WorkerConfig,
    /// Workspace information.
    pub workspace: WorkspaceInfo,
    /// Current status.
    pub status: WorkerStatus,
    /// Child process handle (if running).
    pub process: Option<Child>,
    /// When the worker started.
    pub started_at: Option<Instant>,
    /// When the worker completed.
    pub completed_at: Option<Instant>,
    /// Current progress (0-100).
    pub progress: u8,
    /// Token usage so far.
    pub tokens: TokenUsage,
    /// Number of restarts.
    pub restart_count: u32,
}

impl WorkerState {
    /// Create a new worker state.
    pub fn new(config: WorkerConfig, workspace: WorkspaceInfo) -> Self {
        Self {
            config,
            workspace,
            status: WorkerStatus::Starting,
            process: None,
            started_at: None,
            completed_at: None,
            progress: 0,
            tokens: TokenUsage::default(),
            restart_count: 0,
        }
    }

    /// Check if this worker is active (not in a terminal state).
    pub fn is_active(&self) -> bool {
        self.status.is_active()
    }

    /// Get elapsed time since start (if started).
    pub fn elapsed(&self) -> Option<std::time::Duration> {
        self.started_at.map(|start| start.elapsed())
    }

    /// Get elapsed time in milliseconds.
    pub fn elapsed_ms(&self) -> u64 {
        self.elapsed().map(|d| d.as_millis() as u64).unwrap_or(0)
    }
}

// ============================================================================
// Commander Configuration
// ============================================================================

/// Configuration for the commander (orchestrator).
#[derive(Debug, Clone)]
pub struct CommanderConfig {
    /// Path to the IPC endpoint.
    pub socket_path: PathBuf,
    /// Maximum number of concurrent workers.
    pub max_workers: usize,
    /// Base branch for creating worker branches.
    pub base_branch: String,
    /// Whether to cleanup workspaces on exit.
    pub cleanup_on_exit: bool,
    /// Directory for worktrees (relative to project root).
    pub worktree_dir: Option<PathBuf>,
    /// Maximum restarts per worker before giving up.
    pub max_restarts: u32,
}

impl CommanderConfig {
    /// Create configuration for a specific project.
    ///
    /// The endpoint will be created at `<project_root>/.codi/orchestrator.sock` on Unix,
    /// and a named pipe on Windows.
    pub fn for_project(project_root: &Path) -> Self {
        Self {
            socket_path: socket_path_for_project(project_root),
            max_workers: 4,
            base_branch: "main".to_string(),
            cleanup_on_exit: true,
            worktree_dir: None,
            max_restarts: 2,
        }
    }
}

impl Default for CommanderConfig {
    fn default() -> Self {
        Self {
            socket_path: default_socket_path(),
            max_workers: 4,
            base_branch: "main".to_string(),
            cleanup_on_exit: true,
            worktree_dir: None,
            max_restarts: 2,
        }
    }
}

/// Get the socket path for a project.
///
/// Returns `<project_root>/.codi/orchestrator.sock` on Unix, and a named pipe
/// on Windows.
pub fn socket_path_for_project(project_root: &Path) -> PathBuf {
    #[cfg(not(windows))]
    {
        project_root.join(".codi").join("orchestrator.sock")
    }

    #[cfg(windows)]
    {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        project_root.to_string_lossy().hash(&mut hasher);
        let hash = hasher.finish();
        PathBuf::from(format!(r"\\.\pipe\codi-orchestrator-{hash:x}"))
    }
}

fn default_socket_path() -> PathBuf {
    #[cfg(not(windows))]
    {
        PathBuf::from("/tmp/codi-orchestrator.sock")
    }

    #[cfg(windows)]
    {
        PathBuf::from(r"\\.\pipe\codi-orchestrator-default")
    }
}

// ============================================================================
// Griptree Types (for multi-repo workspaces)
// ============================================================================

/// Pointer file stored in a griptree directory (.griptree).
/// Points back to the main workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GriptreePointer {
    /// Absolute path to the main workspace.
    pub main_workspace: String,
    /// Branch name.
    pub branch: String,
    /// Whether the griptree is locked.
    #[serde(default)]
    pub locked: bool,
    /// When the griptree was created.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    /// Per-repo information.
    #[serde(default)]
    pub repos: Vec<GriptreeRepoPointer>,
}

/// Per-repo info in a griptree pointer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GriptreeRepoPointer {
    /// Repository name.
    pub name: String,
    /// Original branch before griptree creation.
    pub original_branch: String,
}

impl GriptreePointer {
    /// Load a griptree pointer from a file.
    pub fn load(path: &std::path::Path) -> std::io::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        serde_json::from_str(&content)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    /// Save the pointer to a file.
    pub fn save(&self, path: &std::path::Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, json)
    }

    /// Find a .griptree pointer by searching up from a starting path.
    pub fn find_in_ancestors(start: &std::path::Path) -> Option<(PathBuf, Self)> {
        let mut current = start.to_path_buf();
        loop {
            let pointer_path = current.join(".griptree");
            if pointer_path.exists() {
                if let Ok(pointer) = Self::load(&pointer_path) {
                    return Some((current, pointer));
                }
            }
            match current.parent() {
                Some(parent) => current = parent.to_path_buf(),
                None => return None,
            }
        }
    }
}

// ============================================================================
// Read-Only Tools (for reader agents)
// ============================================================================

/// Tools that are safe for read-only agents.
pub static READER_ALLOWED_TOOLS: &[&str] = &[
    "read_file",
    "glob",
    "grep",
    "list_directory",
    "analyze_image",
    "find_symbol",
    "find_references",
    "get_dependency_graph",
    "search_codebase",
    "recall_result",
    "get_context_status",
    "bash", // Note: Still needs command filtering
];

/// Check if a tool is allowed for read-only agents.
pub fn is_reader_tool(tool_name: &str) -> bool {
    READER_ALLOWED_TOOLS.contains(&tool_name)
}

/// Get the set of reader-allowed tools.
pub fn reader_tools_set() -> HashSet<&'static str> {
    READER_ALLOWED_TOOLS.iter().copied().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worker_config_creation() {
        let config = WorkerConfig::new("w1", "feat/test", "Write hello world");
        assert_eq!(config.id, "w1");
        assert_eq!(config.branch, "feat/test");
        assert_eq!(config.task, "Write hello world");
        assert_eq!(config.max_iterations, 50);
    }

    #[test]
    fn test_worker_config_builder() {
        let config = WorkerConfig::new("w1", "feat/auth", "Implement OAuth")
            .with_model("claude-sonnet-4-20250514")
            .with_provider("anthropic")
            .with_auto_approve(vec!["read_file".to_string(), "glob".to_string()]);

        assert_eq!(config.model, Some("claude-sonnet-4-20250514".to_string()));
        assert_eq!(config.provider, Some("anthropic".to_string()));
        assert!(config.should_auto_approve("read_file"));
        assert!(config.should_auto_approve("glob"));
        assert!(!config.should_auto_approve("bash"));
    }

    #[test]
    fn test_worker_status_active() {
        assert!(WorkerStatus::Starting.is_active());
        assert!(WorkerStatus::Thinking.is_active());
        assert!(WorkerStatus::ToolCall { tool: "bash".to_string() }.is_active());

        // Terminal states
        assert!(!WorkerStatus::Complete {
            result: WorkerResult::success("done")
        }.is_active());
        assert!(WorkerStatus::Failed {
            error: "oops".to_string(),
            recoverable: false
        }.is_terminal());
        assert!(WorkerStatus::Cancelled.is_terminal());
    }

    #[test]
    fn test_workspace_info() {
        let ws = WorkspaceInfo::GitWorktree {
            path: PathBuf::from("/tmp/worktree"),
            branch: "feat/test".to_string(),
            base_branch: "main".to_string(),
        };

        assert_eq!(ws.path(), &PathBuf::from("/tmp/worktree"));
        assert_eq!(ws.branch(), "feat/test");
        assert!(!ws.is_griptree());
    }

    #[test]
    fn test_griptree_workspace() {
        let ws = WorkspaceInfo::Griptree {
            path: PathBuf::from("/tmp/feat-auth"),
            branch: "feat/auth".to_string(),
            main_workspace: PathBuf::from("/workspace"),
            repos: vec![
                GriptreeRepoInfo {
                    name: "codi".to_string(),
                    original_branch: "main".to_string(),
                    worktree_path: PathBuf::from("/tmp/feat-auth/codi"),
                    is_reference: false,
                },
            ],
        };

        assert!(ws.is_griptree());
        assert_eq!(ws.branch(), "feat/auth");
    }

    #[test]
    fn test_commander_config_default() {
        let config = CommanderConfig::default();
        assert_eq!(config.max_workers, 4);
        assert_eq!(config.base_branch, "main");
        assert!(config.cleanup_on_exit);
    }

    #[test]
    fn test_commander_config_for_project() {
        let config = CommanderConfig::for_project(Path::new("/workspace/my-project"));
        #[cfg(not(windows))]
        assert_eq!(
            config.socket_path,
            PathBuf::from("/workspace/my-project/.codi/orchestrator.sock")
        );
        #[cfg(windows)]
        assert!(config.socket_path.to_string_lossy().starts_with(r"\\.\pipe\codi-orchestrator-"));
        assert_eq!(config.max_workers, 4);
    }

    #[test]
    fn test_socket_path_for_project() {
        let path = socket_path_for_project(Path::new("/home/user/project"));
        #[cfg(not(windows))]
        assert_eq!(path, PathBuf::from("/home/user/project/.codi/orchestrator.sock"));
        #[cfg(windows)]
        assert!(path.to_string_lossy().starts_with(r"\\.\pipe\codi-orchestrator-"));
    }

    #[test]
    fn test_reader_tools() {
        assert!(is_reader_tool("read_file"));
        assert!(is_reader_tool("glob"));
        assert!(!is_reader_tool("write_file"));
        assert!(!is_reader_tool("edit_file"));
    }

    #[test]
    fn test_worker_result() {
        let success = WorkerResult::success("Task completed");
        assert!(success.success);
        assert_eq!(success.response, "Task completed");

        let failure = WorkerResult::failure("Something went wrong");
        assert!(!failure.success);
        assert_eq!(failure.response, "Something went wrong");
    }

    #[test]
    fn test_griptree_pointer_serialization() {
        let pointer = GriptreePointer {
            main_workspace: "/workspace".to_string(),
            branch: "feat/test".to_string(),
            locked: false,
            created_at: None,
            repos: vec![
                GriptreeRepoPointer {
                    name: "codi".to_string(),
                    original_branch: "main".to_string(),
                },
            ],
        };

        let json = serde_json::to_string(&pointer).unwrap();
        assert!(json.contains("\"mainWorkspace\""));
        assert!(json.contains("\"branch\":\"feat/test\""));

        let parsed: GriptreePointer = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.branch, "feat/test");
    }
}
