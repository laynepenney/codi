// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Child agent for worker processes.
//!
//! The ChildAgent runs in a worker process and communicates with the
//! Commander via IPC for permission requests and status updates.
//!
//! # Lifecycle
//!
//! 1. Connect to commander's IPC socket
//! 2. Perform handshake with worker config
//! 3. Execute task with agent loop
//! 4. Request permissions via IPC when needed
//! 5. Report completion or error

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::agent::{Agent, AgentCallbacks, AgentConfig, AgentOptions, ConfirmationResult, ToolConfirmation};
use crate::tools::ToolRegistry;
use crate::types::TokenUsage;
use crate::providers::create_provider_from_env;

use super::ipc::{IpcClient, PermissionResult};
use super::ipc::client::IpcClientError;
use super::isolation::{detect_workspace_type, WorkspaceType};
use super::types::{GriptreePointer, WorkerConfig, WorkerResult, WorkerStatus, WorkspaceInfo};

/// Error type for child agent operations.
#[derive(Debug, thiserror::Error)]
pub enum ChildAgentError {
    #[error("IPC error: {0}")]
    Ipc(#[from] IpcClientError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Agent error: {0}")]
    Agent(#[from] crate::error::AgentError),

    #[error("Provider error: {0}")]
    Provider(#[from] crate::error::ProviderError),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Cancelled")]
    Cancelled,

    #[error("Permission denied: {0}")]
    PermissionDenied(String),
}

/// Child agent that runs in a worker process.
pub struct ChildAgent {
    /// IPC client for commander communication.
    ipc: Arc<Mutex<IpcClient>>,
    /// Worker configuration.
    config: WorkerConfig,
    /// Detected workspace.
    workspace: WorkspaceInfo,
    /// Auto-approved tools from handshake.
    auto_approve: Vec<String>,
    /// Timeout from handshake.
    timeout_ms: u64,
}

impl ChildAgent {
    /// Run a child agent in the current process.
    ///
    /// This is the main entry point for child/worker mode.
    pub async fn run(
        socket_path: &Path,
        worker_id: &str,
        task: &str,
    ) -> Result<WorkerResult, ChildAgentError> {
        let start_time = Instant::now();

        // Detect workspace type
        let cwd = std::env::current_dir()?;
        let workspace = detect_workspace(&cwd)?;

        info!(
            "Starting child agent {} in {:?} workspace",
            worker_id,
            if workspace.is_griptree() { "griptree" } else { "git" }
        );

        // Create worker config
        let config = WorkerConfig::new(worker_id, workspace.branch(), task);

        // Connect to commander
        let mut ipc = IpcClient::new(socket_path, worker_id);
        ipc.connect().await?;

        // Perform handshake
        let ack = ipc.handshake(&config, &workspace).await?;
        info!(
            "Handshake complete, auto-approve: {:?}",
            ack.auto_approve
        );

        let ipc = Arc::new(Mutex::new(ipc));
        let auto_approve = ack.auto_approve.clone();

        // Create agent
        let mut child_agent = Self {
            ipc: Arc::clone(&ipc),
            config,
            workspace,
            auto_approve,
            timeout_ms: ack.timeout_ms,
        };

        // Execute task
        let result = child_agent.execute_task(task).await;

        // Calculate duration
        let duration_ms = start_time.elapsed().as_millis() as u64;

        // Report completion
        match &result {
            Ok(response) => {
                let mut ipc = ipc.lock().await;

                // Get git stats
                let commits = child_agent.get_commits().await.unwrap_or_default();
                let files_changed = child_agent.get_changed_files().await.unwrap_or_default();

                let worker_result = WorkerResult {
                    success: true,
                    response: response.clone(),
                    tool_count: 0, // TODO: Track this
                    duration_ms,
                    commits,
                    files_changed,
                    branch: Some(child_agent.workspace.branch().to_string()),
                    usage: None, // TODO: Track this
                };

                ipc.send_task_complete(worker_result.clone()).await?;
                Ok(worker_result)
            }
            Err(e) => {
                let mut ipc = ipc.lock().await;
                let is_recoverable = matches!(
                    e,
                    ChildAgentError::Ipc(_) | ChildAgentError::Io(_)
                );
                ipc.send_task_error(&e.to_string(), is_recoverable).await?;

                Ok(WorkerResult {
                    success: false,
                    response: e.to_string(),
                    tool_count: 0,
                    duration_ms,
                    commits: Vec::new(),
                    files_changed: Vec::new(),
                    branch: Some(child_agent.workspace.branch().to_string()),
                    usage: None,
                })
            }
        }
    }

    /// Execute the task using an agent.
    async fn execute_task(&mut self, task: &str) -> Result<String, ChildAgentError> {
        // Create provider
        let provider = create_provider_from_env()?;

        // Create tool registry with defaults
        let registry = Arc::new(ToolRegistry::with_defaults());

        // Create agent with IPC-based confirmation
        let ipc = Arc::clone(&self.ipc);
        let auto_approve = self.auto_approve.clone();

        let callbacks = AgentCallbacks {
            on_confirm: Some(Arc::new(move |confirmation: ToolConfirmation| {
                // Check auto-approve list
                if auto_approve.contains(&confirmation.tool_name) {
                    return ConfirmationResult::Approve;
                }

                // Request permission via IPC (blocking)
                // Note: This is a sync callback, so we need to block on the async call
                let ipc_clone = Arc::clone(&ipc);
                let result = tokio::runtime::Handle::current().block_on(async {
                    let mut ipc = ipc_clone.lock().await;
                    ipc.request_permission(&confirmation).await
                });

                match result {
                    Ok(PermissionResult::Approve) => ConfirmationResult::Approve,
                    Ok(PermissionResult::Deny { reason }) => {
                        warn!("Permission denied: {}", reason);
                        ConfirmationResult::Deny
                    }
                    Ok(PermissionResult::Abort) => {
                        warn!("Operation aborted");
                        ConfirmationResult::Abort
                    }
                    Err(e) => {
                        error!("Failed to request permission: {}", e);
                        ConfirmationResult::Abort
                    }
                }
            })),
            on_text: None,
            on_tool_call: Some(Arc::new({
                let ipc = Arc::clone(&self.ipc);
                move |_tool_id: &str, tool_name: &str, _input: &serde_json::Value| {
                    let ipc = Arc::clone(&ipc);
                    let tool = tool_name.to_string();
                    tokio::spawn(async move {
                        let mut ipc = ipc.lock().await;
                        let _ = ipc.send_status(
                            &WorkerStatus::ToolCall { tool },
                            TokenUsage::default(),
                        ).await;
                    });
                }
            })),
            on_tool_result: None,
            on_compaction: None,
            on_turn_complete: None,
            on_stream_event: None,
        };

        let agent_config = AgentConfig {
            max_iterations: self.config.max_iterations as usize,
            max_consecutive_errors: 3,
            max_turn_duration_ms: self.timeout_ms,
            max_context_tokens: 100_000,
            use_tools: true,
            extract_tools_from_text: true,
            auto_approve_all: false,
            auto_approve_tools: self.auto_approve.clone(),
            dangerous_patterns: Vec::new(),
        };

        let mut agent = Agent::new(AgentOptions {
            provider,
            tool_registry: registry,
            system_prompt: None,
            config: agent_config,
            callbacks,
        });

        // Send thinking status
        {
            let mut ipc = self.ipc.lock().await;
            ipc.send_status(&WorkerStatus::Thinking, TokenUsage::default()).await?;
        }

        // Execute chat
        let response = agent.chat(task).await
            .map_err(|e| ChildAgentError::Agent(crate::error::AgentError::InvalidState(e.to_string())))?;

        Ok(response)
    }

    /// Get commits made in this workspace.
    async fn get_commits(&self) -> Result<Vec<String>, std::io::Error> {
        let output = tokio::process::Command::new("git")
            .args(["log", "--oneline", "HEAD~10..HEAD"])
            .current_dir(self.workspace.path())
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

    /// Get files changed in this workspace.
    async fn get_changed_files(&self) -> Result<Vec<String>, std::io::Error> {
        let output = tokio::process::Command::new("git")
            .args(["diff", "--name-only", "HEAD~1"])
            .current_dir(self.workspace.path())
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

/// Detect the workspace type and create WorkspaceInfo.
fn detect_workspace(cwd: &Path) -> Result<WorkspaceInfo, ChildAgentError> {
    match detect_workspace_type(cwd) {
        WorkspaceType::Gitgrip => {
            // Find griptree pointer
            if let Some((tree_path, pointer)) = GriptreePointer::find_in_ancestors(cwd) {
                let repos = pointer
                    .repos
                    .iter()
                    .map(|r| super::types::GriptreeRepoInfo {
                        name: r.name.clone(),
                        original_branch: r.original_branch.clone(),
                        worktree_path: tree_path.join(&r.name),
                        is_reference: false,
                    })
                    .collect();

                Ok(WorkspaceInfo::Griptree {
                    path: tree_path,
                    branch: pointer.branch,
                    main_workspace: pointer.main_workspace.into(),
                    repos,
                })
            } else {
                // In main workspace, not a griptree
                let branch = get_current_branch(cwd).unwrap_or_else(|| "main".to_string());
                Ok(WorkspaceInfo::GitWorktree {
                    path: cwd.to_path_buf(),
                    branch,
                    base_branch: "main".to_string(),
                })
            }
        }
        WorkspaceType::Git => {
            let branch = get_current_branch(cwd).unwrap_or_else(|| "main".to_string());
            Ok(WorkspaceInfo::GitWorktree {
                path: cwd.to_path_buf(),
                branch,
                base_branch: "main".to_string(),
            })
        }
        WorkspaceType::Unknown => {
            Err(ChildAgentError::Config(
                "Not in a git or gitgrip workspace".to_string(),
            ))
        }
    }
}

/// Get the current git branch.
fn get_current_branch(path: &Path) -> Option<String> {
    std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_detect_git_workspace() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();

        // Initialize git repo
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let workspace = detect_workspace(dir.path()).unwrap();
        assert!(!workspace.is_griptree());
    }

    #[test]
    fn test_workspace_info_path() {
        let ws = WorkspaceInfo::GitWorktree {
            path: "/tmp/test".into(),
            branch: "main".to_string(),
            base_branch: "main".to_string(),
        };
        assert_eq!(ws.path().to_str().unwrap(), "/tmp/test");
        assert_eq!(ws.branch(), "main");
    }
}
