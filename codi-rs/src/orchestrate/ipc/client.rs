// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC client for worker agents.
//!
//! The client connects to the commander's Unix domain socket and handles
//! bidirectional communication for permission requests and status updates.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{debug, error, info, warn};

use crate::agent::ToolConfirmation;
use crate::types::TokenUsage;

use super::protocol::{
    decode, encode, CommanderMessage, PermissionResult, WorkerMessage,
};
use super::super::types::{WorkerConfig, WorkerResult, WorkerStatus, WorkspaceInfo};

/// Error type for IPC client operations.
#[derive(Debug, thiserror::Error)]
pub enum IpcClientError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Not connected")]
    NotConnected,

    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Handshake failed: {0}")]
    HandshakeFailed(String),

    #[error("Channel closed")]
    ChannelClosed,

    #[error("Permission timeout")]
    PermissionTimeout,

    #[error("Cancelled")]
    Cancelled,
}

/// Handshake acknowledgment from commander.
#[derive(Debug, Clone)]
pub struct HandshakeAck {
    /// Whether the handshake was accepted.
    pub accepted: bool,
    /// Tools that can be auto-approved.
    pub auto_approve: Vec<String>,
    /// Dangerous patterns for tool inputs.
    pub dangerous_patterns: Vec<String>,
    /// Timeout in milliseconds.
    pub timeout_ms: u64,
    /// Optional rejection reason.
    pub reason: Option<String>,
}

/// Pending permission request.
struct PendingPermission {
    /// Channel to send the result.
    tx: oneshot::Sender<PermissionResult>,
}

/// IPC client for worker-commander communication.
pub struct IpcClient {
    /// Path to the Unix socket.
    socket_path: PathBuf,
    /// Worker ID.
    worker_id: String,
    /// Writer half of the socket.
    writer: Option<tokio::io::WriteHalf<UnixStream>>,
    /// Pending permission requests by request ID.
    pending_permissions: Arc<Mutex<HashMap<String, PendingPermission>>>,
    /// Channel for cancel signals.
    cancel_tx: Option<mpsc::Sender<()>>,
    /// Whether we've been cancelled.
    cancelled: Arc<Mutex<bool>>,
    /// Latest handshake acknowledgement.
    handshake_ack: Arc<Mutex<Option<HandshakeAck>>>,
}

impl IpcClient {
    /// Create a new IPC client.
    pub fn new(socket_path: impl AsRef<Path>, worker_id: impl Into<String>) -> Self {
        Self {
            socket_path: socket_path.as_ref().to_path_buf(),
            worker_id: worker_id.into(),
            writer: None,
            pending_permissions: Arc::new(Mutex::new(HashMap::new())),
            cancel_tx: None,
            cancelled: Arc::new(Mutex::new(false)),
            handshake_ack: Arc::new(Mutex::new(None)),
        }
    }

    /// Connect to the commander's socket.
    pub async fn connect(&mut self) -> Result<(), IpcClientError> {
        let stream = UnixStream::connect(&self.socket_path).await?;
        let (read_half, write_half) = tokio::io::split(stream);

        self.writer = Some(write_half);

        // Spawn reader task
        let pending = Arc::clone(&self.pending_permissions);
        let cancelled = Arc::clone(&self.cancelled);
        let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);
        self.cancel_tx = Some(cancel_tx);

        let handshake_ack = Arc::clone(&self.handshake_ack);

        tokio::spawn(async move {
            let mut reader = BufReader::new(read_half);
            let mut line = String::new();

            loop {
                tokio::select! {
                    result = reader.read_line(&mut line) => {
                        match result {
                            Ok(0) => {
                                info!("Commander disconnected");
                                break;
                            }
                            Ok(_) => {
                                if let Ok(msg) = decode::<CommanderMessage>(&line) {
                                    Self::handle_commander_message(
                                        msg,
                                        &pending,
                                        &cancelled,
                                        &handshake_ack
                                    ).await;
                                }
                                line.clear();
                            }
                            Err(e) => {
                                error!("Error reading from commander: {}", e);
                                break;
                            }
                        }
                    }
                    _ = cancel_rx.recv() => {
                        info!("Client cancelled");
                        break;
                    }
                }
            }
        });

