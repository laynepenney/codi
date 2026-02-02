// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC protocol for commander-worker communication.
//!
//! Uses newline-delimited JSON over Unix domain sockets.

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::types::TokenUsage;
use crate::agent::ToolConfirmation;
use super::super::types::{WorkerResult, WorkerStatus};

// ============================================================================
// Message Envelope
// ============================================================================

/// Generate a unique message ID.
pub fn generate_message_id() -> String {
    Uuid::new_v4().to_string()
}

/// Get current timestamp.
pub fn now() -> DateTime<Utc> {
    Utc::now()
}

// ============================================================================
// Worker -> Commander Messages
// ============================================================================

/// Messages sent from worker to commander.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerMessage {
    /// Initial handshake from worker.
    Handshake {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Worker ID.
        worker_id: String,
        /// Workspace path.
        workspace_path: String,
        /// Branch name.
        branch: String,
        /// Task description.
        task: String,
        /// Model being used.
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// Provider being used.
        #[serde(skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
    },

    /// Request permission for a tool operation.
    PermissionRequest {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Request ID for correlating response.
        request_id: String,
        /// Tool name.
        tool_name: String,
        /// Human-readable description.
        description: String,
        /// Tool input parameters.
        input: serde_json::Value,
        /// Whether this is a dangerous operation.
        is_dangerous: bool,
        /// Reason why this is dangerous (if applicable).
        #[serde(skip_serializing_if = "Option::is_none")]
        danger_reason: Option<String>,
    },

    /// Status update from worker.
    StatusUpdate {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Current status.
        status: WorkerStatusUpdate,
        /// Progress percentage (0-100).
        #[serde(skip_serializing_if = "Option::is_none")]
        progress: Option<u8>,
        /// Current tool being executed.
        #[serde(skip_serializing_if = "Option::is_none")]
        current_tool: Option<String>,
        /// Token usage so far.
        tokens: TokenUsage,
        /// Optional status message.
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    /// Task completed successfully.
    TaskComplete {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Completion result.
        result: WorkerResult,
    },

    /// Task failed with error.
    TaskError {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Error message.
        message: String,
        /// Error code (if applicable).
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        /// Whether this error is recoverable.
        recoverable: bool,
    },

    /// Log output from worker.
    Log {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Log level.
        level: LogLevel,
        /// Log message.
        message: String,
    },

    /// Pong response to ping.
    Pong {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
    },
}

/// Simplified status for updates (avoids recursive Result type).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatusUpdate {
    Starting,
    Idle,
    Thinking,
    ToolCall { tool: String },
    WaitingPermission { tool: String },
    Complete,
    Failed,
    Cancelled,
}

impl From<&WorkerStatus> for WorkerStatusUpdate {
    fn from(status: &WorkerStatus) -> Self {
        match status {
            WorkerStatus::Starting => Self::Starting,
            WorkerStatus::Idle => Self::Idle,
            WorkerStatus::Thinking => Self::Thinking,
            WorkerStatus::ToolCall { tool } => Self::ToolCall { tool: tool.clone() },
            WorkerStatus::WaitingPermission { tool } => Self::WaitingPermission { tool: tool.clone() },
            WorkerStatus::Complete { .. } => Self::Complete,
            WorkerStatus::Failed { .. } => Self::Failed,
            WorkerStatus::Cancelled => Self::Cancelled,
        }
    }
}

/// Log levels for worker output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// Regular text output.
    Text,
    /// Tool execution output.
    Tool,
    /// Informational message.
    Info,
    /// Warning message.
    Warn,
    /// Error message.
    Error,
}

impl WorkerMessage {
    /// Create a handshake message.
    pub fn handshake(
        worker_id: impl Into<String>,
        workspace_path: impl Into<String>,
        branch: impl Into<String>,
        task: impl Into<String>,
    ) -> Self {
        Self::Handshake {
            id: generate_message_id(),
            timestamp: now(),
            worker_id: worker_id.into(),
            workspace_path: workspace_path.into(),
            branch: branch.into(),
            task: task.into(),
            model: None,
            provider: None,
        }
    }

    /// Create a permission request message.
    pub fn permission_request(confirmation: &ToolConfirmation) -> Self {
        Self::PermissionRequest {
            id: generate_message_id(),
            timestamp: now(),
            request_id: generate_message_id(),
            tool_name: confirmation.tool_name.clone(),
            description: format!("Execute tool: {}", confirmation.tool_name),
            input: confirmation.input.clone(),
            is_dangerous: confirmation.is_dangerous,
            danger_reason: confirmation.danger_reason.clone(),
        }
    }

    /// Create a status update message.
    pub fn status_update(status: &WorkerStatus, tokens: TokenUsage) -> Self {
        let (current_tool, progress) = match status {
            WorkerStatus::ToolCall { tool } => (Some(tool.clone()), None),
            WorkerStatus::WaitingPermission { tool } => (Some(tool.clone()), None),
            _ => (None, None),
        };

        Self::StatusUpdate {
            id: generate_message_id(),
            timestamp: now(),
            status: WorkerStatusUpdate::from(status),
            progress,
            current_tool,
            tokens,
            message: None,
        }
    }

