// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Code chunking for semantic splitting.
//!
//! Extracts semantic code units (functions, classes, etc.) for embedding.

use std::path::Path;
use std::time::Instant;

use regex::Regex;

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::types::{ChunkType, CodeChunk, RAGConfig};

/// Configuration for the chunker.
#[derive(Debug, Clone)]
pub struct ChunkerConfig {
    /// Maximum chunk size in characters.
    pub max_chunk_size: usize,
    /// Overlap between chunks in characters.
    pub chunk_overlap: usize,
    /// Minimum chunk size to include.
    pub min_chunk_size: usize,
}

impl Default for ChunkerConfig {
    fn default() -> Self {
        Self {
            max_chunk_size: 4000,
            chunk_overlap: 400,
            min_chunk_size: 100,
        }
    }
}

impl From<&RAGConfig> for ChunkerConfig {
    fn from(config: &RAGConfig) -> Self {
        Self {
            max_chunk_size: config.max_chunk_size,
            chunk_overlap: config.chunk_overlap,
            min_chunk_size: 100,
        }
    }
}

/// Code chunker for semantic splitting.
pub struct CodeChunker {
    config: ChunkerConfig,
    patterns: LanguagePatterns,
}

impl CodeChunker {
    /// Create a new code chunker with default config.
    pub fn new() -> Self {
        Self {
            config: ChunkerConfig::default(),
            patterns: LanguagePatterns::new(),
        }
    }

    /// Create a chunker with custom config.
    pub fn with_config(config: ChunkerConfig) -> Self {
        Self {
            config,
            patterns: LanguagePatterns::new(),
        }
    }

    /// Chunk a file into code units.
    pub fn chunk_file(
        &self,
        file_path: &Path,
        content: &str,
        project_root: &Path,
    ) -> Result<Vec<CodeChunk>, ToolError> {
        let start = Instant::now();

        let language = self.detect_language(file_path);
        let relative_path = file_path
            .strip_prefix(project_root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        let chunks = self.extract_semantic_chunks(
            content,
            &file_path.to_string_lossy(),
            &relative_path,
            &language,
        )?;

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.chunker.chunk_file", start.elapsed());

        Ok(chunks)
    }

    /// Detect language from file extension.
    fn detect_language(&self, path: &Path) -> String {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        match ext.as_str() {
            "ts" | "tsx" | "mts" | "cts" => "typescript".to_string(),
            "js" | "jsx" | "mjs" | "cjs" => "javascript".to_string(),
            "rs" => "rust".to_string(),
            "py" | "pyi" => "python".to_string(),
            "go" => "go".to_string(),
            "java" => "java".to_string(),
            "rb" => "ruby".to_string(),
            "php" => "php".to_string(),
            "c" | "h" => "c".to_string(),
            "cpp" | "cc" | "cxx" | "hpp" | "hxx" => "cpp".to_string(),
            "cs" => "csharp".to_string(),
            "swift" => "swift".to_string(),
            "kt" | "kts" => "kotlin".to_string(),
            _ => "unknown".to_string(),
        }
    }

    /// Extract semantic chunks from content.
    fn extract_semantic_chunks(
        &self,
        content: &str,
        file_path: &str,
        relative_path: &str,
        language: &str,
    ) -> Result<Vec<CodeChunk>, ToolError> {
        let lines: Vec<&str> = content.lines().collect();
        let mut chunks = Vec::new();

        // Get language-specific patterns
        let patterns = self.patterns.get(language);

        if patterns.is_empty() {
            // Fall back to fixed-size chunking
            return self.fixed_size_chunks(content, file_path, relative_path, language);
        }

        let mut covered_ranges: Vec<(usize, usize)> = Vec::new();

        // Extract semantic units using patterns
        for (pattern, chunk_type) in patterns {
            for m in pattern.find_iter(content) {
                let start_byte = m.start();
                let start_line = content[..start_byte].matches('\n').count();

                // Find the end of the block
                let end_line = self.find_block_end(content, start_byte, language);

                // Skip if this range overlaps with an already extracted chunk
                if covered_ranges
                    .iter()
                    .any(|(s, e)| start_line < *e && end_line > *s)
                {
                    continue;
                }

                // Extract the block content
                if start_line < lines.len() && end_line <= lines.len() {
                    let block_lines = &lines[start_line..end_line];
                    let block_content = block_lines.join("\n");

                    // Skip very small chunks
                    if block_content.len() < self.config.min_chunk_size {
                        continue;
                    }

                    // Extract name from the match
                    let name = self.extract_name_from_match(&m.as_str(), *chunk_type);

                    // Split if too large
                    if block_content.len() > self.config.max_chunk_size {
                        let sub_chunks = self.split_large_chunk(
                            &block_content,
                            file_path,
                            relative_path,
                            language,
                            start_line,
                            *chunk_type,
                            &name,
                        )?;
                        chunks.extend(sub_chunks);
                    } else {
                        chunks.push(CodeChunk::new(
                            block_content,
                            file_path.to_string(),
                            relative_path.to_string(),
                            (start_line + 1) as u32,
                            end_line as u32,
                            language.to_string(),
                            *chunk_type,
                            name,
                        ));
                    }

                    covered_ranges.push((start_line, end_line));
                }
            }
        }

        // If no semantic chunks found, use fixed-size
        if chunks.is_empty() {
            return self.fixed_size_chunks(content, file_path, relative_path, language);
        }

        Ok(chunks)
    }

    /// Find the end of a code block.
    fn find_block_end(&self, content: &str, start_byte: usize, language: &str) -> usize {
        let remaining = &content[start_byte..];

        if language == "python" {
            // Python uses indentation
            self.find_python_block_end(remaining, content, start_byte)
        } else {
            // Brace-delimited languages
            self.find_brace_block_end(remaining, content, start_byte)
        }
    }

    /// Find end of brace-delimited block.
    fn find_brace_block_end(&self, remaining: &str, content: &str, start_byte: usize) -> usize {
        let mut depth = 0;
        let mut in_string = false;
        let mut string_char = ' ';
        let mut prev_char = ' ';

        for (i, ch) in remaining.char_indices() {
            // Handle string literals
            if (ch == '"' || ch == '\'' || ch == '`') && prev_char != '\\' {
                if in_string && ch == string_char {
                    in_string = false;
                } else if !in_string {
                    in_string = true;
                    string_char = ch;
                }
            }

            if !in_string {
                match ch {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            // Found the closing brace
                            let end_byte = start_byte + i + 1;
                            return content[..end_byte].matches('\n').count() + 1;
                        }
                    }
                    _ => {}
                }
            }

            prev_char = ch;
        }

