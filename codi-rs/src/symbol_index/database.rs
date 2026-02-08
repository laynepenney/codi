// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! SQLite database wrapper for the symbol index.
//!
//! Handles schema creation, migrations, and low-level queries.

use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::types::{
    CodeSymbol, ExtractionMethod, ImportStatement, IndexStats, IndexedFile, SymbolKind,
    SymbolSearchResult, SymbolVisibility,
};

/// Current index format version.
pub const INDEX_VERSION: &str = "1.0.0";

/// Get the index directory for a project.
pub fn get_index_directory(project_root: &str) -> PathBuf {
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
        .join("symbol-index")
        .join(format!("{}-{}", project_name, hash_short))
}

/// SQLite database wrapper for the symbol index.
pub struct SymbolDatabase {
    conn: Connection,
    index_dir: PathBuf,
    db_path: PathBuf,
    project_root: String,
}

impl SymbolDatabase {
    /// Open or create a symbol database for the given project.
    pub fn open(project_root: &str) -> Result<Self, ToolError> {
        let start = Instant::now();

        let index_dir = get_index_directory(project_root);
        let db_path = index_dir.join("symbols.db");

        // Ensure directory exists
        std::fs::create_dir_all(&index_dir).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to create index directory: {}", e))
        })?;

        // Open database
        let conn = Connection::open(&db_path)
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to open database: {}", e)))?;

        // Set pragmas for performance
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA cache_size = -64000;", // 64MB cache
        )
        .map_err(|e| ToolError::ExecutionFailed(format!("Failed to set pragmas: {}", e)))?;

        let mut db = Self {
            conn,
            index_dir,
            db_path,
            project_root: project_root.to_string(),
        };

        // Initialize schema if needed
        db.initialize_schema()?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.open", start.elapsed());

        Ok(db)
    }

    /// Get the database file path.
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

        // Check if schema exists
        let table_exists: bool = self
            .conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='files'",
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
        GLOBAL_METRICS.record_operation("symbol_index.db.init_schema", start.elapsed());

        Ok(())
    }

    /// Create the database schema.
    fn create_schema(&self) -> Result<(), ToolError> {
        // Create tables and indexes first (no parameters needed)
        self.conn
            .execute_batch(
                r#"
            -- Files table
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                hash TEXT NOT NULL,
                extraction_method TEXT NOT NULL,
                last_indexed TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Symbols table
            CREATE TABLE IF NOT EXISTS symbols (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                line INTEGER NOT NULL,
                end_line INTEGER,
                visibility TEXT NOT NULL,
                signature TEXT,
                doc_summary TEXT,
                metadata TEXT
            );

            -- Imports table
            CREATE TABLE IF NOT EXISTS imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                source_path TEXT NOT NULL,
                resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
                is_type_only INTEGER NOT NULL DEFAULT 0,
                line INTEGER NOT NULL
            );

            -- Import symbols table
            CREATE TABLE IF NOT EXISTS import_symbols (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                alias TEXT,
                is_default INTEGER NOT NULL DEFAULT 0,
                is_namespace INTEGER NOT NULL DEFAULT 0
            );

            -- File dependencies table
            CREATE TABLE IF NOT EXISTS file_dependencies (
                from_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                to_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                PRIMARY KEY (from_file_id, to_file_id, type)
            );

            -- Metadata table
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- Create indexes for common queries
            CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
            CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
            CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
            CREATE INDEX IF NOT EXISTS idx_imports_file_id ON imports(file_id);
            CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_file_id);
            CREATE INDEX IF NOT EXISTS idx_deps_from ON file_dependencies(from_file_id);
            CREATE INDEX IF NOT EXISTS idx_deps_to ON file_dependencies(to_file_id);
        "#,
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to create schema: {}", e)))?;

        // Insert metadata with parameters (separate statements)
        self.conn
            .execute(
                "INSERT OR REPLACE INTO metadata (key, value) VALUES ('version', ?1)",
                params![INDEX_VERSION],
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to set version: {}", e)))?;

        self.conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_full_rebuild', datetime('now'))",
            [],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to set last_full_rebuild: {}", e)))?;

        self.conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_update', datetime('now'))",
            [],
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to set last_update: {}", e)))?;

        Ok(())
    }

    /// Get or create a file record.
    pub fn upsert_file(
        &self,
        path: &str,
        hash: &str,
        method: ExtractionMethod,
    ) -> Result<i64, ToolError> {
        let start = Instant::now();

        // Try to insert, on conflict update
        self.conn
            .execute(
                "INSERT INTO files (path, hash, extraction_method, last_indexed)
             VALUES (?1, ?2, ?3, datetime('now'))
             ON CONFLICT(path) DO UPDATE SET
                hash = excluded.hash,
                extraction_method = excluded.extraction_method,
                last_indexed = datetime('now')",
                params![path, hash, method.as_str()],
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to upsert file: {}", e)))?;

        // Always query for the actual ID (last_insert_rowid is unreliable for upsert)
        let file_id: i64 = self
            .conn
            .query_row(
                "SELECT id FROM files WHERE path = ?1",
                params![path],
                |row| row.get(0),
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to get file id: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.upsert_file", start.elapsed());

        Ok(file_id)
    }

    /// Get a file by path.
    pub fn get_file(&self, path: &str) -> Result<Option<IndexedFile>, ToolError> {
        let start = Instant::now();

        let result = self
            .conn
            .query_row(
                "SELECT id, path, hash, extraction_method, last_indexed FROM files WHERE path = ?1",
                params![path],
                |row| {
                    Ok(IndexedFile {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        hash: row.get(2)?,
                        extraction_method: ExtractionMethod::from_str(&row.get::<_, String>(3)?),
                        last_indexed: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to get file: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.get_file", start.elapsed());

        Ok(result)
    }

    /// Delete a file and its symbols.
    pub fn delete_file(&self, file_id: i64) -> Result<(), ToolError> {
        let start = Instant::now();

        // Cascading deletes handle symbols, imports, etc.
        self.conn
            .execute("DELETE FROM files WHERE id = ?1", params![file_id])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to delete file: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.delete_file", start.elapsed());

        Ok(())
    }

    /// Insert symbols for a file.
    pub fn insert_symbols(&self, file_id: i64, symbols: &[CodeSymbol]) -> Result<(), ToolError> {
        let start = Instant::now();

        // Delete existing symbols for this file
        self.conn
            .execute("DELETE FROM symbols WHERE file_id = ?1", params![file_id])
            .map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to delete old symbols: {}", e))
            })?;

        // Insert new symbols
        let mut stmt = self.conn.prepare(
            "INSERT INTO symbols (file_id, name, kind, line, end_line, visibility, signature, doc_summary, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare statement: {}", e)))?;

        for symbol in symbols {
            let metadata_json = symbol.metadata.as_ref().map(|m| m.to_string());

            stmt.execute(params![
                file_id,
                symbol.name,
                symbol.kind.as_str(),
                symbol.line,
                symbol.end_line,
                symbol.visibility.as_str(),
                symbol.signature,
                symbol.doc_summary,
                metadata_json,
            ])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to insert symbol: {}", e)))?;
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.insert_symbols", start.elapsed());

        Ok(())
    }

    /// Insert imports for a file.
    pub fn insert_imports(
        &self,
        file_id: i64,
        imports: &[ImportStatement],
    ) -> Result<(), ToolError> {
        let start = Instant::now();

        // Delete existing imports for this file
        self.conn
            .execute("DELETE FROM imports WHERE file_id = ?1", params![file_id])
            .map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to delete old imports: {}", e))
            })?;

        let mut import_stmt = self
            .conn
            .prepare(
                "INSERT INTO imports (file_id, source_path, is_type_only, line)
             VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to prepare import statement: {}", e))
            })?;

        let mut symbol_stmt = self
            .conn
            .prepare(
                "INSERT INTO import_symbols (import_id, name, alias, is_default, is_namespace)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .map_err(|e| {
                ToolError::ExecutionFailed(format!(
                    "Failed to prepare import symbol statement: {}",
                    e
                ))
            })?;

        for import in imports {
            import_stmt
                .execute(params![
                    file_id,
                    import.source,
                    import.is_type_only as i32,
                    import.line,
                ])
                .map_err(|e| {
                    ToolError::ExecutionFailed(format!("Failed to insert import: {}", e))
                })?;

            let import_id = self.conn.last_insert_rowid();

            for sym in &import.symbols {
                symbol_stmt
                    .execute(params![
                        import_id,
                        sym.name,
                        sym.alias,
                        sym.is_default as i32,
                        sym.is_namespace as i32,
                    ])
                    .map_err(|e| {
                        ToolError::ExecutionFailed(format!("Failed to insert import symbol: {}", e))
                    })?;
            }
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.insert_imports", start.elapsed());

        Ok(())
    }

    /// Search for symbols by name (fuzzy search).
    pub fn find_symbols(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SymbolSearchResult>, ToolError> {
        let start = Instant::now();

        // Use LIKE for simple fuzzy search
        let pattern = format!("%{}%", query);

        let mut stmt = self.conn.prepare(
            "SELECT s.name, s.kind, f.path, s.line, s.end_line, s.visibility, s.signature, s.doc_summary
             FROM symbols s
             JOIN files f ON s.file_id = f.id
             WHERE s.name LIKE ?1
             ORDER BY
                CASE WHEN s.name = ?2 THEN 0
                     WHEN s.name LIKE ?3 THEN 1
                     ELSE 2 END,
                length(s.name)
             LIMIT ?4"
        ).map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare query: {}", e)))?;

        let exact_pattern = query;
        let starts_with_pattern = format!("{}%", query);

        let results = stmt
            .query_map(
                params![pattern, exact_pattern, starts_with_pattern, limit as i64],
                |row| {
                    let name: String = row.get(0)?;
                    let score = if name == query {
                        1.0
                    } else if name.starts_with(query) {
                        0.8
                    } else {
                        0.5
                    };

                    Ok(SymbolSearchResult {
                        name,
                        kind: SymbolKind::from_str(&row.get::<_, String>(1)?),
                        file: row.get(2)?,
                        line: row.get(3)?,
                        end_line: row.get(4)?,
                        visibility: SymbolVisibility::from_str(&row.get::<_, String>(5)?),
                        signature: row.get(6)?,
                        doc_summary: row.get(7)?,
                        score,
                    })
                },
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Query failed: {}", e)))?;

        let results: Vec<_> = results.filter_map(|r| r.ok()).collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.find_symbols", start.elapsed());

        Ok(results)
    }

    /// Get index statistics.
    pub fn get_stats(&self) -> Result<IndexStats, ToolError> {
        let start = Instant::now();

        let total_files: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to count files: {}", e)))?;

        let total_symbols: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM symbols", [], |row| row.get(0))
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to count symbols: {}", e)))?;

        let total_imports: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM imports", [], |row| row.get(0))
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to count imports: {}", e)))?;

        let total_dependencies: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM file_dependencies", [], |row| {
                row.get(0)
            })
            .map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to count dependencies: {}", e))
            })?;

        let version: String = self
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| INDEX_VERSION.to_string());

        let last_full_rebuild: String = self
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE key = 'last_full_rebuild'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "never".to_string());

        let last_update: String = self
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE key = 'last_update'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "never".to_string());

        let index_size_bytes = std::fs::metadata(&self.db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.get_stats", start.elapsed());

        Ok(IndexStats {
            version,
            project_root: self.project_root.clone(),
            total_files,
            total_symbols,
            total_imports,
            total_dependencies,
            last_full_rebuild,
            last_update,
            index_size_bytes,
        })
    }

    /// Update the last_update timestamp.
    pub fn touch_update(&self) -> Result<(), ToolError> {
        self.conn
            .execute(
                "UPDATE metadata SET value = datetime('now') WHERE key = 'last_update'",
                [],
            )
            .map_err(|e| {
                ToolError::ExecutionFailed(format!("Failed to update timestamp: {}", e))
            })?;
        Ok(())
    }

    /// Get all indexed file paths.
    pub fn get_all_files(&self) -> Result<Vec<String>, ToolError> {
        let start = Instant::now();

        let mut stmt = self
            .conn
            .prepare("SELECT id, path FROM files")
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to prepare query: {}", e)))?;

        let files = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to query files: {}", e)))?;

        let mut result = Vec::new();
        for file in files {
            if let Ok((_, path)) = file {
                result.push(path);
            }
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.get_all_files", start.elapsed());

        Ok(result)
    }

    /// Clear the entire index.
    pub fn clear(&self) -> Result<(), ToolError> {
        let start = Instant::now();

        self.conn
            .execute_batch(
                "DELETE FROM file_dependencies;
             DELETE FROM import_symbols;
             DELETE FROM imports;
             DELETE FROM symbols;
             DELETE FROM files;
             UPDATE metadata SET value = datetime('now') WHERE key = 'last_full_rebuild';
             UPDATE metadata SET value = datetime('now') WHERE key = 'last_update';",
            )
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to clear index: {}", e)))?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.db.clear", start.elapsed());

        Ok(())
    }

    /// Begin a transaction.
    pub fn begin_transaction(&mut self) -> Result<(), ToolError> {
        self.conn.execute("BEGIN TRANSACTION", []).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to begin transaction: {}", e))
        })?;
        Ok(())
    }

    /// Commit the current transaction.
    pub fn commit(&mut self) -> Result<(), ToolError> {
        self.conn
            .execute("COMMIT", [])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to commit: {}", e)))?;
        Ok(())
    }

    /// Rollback the current transaction.
    pub fn rollback(&mut self) -> Result<(), ToolError> {
        self.conn
            .execute("ROLLBACK", [])
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to rollback: {}", e)))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_get_index_directory() {
        let dir = get_index_directory("/home/user/project");
        assert!(dir.to_str().unwrap().contains("symbol-index"));
        assert!(dir.to_str().unwrap().contains("project"));
    }

    #[test]
    fn test_database_open() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let db = SymbolDatabase::open(project_root).unwrap();
        assert!(db.db_path().exists());
    }

    #[test]
    fn test_file_operations() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let db = SymbolDatabase::open(project_root).unwrap();

        // Insert file
        let file_id = db
            .upsert_file("src/main.rs", "abc123", ExtractionMethod::TreeSitter)
            .unwrap();
        assert!(file_id > 0);

        // Get file
        let file = db.get_file("src/main.rs").unwrap().unwrap();
        assert_eq!(file.path, "src/main.rs");
        assert_eq!(file.hash, "abc123");

        // Update file
        let file_id2 = db
            .upsert_file("src/main.rs", "def456", ExtractionMethod::TreeSitter)
            .unwrap();
        assert_eq!(file_id, file_id2);

        let file = db.get_file("src/main.rs").unwrap().unwrap();
        assert_eq!(file.hash, "def456");
    }

    #[test]
    fn test_symbol_operations() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let db = SymbolDatabase::open(project_root).unwrap();

        let file_id = db
            .upsert_file("src/lib.rs", "hash", ExtractionMethod::TreeSitter)
            .unwrap();

        let symbols = vec![
            CodeSymbol {
                name: "main".to_string(),
                kind: SymbolKind::Function,
                line: 1,
                end_line: Some(10),
                column: 0,
                visibility: SymbolVisibility::Public,
                signature: Some("fn main()".to_string()),
                doc_summary: None,
                metadata: None,
            },
            CodeSymbol {
                name: "Config".to_string(),
                kind: SymbolKind::Struct,
                line: 12,
                end_line: Some(20),
                column: 0,
                visibility: SymbolVisibility::Public,
                signature: Some("struct Config".to_string()),
                doc_summary: Some("Configuration struct".to_string()),
                metadata: None,
            },
        ];

        db.insert_symbols(file_id, &symbols).unwrap();

        // Search for symbols
        let results = db.find_symbols("main", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "main");

        let results = db.find_symbols("Config", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].kind, SymbolKind::Struct);
    }

    #[test]
    fn test_stats() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().to_str().unwrap();

        let db = SymbolDatabase::open(project_root).unwrap();

        let stats = db.get_stats().unwrap();
        assert_eq!(stats.total_files, 0);
        assert_eq!(stats.total_symbols, 0);
        assert_eq!(stats.version, INDEX_VERSION);
    }
}
