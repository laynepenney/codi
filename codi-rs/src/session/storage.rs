// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! SQLite-based session storage.

use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::ToolError;
use crate::types::ContentBlock;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::types::{Session, SessionInfo, SessionMessage, Todo};

/// Current schema version.
pub const SCHEMA_VERSION: u32 = 1;

/// Session storage using SQLite.
pub struct SessionStorage {
    conn: Connection,
    path: PathBuf,
}

impl SessionStorage {
    /// Open or create a session database.
    pub fn open(project_root: &str) -> Result<Self, ToolError> {
        let start = Instant::now();

        let codi_dir = get_sessions_directory(project_root)?;
        std::fs::create_dir_all(&codi_dir).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to create sessions directory: {}", e))
        })?;

        let db_path = codi_dir.join("sessions.db");
        let result = Self::open_at(&db_path)?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.open", start.elapsed());

        Ok(result)
    }

    /// Open or create a session database at a specific path.
    ///
    /// This is useful for testing or when you want to use a custom location.
    pub fn open_at(db_path: &Path) -> Result<Self, ToolError> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to create directory: {}", e))
            })?;
        }

        let conn = Connection::open(db_path).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to open sessions database: {}", e))
        })?;

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to set pragmas: {}", e)))?;

        let mut storage = Self {
            conn,
            path: db_path.to_path_buf(),
        };

        storage.init_schema()?;

        Ok(storage)
    }

    /// Initialize the database schema.
    fn init_schema(&mut self) -> Result<(), ToolError> {
        let start = Instant::now();

        self.conn
            .execute_batch(
                r#"
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                title TEXT NOT NULL,
                label TEXT,
                project_path TEXT NOT NULL,
                project_name TEXT,
                provider TEXT,
                model TEXT,
                prompt_tokens INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                cost REAL DEFAULT 0.0,
                summary_message_id TEXT,
                conversation_summary TEXT,
                todos TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (parent_id) REFERENCES sessions(id)
            );

            CREATE TABLE IF NOT EXISTS session_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model TEXT,
                provider TEXT,
                is_summary INTEGER DEFAULT 0,
                token_count INTEGER,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
            CREATE INDEX IF NOT EXISTS idx_messages_session_id ON session_messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_messages_created_at ON session_messages(session_id, created_at);
            "#,
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to create schema: {}", e)))?;

        // Check and update schema version
        let current_version: Option<u32> = self
            .conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to get schema version: {}", e)))?;

        if current_version.is_none() {
            self.conn
                .execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    params![SCHEMA_VERSION],
                )
                .map_err(|e| {
                    ToolError::ExecutionFailed(format!("Failed to set schema version: {}", e))
                })?;
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.init_schema", start.elapsed());

        Ok(())
    }

    /// Create a new session.
    pub fn create_session(&self, session: &Session) -> Result<(), ToolError> {
        let start = Instant::now();

        let todos_json = serde_json::to_string(&session.todos).unwrap_or_default();

        self.conn
            .execute(
                r#"
            INSERT INTO sessions (
                id, parent_id, title, label, project_path, project_name,
                provider, model, prompt_tokens, completion_tokens, cost,
                summary_message_id, conversation_summary, todos, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
                params![
                    session.id,
                    session.parent_id,
                    session.title,
                    session.label,
                    session.project_path,
                    session.project_name,
                    session.provider,
                    session.model,
                    session.prompt_tokens as i64,
                    session.completion_tokens as i64,
                    session.cost,
                    session.summary_message_id,
                    session.conversation_summary,
                    todos_json,
                    session.created_at,
                    session.updated_at,
                ],
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to create session: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.create", start.elapsed());

        Ok(())
    }

    /// Update an existing session.
    pub fn update_session(&self, session: &Session) -> Result<(), ToolError> {
        let start = Instant::now();

        let todos_json = serde_json::to_string(&session.todos).unwrap_or_default();

        self.conn
            .execute(
                r#"
            UPDATE sessions SET
                parent_id = ?, title = ?, label = ?, project_path = ?, project_name = ?,
                provider = ?, model = ?, prompt_tokens = ?, completion_tokens = ?, cost = ?,
                summary_message_id = ?, conversation_summary = ?, todos = ?, updated_at = ?
            WHERE id = ?
            "#,
                params![
                    session.parent_id,
                    session.title,
                    session.label,
                    session.project_path,
                    session.project_name,
                    session.provider,
                    session.model,
                    session.prompt_tokens as i64,
                    session.completion_tokens as i64,
                    session.cost,
                    session.summary_message_id,
                    session.conversation_summary,
                    todos_json,
                    session.updated_at,
                    session.id,
                ],
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to update session: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.update", start.elapsed());

        Ok(())
    }

    /// Get a session by ID.
    pub fn get_session(&self, id: &str) -> Result<Option<Session>, ToolError> {
        let start = Instant::now();

        let result = self
            .conn
            .query_row(
                r#"
            SELECT id, parent_id, title, label, project_path, project_name,
                   provider, model, prompt_tokens, completion_tokens, cost,
                   summary_message_id, conversation_summary, todos, created_at, updated_at
            FROM sessions WHERE id = ?
            "#,
                params![id],
                |row| {
                    let todos_json: String = row.get(13)?;
                    let todos: Vec<Todo> =
                        serde_json::from_str(&todos_json).unwrap_or_default();

                    Ok(Session {
                        id: row.get(0)?,
                        parent_id: row.get(1)?,
                        title: row.get(2)?,
                        label: row.get(3)?,
                        project_path: row.get(4)?,
                        project_name: row.get(5)?,
                        provider: row.get(6)?,
                        model: row.get(7)?,
                        prompt_tokens: row.get::<_, i64>(8)? as u64,
                        completion_tokens: row.get::<_, i64>(9)? as u64,
                        cost: row.get(10)?,
                        summary_message_id: row.get(11)?,
                        conversation_summary: row.get(12)?,
                        todos,
                        created_at: row.get(14)?,
                        updated_at: row.get(15)?,
                    })
                },
            )
            .optional()
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to get session: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.get", start.elapsed());

        Ok(result)
    }

    /// Delete a session and its messages.
    pub fn delete_session(&self, id: &str) -> Result<bool, ToolError> {
        let start = Instant::now();

        // Messages are deleted via CASCADE
        let rows = self
            .conn
            .execute("DELETE FROM sessions WHERE id = ?", params![id])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to delete session: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.delete", start.elapsed());

        Ok(rows > 0)
    }

    /// List all sessions.
    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, ToolError> {
        let start = Instant::now();

        let mut stmt = self
            .conn
            .prepare(
                r#"
            SELECT s.id, s.title, s.label, s.project_path, s.project_name,
                   s.provider, s.model, s.prompt_tokens, s.completion_tokens, s.cost,
                   s.summary_message_id, s.created_at, s.updated_at,
                   (SELECT COUNT(*) FROM session_messages WHERE session_id = s.id) as message_count
            FROM sessions s
            ORDER BY s.updated_at DESC
            "#,
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare query: {}", e)))?;

        let sessions = stmt
            .query_map([], |row| {
                let prompt_tokens: i64 = row.get(7)?;
                let completion_tokens: i64 = row.get(8)?;
                let summary_id: Option<String> = row.get(10)?;

                Ok(SessionInfo {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    label: row.get(2)?,
                    project_path: row.get(3)?,
                    project_name: row.get(4)?,
                    provider: row.get(5)?,
                    model: row.get(6)?,
                    total_tokens: (prompt_tokens + completion_tokens) as u64,
                    cost: row.get(9)?,
                    has_summary: summary_id.is_some(),
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                    message_count: row.get(13)?,
                })
            })
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to query sessions: {}", e)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to collect sessions: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.list", start.elapsed());

        Ok(sessions)
    }

    /// Search sessions by pattern.
    pub fn search_sessions(&self, pattern: &str) -> Result<Vec<SessionInfo>, ToolError> {
        let pattern = format!("%{}%", pattern.to_lowercase());

        let mut stmt = self
            .conn
            .prepare(
                r#"
            SELECT s.id, s.title, s.label, s.project_path, s.project_name,
                   s.provider, s.model, s.prompt_tokens, s.completion_tokens, s.cost,
                   s.summary_message_id, s.created_at, s.updated_at,
                   (SELECT COUNT(*) FROM session_messages WHERE session_id = s.id) as message_count
            FROM sessions s
            WHERE LOWER(s.title) LIKE ?
               OR LOWER(s.label) LIKE ?
               OR LOWER(s.project_name) LIKE ?
               OR LOWER(s.project_path) LIKE ?
            ORDER BY s.updated_at DESC
            "#,
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare query: {}", e)))?;

        let sessions = stmt
            .query_map(params![&pattern, &pattern, &pattern, &pattern], |row| {
                let prompt_tokens: i64 = row.get(7)?;
                let completion_tokens: i64 = row.get(8)?;
                let summary_id: Option<String> = row.get(10)?;

                Ok(SessionInfo {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    label: row.get(2)?,
                    project_path: row.get(3)?,
                    project_name: row.get(4)?,
                    provider: row.get(5)?,
                    model: row.get(6)?,
                    total_tokens: (prompt_tokens + completion_tokens) as u64,
                    cost: row.get(9)?,
                    has_summary: summary_id.is_some(),
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                    message_count: row.get(13)?,
                })
            })
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to search sessions: {}", e)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to collect search results: {}", e))
            })?;

        Ok(sessions)
    }

    /// Add a message to a session.
    pub fn add_message(&self, message: &SessionMessage) -> Result<(), ToolError> {
        let start = Instant::now();

        let content_json = serde_json::to_string(&message.content).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to serialize message content: {}", e))
        })?;

        let role_str = match message.role {
            crate::types::Role::User => "user",
            crate::types::Role::Assistant => "assistant",
            crate::types::Role::System => "system",
        };

        self.conn
            .execute(
                r#"
            INSERT INTO session_messages (
                id, session_id, role, content, model, provider, is_summary, token_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
                params![
                    message.id,
                    message.session_id,
                    role_str,
                    content_json,
                    message.model,
                    message.provider,
                    message.is_summary as i32,
                    message.token_count.map(|t| t as i32),
                    message.created_at,
                ],
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to add message: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.add_message", start.elapsed());

        Ok(())
    }

    /// Get all messages for a session.
    pub fn get_messages(&self, session_id: &str) -> Result<Vec<SessionMessage>, ToolError> {
        let start = Instant::now();

        let mut stmt = self
            .conn
            .prepare(
                r#"
            SELECT id, session_id, role, content, model, provider, is_summary, token_count, created_at
            FROM session_messages
            WHERE session_id = ?
            ORDER BY created_at ASC
            "#,
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare query: {}", e)))?;

        let messages = stmt
            .query_map(params![session_id], |row| {
                let role_str: String = row.get(2)?;
                let content_json: String = row.get(3)?;
                let is_summary: i32 = row.get(6)?;
                let token_count: Option<i32> = row.get(7)?;

                let role = match role_str.as_str() {
                    "user" => crate::types::Role::User,
                    "assistant" => crate::types::Role::Assistant,
                    _ => crate::types::Role::User,
                };

                let content: Vec<ContentBlock> =
                    serde_json::from_str(&content_json).unwrap_or_default();

                Ok(SessionMessage {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role,
                    content,
                    model: row.get(4)?,
                    provider: row.get(5)?,
                    is_summary: is_summary != 0,
                    token_count: token_count.map(|t| t as u32),
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to get messages: {}", e)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to collect messages: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.get_messages", start.elapsed());

        Ok(messages)
    }

    /// Get message count for a session.
    pub fn get_message_count(&self, session_id: &str) -> Result<u32, ToolError> {
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM session_messages WHERE session_id = ?",
                params![session_id],
                |row| row.get(0),
            )
            .map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to get message count: {}", e))
            })?;

        Ok(count as u32)
    }

    /// Delete messages after a certain index (for truncation).
    pub fn delete_messages_after(
        &self,
        session_id: &str,
        after_timestamp: i64,
    ) -> Result<u32, ToolError> {
        let rows = self
            .conn
            .execute(
                "DELETE FROM session_messages WHERE session_id = ? AND created_at > ?",
                params![session_id, after_timestamp],
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to delete messages: {}", e)))?;

        Ok(rows as u32)
    }

    /// Prune old sessions if we exceed the limit.
    pub fn prune_sessions(&self, max_sessions: usize) -> Result<u32, ToolError> {
        let start = Instant::now();

        // Get count of sessions
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to count sessions: {}", e)))?;

        if count as usize <= max_sessions {
            return Ok(0);
        }

        let to_delete = count as usize - max_sessions;

        // Delete oldest sessions (excluding parent sessions with active children)
        let deleted = self
            .conn
            .execute(
                r#"
            DELETE FROM sessions WHERE id IN (
                SELECT id FROM sessions
                WHERE id NOT IN (SELECT DISTINCT parent_id FROM sessions WHERE parent_id IS NOT NULL)
                ORDER BY updated_at ASC
                LIMIT ?
            )
            "#,
                params![to_delete as i64],
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to prune sessions: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("session.storage.prune", start.elapsed());

        Ok(deleted as u32)
    }

    /// Get the database path.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Get the sessions directory for a project.
fn get_sessions_directory(_project_root: &str) -> Result<PathBuf, ToolError> {
    let home = dirs::home_dir().ok_or_else(|| {
        ToolError::ExecutionFailed("Could not determine home directory".to_string())
    })?;

    Ok(home.join(".codi").join("sessions"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_storage() -> (SessionStorage, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        // Override the sessions directory for testing
        let db_path = temp_dir.path().join("sessions.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();

        let mut storage = SessionStorage {
            conn,
            path: db_path,
        };
        storage.init_schema().unwrap();

        (storage, temp_dir)
    }

    #[test]
    fn test_create_and_get_session() {
        let (storage, _temp) = create_test_storage();

        let session = Session::new(
            "test-session-1".to_string(),
            "Test Session".to_string(),
            "/path/to/project".to_string(),
        );

        storage.create_session(&session).unwrap();

        let retrieved = storage.get_session("test-session-1").unwrap().unwrap();
        assert_eq!(retrieved.id, "test-session-1");
        assert_eq!(retrieved.title, "Test Session");
    }

    #[test]
    fn test_update_session() {
        let (storage, _temp) = create_test_storage();

        let mut session = Session::new(
            "test-update".to_string(),
            "Original Title".to_string(),
            "/path".to_string(),
        );
        storage.create_session(&session).unwrap();

        session.title = "Updated Title".to_string();
        session.add_usage(100, 50, 0.01);
        storage.update_session(&session).unwrap();

        let retrieved = storage.get_session("test-update").unwrap().unwrap();
        assert_eq!(retrieved.title, "Updated Title");
        assert_eq!(retrieved.prompt_tokens, 100);
        assert_eq!(retrieved.completion_tokens, 50);
    }

    #[test]
    fn test_list_sessions() {
        let (storage, _temp) = create_test_storage();

        for i in 0..3 {
            let session = Session::new(
                format!("session-{}", i),
                format!("Session {}", i),
                "/path".to_string(),
            );
            storage.create_session(&session).unwrap();
        }

        let sessions = storage.list_sessions().unwrap();
        assert_eq!(sessions.len(), 3);
    }

    #[test]
    fn test_delete_session() {
        let (storage, _temp) = create_test_storage();

        let session = Session::new("to-delete".to_string(), "Delete Me".to_string(), "/path".to_string());
        storage.create_session(&session).unwrap();

        assert!(storage.get_session("to-delete").unwrap().is_some());

        let deleted = storage.delete_session("to-delete").unwrap();
        assert!(deleted);

        assert!(storage.get_session("to-delete").unwrap().is_none());
    }

    #[test]
    fn test_add_and_get_messages() {
        let (storage, _temp) = create_test_storage();

        let session = Session::new("msg-test".to_string(), "Message Test".to_string(), "/path".to_string());
        storage.create_session(&session).unwrap();

        let msg1 = SessionMessage::new(
            "msg-test".to_string(),
            crate::types::Role::User,
            vec![ContentBlock::text("Hello")],
        );
        storage.add_message(&msg1).unwrap();

        let msg2 = SessionMessage::new(
            "msg-test".to_string(),
            crate::types::Role::Assistant,
            vec![ContentBlock::text("Hi there!")],
        );
        storage.add_message(&msg2).unwrap();

        let messages = storage.get_messages("msg-test").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, crate::types::Role::User);
        assert_eq!(messages[1].role, crate::types::Role::Assistant);
    }

    #[test]
    fn test_search_sessions() {
        let (storage, _temp) = create_test_storage();

        let mut session = Session::new("search-1".to_string(), "Rust Project".to_string(), "/path".to_string());
        session.project_name = Some("myproject".to_string());
        storage.create_session(&session).unwrap();

        let session2 = Session::new("search-2".to_string(), "Python Project".to_string(), "/path".to_string());
        storage.create_session(&session2).unwrap();

        let results = storage.search_sessions("rust").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Rust Project");

        let results = storage.search_sessions("myproject").unwrap();
        assert_eq!(results.len(), 1);
    }
}