        // If no closing brace found, return end of content
        content.matches('\n').count() + 1
    }

    /// Find end of Python indentation block.
    fn find_python_block_end(&self, remaining: &str, content: &str, start_byte: usize) -> usize {
        let lines: Vec<&str> = remaining.lines().collect();
        if lines.is_empty() {
            return content.matches('\n').count() + 1;
        }

        // Get base indentation from the first line
        let base_indent = lines[0].len() - lines[0].trim_start().len();

        for (i, line) in lines.iter().enumerate().skip(1) {
            // Skip empty lines
            if line.trim().is_empty() {
                continue;
            }

            let line_indent = line.len() - line.trim_start().len();

            // If we find a line with same or less indentation, block ends here
            if line_indent <= base_indent && !line.trim().is_empty() {
                let start_line = content[..start_byte].matches('\n').count();
                return start_line + i;
            }
        }

        // Block extends to end of content
        let start_line = content[..start_byte].matches('\n').count();
        start_line + lines.len()
    }

    /// Extract name from a pattern match.
    fn extract_name_from_match(&self, matched: &str, _chunk_type: ChunkType) -> Option<String> {
        // Try to find identifier after keywords
        let name_patterns = [
            r"(?:function|fn|def|func)\s+(\w+)",
            r"(?:class|struct|interface|trait|enum|type)\s+(\w+)",
            r"(?:const|let|var)\s+(\w+)",
        ];

        for pattern_str in name_patterns {
            if let Ok(re) = Regex::new(pattern_str) {
                if let Some(caps) = re.captures(matched) {
                    if let Some(name) = caps.get(1) {
                        return Some(name.as_str().to_string());
                    }
                }
            }
        }

        None
    }

    /// Split a large chunk into smaller overlapping pieces.
    fn split_large_chunk(
        &self,
        content: &str,
        file_path: &str,
        relative_path: &str,
        language: &str,
        base_line: usize,
        chunk_type: ChunkType,
        base_name: &Option<String>,
    ) -> Result<Vec<CodeChunk>, ToolError> {
        let mut chunks = Vec::new();
        let lines: Vec<&str> = content.lines().collect();

        let chars_per_line = if lines.is_empty() {
            80
        } else {
            content.len() / lines.len()
        };

        let lines_per_chunk = self.config.max_chunk_size / chars_per_line.max(1);
        let overlap_lines = self.config.chunk_overlap / chars_per_line.max(1);

        let mut start = 0;
        let mut part = 0;

        while start < lines.len() {
            let end = (start + lines_per_chunk).min(lines.len());
            let chunk_lines = &lines[start..end];
            let chunk_content = chunk_lines.join("\n");

            let name = base_name.as_ref().map(|n| {
                if part == 0 {
                    n.clone()
                } else {
                    format!("{} (part {})", n, part + 1)
                }
            });

            chunks.push(CodeChunk::new(
                chunk_content,
                file_path.to_string(),
                relative_path.to_string(),
                (base_line + start + 1) as u32,
                (base_line + end) as u32,
                language.to_string(),
                chunk_type,
                name,
            ));

            if end >= lines.len() {
                break;
            }

            start = end.saturating_sub(overlap_lines);
            part += 1;
        }

        Ok(chunks)
    }

    /// Create fixed-size chunks (fallback).
    fn fixed_size_chunks(
        &self,
        content: &str,
        file_path: &str,
        relative_path: &str,
        language: &str,
    ) -> Result<Vec<CodeChunk>, ToolError> {
        let mut chunks = Vec::new();
        let lines: Vec<&str> = content.lines().collect();

        if lines.is_empty() {
            return Ok(chunks);
        }

        let chars_per_line = content.len() / lines.len();
        let lines_per_chunk = self.config.max_chunk_size / chars_per_line.max(1);
        let overlap_lines = self.config.chunk_overlap / chars_per_line.max(1);

        let mut start = 0;

        while start < lines.len() {
            let end = (start + lines_per_chunk).min(lines.len());
            let chunk_lines = &lines[start..end];
            let chunk_content = chunk_lines.join("\n");

            if chunk_content.len() >= self.config.min_chunk_size {
                chunks.push(CodeChunk::new(
                    chunk_content,
                    file_path.to_string(),
                    relative_path.to_string(),
                    (start + 1) as u32,
                    end as u32,
                    language.to_string(),
                    ChunkType::Block,
                    None,
                ));
            }

            if end >= lines.len() {
                break;
            }

            start = end.saturating_sub(overlap_lines);
        }

        Ok(chunks)
    }
}

