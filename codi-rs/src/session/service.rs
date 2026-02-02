// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Session service for managing conversation sessions.

use std::sync::Arc;
#[cfg(feature = "telemetry")]
use std::time::Instant;

use tokio::sync::Mutex;

use crate::error::ToolError;
use crate::types::Message;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::context::{
    apply_selection, estimate_messages_tokens, select_messages_to_keep, ContextConfig,
    ContextWindow, SelectionResult, SelectionStats, WorkingSet,
};
use super::storage::SessionStorage;
use super::types::{Session, SessionConfig, SessionInfo, SessionMessage};

/// Session service for managing conversations.
pub struct SessionService {
    storage: Arc<Mutex<SessionStorage>>,
    config: SessionConfig,
    context_config: ContextConfig,
}

impl SessionService {
    /// Create a new session service.
    pub fn new(project_root: &str) -> Result<Self, ToolError> {
        Self::with_config(project_root, SessionConfig::default(), ContextConfig::default())
    }

    /// Create with custom configuration.
    pub fn with_config(
        project_root: &str,
        config: SessionConfig,
        context_config: ContextConfig,
    ) -> Result<Self, ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let storage = SessionStorage::open(project_root)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.new", start.elapsed());

        Ok(Self {
            storage: Arc::new(Mutex::new(storage)),
            config,
            context_config,
        })
    }

    /// Create with a pre-configured storage (useful for testing).
    pub fn with_storage(storage: SessionStorage) -> Self {
        Self {
            storage: Arc::new(Mutex::new(storage)),
            config: SessionConfig::default(),
            context_config: ContextConfig::default(),
        }
    }

    /// Create a new session.
    pub async fn create(&self, title: String, project_path: String) -> Result<Session, ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let id = Session::generate_id();
        let session = Session::new(id, title, project_path);

        let storage = self.storage.lock().await;
        storage.create_session(&session)?;

        // Prune old sessions if needed
        storage.prune_sessions(self.config.max_sessions)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.create", start.elapsed());

        Ok(session)
    }

    /// Create a child session (for sub-agents).
    pub async fn create_child(
        &self,
        parent_id: &str,
        title: String,
        project_path: String,
    ) -> Result<Session, ToolError> {
        let id = format!("child-{}-{}", parent_id, uuid::Uuid::new_v4());
        let mut session = Session::new(id, title, project_path);
        session.parent_id = Some(parent_id.to_string());

        let storage = self.storage.lock().await;
        storage.create_session(&session)?;

        Ok(session)
    }

    /// Get a session by ID.
    pub async fn get(&self, id: &str) -> Result<Option<Session>, ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let storage = self.storage.lock().await;
        let result = storage.get_session(id)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.get", start.elapsed());

        Ok(result)
    }

    /// Save/update a session.
    pub async fn save(&self, session: &mut Session) -> Result<(), ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        session.touch();

        let storage = self.storage.lock().await;
        storage.update_session(session)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.save", start.elapsed());

        Ok(())
    }

    /// Delete a session.
    pub async fn delete(&self, id: &str) -> Result<bool, ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let storage = self.storage.lock().await;
        let deleted = storage.delete_session(id)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.delete", start.elapsed());

        Ok(deleted)
    }

    /// List all sessions.
    pub async fn list(&self) -> Result<Vec<SessionInfo>, ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let storage = self.storage.lock().await;
        let sessions = storage.list_sessions()?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.list", start.elapsed());

        Ok(sessions)
    }

    /// Search sessions by pattern.
    pub async fn search(&self, pattern: &str) -> Result<Vec<SessionInfo>, ToolError> {
        let storage = self.storage.lock().await;
        storage.search_sessions(pattern)
    }

    /// Add a message to a session.
    pub async fn add_message(&self, session_id: &str, message: &Message) -> Result<SessionMessage, ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let session_message = SessionMessage::from_message(session_id.to_string(), message);

        let storage = self.storage.lock().await;
        storage.add_message(&session_message)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.add_message", start.elapsed());

        Ok(session_message)
    }

    /// Get all messages for a session.
    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<Message>, ToolError> {
        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let storage = self.storage.lock().await;
        let session_messages = storage.get_messages(session_id)?;

        let messages: Vec<Message> = session_messages
            .iter()
            .map(SessionMessage::to_message)
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.service.get_messages", start.elapsed());

        Ok(messages)
    }

    /// Get message count for a session.
    pub async fn get_message_count(&self, session_id: &str) -> Result<u32, ToolError> {
        let storage = self.storage.lock().await;
        storage.get_message_count(session_id)
    }

    /// Check if context needs summarization.
    pub async fn needs_summarization(&self, session_id: &str) -> Result<bool, ToolError> {
        let messages = self.get_messages(session_id).await?;
        let token_count = estimate_messages_tokens(&messages);
        Ok(token_count >= self.context_config.summarization_threshold())
    }

    /// Select messages to keep and summarize.
    pub async fn select_for_windowing(
        &self,
        session_id: &str,
        working_set: &WorkingSet,
    ) -> Result<(SelectionResult, SelectionStats), ToolError> {
        let messages = self.get_messages(session_id).await?;
        let selection = select_messages_to_keep(&messages, &self.context_config, working_set);
        let stats = SelectionStats::from_selection(&messages, &selection, working_set);
        Ok((selection, stats))
    }

    /// Apply windowing to get the kept messages.
    pub async fn apply_windowing(
        &self,
        session_id: &str,
        working_set: &WorkingSet,
    ) -> Result<Vec<Message>, ToolError> {
        let messages = self.get_messages(session_id).await?;
        let selection = select_messages_to_keep(&messages, &self.context_config, working_set);
        Ok(apply_selection(&messages, &selection))
    }

    /// Get context window state for a session.
    pub async fn get_context_state(&self, session_id: &str) -> Result<ContextWindow, ToolError> {
        let messages = self.get_messages(session_id).await?;
        let mut window = ContextWindow::new(self.context_config.clone());
        window.update_token_count(&messages);
        Ok(window)
    }

    /// Update session usage stats.
    pub async fn update_usage(
        &self,
        session_id: &str,
        prompt_tokens: u64,
        completion_tokens: u64,
        cost: f64,
    ) -> Result<(), ToolError> {
        let storage = self.storage.lock().await;

        if let Some(mut session) = storage.get_session(session_id)? {
            session.add_usage(prompt_tokens, completion_tokens, cost);
            storage.update_session(&session)?;
        }

        Ok(())
    }

    /// Set session title.
    pub async fn set_title(&self, session_id: &str, title: String) -> Result<(), ToolError> {
        let storage = self.storage.lock().await;

        if let Some(mut session) = storage.get_session(session_id)? {
            session.title = title;
            session.touch();
            storage.update_session(&session)?;
        }

        Ok(())
    }

    /// Set session label.
    pub async fn set_label(&self, session_id: &str, label: Option<String>) -> Result<(), ToolError> {
        let storage = self.storage.lock().await;

        if let Some(mut session) = storage.get_session(session_id)? {
            session.label = label;
            session.touch();
            storage.update_session(&session)?;
        }

        Ok(())
    }

    /// Set conversation summary.
    pub async fn set_summary(&self, session_id: &str, summary: String) -> Result<(), ToolError> {
        let storage = self.storage.lock().await;

        if let Some(mut session) = storage.get_session(session_id)? {
            session.conversation_summary = Some(summary);
            session.touch();
            storage.update_session(&session)?;
        }

        Ok(())
    }

    /// Get the configuration.
    pub fn config(&self) -> &SessionConfig {
        &self.config
    }

    /// Get the context configuration.
    pub fn context_config(&self) -> &ContextConfig {
        &self.context_config
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn create_test_service() -> (SessionService, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("sessions.db");
        let storage = SessionStorage::open_at(&db_path).unwrap();
        let service = SessionService::with_storage(storage);
        (service, temp_dir)
    }

    #[tokio::test]
    async fn test_create_and_get_session() {
        let (service, _temp) = create_test_service().await;

        let session = service
            .create("Test Session".to_string(), "/path/to/project".to_string())
            .await
            .unwrap();

        assert!(!session.id.is_empty());
        assert_eq!(session.title, "Test Session");

        let retrieved = service.get(&session.id).await.unwrap().unwrap();
        assert_eq!(retrieved.id, session.id);
    }

    #[tokio::test]
    async fn test_save_session() {
        let (service, _temp) = create_test_service().await;

        let mut session = service
            .create("Original".to_string(), "/path".to_string())
            .await
            .unwrap();

        session.title = "Updated".to_string();
        service.save(&mut session).await.unwrap();

        let retrieved = service.get(&session.id).await.unwrap().unwrap();
        assert_eq!(retrieved.title, "Updated");
    }

    #[tokio::test]
    async fn test_list_sessions() {
        let (service, _temp) = create_test_service().await;

        for i in 0..3 {
            service
                .create(format!("Session {}", i), "/path".to_string())
                .await
                .unwrap();
        }

        let sessions = service.list().await.unwrap();
        assert_eq!(sessions.len(), 3);
    }

    #[tokio::test]
    async fn test_delete_session() {
        let (service, _temp) = create_test_service().await;

        let session = service
            .create("Delete Me".to_string(), "/path".to_string())
            .await
            .unwrap();

        assert!(service.get(&session.id).await.unwrap().is_some());

        let deleted = service.delete(&session.id).await.unwrap();
        assert!(deleted);

        assert!(service.get(&session.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_add_and_get_messages() {
        let (service, _temp) = create_test_service().await;

        let session = service
            .create("Message Test".to_string(), "/path".to_string())
            .await
            .unwrap();

        let msg1 = Message::user("Hello");
        service.add_message(&session.id, &msg1).await.unwrap();

        let msg2 = Message::assistant("Hi there!");
        service.add_message(&session.id, &msg2).await.unwrap();

        let messages = service.get_messages(&session.id).await.unwrap();
        assert_eq!(messages.len(), 2);
    }

    #[tokio::test]
    async fn test_search_sessions() {
        let (service, _temp) = create_test_service().await;

        service
            .create("Rust Project".to_string(), "/rust".to_string())
            .await
            .unwrap();
        service
            .create("Python Project".to_string(), "/python".to_string())
            .await
            .unwrap();

        let results = service.search("rust").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Rust Project");
    }

    #[tokio::test]
    async fn test_update_usage() {
        let (service, _temp) = create_test_service().await;

        let session = service
            .create("Usage Test".to_string(), "/path".to_string())
            .await
            .unwrap();

        service
            .update_usage(&session.id, 100, 50, 0.01)
            .await
            .unwrap();

        let retrieved = service.get(&session.id).await.unwrap().unwrap();
        assert_eq!(retrieved.prompt_tokens, 100);
        assert_eq!(retrieved.completion_tokens, 50);
        assert!((retrieved.cost - 0.01).abs() < 0.001);
    }

    #[tokio::test]
    async fn test_set_label() {
        let (service, _temp) = create_test_service().await;

        let session = service
            .create("Label Test".to_string(), "/path".to_string())
            .await
            .unwrap();

        service
            .set_label(&session.id, Some("My Label".to_string()))
            .await
            .unwrap();

        let retrieved = service.get(&session.id).await.unwrap().unwrap();
        assert_eq!(retrieved.label, Some("My Label".to_string()));
    }

    #[tokio::test]
    async fn test_context_state() {
        let (service, _temp) = create_test_service().await;

        let session = service
            .create("Context Test".to_string(), "/path".to_string())
            .await
            .unwrap();

        // Add some messages
        for i in 0..5 {
            let msg = Message::user(&format!("Message {}", i));
            service.add_message(&session.id, &msg).await.unwrap();
        }

        let state = service.get_context_state(&session.id).await.unwrap();
        assert!(state.token_count > 0);
        assert!(!state.needs_summarization()); // Should not need summarization with 5 messages
    }
}
