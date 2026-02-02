// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Types for the RAG (Retrieval-Augmented Generation) system.

use serde::{Deserialize, Serialize};

/// Type of code chunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChunkType {
    Function,
    Method,
    Class,
    Struct,
    Interface,
    Enum,
    Module,
    Block,
    File,
    Unknown,
}

impl ChunkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Function => "function",
            Self::Method => "method",
            Self::Class => "class",
            Self::Struct => "struct",
            Self::Interface => "interface",
            Self::Enum => "enum",
            Self::Module => "module",
            Self::Block => "block",
            Self::File => "file",
            Self::Unknown => "unknown",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "function" | "func" | "fn" => Self::Function,
            "method" => Self::Method,
            "class" => Self::Class,
            "struct" => Self::Struct,
            "interface" => Self::Interface,
            "enum" => Self::Enum,
            "module" | "mod" => Self::Module,
            "block" => Self::Block,
            "file" => Self::File,
            _ => Self::Unknown,
        }
    }
}

impl std::fmt::Display for ChunkType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A chunk of code extracted for embedding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChunk {
    /// Unique chunk ID (hash of content + location).
    pub id: String,
    /// The actual code content.
    pub content: String,
    /// Absolute file path.
    pub file_path: String,
    /// Project-relative path.
    pub relative_path: String,
    /// Start line (1-indexed).
    pub start_line: u32,
    /// End line (1-indexed, inclusive).
    pub end_line: u32,
    /// Detected programming language.
    pub language: String,
    /// Type of code unit.
    pub chunk_type: ChunkType,
    /// Symbol name if applicable (function name, class name, etc.).
    pub name: Option<String>,
    /// Additional metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl CodeChunk {
    /// Create a new code chunk.
    pub fn new(
        content: String,
        file_path: String,
        relative_path: String,
        start_line: u32,
        end_line: u32,
        language: String,
        chunk_type: ChunkType,
        name: Option<String>,
    ) -> Self {
        let id = Self::generate_id(&file_path, start_line);
        Self {
            id,
            content,
            file_path,
            relative_path,
            start_line,
            end_line,
            language,
            chunk_type,
            name,
            metadata: None,
        }
    }

    /// Generate a deterministic chunk ID from file path and line.
    pub fn generate_id(file_path: &str, start_line: u32) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(format!("{}:{}", file_path, start_line).as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        hash[..12].to_string()
    }

    /// Get the number of lines in this chunk.
    pub fn line_count(&self) -> u32 {
        self.end_line.saturating_sub(self.start_line) + 1
    }
}

/// Result from a retrieval query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalResult {
    /// The matched code chunk.
    pub chunk: CodeChunk,
    /// Similarity score (0.0 to 1.0, higher is more similar).
    pub score: f32,
}

/// RAG system configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RAGConfig {
    /// Whether RAG is enabled.
    pub enabled: bool,
    /// Project root directory.
    #[serde(default)]
    pub project_root: String,
    /// Embedding provider to use.
    pub embedding_provider: EmbeddingProviderType,
    /// OpenAI embedding model.
    pub openai_model: String,
    /// Ollama embedding model.
    pub ollama_model: String,
    /// Ollama base URL.
    pub ollama_base_url: String,
    /// Chunking strategy.
    pub chunk_strategy: ChunkStrategy,
    /// Maximum chunk size in characters.
    pub max_chunk_size: usize,
    /// Overlap between chunks in characters.
    pub chunk_overlap: usize,
    /// Number of results to return.
    pub top_k: usize,
    /// Minimum similarity score threshold.
    pub min_score: f32,
    /// Glob patterns to include.
    pub include_patterns: Vec<String>,
    /// Glob patterns to exclude.
    pub exclude_patterns: Vec<String>,
    /// Auto-index on startup.
    pub auto_index: bool,
    /// Watch for file changes.
    pub watch_files: bool,
    /// Number of parallel indexing jobs.
    pub parallel_jobs: usize,
}

impl Default for RAGConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            project_root: ".".to_string(),
            embedding_provider: EmbeddingProviderType::Auto,
            openai_model: "text-embedding-3-small".to_string(),
            ollama_model: "nomic-embed-text".to_string(),
            ollama_base_url: "http://localhost:11434".to_string(),
            chunk_strategy: ChunkStrategy::Code,
            max_chunk_size: 4000,
            chunk_overlap: 400,
            top_k: 5,
            min_score: 0.7,
            include_patterns: vec![
                "**/*.ts".to_string(),
                "**/*.tsx".to_string(),
                "**/*.js".to_string(),
                "**/*.jsx".to_string(),
                "**/*.rs".to_string(),
                "**/*.py".to_string(),
                "**/*.go".to_string(),
            ],
            exclude_patterns: vec![
                "**/node_modules/**".to_string(),
                "**/target/**".to_string(),
                "**/.git/**".to_string(),
                "**/dist/**".to_string(),
                "**/build/**".to_string(),
                "**/__pycache__/**".to_string(),
                "**/venv/**".to_string(),
            ],
            auto_index: true,
            watch_files: true,
            parallel_jobs: 4,
        }
    }
}