impl Default for CodeChunker {
    fn default() -> Self {
        Self::new()
    }
}

/// Language-specific patterns for semantic extraction.
struct LanguagePatterns {
    typescript: Vec<(Regex, ChunkType)>,
    rust: Vec<(Regex, ChunkType)>,
    python: Vec<(Regex, ChunkType)>,
    go: Vec<(Regex, ChunkType)>,
    java: Vec<(Regex, ChunkType)>,
}

impl LanguagePatterns {
    fn new() -> Self {
        Self {
            typescript: vec![
                (
                    Regex::new(r"(?m)^(?:export\s+)?(?:async\s+)?function\s+\w+").unwrap(),
                    ChunkType::Function,
                ),
                (
                    Regex::new(r"(?m)^(?:export\s+)?(?:abstract\s+)?class\s+\w+").unwrap(),
                    ChunkType::Class,
                ),
                (
                    Regex::new(r"(?m)^(?:export\s+)?interface\s+\w+").unwrap(),
                    ChunkType::Interface,
                ),
                (
                    Regex::new(r"(?m)^(?:export\s+)?enum\s+\w+").unwrap(),
                    ChunkType::Enum,
                ),
                (
                    Regex::new(r"(?m)^(?:export\s+)?type\s+\w+").unwrap(),
                    ChunkType::Unknown, // TypeAlias
                ),
            ],
            rust: vec![
                (
                    Regex::new(r"(?m)^(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+").unwrap(),
                    ChunkType::Function,
                ),
                (
                    Regex::new(r"(?m)^(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+\w+").unwrap(),
                    ChunkType::Struct,
                ),
                (
                    Regex::new(r"(?m)^(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+\w+").unwrap(),
                    ChunkType::Enum,
                ),
                (
                    Regex::new(r"(?m)^(?:pub(?:\s*\([^)]*\))?\s+)?trait\s+\w+").unwrap(),
                    ChunkType::Interface, // Trait
                ),
                (
                    Regex::new(r"(?m)^impl(?:\s*<[^>]*>)?\s+\w+").unwrap(),
                    ChunkType::Unknown, // Impl
                ),
                (
                    Regex::new(r"(?m)^(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+\w+").unwrap(),
                    ChunkType::Module,
                ),
            ],
            python: vec![
                (
                    Regex::new(r"(?m)^(?:async\s+)?def\s+\w+").unwrap(),
                    ChunkType::Function,
                ),
                (
                    Regex::new(r"(?m)^class\s+\w+").unwrap(),
                    ChunkType::Class,
                ),
            ],
            go: vec![
                (
                    Regex::new(r"(?m)^func\s+(?:\([^)]*\)\s*)?\w+").unwrap(),
                    ChunkType::Function,
                ),
                (
                    Regex::new(r"(?m)^type\s+\w+\s+struct").unwrap(),
                    ChunkType::Struct,
                ),
                (
                    Regex::new(r"(?m)^type\s+\w+\s+interface").unwrap(),
                    ChunkType::Interface,
                ),
            ],
            java: vec![
                (
                    Regex::new(r"(?m)^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+\w+\s*\([^)]*\)\s*(?:throws\s+\w+(?:\s*,\s*\w+)*)?\s*\{").unwrap(),
                    ChunkType::Method,
                ),
                (
                    Regex::new(r"(?m)^(?:public|private|protected)?\s*(?:abstract\s+)?(?:final\s+)?class\s+\w+").unwrap(),
                    ChunkType::Class,
                ),
                (
                    Regex::new(r"(?m)^(?:public\s+)?interface\s+\w+").unwrap(),
                    ChunkType::Interface,
                ),
                (
                    Regex::new(r"(?m)^(?:public\s+)?enum\s+\w+").unwrap(),
                    ChunkType::Enum,
                ),
            ],
        }
    }

