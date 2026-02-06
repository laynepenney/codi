// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Commander for multi-agent orchestration.
//!
//! The Commander spawns worker processes, manages their workspaces,
//! and handles IPC communication for permission requests.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                       Commander                              │
//! │  ┌──────────────────────────────────────────────────────┐  │
//! │  │  IPC Server (socket/pipe)                             │  │
//! │  │  ~/.codi/orchestrator.sock or \\\\.\\pipe\\...         │  │
//! │  └──────────────────┬───────────────────────────────────┘  │
//! │                     │                                       │
//! │  ┌──────────────────┴───────────────────────────────────┐  │
//! │  │  WorkspaceIsolator (trait)                            │  │
//! │  │  ├── GitWorktreeIsolator (single repo)               │  │
//! │  │  └── GriptreeIsolator (multi-repo gitgrip)           │  │
//! │  └──────────────────────────────────────────────────────┘  │
//! └─────────────────────────────────────────────────────────────┘
//!               │                │
//!               ▼                ▼
//!       ┌────────────┐    ┌────────────┐
//!       │  Worker 1  │    │  Worker 2  │
//!       │  (IPC)     │    │  (IPC)     │
//!       └──────┬─────┘    └──────┬─────┘
//!              │                 │
//!       ┌──────▼─────┐    ┌──────▼─────┐
//!       │ Worktree/  │    │ Worktree/  │
//!       │ Griptree A │    │ Griptree B │
//!       └────────────┘    └────────────┘
//! ```

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tokio::process::Command;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info, warn};

use super::isolation::{detect_isolator, IsolationError, WorkspaceIsolator};
use super::ipc::{
    CommanderMessage, IpcServer, PermissionResult, WorkerMessage,
};
use super::types::{
    CommanderConfig, WorkerConfig, WorkerResult, WorkerState, WorkerStatus,
};

