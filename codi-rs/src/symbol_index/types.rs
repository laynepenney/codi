// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Types for the symbol index system.

use serde::{Deserialize, Serialize};

/// Kind of symbol (function, class, variable, etc.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Interface,
    Struct,
    Enum,
    EnumMember,
    Constant,
    Variable,
    Property,
    Field,
    Type,
    TypeAlias,
    Module,
    Namespace,
    Trait,
    Impl,
    Macro,
    Unknown,
}

impl SymbolKind {
    /// Convert from string representation.
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "function" | "func" | "fn" => Self::Function,
            "method" => Self::Method,
            "class" => Self::Class,
            "interface" => Self::Interface,
            "struct" => Self::Struct,
            "enum" => Self::Enum,
            "enum_member" | "enummember" | "variant" => Self::EnumMember,
            "constant" | "const" => Self::Constant,
            "variable" | "var" | "let" => Self::Variable,
            "property" | "prop" => Self::Property,
            "field" => Self::Field,
            "type" => Self::Type,
            "type_alias" | "typealias" => Self::TypeAlias,
            "module" | "mod" => Self::Module,
            "namespace" => Self::Namespace,
            "trait" => Self::Trait,
            "impl" => Self::Impl,
            "macro" => Self::Macro,
            _ => Self::Unknown,
        }
    }

    /// Convert to database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Function => "function",
            Self::Method => "method",
            Self::Class => "class",
            Self::Interface => "interface",
            Self::Struct => "struct",
            Self::Enum => "enum",
            Self::EnumMember => "enum_member",
            Self::Constant => "constant",
            Self::Variable => "variable",
            Self::Property => "property",
            Self::Field => "field",
            Self::Type => "type",
            Self::TypeAlias => "type_alias",
            Self::Module => "module",
            Self::Namespace => "namespace",
            Self::Trait => "trait",
            Self::Impl => "impl",
            Self::Macro => "macro",
            Self::Unknown => "unknown",
        }
    }
}

impl std::fmt::Display for SymbolKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Visibility of a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SymbolVisibility {
    Public,
    Private,
    Protected,
    Internal,
    #[default]
    Unknown,
}

impl SymbolVisibility {
    /// Convert from string representation.
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "public" | "pub" | "export" => Self::Public,
            "private" | "priv" => Self::Private,
            "protected" => Self::Protected,
            "internal" | "crate" | "pub(crate)" => Self::Internal,
            _ => Self::Unknown,
        }
    }

    /// Convert to database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Private => "private",
            Self::Protected => "protected",
            Self::Internal => "internal",
            Self::Unknown => "unknown",
        }
    }
}

impl std::fmt::Display for SymbolVisibility {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A code symbol extracted from source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSymbol {
    /// Symbol name.
    pub name: String,
    /// Kind of symbol.
    pub kind: SymbolKind,
    /// Start line (1-indexed).
    pub line: u32,
    /// End line (1-indexed), if known.
    pub end_line: Option<u32>,
    /// Start column (0-indexed).
    pub column: u32,
    /// Visibility.
    pub visibility: SymbolVisibility,
    /// Type signature or declaration.
    pub signature: Option<String>,
    /// Documentation summary.
    pub doc_summary: Option<String>,
    /// Additional metadata (e.g., extends, implements).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// An import statement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportStatement {
    /// Source path/module being imported from.
    pub source: String,
    /// Line number (1-indexed).
    pub line: u32,
    /// Whether this is a type-only import.
    pub is_type_only: bool,
    /// Imported symbols.
    pub symbols: Vec<ImportedSymbol>,
}

/// An imported symbol.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedSymbol {
    /// Original name in the source module.
    pub name: String,
    /// Local alias (if renamed).
    pub alias: Option<String>,
    /// Whether this is the default export.
    pub is_default: bool,
    /// Whether this is a namespace import (import * as X).
    pub is_namespace: bool,
}

/// Index metadata stored in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexMetadata {
    /// Index format version.
    pub version: String,
    /// Project root path.
    pub project_root: String,
    /// Last full rebuild timestamp.
    pub last_full_rebuild: String,
    /// Last incremental update timestamp.
    pub last_update: String,
    /// Total indexed files.
    pub total_files: u32,
    /// Total indexed symbols.
    pub total_symbols: u32,
}

/// A file record in the index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedFile {
    /// Database ID.
    pub id: i64,
    /// Relative file path.
    pub path: String,
    /// Content hash for change detection.
    pub hash: String,
    /// Extraction method used.
    pub extraction_method: ExtractionMethod,
    /// Last indexed timestamp.
    pub last_indexed: String,
}

/// Method used to extract symbols from a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionMethod {
    /// Full AST parsing with tree-sitter.
    TreeSitter,
    /// Regex-based extraction (fallback).
    Regex,
}

impl ExtractionMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TreeSitter => "tree_sitter",
            Self::Regex => "regex",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "tree_sitter" | "ast" => Self::TreeSitter,
            _ => Self::Regex,
        }
    }
}

/// A symbol record in the index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedSymbol {
    /// Database ID.
    pub id: i64,
    /// File ID.
    pub file_id: i64,
    /// Symbol name.
    pub name: String,
    /// Symbol kind.
    pub kind: SymbolKind,
    /// Start line.
    pub line: u32,
    /// End line.
    pub end_line: Option<u32>,
    /// Visibility.
    pub visibility: SymbolVisibility,
    /// Type signature.
    pub signature: Option<String>,
    /// Doc summary.
    pub doc_summary: Option<String>,
    /// Additional metadata as JSON.
    pub metadata: Option<serde_json::Value>,
}

