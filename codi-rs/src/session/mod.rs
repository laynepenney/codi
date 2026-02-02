// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Session management for conversation persistence and context windowing.
//!
//! This module provides a complete session system for managing AI conversations:
//!
//! - **Types**: Session, SessionMessage, SessionInfo, Todo
//! - **Storage**: SQLite-based persistence with efficient queries
//! - **Context**: Token counting, context windowing, working set tracking
//! - **Service**: High-level API for session operations
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    SessionService                            │
//! │  (High-level API: create, save, list, get_messages, etc.)   │
//! └─────────────────────────────────────────────────────────────┘
//!                            │
//!          ┌─────────────────┼─────────────────┐
//!          ▼                 ▼                 ▼
//! ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
//! │  SessionStorage │ │ ContextWindow│ │  WorkingSet    │
//! │   (SQLite DB)   │ │   (Tokens)   │ │  (Files/Entities)│
//! └─────────────────┘ └─────────────┘ └─────────────────┘
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::session::{SessionService, WorkingSet};
//! use codi::types::Message;
//!
//! // Create service
//! let service = SessionService::new("/path/to/project").await?;
//!
//! // Create a session
//! let session = service.create("My Session".to_string(), "/project".to_string()).await?;
//!
//! // Add messages
//! let msg = Message::user("Hello!");
//! service.add_message(&session.id, &msg).await?;
//!
//! // Get messages with context windowing
//! let working_set = WorkingSet::new();
//! let messages = service.apply_windowing(&session.id, &working_set).await?;
//!
//! // Check context state
//! let state = service.get_context_state(&session.id).await?;
//! if state.needs_summarization() {
//!     println!("Context is getting full, consider summarizing");
//! }
//! ```

pub mod context;
pub mod service;
pub mod storage;
pub mod types;

// Re-export commonly used types
pub use context::{
    apply_selection, estimate_message_tokens, estimate_messages_tokens, estimate_text_tokens,
    find_safe_start_index, get_message_text, has_tool_result_blocks, has_tool_use_blocks,
    select_messages_to_keep, ContextConfig, ContextWindow, SelectionResult, SelectionStats,
    WorkingSet,
};
pub use service::SessionService;
pub use storage::{SessionStorage, SCHEMA_VERSION};
pub use types::{
    Session, SessionConfig, SessionId, SessionInfo, SessionMessage, Todo, TodoStatus,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        // Verify key types are accessible
        let _config = SessionConfig::default();
        let _ctx_config = ContextConfig::default();
        let _ws = WorkingSet::new();
    }
}
