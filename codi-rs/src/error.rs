// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Error types for the Codi AI assistant.
//!
//! This module provides strongly-typed errors for different parts of the application,
//! using `thiserror` for ergonomic error definitions and `anyhow` for error propagation.

use thiserror::Error;

/// Errors that can occur during provider operations.
#[derive(Error, Debug)]
pub enum ProviderError {
    #[error("Authentication failed: {0}")]
    AuthError(String),

    #[error("API error: {message}")]
    ApiError {
        message: String,
        status_code: Option<u16>,
    },

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Context window exceeded: {used} tokens used, {limit} available")]
    ContextWindowExceeded { used: u32, limit: u32 },

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Response parsing error: {0}")]
    ParseError(String),

    #[error("Streaming error: {0}")]
    StreamError(String),

    #[error("Provider not configured: {0}")]
    NotConfigured(String),

    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),

    #[error("Timeout after {0}ms")]
    Timeout(u64),
}

impl ProviderError {
    /// Create an API error with status code.
    pub fn api(message: impl Into<String>, status_code: u16) -> Self {
        Self::ApiError {
            message: message.into(),
            status_code: Some(status_code),
        }
    }

    /// Create an API error without status code.
    pub fn api_message(message: impl Into<String>) -> Self {
        Self::ApiError {
            message: message.into(),
            status_code: None,
        }
    }

    /// Check if this error is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::RateLimited(_) | Self::NetworkError(_) | Self::Timeout(_)
        )
    }

    /// Check if this is a rate limit error.
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, Self::RateLimited(_))
    }
}

/// Errors that can occur during tool execution.
#[derive(Error, Debug)]
pub enum ToolError {
    #[error("Tool not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Missing required parameter: {0}")]
    MissingParameter(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Execution failed: {0}")]
    ExecutionFailed(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Timeout after {0}ms")]
    Timeout(u64),

    #[error("Security violation: {0}")]
    SecurityViolation(String),
}

impl ToolError {
    /// Check if this error should be reported back to the model.
    pub fn is_reportable(&self) -> bool {
        // All tool errors should be reported so the model can try alternatives
        true
    }
}

impl From<std::io::Error> for ToolError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => Self::FileNotFound(err.to_string()),
            std::io::ErrorKind::PermissionDenied => Self::PermissionDenied(err.to_string()),
            _ => Self::IoError(err.to_string()),
        }
    }
}

/// Errors that can occur during configuration loading.
#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Config file not found: {0}")]
    NotFound(String),

    #[error("Invalid config format: {0}")]
    InvalidFormat(String),

    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Invalid value for {field}: {message}")]
    InvalidValue { field: String, message: String },

    #[error("IO error reading config: {0}")]
    IoError(String),

    #[error("YAML parsing error: {0}")]
    YamlError(String),

    #[error("JSON parsing error: {0}")]
    JsonError(String),
}

impl From<std::io::Error> for ConfigError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound(err.to_string()),
            _ => Self::IoError(err.to_string()),
        }
    }
}

impl From<serde_json::Error> for ConfigError {
    fn from(err: serde_json::Error) -> Self {
        Self::JsonError(err.to_string())
    }
}

impl From<serde_yaml::Error> for ConfigError {
    fn from(err: serde_yaml::Error) -> Self {
        Self::YamlError(err.to_string())
    }
}

/// Errors that can occur during session operations.
#[derive(Error, Debug)]
pub enum SessionError {
    #[error("Session not found: {0}")]
    NotFound(String),

    #[error("Failed to save session: {0}")]
    SaveFailed(String),

    #[error("Failed to load session: {0}")]
    LoadFailed(String),

    #[error("Session corrupted: {0}")]
    Corrupted(String),

    #[error("IO error: {0}")]
    IoError(String),
}

impl From<std::io::Error> for SessionError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound(err.to_string()),
            _ => Self::IoError(err.to_string()),
        }
    }
}

/// Errors that can occur during agent operations.
#[derive(Error, Debug)]
pub enum AgentError {
    #[error("Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Tool error: {0}")]
    Tool(#[from] ToolError),

    #[error("Maximum iterations exceeded: {0}")]
    MaxIterationsExceeded(u32),

    #[error("Maximum consecutive errors exceeded: {0}")]
    MaxErrorsExceeded(u32),

    #[error("User cancelled operation")]
    UserCancelled,

    #[error("Context compaction failed: {0}")]
    CompactionFailed(String),

    #[error("Invalid state: {0}")]
    InvalidState(String),
}

/// Result type alias using anyhow for flexible error handling.
pub type Result<T> = anyhow::Result<T>;

/// Convert any error type that implements std::error::Error to an anyhow::Error.
pub fn to_anyhow<E: std::error::Error + Send + Sync + 'static>(err: E) -> anyhow::Error {
    anyhow::Error::new(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_error_retryable() {
        assert!(ProviderError::RateLimited("wait 1s".to_string()).is_retryable());
        assert!(ProviderError::NetworkError("timeout".to_string()).is_retryable());
        assert!(ProviderError::Timeout(30000).is_retryable());
        assert!(!ProviderError::AuthError("invalid key".to_string()).is_retryable());
        assert!(!ProviderError::ModelNotFound("gpt-5".to_string()).is_retryable());
    }

    #[test]
    fn test_provider_error_api() {
        let err = ProviderError::api("Bad request", 400);
        match err {
            ProviderError::ApiError { message, status_code } => {
                assert_eq!(message, "Bad request");
                assert_eq!(status_code, Some(400));
            }
            _ => panic!("Expected ApiError"),
        }
    }

    #[test]
    fn test_tool_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let tool_err: ToolError = io_err.into();
        assert!(matches!(tool_err, ToolError::FileNotFound(_)));
    }

    #[test]
    fn test_config_error_from_json() {
        // Create a JSON parse error
        let result: std::result::Result<serde_json::Value, _> = serde_json::from_str("invalid json");
        let json_err = result.unwrap_err();
        let config_err: ConfigError = json_err.into();
        assert!(matches!(config_err, ConfigError::JsonError(_)));
    }

    #[test]
    fn test_agent_error_from_provider() {
        let provider_err = ProviderError::AuthError("invalid".to_string());
        let agent_err: AgentError = provider_err.into();
        assert!(matches!(agent_err, AgentError::Provider(_)));
    }

    #[test]
    fn test_error_display() {
        let err = ProviderError::ContextWindowExceeded {
            used: 100000,
            limit: 128000,
        };
        let display = format!("{}", err);
        assert!(display.contains("100000"));
        assert!(display.contains("128000"));
    }
}