        debug!("Connected to commander at {:?}", self.socket_path);
        Ok(())
    }

    /// Handle a message from the commander.
    async fn handle_commander_message(
        msg: CommanderMessage,
        pending: &Arc<Mutex<HashMap<String, PendingPermission>>>,
        cancelled: &Arc<Mutex<bool>>,
        handshake_ack: &Arc<Mutex<Option<HandshakeAck>>>,
    ) {
        match msg {
            CommanderMessage::HandshakeAck {
                accepted,
                auto_approve,
                dangerous_patterns,
                timeout_ms,
                reason,
                ..
            } => {
                let mut ack = handshake_ack.lock().await;
                *ack = Some(HandshakeAck {
                    accepted,
                    auto_approve,
                    dangerous_patterns,
                    timeout_ms,
                    reason,
                });
            }
            CommanderMessage::PermissionResponse { request_id, result, .. } => {
                let mut pending = pending.lock().await;
                if let Some(req) = pending.remove(&request_id) {
                    let _ = req.tx.send(result);
                }
            }
            CommanderMessage::Cancel { reason, .. } => {
                warn!("Received cancel: {:?}", reason);
                let mut cancelled = cancelled.lock().await;
                *cancelled = true;

                // Cancel all pending permissions
                let mut pending = pending.lock().await;
                for (_, req) in pending.drain() {
                    let _ = req.tx.send(PermissionResult::Abort);
                }
            }
            CommanderMessage::Ping { .. } => {
                // Pong is handled in send_pong
            }
            _ => {
                debug!("Received message: {:?}", msg);
            }
        }
    }

    /// Perform handshake with the commander.
    pub async fn handshake(
        &mut self,
        config: &WorkerConfig,
        workspace: &WorkspaceInfo,
    ) -> Result<HandshakeAck, IpcClientError> {
        let writer = self.writer.as_mut().ok_or(IpcClientError::NotConnected)?;

        // Send handshake
        let msg = WorkerMessage::Handshake {
            id: super::protocol::generate_message_id(),
            timestamp: super::protocol::now(),
            worker_id: self.worker_id.clone(),
            workspace_path: workspace.path().to_string_lossy().to_string(),
            branch: workspace.branch().to_string(),
            task: config.task.clone(),
            model: config.model.clone(),
            provider: config.provider.clone(),
        };

        let encoded = encode(&msg)?;
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;

        let ack = self.handshake_ack.lock().await.take();

        if let Some(ack) = ack {
            if !ack.accepted {
                return Err(IpcClientError::HandshakeFailed(
                    ack.reason.unwrap_or_else(|| "Handshake rejected".to_string())
                ));
            }

            // If commander didn't provide values, fall back to local config
            let auto_approve = if ack.auto_approve.is_empty() {
                config.auto_approve.clone()
            } else {
                ack.auto_approve
            };
            let dangerous_patterns = if ack.dangerous_patterns.is_empty() {
                config.dangerous_patterns.clone()
            } else {
                ack.dangerous_patterns
            };
            let timeout_ms = if ack.timeout_ms == 0 { config.timeout_ms } else { ack.timeout_ms };

            Ok(HandshakeAck {
                accepted: true,
                auto_approve,
                dangerous_patterns,
                timeout_ms,
                reason: None,
            })
        } else {
            Ok(HandshakeAck {
                accepted: true,
                auto_approve: config.auto_approve.clone(),
                dangerous_patterns: config.dangerous_patterns.clone(),
                timeout_ms: config.timeout_ms,
                reason: None,
            })
        }
    }

    /// Request permission for a tool operation.
    pub async fn request_permission(
        &mut self,
        confirmation: &ToolConfirmation,
    ) -> Result<PermissionResult, IpcClientError> {
        // Check if cancelled
        {
            let cancelled = self.cancelled.lock().await;
            if *cancelled {
                return Err(IpcClientError::Cancelled);
            }
        }

        let writer = self.writer.as_mut().ok_or(IpcClientError::NotConnected)?;

        // Create permission request message
        let msg = WorkerMessage::permission_request(confirmation);
        let request_id = msg.request_id().unwrap().to_string();

        // Set up response channel
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending_permissions.lock().await;
            pending.insert(request_id.clone(), PendingPermission { tx });
        }

        // Send request
        let encoded = encode(&msg)?;
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;

        // Wait for response with timeout (5 minutes)
        match tokio::time::timeout(Duration::from_secs(300), rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err(IpcClientError::ChannelClosed),
            Err(_) => Err(IpcClientError::PermissionTimeout),
        }
    }

    /// Send a status update.
    pub async fn send_status(&mut self, status: &WorkerStatus, tokens: TokenUsage) -> Result<(), IpcClientError> {
        let writer = self.writer.as_mut().ok_or(IpcClientError::NotConnected)?;

        let msg = WorkerMessage::status_update(status, tokens);
        let encoded = encode(&msg)?;
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;

        Ok(())
    }

    /// Send task completion.
    pub async fn send_task_complete(&mut self, result: WorkerResult) -> Result<(), IpcClientError> {
        let writer = self.writer.as_mut().ok_or(IpcClientError::NotConnected)?;

        let msg = WorkerMessage::task_complete(result);
        let encoded = encode(&msg)?;
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;

        Ok(())
    }

    /// Send task error.
    pub async fn send_task_error(&mut self, message: &str, recoverable: bool) -> Result<(), IpcClientError> {
        let writer = self.writer.as_mut().ok_or(IpcClientError::NotConnected)?;

        let msg = WorkerMessage::task_error(message, recoverable);
        let encoded = encode(&msg)?;
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;

        Ok(())
    }

    /// Send a log message.
    pub async fn send_log(&mut self, level: super::protocol::LogLevel, message: &str) -> Result<(), IpcClientError> {
        let writer = self.writer.as_mut().ok_or(IpcClientError::NotConnected)?;

        let msg = WorkerMessage::log(level, message);
        let encoded = encode(&msg)?;
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;

        Ok(())
    }

    /// Send pong response.
    pub async fn send_pong(&mut self) -> Result<(), IpcClientError> {
        let writer = self.writer.as_mut().ok_or(IpcClientError::NotConnected)?;

        let msg = WorkerMessage::pong();
        let encoded = encode(&msg)?;
        writer.write_all(encoded.as_bytes()).await?;
        writer.flush().await?;

        Ok(())
    }

    /// Check if the client has been cancelled.
    pub async fn is_cancelled(&self) -> bool {
        let cancelled = self.cancelled.lock().await;
        *cancelled
    }

    /// Disconnect from the commander.
    pub async fn disconnect(&mut self) -> Result<(), IpcClientError> {
        if let Some(tx) = self.cancel_tx.take() {
            let _ = tx.send(()).await;
        }
        self.writer = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = IpcClient::new("/tmp/test.sock", "worker-1");
        assert_eq!(client.worker_id, "worker-1");
        assert!(client.writer.is_none());
    }

    #[tokio::test]
    async fn test_cancelled_state() {
        let client = IpcClient::new("/tmp/test.sock", "worker-1");
        assert!(!client.is_cancelled().await);
    }
}
