// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Session types for conversation persistence and management.

use serde::{Deserialize, Serialize};

use crate::types::{ContentBlock, Message, Role};

/// Session identifier.
pub type SessionId = String;

/// A saved conversation session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Unique session identifier.
    pub id: SessionId,
    /// Optional parent session ID (for sub-sessions).
    pub parent_id: Option<SessionId>,
    /// Session title (auto-generated or user-defined).
    pub title: String,
    /// Optional user-defined label.
    pub label: Option<String>,
    /// Project path where session was created.
    pub project_path: String,
    /// Project name.
    pub project_name: Option<String>,
    /// Provider used.
    pub provider: Option<String>,
    /// Model used.
    pub model: Option<String>,
    /// Total prompt tokens used.
    pub prompt_tokens: u64,
    /// Total completion tokens used.
    pub completion_tokens: u64,
    /// Total cost in USD.
    pub cost: f64,
    /// ID of the summary message (for context windowing).
    pub summary_message_id: Option<String>,
    /// Current conversation summary (if compacted).
    pub conversation_summary: Option<String>,
    /// Todo items tracked in this session.
    pub todos: Vec<Todo>,
    /// Creation timestamp (Unix epoch seconds).
    pub created_at: i64,
    /// Last update timestamp (Unix epoch seconds).
    pub updated_at: i64,
}

impl Session {
    /// Create a new session with default values.
    pub fn new(id: SessionId, title: String, project_path: String) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id,
            parent_id: None,
            title,
            label: None,
            project_path,
            project_name: None,
            provider: None,
            model: None,
            prompt_tokens: 0,
            completion_tokens: 0,
            cost: 0.0,
            summary_message_id: None,
            conversation_summary: None,
            todos: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    /// Generate a unique session ID based on timestamp and UUID.
    pub fn generate_id() -> SessionId {
        let now = chrono::Utc::now();
        let short_uuid = &uuid::Uuid::new_v4().to_string()[..8];
        format!("session-{}-{}", now.format("%Y-%m-%d-%H-%M-%S"), short_uuid)
    }

    /// Update the session's updated_at timestamp.
    pub fn touch(&mut self) {
        self.updated_at = chrono::Utc::now().timestamp();
    }

    /// Add token usage to the session.
    pub fn add_usage(&mut self, prompt_tokens: u64, completion_tokens: u64, cost: f64) {
        self.prompt_tokens += prompt_tokens;
        self.completion_tokens += completion_tokens;
        self.cost += cost;
        self.touch();
    }

    /// Get total tokens used.
    pub fn total_tokens(&self) -> u64 {
        self.prompt_tokens + self.completion_tokens
    }
}

/// Session metadata for listing (without full message history).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    /// Session ID.
    pub id: SessionId,
    /// Session title.
    pub title: String,
    /// Optional label.
    pub label: Option<String>,
    /// Project path.
    pub project_path: String,
    /// Project name.
    pub project_name: Option<String>,
    /// Provider used.
    pub provider: Option<String>,
    /// Model used.
    pub model: Option<String>,
    /// Number of messages.
    pub message_count: u32,
    /// Whether the session has a summary.
    pub has_summary: bool,
    /// Total tokens used.
    pub total_tokens: u64,
    /// Total cost.
    pub cost: f64,
    /// Creation timestamp.
    pub created_at: i64,
    /// Last update timestamp.
    pub updated_at: i64,
}

impl SessionInfo {
    /// Format the session info for display.
    pub fn format(&self) -> String {
        let date = chrono::DateTime::from_timestamp(self.updated_at, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let mut display = self.title.clone();
        if let Some(ref label) = self.label {
            display.push_str(&format!(": \"{}\"", label));
        }
        display.push_str(&format!(" ({} msgs", self.message_count));
        if self.has_summary {
            display.push_str(", summarized");
        }
        display.push(')');
        display.push_str(&format!(" - {}", date));

        if let Some(ref name) = self.project_name {
            display.push_str(&format!(" [{}]", name));
        }

        display
    }
}

/// A message stored in a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
    /// Unique message ID.
    pub id: String,
    /// Session this message belongs to.
    pub session_id: SessionId,
    /// Message role.
    pub role: Role,
    /// Message content blocks.
    pub content: Vec<ContentBlock>,
    /// Optional model that generated this message.
    pub model: Option<String>,
    /// Optional provider.
    pub provider: Option<String>,
    /// Whether this is a summary message.
    pub is_summary: bool,
    /// Token count for this message.
    pub token_count: Option<u32>,
    /// Creation timestamp.
    pub created_at: i64,
}