    /// Create a task complete message.
    pub fn task_complete(result: WorkerResult) -> Self {
        Self::TaskComplete {
            id: generate_message_id(),
            timestamp: now(),
            result,
        }
    }

    /// Create a task error message.
    pub fn task_error(message: impl Into<String>, recoverable: bool) -> Self {
        Self::TaskError {
            id: generate_message_id(),
            timestamp: now(),
            message: message.into(),
            code: None,
            recoverable,
        }
    }

    /// Create a log message.
    pub fn log(level: LogLevel, message: impl Into<String>) -> Self {
        Self::Log {
            id: generate_message_id(),
            timestamp: now(),
            level,
            message: message.into(),
        }
    }

    /// Create a pong response.
    pub fn pong() -> Self {
        Self::Pong {
            id: generate_message_id(),
            timestamp: now(),
        }
    }

    /// Get the request ID if this is a permission request.
    pub fn request_id(&self) -> Option<&str> {
        match self {
            Self::PermissionRequest { request_id, .. } => Some(request_id),
            _ => None,
        }
    }
}

// ============================================================================
// Commander -> Worker Messages
// ============================================================================

/// Messages sent from commander to worker.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommanderMessage {
    /// Acknowledge handshake.
    HandshakeAck {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Whether the handshake was accepted.
        accepted: bool,
        /// Tools to auto-approve.
        auto_approve: Vec<String>,
        /// Timeout in milliseconds.
        timeout_ms: u64,
        /// Rejection reason (if not accepted).
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },

    /// Response to permission request.
    PermissionResponse {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Request ID being responded to.
        request_id: String,
        /// Permission result.
        result: PermissionResult,
    },

    /// Inject context into the worker.
    InjectContext {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Context to inject.
        context: String,
        /// Relevant files (if any).
        #[serde(skip_serializing_if = "Option::is_none")]
        relevant_files: Option<Vec<String>>,
    },

    /// Cancel the worker.
    Cancel {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
        /// Reason for cancellation.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },

    /// Ping to check if worker is alive.
    Ping {
        /// Message ID.
        id: String,
        /// Timestamp.
        timestamp: DateTime<Utc>,
    },
}

/// Result of a permission request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum PermissionResult {
    /// Permission granted.
    Approve,
    /// Permission denied.
    Deny {
        /// Reason for denial.
        reason: String,
    },
    /// Abort the entire operation.
    Abort,
}

impl CommanderMessage {
    /// Create a handshake acknowledgment.
    pub fn handshake_ack(accepted: bool, auto_approve: Vec<String>, timeout_ms: u64) -> Self {
        Self::HandshakeAck {
            id: generate_message_id(),
            timestamp: now(),
            accepted,
            auto_approve,
            timeout_ms,
            reason: None,
        }
    }

    /// Create a handshake rejection.
    pub fn handshake_reject(reason: impl Into<String>) -> Self {
        Self::HandshakeAck {
            id: generate_message_id(),
            timestamp: now(),
            accepted: false,
            auto_approve: Vec::new(),
            timeout_ms: 0,
            reason: Some(reason.into()),
        }
    }

    /// Create a permission approval.
    pub fn approve(request_id: impl Into<String>) -> Self {
        Self::PermissionResponse {
            id: generate_message_id(),
            timestamp: now(),
            request_id: request_id.into(),
            result: PermissionResult::Approve,
        }
    }

    /// Create a permission denial.
    pub fn deny(request_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::PermissionResponse {
            id: generate_message_id(),
            timestamp: now(),
            request_id: request_id.into(),
            result: PermissionResult::Deny {
                reason: reason.into(),
            },
        }
    }

    /// Create an abort message.
    pub fn abort(request_id: impl Into<String>) -> Self {
        Self::PermissionResponse {
            id: generate_message_id(),
            timestamp: now(),
            request_id: request_id.into(),
            result: PermissionResult::Abort,
        }
    }

    /// Create a context injection message.
    pub fn inject_context(context: impl Into<String>) -> Self {
        Self::InjectContext {
            id: generate_message_id(),
            timestamp: now(),
            context: context.into(),
            relevant_files: None,
        }
    }

    /// Create a cancel message.
    pub fn cancel(reason: Option<String>) -> Self {
        Self::Cancel {
            id: generate_message_id(),
            timestamp: now(),
            reason,
        }
    }

    /// Create a ping message.
    pub fn ping() -> Self {
        Self::Ping {
            id: generate_message_id(),
            timestamp: now(),
        }
    }
}

// ============================================================================
// Serialization
// ============================================================================

/// Encode a message to a newline-delimited JSON string.
pub fn encode<T: Serialize>(msg: &T) -> Result<String, serde_json::Error> {
    let mut json = serde_json::to_string(msg)?;
    json.push('\n');
    Ok(json)
}