/// Error type for commander operations.
#[derive(Debug, thiserror::Error)]
pub enum CommanderError {
    #[error("IPC error: {0}")]
    Ipc(#[from] super::ipc::server::IpcError),

    #[error("Isolation error: {0}")]
    Isolation(#[from] IsolationError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Max workers reached: {0}")]
    MaxWorkersReached(usize),

    #[error("Worker not found: {0}")]
    WorkerNotFound(String),

    #[error("Worker already exists: {0}")]
    WorkerAlreadyExists(String),

    #[error("Spawn failed: {0}")]
    SpawnFailed(String),
}

/// Callback for permission requests.
pub type PermissionCallback = Box<dyn Fn(&str, &str, &serde_json::Value) -> PermissionResult + Send + Sync>;

/// Commander for multi-agent orchestration.
pub struct Commander {
    /// Workspace isolator.
    isolator: Box<dyn WorkspaceIsolator>,
    /// IPC server.
    server: IpcServer,
    /// Configuration.
    config: CommanderConfig,
    /// Worker states by ID.
    workers: Arc<RwLock<HashMap<String, WorkerState>>>,
    /// Permission callback.
    permission_callback: Option<PermissionCallback>,
    /// Channel for worker events.
    event_tx: mpsc::Sender<WorkerEvent>,
    /// Receiver for worker events.
    event_rx: Option<mpsc::Receiver<WorkerEvent>>,
}

/// Events from workers.
#[derive(Debug)]
pub enum WorkerEvent {
    /// Worker connected.
    Connected {
        worker_id: String,
    },
    /// Worker status changed.
    StatusChanged {
        worker_id: String,
        status: WorkerStatus,
    },
    /// Worker completed.
    Completed {
        worker_id: String,
        result: WorkerResult,
    },
    /// Worker failed.
    Failed {
        worker_id: String,
        error: String,
        recoverable: bool,
    },
    /// Worker disconnected.
    Disconnected {
        worker_id: String,
    },
    /// Permission requested.
    PermissionRequest {
        worker_id: String,
        request_id: String,
        tool_name: String,
        input: serde_json::Value,
    },
}

impl Commander {
    /// Create a new commander.
    pub async fn new(project_root: &Path, config: CommanderConfig) -> Result<Self, CommanderError> {
        let isolator = detect_isolator(project_root);
        let mut server = IpcServer::new(&config.socket_path);
        server.start().await?;

        let (tx, rx) = mpsc::channel(100);

        Ok(Self {
            isolator,
            server,
            config,
            workers: Arc::new(RwLock::new(HashMap::new())),
            permission_callback: None,
            event_tx: tx,
            event_rx: Some(rx),
        })
    }

    /// Take the event receiver.
    ///
    /// Use this to process worker events in a separate task.
    pub fn take_event_receiver(&mut self) -> Option<mpsc::Receiver<WorkerEvent>> {
        self.event_rx.take()
    }

    /// Set the permission callback.
    pub fn set_permission_callback(&mut self, callback: PermissionCallback) {
        self.permission_callback = Some(callback);
    }

    /// Spawn a new worker.
    pub async fn spawn_worker(&mut self, config: WorkerConfig) -> Result<String, CommanderError> {
        // Check if worker already exists
        {
            let workers = self.workers.read().await;
            if workers.contains_key(&config.id) {
                return Err(CommanderError::WorkerAlreadyExists(config.id.clone()));
            }

            // Check concurrency limit
            let active = workers.values().filter(|w| w.is_active()).count();
            if active >= self.config.max_workers {
                return Err(CommanderError::MaxWorkersReached(self.config.max_workers));
            }
        }

        // Create isolated workspace
        info!("Creating workspace for worker {}", config.id);
        let workspace = self
            .isolator
            .create(&config.branch, &self.config.base_branch)
            .await?;

        // Spawn child process
        let exe = std::env::current_exe()?;
        let process = Command::new(&exe)
            .arg("--child-mode")
            .arg("--socket-path")
            .arg(self.config.socket_path.to_str().unwrap())
            .arg("--child-id")
            .arg(&config.id)
            .arg("--child-task")
            .arg(&config.task)
            .current_dir(workspace.path())
            .spawn()
            .map_err(|e| CommanderError::SpawnFailed(e.to_string()))?;

        // Create worker state
        let worker_id = config.id.clone();
        let state = WorkerState {
            config,
            workspace,
            status: WorkerStatus::Starting,
            process: Some(process),
            started_at: Some(Instant::now()),
            completed_at: None,
            progress: 0,
            tokens: Default::default(),
            restart_count: 0,
        };

        // Store worker
        {
            let mut workers = self.workers.write().await;
            workers.insert(worker_id.clone(), state);
        }

        info!("Spawned worker {}", worker_id);
        Ok(worker_id)
    }

    /// Handle incoming messages from workers.
    ///
    /// This should be run in a loop to process worker messages.
    pub async fn process_messages(&mut self) -> Result<(), CommanderError> {
        // Take the message receiver from the server
        let mut rx = match self.server.take_receiver() {
            Some(rx) => rx,
            None => return Ok(()), // Receiver already taken
        };

        let workers = Arc::clone(&self.workers);
        let event_tx = self.event_tx.clone();

        // Process messages
        while let Some((worker_id, msg)) = rx.recv().await {
            debug!("Received message from {}: {:?}", worker_id, msg);

            match msg {
                WorkerMessage::Handshake { .. } => {
                    // Update worker status and send ack
                    {
                        let mut workers = workers.write().await;
                        if let Some(worker) = workers.get_mut(&worker_id) {
                            worker.status = WorkerStatus::Idle;
                        }
                    }

                    // Get auto-approve list from worker config
                    let auto_approve = {
                        let workers = workers.read().await;
                        workers
                            .get(&worker_id)
                            .map(|w| w.config.auto_approve.clone())
                            .unwrap_or_default()
                    };

                    let timeout_ms = {
                        let workers = workers.read().await;
                        workers
                            .get(&worker_id)
                            .map(|w| w.config.timeout_ms)
                            .unwrap_or(300_000)
                    };

                    let dangerous_patterns = {
                        let workers = workers.read().await;
                        workers
                            .get(&worker_id)
                            .map(|w| w.config.dangerous_patterns.clone())
                            .unwrap_or_default()
                    };

                    // Send ack
                    let ack = CommanderMessage::handshake_ack(
                        true,
                        auto_approve,
                        dangerous_patterns,
                        timeout_ms
                    );
                    if let Err(e) = self.server.send(&worker_id, &ack).await {
                        error!("Failed to send handshake ack: {}", e);
                    }

                    let _ = event_tx
                        .send(WorkerEvent::Connected {
                            worker_id: worker_id.clone(),
                        })
                        .await;
                }

                WorkerMessage::PermissionRequest {
                    request_id,
                    tool_name,
                    input,
                    ..
                } => {
                    // Update status
                    {
                        let mut workers = workers.write().await;
                        if let Some(worker) = workers.get_mut(&worker_id) {
                            worker.status = WorkerStatus::WaitingPermission {
                                tool: tool_name.clone(),
                            };
                        }
                    }

                    // Emit event for permission handling
                    let _ = event_tx
                        .send(WorkerEvent::PermissionRequest {
                            worker_id: worker_id.clone(),
                            request_id,
                            tool_name,
                            input,
                        })
                        .await;
                }

                WorkerMessage::StatusUpdate { status, tokens, .. } => {
                    // Update worker state
                    {
                        let mut workers = workers.write().await;
                        if let Some(worker) = workers.get_mut(&worker_id) {
                            worker.tokens = tokens;
                            // Convert status update to full status
                            worker.status = match status {
                                super::ipc::WorkerStatusUpdate::Starting => WorkerStatus::Starting,
                                super::ipc::WorkerStatusUpdate::Idle => WorkerStatus::Idle,
                                super::ipc::WorkerStatusUpdate::Thinking => WorkerStatus::Thinking,
                                super::ipc::WorkerStatusUpdate::ToolCall { tool } => {
                                    WorkerStatus::ToolCall { tool }
                                }
                                super::ipc::WorkerStatusUpdate::WaitingPermission { tool } => {
                                    WorkerStatus::WaitingPermission { tool }
                                }
                                super::ipc::WorkerStatusUpdate::Complete => {
                                    WorkerStatus::Complete {
                                        result: WorkerResult::success(""),
                                    }
                                }
                                super::ipc::WorkerStatusUpdate::Failed => WorkerStatus::Failed {
                                    error: "Unknown error".to_string(),
                                    recoverable: false,
                                },
                                super::ipc::WorkerStatusUpdate::Cancelled => WorkerStatus::Cancelled,
                            };
                        }
                    }
                }

                WorkerMessage::TaskComplete { result, .. } => {
                    // Update worker state
                    {
                        let mut workers = workers.write().await;
                        if let Some(worker) = workers.get_mut(&worker_id) {
                            worker.status = WorkerStatus::Complete {
                                result: result.clone(),
                            };
                            worker.completed_at = Some(Instant::now());
                        }
                    }

                    let _ = event_tx
                        .send(WorkerEvent::Completed {
                            worker_id: worker_id.clone(),
                            result,
                        })
                        .await;
                }

                WorkerMessage::TaskError {
                    message,
                    recoverable,
                    ..
                } => {
                    // Update worker state
                    {
                        let mut workers = workers.write().await;
                        if let Some(worker) = workers.get_mut(&worker_id) {
                            worker.status = WorkerStatus::Failed {
                                error: message.clone(),
                                recoverable,
                            };
                            worker.completed_at = Some(Instant::now());
                        }
                    }

                    let _ = event_tx
                        .send(WorkerEvent::Failed {
                            worker_id: worker_id.clone(),
                            error: message,
                            recoverable,
                        })
                        .await;
                }

                WorkerMessage::Log { level, message, .. } => {
                    // Log the message
                    match level {
                        super::ipc::LogLevel::Error => error!("[{}] {}", worker_id, message),
                        super::ipc::LogLevel::Warn => warn!("[{}] {}", worker_id, message),
                        super::ipc::LogLevel::Info => info!("[{}] {}", worker_id, message),
                        _ => debug!("[{}] {}", worker_id, message),
                    }
                }

                WorkerMessage::Pong { .. } => {
                    debug!("Received pong from {}", worker_id);
                }
            }
        }

        Ok(())
    }

    /// Respond to a permission request.
    pub async fn respond_permission(
        &self,
        worker_id: &str,
        request_id: &str,
        result: PermissionResult,
    ) -> Result<(), CommanderError> {
        let msg = match result {
            PermissionResult::Approve => CommanderMessage::approve(request_id),
            PermissionResult::Deny { reason } => CommanderMessage::deny(request_id, reason),
            PermissionResult::Abort => CommanderMessage::abort(request_id),
        };

        self.server.send(worker_id, &msg).await?;

        // Update worker status
        {
            let mut workers = self.workers.write().await;
            if let Some(worker) = workers.get_mut(worker_id) {
                if matches!(worker.status, WorkerStatus::WaitingPermission { .. }) {
                    worker.status = WorkerStatus::Thinking;
                }
            }
        }

        Ok(())
    }

    /// Cancel a worker.
    pub async fn cancel_worker(&self, worker_id: &str) -> Result<(), CommanderError> {
        info!("Cancelling worker {}", worker_id);

        // Send cancel message
        let msg = CommanderMessage::cancel(Some("User requested".to_string()));
        self.server.send(worker_id, &msg).await?;

        // Wait a moment for graceful shutdown
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        // Force kill if still running
        {
            let mut workers = self.workers.write().await;
            if let Some(worker) = workers.get_mut(worker_id) {
                if let Some(ref mut process) = worker.process {
                    let _ = process.kill().await;
                }
                worker.status = WorkerStatus::Cancelled;
                worker.completed_at = Some(Instant::now());
            }
        }

        Ok(())
    }

    /// Get worker status.
    pub async fn get_worker(&self, worker_id: &str) -> Option<WorkerStatus> {
        let workers = self.workers.read().await;
        workers.get(worker_id).map(|w| w.status.clone())
    }

    /// List all workers.
    pub async fn list_workers(&self) -> Vec<(String, WorkerStatus)> {
        let workers = self.workers.read().await;
        workers
            .iter()
            .map(|(id, state)| (id.clone(), state.status.clone()))
            .collect()
    }

    /// List active workers.
    pub async fn active_workers(&self) -> Vec<String> {
        let workers = self.workers.read().await;
        workers
            .iter()
            .filter(|(_, state)| state.is_active())
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Get number of active workers.
    pub async fn active_count(&self) -> usize {
        let workers = self.workers.read().await;
        workers.values().filter(|w| w.is_active()).count()
    }

    /// Cleanup a completed worker's workspace.
    pub async fn cleanup_worker(&self, worker_id: &str) -> Result<(), CommanderError> {
        let workspace = {
            let workers = self.workers.read().await;
            workers.get(worker_id).map(|w| w.workspace.clone())
        };

        if let Some(workspace) = workspace {
            info!("Cleaning up workspace for {}", worker_id);
            self.isolator.remove(&workspace, true).await?;
        }

        // Remove from tracking
        {
            let mut workers = self.workers.write().await;
            workers.remove(worker_id);
        }

        Ok(())
    }

    /// Cleanup all workers and shutdown.
    pub async fn shutdown(&mut self) -> Result<(), CommanderError> {
        info!("Shutting down commander");

        // Cancel all active workers
        let active = self.active_workers().await;
        for worker_id in active {
            let _ = self.cancel_worker(&worker_id).await;
        }

        // Cleanup workspaces if configured
        if self.config.cleanup_on_exit {
            let workers: Vec<_> = {
                let workers = self.workers.read().await;
                workers.values().map(|w| w.workspace.clone()).collect()
            };

            for workspace in workers {
                if let Err(e) = self.isolator.remove(&workspace, true).await {
                    warn!("Failed to cleanup workspace: {}", e);
                }
            }
        }

        // Stop server
        self.server.stop().await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_commander_config_default() {
        let config = CommanderConfig::default();
        assert_eq!(config.max_workers, 4);
        assert!(config.cleanup_on_exit);
    }

    #[test]
    fn test_worker_event_types() {
        let event = WorkerEvent::Connected {
            worker_id: "test".to_string(),
        };
        assert!(matches!(event, WorkerEvent::Connected { .. }));
    }
}
