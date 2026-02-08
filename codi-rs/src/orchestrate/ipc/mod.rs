// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC (Inter-Process Communication) module for commander-worker communication.
//!
//! This module provides cross-platform IPC between the commander (orchestrator)
//! and worker (child agent) processes.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────┐              ┌─────────────────┐
//! │    Commander    │              │     Worker      │
//! │                 │              │                 │
//! │  ┌───────────┐  │  Socket/     │  ┌───────────┐  │
//! │  │  Server   │◄─┼──Pipe────────┼──│  Client   │  │
//! │  └───────────┘  │              │  └───────────┘  │
//! └─────────────────┘              └─────────────────┘
//! ```
//!
//! # Protocol
//!
//! Messages are newline-delimited JSON (NDJSON). Each message is a complete
//! JSON object followed by a newline character.
//!
//! Transport:
//! - Unix: domain sockets
//! - Windows: named pipes
//!
//! ## Worker → Commander Messages
//!
//! - `handshake` - Initial connection from worker
//! - `permission_request` - Request approval for a tool operation
//! - `status_update` - Progress update
//! - `task_complete` - Successful completion
//! - `task_error` - Task failed
//! - `log` - Log output
//! - `pong` - Response to ping
//!
//! ## Commander → Worker Messages
//!
//! - `handshake_ack` - Accept/reject worker connection
//! - `permission_response` - Approve/deny/abort tool operation
//! - `inject_context` - Add context to worker's conversation
//! - `cancel` - Cancel the worker
//! - `ping` - Health check

pub mod protocol;
pub mod server;
pub mod client;
pub mod transport;
pub mod error;

pub use error::{IpcError, IpcResult};

pub use protocol::{
    WorkerMessage, CommanderMessage, PermissionResult,
    WorkerStatusUpdate, LogLevel,
    encode, decode, decode_messages,
};
pub use server::IpcServer;
pub use client::IpcClient;

#[cfg(test)]
mod tests {
    use super::{CommanderMessage, IpcClient, IpcServer, PermissionResult, WorkerMessage};
    use crate::agent::ToolConfirmation;
    use crate::orchestrate::types::{WorkerConfig, WorkspaceInfo};
    use std::path::PathBuf;
    use std::sync::Arc;

    #[cfg(windows)]
    #[tokio::test]
    async fn test_named_pipe_handshake_roundtrip() {
        let pipe_name = format!(r"\\.\pipe\codi-ipc-handshake-{}", uuid::Uuid::new_v4());
        let socket_path = PathBuf::from(pipe_name);

        let mut server = IpcServer::new(&socket_path);
        server.start().await.expect("server start failed");

        let mut rx = server.take_receiver().expect("receiver already taken");
        let server = Arc::new(server);

        let accept_server = Arc::clone(&server);
        let accept_task = tokio::spawn(async move {
            accept_server.accept().await.expect("accept failed")
        });

        let ack_server = Arc::clone(&server);
        let ack_task = tokio::spawn(async move {
            let (worker_id, msg) = rx.recv().await.expect("handshake missing");
            assert_eq!(worker_id, "worker-1");
            assert!(matches!(msg, WorkerMessage::Handshake { .. }));

            let ack = CommanderMessage::handshake_ack(
                true,
                vec!["read_file".to_string()],
                vec!["rm -rf".to_string()],
                1_234,
            );

            ack_server
                .send(&worker_id, &ack)
                .await
                .expect("ack send failed");
        });

        let mut client = IpcClient::new(&socket_path, "worker-1");
        client.connect().await.expect("client connect failed");

        let workspace = WorkspaceInfo::GitWorktree {
            path: PathBuf::from("."),
            branch: "feat/test".to_string(),
            base_branch: "main".to_string(),
        };
        let config = WorkerConfig::new("worker-1", "feat/test", "task");

        let ack = client
            .handshake(&config, &workspace)
            .await
            .expect("handshake failed");

        assert_eq!(ack.auto_approve, vec!["read_file".to_string()]);
        assert_eq!(ack.dangerous_patterns, vec!["rm -rf".to_string()]);
        assert_eq!(ack.timeout_ms, 1_234);

        accept_task.await.expect("accept task failed");
        ack_task.await.expect("ack task failed");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn test_named_pipe_permission_roundtrip() {
        let pipe_name = format!(r"\\.\pipe\codi-ipc-permission-{}", uuid::Uuid::new_v4());
        let socket_path = PathBuf::from(pipe_name);

        let mut server = IpcServer::new(&socket_path);
        server.start().await.expect("server start failed");

        let mut rx = server.take_receiver().expect("receiver already taken");
        let server = Arc::new(server);

        let accept_server = Arc::clone(&server);
        let accept_task = tokio::spawn(async move {
            accept_server.accept().await.expect("accept failed")
        });

        let ack_server = Arc::clone(&server);
        let server_task = tokio::spawn(async move {
            let (worker_id, msg) = rx.recv().await.expect("handshake missing");
            assert_eq!(worker_id, "worker-1");
            assert!(matches!(msg, WorkerMessage::Handshake { .. }));

            let ack = CommanderMessage::handshake_ack(
                true,
                Vec::new(),
                Vec::new(),
                5_000,
            );
            ack_server
                .send(&worker_id, &ack)
                .await
                .expect("ack send failed");

            let (worker_id, msg) = rx.recv().await.expect("permission missing");
            if let WorkerMessage::PermissionRequest { request_id, .. } = msg {
                ack_server
                    .send(&worker_id, &CommanderMessage::approve(request_id))
                    .await
                    .expect("permission approve failed");
            } else {
                panic!("expected permission request");
            }
        });

        let mut client = IpcClient::new(&socket_path, "worker-1");
        client.connect().await.expect("client connect failed");

        let workspace = WorkspaceInfo::GitWorktree {
            path: PathBuf::from("."),
            branch: "feat/test".to_string(),
            base_branch: "main".to_string(),
        };
        let config = WorkerConfig::new("worker-1", "feat/test", "task");

        client
            .handshake(&config, &workspace)
            .await
            .expect("handshake failed");

        let confirmation = ToolConfirmation {
            tool_name: "read_file".to_string(),
            input: serde_json::json!({ "path": "README.md" }),
            is_dangerous: false,
            danger_reason: None,
        };

        let result = client
            .request_permission(&confirmation)
            .await
            .expect("permission request failed");
        assert_eq!(result, PermissionResult::Approve);

        accept_task.await.expect("accept task failed");
        server_task.await.expect("server task failed");
    }
}