/// Result from find_symbol query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolSearchResult {
    /// Symbol name.
    pub name: String,
    /// Symbol kind.
    pub kind: SymbolKind,
    /// File path.
    pub file: String,
    /// Line number.
    pub line: u32,
    /// End line.
    pub end_line: Option<u32>,
    /// Visibility.
    pub visibility: SymbolVisibility,
    /// Signature.
    pub signature: Option<String>,
    /// Doc summary.
    pub doc_summary: Option<String>,
    /// Match score (for fuzzy search).
    pub score: f64,
}

/// Result from find_references query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceResult {
    /// File path.
    pub file: String,
    /// Line number.
    pub line: u32,
    /// Reference type.
    pub reference_type: ReferenceType,
    /// Context (surrounding code).
    pub context: Option<String>,
}

/// Type of reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceType {
    Import,
    Usage,
    TypeOnly,
    Definition,
}

/// Result from dependency graph query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyResult {
    /// File path.
    pub file: String,
    /// Direction (imports or imported_by).
    pub direction: DependencyDirection,
    /// Depth in the graph.
    pub depth: u32,
    /// Dependency type.
    pub dependency_type: DependencyType,
}

/// Direction in dependency graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyDirection {
    Imports,
    ImportedBy,
}

/// Type of dependency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyType {
    Import,
    DynamicImport,
    ReExport,
    Usage,
}

impl DependencyType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Import => "import",
            Self::DynamicImport => "dynamic_import",
            Self::ReExport => "re_export",
            Self::Usage => "usage",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "import" => Self::Import,
            "dynamic_import" => Self::DynamicImport,
            "re_export" => Self::ReExport,
            "usage" => Self::Usage,
            _ => Self::Import,
        }
    }
}

/// Index statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    /// Index format version.
    pub version: String,
    /// Project root.
    pub project_root: String,
    /// Total indexed files.
    pub total_files: u32,
    /// Total indexed symbols.
    pub total_symbols: u32,
    /// Total imports.
    pub total_imports: u32,
    /// Total dependencies.
    pub total_dependencies: u32,
    /// Last full rebuild.
    pub last_full_rebuild: String,
    /// Last update.
    pub last_update: String,
    /// Index size in bytes.
    pub index_size_bytes: u64,
}

/// Options for building the index.
#[derive(Debug, Clone)]
pub struct IndexBuildOptions {
    /// Project root directory.
    pub project_root: String,
    /// Glob patterns to include.
    pub include_patterns: Vec<String>,
    /// Glob patterns to exclude.
    pub exclude_patterns: Vec<String>,
    /// Force full rebuild.
    pub force_rebuild: bool,
    /// Enable deep indexing (usage-based dependency detection).
    pub deep_index: bool,
    /// Number of parallel jobs.
    pub parallel_jobs: usize,
}

impl Default for IndexBuildOptions {
    fn default() -> Self {
        Self {
            project_root: ".".to_string(),
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
            force_rebuild: false,
            deep_index: false,
            parallel_jobs: 4,
        }
    }
}

/// Supported languages for symbol extraction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    TypeScript,
    JavaScript,
    Rust,
    Python,
    Go,
    Json,
    Unknown,
}

impl Language {
    /// Detect language from file extension.
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "ts" | "tsx" | "mts" | "cts" => Self::TypeScript,
            "js" | "jsx" | "mjs" | "cjs" => Self::JavaScript,
            "rs" => Self::Rust,
            "py" | "pyi" => Self::Python,
            "go" => Self::Go,
            "json" => Self::Json,
            _ => Self::Unknown,
        }
    }

    /// Get the file extensions for this language.
    pub fn extensions(&self) -> &'static [&'static str] {
        match self {
            Self::TypeScript => &["ts", "tsx", "mts", "cts"],
            Self::JavaScript => &["js", "jsx", "mjs", "cjs"],
            Self::Rust => &["rs"],
            Self::Python => &["py", "pyi"],
            Self::Go => &["go"],
            Self::Json => &["json"],
            Self::Unknown => &[],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symbol_kind_from_str() {
        assert_eq!(SymbolKind::from_str("function"), SymbolKind::Function);
        assert_eq!(SymbolKind::from_str("fn"), SymbolKind::Function);
        assert_eq!(SymbolKind::from_str("class"), SymbolKind::Class);
        assert_eq!(SymbolKind::from_str("struct"), SymbolKind::Struct);
        assert_eq!(SymbolKind::from_str("unknown_thing"), SymbolKind::Unknown);
    }

    #[test]
    fn test_symbol_visibility_from_str() {
        assert_eq!(SymbolVisibility::from_str("public"), SymbolVisibility::Public);
        assert_eq!(SymbolVisibility::from_str("pub"), SymbolVisibility::Public);
        assert_eq!(SymbolVisibility::from_str("private"), SymbolVisibility::Private);
        assert_eq!(SymbolVisibility::from_str("pub(crate)"), SymbolVisibility::Internal);
    }

    #[test]
    fn test_language_from_extension() {
        assert_eq!(Language::from_extension("ts"), Language::TypeScript);
        assert_eq!(Language::from_extension("tsx"), Language::TypeScript);
        assert_eq!(Language::from_extension("rs"), Language::Rust);
        assert_eq!(Language::from_extension("py"), Language::Python);
        assert_eq!(Language::from_extension("go"), Language::Go);
        assert_eq!(Language::from_extension("txt"), Language::Unknown);
    }

    #[test]
    fn test_index_build_options_default() {
        let opts = IndexBuildOptions::default();
        assert!(!opts.force_rebuild);
        assert!(!opts.deep_index);
        assert_eq!(opts.parallel_jobs, 4);
        assert!(!opts.include_patterns.is_empty());
        assert!(!opts.exclude_patterns.is_empty());
    }
}
