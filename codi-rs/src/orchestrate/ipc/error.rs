// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC error types for multi-agent orchestration.

use std::io;
use thiserror::Error;

/// Errors that can occur in the IPC subsystem.
#[derive(Debug, Error)]
pub enum IpcError {
    /// Failed to bind to the socket/pipe.
    #[error("Failed to bind IPC endpoint: {0}")]
    BindFailed(String),

    /// Failed to accept an incoming connection.
    #[error("Failed to accept IPC connection: {0}")]
    AcceptFailed(String),

    /// Failed to connect to the IPC endpoint.
    #[error("Failed to connect to IPC endpoint: {0}")]
    ConnectFailed(String),

    /// Failed to read from the IPC stream.
    #[error("Failed to read from IPC stream: {0}")]
    ReadFailed(String),

    /// Failed to write to the IPC stream.
    #[error("Failed to write to IPC stream: {0}")]
    WriteFailed(String),

    /// Failed to flush the IPC stream.
    #[error("Failed to flush IPC stream: {0}")]
    FlushFailed(String),

    /// Handshake with peer failed.
    #[error("IPC handshake failed: {0}")]
    HandshakeFailed(String),

    /// Permission request failed.
    #[error("Permission request failed: {0}")]
    PermissionFailed(String),

    /// Server failed to start.
    #[error("IPC server failed to start: {0}")]
    ServerStartFailed(String),

    /// Server task panicked or failed.
    #[error("IPC server task failed: {0}")]
    ServerTaskFailed(String),

    /// Failed to receive message.
    #[error("Failed to receive IPC message: {0}")]
    ReceiveFailed(String),

    /// Failed to send message.
    #[error("Failed to send IPC message: {0}")]
    SendFailed(String),

    /// Receiver already taken.
    #[error("IPC receiver already taken")]
    ReceiverAlreadyTaken,

    /// Invalid message received.
    #[error("Invalid IPC message: {0}")]
    InvalidMessage(String),

    /// Connection closed unexpectedly.
    #[error("IPC connection closed unexpectedly")]
    ConnectionClosed,

    /// Timeout waiting for response.
    #[error("IPC operation timed out")]
    Timeout,

    /// Platform-specific error.
    #[error("Platform error: {0}")]
    Platform(String),

    /// General transport error.
    #[error("Transport error: {0}")]
    Transport(String),
}

impl IpcError {
    /// Create an IPC error from an IO error with context.
    pub fn from_io_error(context: &str, err: io::Error) -> Self {
        IpcError::Transport(format!("{}: {}", context, err))
    }
}

/// Result type for IPC operations.
pub type IpcResult<T> = Result<T, IpcError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ipc_error_display() {
        let err = IpcError::BindFailed("permission denied".to_string());
        assert_eq!(
            err.to_string(),
            "Failed to bind IPC endpoint: permission denied"
        );
    }

    #[test]
    fn test_from_io_error() {
        let io_err = io::Error::new(io::ErrorKind::NotFound, "file not found");
        let err = IpcError::from_io_error("opening socket", io_err);
        assert!(err.to_string().contains("opening socket"));
        assert!(err.to_string().contains("file not found"));
    }
}
