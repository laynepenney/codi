// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Error types for LSP operations.

use thiserror::Error;

/// Errors that can occur during LSP operations.
#[derive(Error, Debug)]
pub enum LspError {
    /// Server not found or not configured.
    #[error("LSP server not found: {0}")]
    ServerNotFound(String),

    /// Server failed to start.
    #[error("Failed to start LSP server: {0}")]
    StartupFailed(String),

    /// Server is not ready for requests.
    #[error("LSP server not ready: {0}")]
    NotReady(String),

    /// Server communication error.
    #[error("LSP communication error: {0}")]
    CommunicationError(String),

    /// Request timed out.
    #[error("LSP request timed out after {0}ms")]
    Timeout(u64),

    /// Server returned an error response.
    #[error("LSP error response: {message}")]
    ServerError {
        code: i32,
        message: String,
        data: Option<serde_json::Value>,
    },

    /// Invalid response from server.
    #[error("Invalid LSP response: {0}")]
    InvalidResponse(String),

    /// File not found.
    #[error("File not found: {0}")]
    FileNotFound(String),

    /// Language not supported.
    #[error("Language not supported: {0}")]
    UnsupportedLanguage(String),

    /// Configuration error.
    #[error("LSP configuration error: {0}")]
    ConfigError(String),

    /// Capability not supported.
    #[error("LSP capability not supported: {0}")]
    UnsupportedCapability(String),

    /// IO error.
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    /// JSON serialization error.
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

impl LspError {
    /// Create a server error from LSP error response.
    pub fn server_error(code: i32, message: impl Into<String>) -> Self {
        Self::ServerError {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// Create a server error with data.
    pub fn server_error_with_data(
        code: i32,
        message: impl Into<String>,
        data: serde_json::Value,
    ) -> Self {
        Self::ServerError {
            code,
            message: message.into(),
            data: Some(data),
        }
    }

    /// Check if the error is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::Timeout(_) | Self::CommunicationError(_) | Self::NotReady(_)
        )
    }

    /// Check if the server needs to be restarted.
    pub fn needs_restart(&self) -> bool {
        matches!(
            self,
            Self::CommunicationError(_) | Self::StartupFailed(_)
        )
    }
}

/// Result type for LSP operations.
pub type LspResult<T> = std::result::Result<T, LspError>;

/// Standard LSP error codes.
pub mod error_codes {
    /// Invalid JSON was received by the server.
    pub const PARSE_ERROR: i32 = -32700;
    /// The JSON sent is not a valid Request object.
    pub const INVALID_REQUEST: i32 = -32600;
    /// The method does not exist / is not available.
    pub const METHOD_NOT_FOUND: i32 = -32601;
    /// Invalid method parameter(s).
    pub const INVALID_PARAMS: i32 = -32602;
    /// Internal JSON-RPC error.
    pub const INTERNAL_ERROR: i32 = -32603;

    // LSP-specific errors
    /// Server not initialized.
    pub const SERVER_NOT_INITIALIZED: i32 = -32002;
    /// Unknown protocol version.
    pub const UNKNOWN_PROTOCOL_VERSION: i32 = -32001;

    /// Request was cancelled.
    pub const REQUEST_CANCELLED: i32 = -32800;
    /// Content modified.
    pub const CONTENT_MODIFIED: i32 = -32801;
    /// Server cancelled the request.
    pub const SERVER_CANCELLED: i32 = -32802;
    /// Request failed.
    pub const REQUEST_FAILED: i32 = -32803;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = LspError::ServerNotFound("rust-analyzer".to_string());
        assert!(err.to_string().contains("rust-analyzer"));
    }

    #[test]
    fn test_server_error() {
        let err = LspError::server_error(-32601, "Method not found");
        match err {
            LspError::ServerError { code, message, data } => {
                assert_eq!(code, -32601);
                assert_eq!(message, "Method not found");
                assert!(data.is_none());
            }
            _ => panic!("Expected ServerError"),
        }
    }

    #[test]
    fn test_is_retryable() {
        assert!(LspError::Timeout(5000).is_retryable());
        assert!(LspError::NotReady("initializing".to_string()).is_retryable());
        assert!(!LspError::FileNotFound("/foo".to_string()).is_retryable());
    }

    #[test]
    fn test_needs_restart() {
        assert!(LspError::CommunicationError("pipe broken".to_string()).needs_restart());
        assert!(!LspError::Timeout(5000).needs_restart());
    }
}