/// Decode a message from a JSON string.
pub fn decode<'a, T: Deserialize<'a>>(json: &'a str) -> Result<T, serde_json::Error> {
    serde_json::from_str(json.trim())
}

/// Parse multiple newline-delimited messages from a buffer.
pub fn decode_messages<'a, T: Deserialize<'a>>(buffer: &'a str) -> Vec<Result<T, serde_json::Error>> {
    buffer
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line.trim()))
        .collect()
}

// ============================================================================
// Type Guards
// ============================================================================

impl WorkerMessage {
    /// Check if this is a handshake message.
    pub fn is_handshake(&self) -> bool {
        matches!(self, Self::Handshake { .. })
    }

    /// Check if this is a permission request.
    pub fn is_permission_request(&self) -> bool {
        matches!(self, Self::PermissionRequest { .. })
    }

    /// Check if this is a status update.
    pub fn is_status_update(&self) -> bool {
        matches!(self, Self::StatusUpdate { .. })
    }

    /// Check if this is a task complete message.
    pub fn is_task_complete(&self) -> bool {
        matches!(self, Self::TaskComplete { .. })
    }

    /// Check if this is a task error message.
    pub fn is_task_error(&self) -> bool {
        matches!(self, Self::TaskError { .. })
    }

    /// Check if this is a terminal message (complete or error).
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::TaskComplete { .. } | Self::TaskError { .. })
    }
}

impl CommanderMessage {
    /// Check if this is a handshake ack.
    pub fn is_handshake_ack(&self) -> bool {
        matches!(self, Self::HandshakeAck { .. })
    }

    /// Check if this is a permission response.
    pub fn is_permission_response(&self) -> bool {
        matches!(self, Self::PermissionResponse { .. })
    }

    /// Check if this is a cancel message.
    pub fn is_cancel(&self) -> bool {
        matches!(self, Self::Cancel { .. })
    }

    /// Check if this is a ping message.
    pub fn is_ping(&self) -> bool {
        matches!(self, Self::Ping { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worker_handshake() {
        let msg = WorkerMessage::handshake("w1", "/tmp/work", "feat/test", "Do something");
        assert!(msg.is_handshake());

        let json = encode(&msg).unwrap();
        assert!(json.contains("\"type\":\"handshake\""));
        assert!(json.contains("\"worker_id\":\"w1\""));
        assert!(json.ends_with('\n'));

        let decoded: WorkerMessage = decode(&json).unwrap();
        assert!(decoded.is_handshake());
    }

    #[test]
    fn test_permission_result_serialization() {
        let approve = PermissionResult::Approve;
        let json = serde_json::to_string(&approve).unwrap();
        assert!(json.contains("\"result\":\"approve\""));

        let deny = PermissionResult::Deny {
            reason: "Not safe".to_string(),
        };
        let json = serde_json::to_string(&deny).unwrap();
        assert!(json.contains("\"result\":\"deny\""));
        assert!(json.contains("\"reason\":\"Not safe\""));
    }

    #[test]
    fn test_commander_messages() {
        let ack = CommanderMessage::handshake_ack(true, vec!["read_file".to_string()], 60000);
        assert!(ack.is_handshake_ack());

        let cancel = CommanderMessage::cancel(Some("User requested".to_string()));
        assert!(cancel.is_cancel());

        let ping = CommanderMessage::ping();
        assert!(ping.is_ping());
    }

    #[test]
    fn test_status_update_conversion() {
        let status = WorkerStatus::ToolCall {
            tool: "bash".to_string(),
        };
        let update = WorkerStatusUpdate::from(&status);
        assert!(matches!(update, WorkerStatusUpdate::ToolCall { tool } if tool == "bash"));
    }

    #[test]
    fn test_decode_messages() {
        let buffer = r#"{"type":"ping","id":"1","timestamp":"2025-01-01T00:00:00Z"}
{"type":"cancel","id":"2","timestamp":"2025-01-01T00:00:01Z"}"#;

        let messages: Vec<Result<CommanderMessage, _>> = decode_messages(buffer);
        assert_eq!(messages.len(), 2);
        assert!(messages[0].as_ref().unwrap().is_ping());
        assert!(messages[1].as_ref().unwrap().is_cancel());
    }

    #[test]
    fn test_log_levels() {
        let msg = WorkerMessage::log(LogLevel::Error, "Something went wrong");
        let json = encode(&msg).unwrap();
        assert!(json.contains("\"level\":\"error\""));
    }

    #[test]
    fn test_task_complete() {
        let result = crate::orchestrate::types::WorkerResult::success("Done!");
        let msg = WorkerMessage::task_complete(result);
        assert!(msg.is_task_complete());
        assert!(msg.is_terminal());
    }

    #[test]
    fn test_task_error() {
        let msg = WorkerMessage::task_error("Connection failed", true);
        assert!(msg.is_task_error());
        assert!(msg.is_terminal());
    }
}