impl SessionMessage {
    /// Create a new session message.
    pub fn new(session_id: SessionId, role: Role, content: Vec<ContentBlock>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            session_id,
            role,
            content,
            model: None,
            provider: None,
            is_summary: false,
            token_count: None,
            created_at: chrono::Utc::now().timestamp(),
        }
    }

    /// Convert to a Message for API calls.
    pub fn to_message(&self) -> Message {
        Message {
            role: self.role,
            content: crate::types::MessageContent::Blocks(self.content.clone()),
        }
    }

    /// Create from a Message.
    pub fn from_message(session_id: SessionId, message: &Message) -> Self {
        let content = match &message.content {
            crate::types::MessageContent::Text(text) => {
                vec![ContentBlock::text(text.clone())]
            }
            crate::types::MessageContent::Blocks(blocks) => blocks.clone(),
        };

        Self::new(session_id, message.role, content)
    }
}

/// Todo item tracked in a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    /// Todo content/description.
    pub content: String,
    /// Current status.
    pub status: TodoStatus,
    /// Active form for display (e.g., "Running tests...").
    pub active_form: Option<String>,
}

impl Todo {
    /// Create a new pending todo.
    pub fn new(content: String) -> Self {
        Self {
            content,
            status: TodoStatus::Pending,
            active_form: None,
        }
    }
}

/// Status of a todo item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    /// Not started.
    Pending,
    /// Currently in progress.
    InProgress,
    /// Completed.
    Completed,
}

impl std::fmt::Display for TodoStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::InProgress => write!(f, "in_progress"),
            Self::Completed => write!(f, "completed"),
        }
    }
}

/// Configuration for session management.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    /// Maximum sessions to keep (oldest are pruned).
    pub max_sessions: usize,
    /// Whether to auto-save sessions.
    pub auto_save: bool,
    /// Auto-save interval in seconds.
    pub auto_save_interval_secs: u64,
    /// Whether to generate titles automatically.
    pub auto_generate_titles: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            max_sessions: 100,
            auto_save: true,
            auto_save_interval_secs: 30,
            auto_generate_titles: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_new() {
        let session = Session::new(
            "test-id".to_string(),
            "Test Session".to_string(),
            "/path/to/project".to_string(),
        );

        assert_eq!(session.id, "test-id");
        assert_eq!(session.title, "Test Session");
        assert_eq!(session.project_path, "/path/to/project");
        assert!(session.created_at > 0);
        assert_eq!(session.created_at, session.updated_at);
    }

    #[test]
    fn test_session_generate_id() {
        let id = Session::generate_id();
        assert!(id.starts_with("session-"));
    }

    #[test]
    fn test_session_add_usage() {
        let mut session = Session::new(
            "test".to_string(),
            "Test".to_string(),
            "/path".to_string(),
        );

        session.add_usage(100, 50, 0.001);
        assert_eq!(session.prompt_tokens, 100);
        assert_eq!(session.completion_tokens, 50);
        assert!((session.cost - 0.001).abs() < 0.0001);

        session.add_usage(200, 100, 0.002);
        assert_eq!(session.prompt_tokens, 300);
        assert_eq!(session.completion_tokens, 150);
        assert_eq!(session.total_tokens(), 450);
    }

    #[test]
    fn test_session_info_format() {
        let info = SessionInfo {
            id: "test".to_string(),
            title: "Test Session".to_string(),
            label: Some("My Label".to_string()),
            project_path: "/path".to_string(),
            project_name: Some("myproject".to_string()),
            provider: Some("anthropic".to_string()),
            model: Some("claude-3".to_string()),
            message_count: 10,
            has_summary: true,
            total_tokens: 1000,
            cost: 0.01,
            created_at: 0,
            updated_at: 0,
        };

        let formatted = info.format();
        assert!(formatted.contains("Test Session"));
        assert!(formatted.contains("My Label"));
        assert!(formatted.contains("10 msgs"));
        assert!(formatted.contains("summarized"));
        assert!(formatted.contains("[myproject]"));
    }

    #[test]
    fn test_todo_status() {
        let todo = Todo::new("Write tests".to_string());
        assert_eq!(todo.status, TodoStatus::Pending);
        assert_eq!(todo.status.to_string(), "pending");
    }
}