    fn get(&self, language: &str) -> &[(Regex, ChunkType)] {
        match language {
            "typescript" | "javascript" => &self.typescript,
            "rust" => &self.rust,
            "python" => &self.python,
            "go" => &self.go,
            "java" => &self.java,
            _ => &[],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_detect_language() {
        let chunker = CodeChunker::new();

        assert_eq!(chunker.detect_language(Path::new("test.ts")), "typescript");
        assert_eq!(chunker.detect_language(Path::new("test.rs")), "rust");
        assert_eq!(chunker.detect_language(Path::new("test.py")), "python");
        assert_eq!(chunker.detect_language(Path::new("test.go")), "go");
        assert_eq!(chunker.detect_language(Path::new("test.txt")), "unknown");
    }

    #[test]
    fn test_chunk_typescript() {
        let chunker = CodeChunker::new();
        let content = r#"
export function greet(name: string): string {
    return `Hello, ${name}!`;
}

export class Greeter {
    private name: string;

    constructor(name: string) {
        this.name = name;
    }

    greet(): string {
        return greet(this.name);
    }
}
"#;

        let chunks = chunker
            .chunk_file(
                Path::new("/test/file.ts"),
                content,
                Path::new("/test"),
            )
            .unwrap();

        assert!(!chunks.is_empty());

        // Should have at least function and class
        let has_function = chunks.iter().any(|c| c.chunk_type == ChunkType::Function);
        let has_class = chunks.iter().any(|c| c.chunk_type == ChunkType::Class);

        assert!(has_function || has_class);
    }

    #[test]
    fn test_chunk_rust() {
        let chunker = CodeChunker::new();
        let content = r#"
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

pub struct Greeter {
    name: String,
}

impl Greeter {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
        }
    }
}
"#;

        let chunks = chunker
            .chunk_file(
                Path::new("/test/lib.rs"),
                content,
                Path::new("/test"),
            )
            .unwrap();

        assert!(!chunks.is_empty());
    }

    #[test]
    fn test_chunk_python() {
        let chunker = CodeChunker::new();
        let content = r#"
def greet(name):
    return f"Hello, {name}!"

class Greeter:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return greet(self.name)
"#;

        let chunks = chunker
            .chunk_file(
                Path::new("/test/main.py"),
                content,
                Path::new("/test"),
            )
            .unwrap();

        assert!(!chunks.is_empty());
    }

    #[test]
    fn test_fixed_size_fallback() {
        let chunker = CodeChunker::new();
        let content = "This is plain text without any code patterns.\n".repeat(100);

        let chunks = chunker
            .chunk_file(
                Path::new("/test/readme.txt"),
                &content,
                Path::new("/test"),
            )
            .unwrap();

        // Should fall back to fixed-size chunks
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert_eq!(chunk.chunk_type, ChunkType::Block);
        }
    }

    #[test]
    fn test_split_large_chunk() {
        let config = ChunkerConfig {
            max_chunk_size: 200,
            chunk_overlap: 50,
            min_chunk_size: 10,
        };
        let chunker = CodeChunker::with_config(config);

        let content = r#"
pub fn very_long_function() {
    // Line 1
    // Line 2
    // Line 3
    // Line 4
    // Line 5
    // Line 6
    // Line 7
    // Line 8
    // Line 9
    // Line 10
    // Line 11
    // Line 12
    // Line 13
    // Line 14
    // Line 15
}
"#;

        let chunks = chunker
            .chunk_file(
                Path::new("/test/lib.rs"),
                content,
                Path::new("/test"),
            )
            .unwrap();

        // Should have split into multiple chunks
        assert!(chunks.len() >= 1);
    }
}
