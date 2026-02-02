// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! MCP error types.

use thiserror::Error;

/// Errors that can occur during MCP operations.
#[derive(Debug, Error)]
pub enum McpError {
    /// Server not found in connection manager.
    #[error("MCP server not found: {0}")]
    ServerNotFound(String),

    /// Tool not found on server.
    #[error("Tool not found: {server}::{tool}")]
    ToolNotFound { server: String, tool: String },

    /// Connection failed.
    #[error("Failed to connect to MCP server '{server}': {message}")]
    ConnectionFailed { server: String, message: String },

    /// Connection timeout.
    #[error("Connection to MCP server '{server}' timed out after {timeout_secs}s")]
    ConnectionTimeout { server: String, timeout_secs: u64 },

    /// Initialization failed.
    #[error("Failed to initialize MCP server '{server}': {message}")]
    InitializationFailed { server: String, message: String },

    /// Tool call failed.
    #[error("Tool call '{tool}' failed: {message}")]
    ToolCallFailed { tool: String, message: String },

    /// Tool call timeout.
    #[error("Tool call '{tool}' timed out after {timeout_secs}s")]
    ToolCallTimeout { tool: String, timeout_secs: u64 },

    /// Invalid response from server.
    #[error("Invalid response from MCP server: {0}")]
    InvalidResponse(String),

    /// Transport error.
    #[error("Transport error: {0}")]
    Transport(String),

    /// Configuration error.
    #[error("Configuration error: {0}")]
    Config(String),

    /// Server already connected.
    #[error("MCP server '{0}' is already connected")]
    AlreadyConnected(String),

    /// Server not ready (still connecting or initializing).
    #[error("MCP server '{0}' is not ready")]
    NotReady(String),

    /// Protocol error (JSON-RPC).
    #[error("Protocol error: code={code}, message={message}")]
    Protocol { code: i32, message: String },

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization/deserialization error.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Rmcp SDK error.
    #[error("RMCP error: {0}")]
    Rmcp(String),
}

impl McpError {
    /// Create a connection failed error.
    pub fn connection_failed(server: impl Into<String>, message: impl Into<String>) -> Self {
        Self::ConnectionFailed {
            server: server.into(),
            message: message.into(),
        }
    }

    /// Create an initialization failed error.
    pub fn init_failed(server: impl Into<String>, message: impl Into<String>) -> Self {
        Self::InitializationFailed {
            server: server.into(),
            message: message.into(),
        }
    }

    /// Create a tool call failed error.
    pub fn tool_failed(tool: impl Into<String>, message: impl Into<String>) -> Self {
        Self::ToolCallFailed {
            tool: tool.into(),
            message: message.into(),
        }
    }

    /// Create a protocol error.
    pub fn protocol(code: i32, message: impl Into<String>) -> Self {
        Self::Protocol {
            code,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = McpError::ServerNotFound("test_server".to_string());
        assert!(err.to_string().contains("test_server"));

        let err = McpError::ToolNotFound {
            server: "server".to_string(),
            tool: "tool".to_string(),
        };
        assert!(err.to_string().contains("server"));
        assert!(err.to_string().contains("tool"));

        let err = McpError::protocol(-32600, "Invalid Request");
        assert!(err.to_string().contains("-32600"));
        assert!(err.to_string().contains("Invalid Request"));
    }

    #[test]
    fn test_error_helpers() {
        let err = McpError::connection_failed("server", "connection refused");
        assert!(matches!(err, McpError::ConnectionFailed { .. }));

        let err = McpError::init_failed("server", "handshake failed");
        assert!(matches!(err, McpError::InitializationFailed { .. }));

        let err = McpError::tool_failed("read_file", "file not found");
        assert!(matches!(err, McpError::ToolCallFailed { .. }));
    }
}