/// Embedding provider type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingProviderType {
    /// OpenAI embedding API.
    OpenAI,
    /// Ollama local embeddings.
    Ollama,
    /// Use model map configuration.
    ModelMap,
    /// Auto-detect available provider.
    Auto,
}

impl Default for EmbeddingProviderType {
    fn default() -> Self {
        Self::Auto
    }
}

/// Chunking strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChunkStrategy {
    /// Semantic code-aware chunking.
    Code,
    /// Fixed-size chunking.
    Fixed,
}

impl Default for ChunkStrategy {
    fn default() -> Self {
        Self::Code
    }
}

/// Index statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    /// Total number of indexed files.
    pub total_files: u32,
    /// Total number of chunks.
    pub total_chunks: u32,
    /// Last indexed timestamp.
    pub last_indexed: Option<String>,
    /// Index size in bytes.
    pub index_size_bytes: u64,
    /// Embedding provider used.
    pub embedding_provider: String,
    /// Embedding model used.
    pub embedding_model: String,
    /// Whether indexing is currently in progress.
    pub is_indexing: bool,
    /// Number of files queued for indexing.
    pub queued_files: u32,
}

impl Default for IndexStats {
    fn default() -> Self {
        Self {
            total_files: 0,
            total_chunks: 0,
            last_indexed: None,
            index_size_bytes: 0,
            embedding_provider: String::new(),
            embedding_model: String::new(),
            is_indexing: false,
            queued_files: 0,
        }
    }
}

/// Progress update during indexing.
#[derive(Debug, Clone)]
pub struct IndexProgress {
    /// Current file being processed.
    pub current_file: Option<String>,
    /// Number of files processed.
    pub files_processed: u32,
    /// Total number of files.
    pub total_files: u32,
    /// Number of chunks created.
    pub chunks_created: u32,
    /// Whether indexing is complete.
    pub is_complete: bool,
    /// Error message if any.
    pub error: Option<String>,
}

/// Result of an indexing operation.
#[derive(Debug, Clone)]
pub struct IndexResult {
    /// Number of files indexed.
    pub files_indexed: u32,
    /// Number of files skipped (unchanged).
    pub files_skipped: u32,
    /// Number of files with errors.
    pub files_errored: u32,
    /// Total chunks created.
    pub total_chunks: u32,
    /// Duration in milliseconds.
    pub duration_ms: u64,
}

/// Embedding vector with metadata.
#[derive(Debug, Clone)]
pub struct EmbeddingVector {
    /// The embedding values.
    pub values: Vec<f32>,
    /// Dimension count.
    pub dimensions: usize,
}

impl EmbeddingVector {
    pub fn new(values: Vec<f32>) -> Self {
        let dimensions = values.len();
        Self { values, dimensions }
    }
}

/// Information about an embedding model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingModelInfo {
    /// Provider name.
    pub provider: String,
    /// Model name.
    pub model: String,
    /// Vector dimensions.
    pub dimensions: usize,
    /// Maximum tokens per request.
    pub max_tokens: Option<usize>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_type_roundtrip() {
        let types = [
            ChunkType::Function,
            ChunkType::Method,
            ChunkType::Class,
            ChunkType::Struct,
            ChunkType::Interface,
            ChunkType::Enum,
            ChunkType::Module,
            ChunkType::Block,
            ChunkType::File,
            ChunkType::Unknown,
        ];

        for ct in types {
            let s = ct.as_str();
            let parsed = ChunkType::from_str(s);
            assert_eq!(ct, parsed, "Failed roundtrip for {:?}", ct);
        }
    }

    #[test]
    fn test_code_chunk_id_generation() {
        let id1 = CodeChunk::generate_id("/path/to/file.rs", 10);
        let id2 = CodeChunk::generate_id("/path/to/file.rs", 10);
        let id3 = CodeChunk::generate_id("/path/to/file.rs", 20);

        assert_eq!(id1, id2, "Same inputs should produce same ID");
        assert_ne!(id1, id3, "Different line should produce different ID");
        assert_eq!(id1.len(), 12, "ID should be 12 characters");
    }

    #[test]
    fn test_code_chunk_line_count() {
        let chunk = CodeChunk::new(
            "fn main() {}".to_string(),
            "/test.rs".to_string(),
            "test.rs".to_string(),
            10,
            15,
            "rust".to_string(),
            ChunkType::Function,
            Some("main".to_string()),
        );

        assert_eq!(chunk.line_count(), 6);
    }

    #[test]
    fn test_rag_config_default() {
        let config = RAGConfig::default();
        assert!(config.enabled);
        assert_eq!(config.embedding_provider, EmbeddingProviderType::Auto);
        assert_eq!(config.max_chunk_size, 4000);
        assert_eq!(config.chunk_overlap, 400);
        assert_eq!(config.top_k, 5);
        assert!((config.min_score - 0.7).abs() < 0.001);
        assert_eq!(config.parallel_jobs, 4);
    }
}
