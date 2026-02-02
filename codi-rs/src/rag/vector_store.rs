// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Vector store for RAG embeddings.
//!
//! Uses SQLite for metadata storage and vector similarity search.

use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::types::{ChunkType, CodeChunk, IndexStats, RetrievalResult};

/// Version of the vector store format.
pub const VECTOR_STORE_VERSION: &str = "1.0.0";

/// Get the RAG index directory for a project.
pub fn get_rag_directory(project_root: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(project_root.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let hash_short = &hash[..8];

    let project_name = Path::new(project_root)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codi")
        .join("rag-index")
        .join(format!("{}-{}", project_name, hash_short))
}

/// Vector store for RAG embeddings.
pub struct VectorStore {
    conn: Connection,
    index_dir: PathBuf,
    db_path: PathBuf,
    project_root: String,
    embedding_dimensions: usize,
}

impl VectorStore {
    /// Open or create a vector store for the given project.
    pub fn open(project_root: &str, embedding_dimensions: usize) -> Result<Self, ToolError> {
        let start = Instant::now();

        let index_dir = get_rag_directory(project_root);
        let db_path = index_dir.join("vectors.db");

        // Ensure directory exists
        std::fs::create_dir_all(&index_dir).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to create index directory: {}", e))
        })?;

        // Open database
        let conn = Connection::open(&db_path).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to open database: {}", e))
        })?;

        // Set pragmas for performance
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA cache_size = -64000;"
        ).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to set pragmas: {}", e))
        })?;

        let mut store = Self {
            conn,
            index_dir,
            db_path,
            project_root: project_root.to_string(),
            embedding_dimensions,
        };

        // Initialize schema if needed
        store.initialize_schema()?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.open", start.elapsed());

        Ok(store)
    }

    /// Get the database path.
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// Get the index directory.
    pub fn index_dir(&self) -> &Path {
        &self.index_dir
    }

    /// Initialize the database schema.
    fn initialize_schema(&mut self) -> Result<(), ToolError> {
        let start = Instant::now();

        let table_exists: bool = self.conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks'",
                [],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| ToolError::ExecutionFailed(format!("Schema check failed: {}", e)))?
            .unwrap_or(false);

        if !table_exists {
            self.create_schema()?;
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.init_schema", start.elapsed());

        Ok(())
    }

    /// Create the database schema.
    fn create_schema(&self) -> Result<(), ToolError> {
        self.conn.execute_batch(r#"
            -- Chunks table with metadata
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                language TEXT NOT NULL,
                chunk_type TEXT NOT NULL,
                name TEXT,
                content TEXT NOT NULL,
                embedding BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Files table for tracking indexed files
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                hash TEXT NOT NULL,
                last_indexed TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Metadata table
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
            CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
            CREATE INDEX IF NOT EXISTS idx_chunks_language ON chunks(language);
        "#).map_err(|e| ToolError::ExecutionFailed(format!("Failed to create schema: {}", e)))?;

        // Insert metadata
        self.conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('version', ?1)",
            params![VECTOR_STORE_VERSION],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to set version: {}", e)))?;

        self.conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('dimensions', ?1)",
            params![self.embedding_dimensions.to_string()],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to set dimensions: {}", e)))?;

        Ok(())
    }

    /// Insert or update a chunk with its embedding.
    pub fn upsert(&self, chunk: &CodeChunk, embedding: &[f32]) -> Result<(), ToolError> {
        let start = Instant::now();

        // Serialize embedding to bytes
        let embedding_bytes = Self::serialize_embedding(embedding);

        self.conn.execute(
            "INSERT OR REPLACE INTO chunks
             (id, file_path, relative_path, start_line, end_line, language, chunk_type, name, content, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                chunk.id,
                chunk.file_path,
                chunk.relative_path,
                chunk.start_line,
                chunk.end_line,
                chunk.language,
                chunk.chunk_type.as_str(),
                chunk.name,
                chunk.content,
                embedding_bytes,
            ],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to upsert chunk: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.upsert", start.elapsed());

        Ok(())
    }

    /// Batch insert chunks with embeddings.
    pub fn batch_upsert(&self, chunks: &[CodeChunk], embeddings: &[Vec<f32>]) -> Result<(), ToolError> {
        let start = Instant::now();

        if chunks.len() != embeddings.len() {
            return Err(ToolError::InvalidInput(
                "Chunks and embeddings length mismatch".to_string(),
            ));
        }

        // Use a transaction for batch insert
        self.conn.execute("BEGIN TRANSACTION", [])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to begin transaction: {}", e)))?;

        let mut stmt = self.conn.prepare(
            "INSERT OR REPLACE INTO chunks
             (id, file_path, relative_path, start_line, end_line, language, chunk_type, name, content, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare statement: {}", e)))?;

        for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
            let embedding_bytes = Self::serialize_embedding(embedding);
            stmt.execute(params![
                chunk.id,
                chunk.file_path,
                chunk.relative_path,
                chunk.start_line,
                chunk.end_line,
                chunk.language,
                chunk.chunk_type.as_str(),
                chunk.name,
                chunk.content,
                embedding_bytes,
            ]).map_err(|e| {
                let _ = self.conn.execute("ROLLBACK", []);
                ToolError::ExecutionFailed(format!("Failed to insert chunk: {}", e))
            })?;
        }

        self.conn.execute("COMMIT", [])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to commit transaction: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.batch_upsert", start.elapsed());

        Ok(())
    }

    /// Query for similar chunks.
    pub fn query(
        &self,
        embedding: &[f32],
        top_k: usize,
        min_score: f32,
    ) -> Result<Vec<RetrievalResult>, ToolError> {
        let start = Instant::now();

        // Load all embeddings and compute similarity
        // Note: For large indexes, this should use approximate nearest neighbor search
        let mut stmt = self.conn.prepare(
            "SELECT id, file_path, relative_path, start_line, end_line, language, chunk_type, name, content, embedding
             FROM chunks"
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare query: {}", e)))?;

        let mut results: Vec<(CodeChunk, f32)> = Vec::new();

        let rows = stmt.query_map([], |row| {
            let embedding_bytes: Vec<u8> = row.get(9)?;
            Ok((
                row.get::<_, String>(0)?,  // id
                row.get::<_, String>(1)?,  // file_path
                row.get::<_, String>(2)?,  // relative_path
                row.get::<_, u32>(3)?,     // start_line
                row.get::<_, u32>(4)?,     // end_line
                row.get::<_, String>(5)?,  // language
                row.get::<_, String>(6)?,  // chunk_type
                row.get::<_, Option<String>>(7)?, // name
                row.get::<_, String>(8)?,  // content
                embedding_bytes,
            ))
        }).map_err(|e| ToolError::ExecutionFailed(format!("Failed to query chunks: {}", e)))?;

        for row_result in rows {
            let (id, file_path, relative_path, start_line, end_line, language, chunk_type_str, name, content, embedding_bytes) =
                row_result.map_err(|e| ToolError::ExecutionFailed(format!("Failed to read row: {}", e)))?;

            let stored_embedding = Self::deserialize_embedding(&embedding_bytes);
            let score = Self::cosine_similarity(embedding, &stored_embedding);

            if score >= min_score {
                let chunk = CodeChunk {
                    id,
                    content,
                    file_path,
                    relative_path,
                    start_line,
                    end_line,
                    language,
                    chunk_type: ChunkType::from_str(&chunk_type_str),
                    name,
                    metadata: None,
                };
                results.push((chunk, score));
            }
        }

        // Sort by score descending and take top_k
        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);

        let retrieval_results: Vec<RetrievalResult> = results
            .into_iter()
            .map(|(chunk, score)| RetrievalResult { chunk, score })
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.query", start.elapsed());

        Ok(retrieval_results)
    }

    /// Delete all chunks for a file.
    pub fn delete_by_file(&self, file_path: &str) -> Result<u32, ToolError> {
        let start = Instant::now();

        let deleted = self.conn.execute(
            "DELETE FROM chunks WHERE file_path = ?1",
            params![file_path],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to delete chunks: {}", e)))?;

        // Also remove from files table
        self.conn.execute(
            "DELETE FROM files WHERE path = ?1",
            params![file_path],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to delete file record: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.delete_by_file", start.elapsed());

        Ok(deleted as u32)
    }

    /// Get list of indexed files.
    pub fn get_indexed_files(&self) -> Result<Vec<String>, ToolError> {
        let start = Instant::now();

        let mut stmt = self.conn.prepare("SELECT DISTINCT file_path FROM chunks")
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare query: {}", e)))?;

        let files: Vec<String> = stmt.query_map([], |row| row.get(0))
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to query files: {}", e)))?
            .filter_map(|r| r.ok())
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.get_indexed_files", start.elapsed());

        Ok(files)
    }

    /// Get or set file hash for change detection.
    pub fn get_file_hash(&self, path: &str) -> Result<Option<String>, ToolError> {
        self.conn.query_row(
            "SELECT hash FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        ).optional().map_err(|e| ToolError::ExecutionFailed(format!("Failed to get file hash: {}", e)))
    }

    /// Set file hash after indexing.
    pub fn set_file_hash(&self, path: &str, hash: &str) -> Result<(), ToolError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO files (path, hash, last_indexed) VALUES (?1, ?2, datetime('now'))",
            params![path, hash],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to set file hash: {}", e)))?;
        Ok(())
    }

    /// Get index statistics.
    pub fn get_stats(&self) -> Result<IndexStats, ToolError> {
        let start = Instant::now();

        let total_chunks: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM chunks",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let total_files: u32 = self.conn.query_row(
            "SELECT COUNT(DISTINCT file_path) FROM chunks",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let last_indexed: Option<String> = self.conn.query_row(
            "SELECT MAX(last_indexed) FROM files",
            [],
            |row| row.get(0),
        ).optional().unwrap_or(None).flatten();

        let index_size = std::fs::metadata(&self.db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.get_stats", start.elapsed());

        Ok(IndexStats {
            total_files,
            total_chunks,
            last_indexed,
            index_size_bytes: index_size,
            embedding_provider: String::new(),
            embedding_model: String::new(),
            is_indexing: false,
            queued_files: 0,
        })
    }

    /// Clear the entire index.
    pub fn clear(&self) -> Result<(), ToolError> {
        let start = Instant::now();

        self.conn.execute("DELETE FROM chunks", [])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to clear chunks: {}", e)))?;
        self.conn.execute("DELETE FROM files", [])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to clear files: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.vector_store.clear", start.elapsed());

        Ok(())
    }

    /// Serialize embedding to bytes.
    fn serialize_embedding(embedding: &[f32]) -> Vec<u8> {
        embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
    }

    /// Deserialize embedding from bytes.
    fn deserialize_embedding(bytes: &[u8]) -> Vec<f32> {
        bytes
            .chunks_exact(4)
            .map(|chunk| {
                let arr: [u8; 4] = chunk.try_into().unwrap_or([0; 4]);
                f32::from_le_bytes(arr)
            })
            .collect()
    }

    /// Compute cosine similarity between two embeddings.
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }

        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a * norm_b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let sim = VectorStore::cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 0.001, "Identical vectors should have similarity 1.0");

        let c = vec![0.0, 1.0, 0.0];
        let sim2 = VectorStore::cosine_similarity(&a, &c);
        assert!(sim2.abs() < 0.001, "Orthogonal vectors should have similarity 0.0");

        let d = vec![-1.0, 0.0, 0.0];
        let sim3 = VectorStore::cosine_similarity(&a, &d);
        assert!((sim3 - (-1.0)).abs() < 0.001, "Opposite vectors should have similarity -1.0");
    }

    #[test]
    fn test_embedding_serialization() {
        let embedding = vec![1.5, -2.3, 0.0, 999.999];
        let bytes = VectorStore::serialize_embedding(&embedding);
        let restored = VectorStore::deserialize_embedding(&bytes);

        assert_eq!(embedding.len(), restored.len());
        for (a, b) in embedding.iter().zip(restored.iter()) {
            assert!((a - b).abs() < 0.0001);
        }
    }

    #[test]
    fn test_vector_store_open() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let store = VectorStore::open(project_root, 384);
        assert!(store.is_ok());
    }

    #[test]
    fn test_upsert_and_query() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let store = VectorStore::open(project_root, 3).unwrap();

        let chunk = CodeChunk::new(
            "fn main() {}".to_string(),
            "/test/main.rs".to_string(),
            "main.rs".to_string(),
            1,
            1,
            "rust".to_string(),
            ChunkType::Function,
            Some("main".to_string()),
        );

        let embedding = vec![1.0, 0.0, 0.0];
        store.upsert(&chunk, &embedding).unwrap();

        // Query with same embedding
        let results = store.query(&embedding, 10, 0.5).unwrap();
        assert_eq!(results.len(), 1);
        assert!((results[0].score - 1.0).abs() < 0.001);
        assert_eq!(results[0].chunk.content, "fn main() {}");
    }

    #[test]
    fn test_delete_by_file() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let store = VectorStore::open(project_root, 3).unwrap();

        let chunk1 = CodeChunk::new(
            "fn a() {}".to_string(),
            "/test/a.rs".to_string(),
            "a.rs".to_string(),
            1, 1,
            "rust".to_string(),
            ChunkType::Function,
            Some("a".to_string()),
        );

        let chunk2 = CodeChunk::new(
            "fn b() {}".to_string(),
            "/test/b.rs".to_string(),
            "b.rs".to_string(),
            1, 1,
            "rust".to_string(),
            ChunkType::Function,
            Some("b".to_string()),
        );

        store.upsert(&chunk1, &[1.0, 0.0, 0.0]).unwrap();
        store.upsert(&chunk2, &[0.0, 1.0, 0.0]).unwrap();

        let stats = store.get_stats().unwrap();
        assert_eq!(stats.total_chunks, 2);

        store.delete_by_file("/test/a.rs").unwrap();

        let stats = store.get_stats().unwrap();
        assert_eq!(stats.total_chunks, 1);
    }

    #[test]
    fn test_clear() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let store = VectorStore::open(project_root, 3).unwrap();

        let chunk = CodeChunk::new(
            "code".to_string(),
            "/test/file.rs".to_string(),
            "file.rs".to_string(),
            1, 1,
            "rust".to_string(),
            ChunkType::Block,
            None,
        );

        store.upsert(&chunk, &[1.0, 0.0, 0.0]).unwrap();
        store.clear().unwrap();

        let stats = store.get_stats().unwrap();
        assert_eq!(stats.total_chunks, 0);
    }
}
