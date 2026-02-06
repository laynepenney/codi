// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Multi-agent orchestration module.
//!
//! This module provides the infrastructure for running multiple AI agents
//! in parallel, each in an isolated workspace.
//!
//! # Architecture
//!
//! The orchestration system consists of:
//!
//! - **Commander**: The parent process that spawns workers, manages workspaces,
//!   and handles IPC communication for permission requests.
//!
//! - **ChildAgent**: The worker process that runs the agent loop and communicates
//!   with the Commander via IPC.
//!
//! - **WorkspaceIsolator**: Abstraction for creating isolated workspaces, supporting
//!   both git worktrees (single repo) and griptrees (multi-repo gitgrip).
//!
//! - **IPC**: Cross-platform IPC (Unix domain sockets on Unix, named pipes on Windows).
//!
//! # Workspace Isolation
//!
//! The system automatically detects the workspace type:
//!
//! - **Git Repository**: Uses `git worktree` to create isolated branches in sibling
//!   directories.
//!
//! - **Gitgrip Workspace**: Creates a parallel workspace with worktrees for ALL
//!   repositories in the manifest.
//!
//! ```text
//! Is current directory a gitgrip workspace?
//! ├── YES (.gitgrip/ exists) → Use GriptreeIsolator
//! │   └── Create sibling directory with worktrees for ALL repos
//! └── NO (regular git repo) → Use GitWorktreeIsolator
//!     └── Create worktree for single repo
//! ```
//!
//! # Usage
//!
//! ## As Commander (main process)
//!
//! ```rust,ignore
//! use codi::orchestrate::{Commander, CommanderConfig, WorkerConfig};
//!
//! // Create commander
//! let mut commander = Commander::new(".", CommanderConfig::default()).await?;
//!
//! // Spawn a worker
//! let worker_id = commander.spawn_worker(WorkerConfig::new(
//!     "worker-1",
//!     "feat/auth",
//!     "Implement OAuth2 login flow",
//! )).await?;
//!
//! // Process messages (permission requests, status updates)
//! commander.process_messages().await?;
//!
//! // Cleanup
//! commander.shutdown().await?;
//! ```
//!
//! ## As Worker (child process)
//!
//! ```rust,ignore
//! use codi::orchestrate::ChildAgent;
//!
//! // Run in child mode (auto-connects to commander)
//! let result = ChildAgent::run(
//!     Path::new("/path/to/socket"),
//!     "worker-1",
//!     "Implement OAuth2 login flow",
//! ).await?;
//! ```
//!
//! # IPC Protocol
//!
//! Communication uses newline-delimited JSON over a platform-specific IPC transport.
//!
//! ## Worker → Commander Messages
//!
//! - `handshake` - Initial connection
//! - `permission_request` - Request tool approval
//! - `status_update` - Progress update
//! - `task_complete` - Successful completion
//! - `task_error` - Task failed
//! - `log` - Log output
//!
//! ## Commander → Worker Messages
//!
//! - `handshake_ack` - Accept/reject connection
//! - `permission_response` - Approve/deny tool operation
//! - `inject_context` - Add context to worker
//! - `cancel` - Cancel the worker
//! - `ping` - Health check

pub mod child_agent;
pub mod commander;
pub mod griptree;
pub mod ipc;
pub mod isolation;
pub mod types;
pub mod worktree;

// Re-export main types for convenience
pub use child_agent::{ChildAgent, ChildAgentError};
pub use commander::{Commander, CommanderError, WorkerEvent};
pub use griptree::GriptreeIsolator;
pub use isolation::{
    detect_isolator, detect_workspace_type, find_workspace_root,
    IsolationError, WorkspaceIsolator, WorkspaceType,
};
pub use ipc::{
    CommanderMessage, IpcClient, IpcServer, LogLevel, PermissionResult,
    WorkerMessage, WorkerStatusUpdate,
};
pub use types::{
    CommanderConfig, GriptreePointer, GriptreeRepoInfo, GriptreeRepoPointer,
    WorkerConfig, WorkerResult, WorkerState, WorkerStatus, WorkspaceInfo,
    READER_ALLOWED_TOOLS, is_reader_tool, reader_tools_set, socket_path_for_project,
};
pub use worktree::GitWorktreeIsolator;
