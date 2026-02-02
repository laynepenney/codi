// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! LSP types for code intelligence.
//!
//! These types mirror the LSP protocol types but are simplified for Codi's needs.

use serde::{Deserialize, Serialize};

/// Position in a text document (0-indexed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub struct Position {
    /// Line number (0-indexed).
    pub line: u32,
    /// Character offset (0-indexed, UTF-16 code units).
    pub character: u32,
}

impl Position {
    /// Create a new position.
    pub fn new(line: u32, character: u32) -> Self {
        Self { line, character }
    }

    /// Convert to 1-indexed line number for display.
    pub fn display_line(&self) -> u32 {
        self.line + 1
    }
}

impl std::fmt::Display for Position {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.display_line(), self.character + 1)
    }
}

/// A range in a text document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub struct Range {
    /// Start position (inclusive).
    pub start: Position,
    /// End position (exclusive).
    pub end: Position,
}

impl Range {
    /// Create a new range.
    pub fn new(start: Position, end: Position) -> Self {
        Self { start, end }
    }

    /// Create a range from line/character coordinates.
    pub fn from_coords(start_line: u32, start_char: u32, end_line: u32, end_char: u32) -> Self {
        Self {
            start: Position::new(start_line, start_char),
            end: Position::new(end_line, end_char),
        }
    }

    /// Check if a position is within this range.
    pub fn contains(&self, pos: Position) -> bool {
        if pos.line < self.start.line || pos.line > self.end.line {
            return false;
        }
        if pos.line == self.start.line && pos.character < self.start.character {
            return false;
        }
        if pos.line == self.end.line && pos.character >= self.end.character {
            return false;
        }
        true
    }
}

impl std::fmt::Display for Range {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}-{}", self.start, self.end)
    }
}

/// A location in a document.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Location {
    /// Document URI.
    pub uri: String,
    /// Range within the document.
    pub range: Range,
}

impl Location {
    /// Create a new location.
    pub fn new(uri: impl Into<String>, range: Range) -> Self {
        Self {
            uri: uri.into(),
            range,
        }
    }

    /// Get the file path from the URI.
    pub fn file_path(&self) -> Option<&str> {
        self.uri.strip_prefix("file://")
    }
}

impl std::fmt::Display for Location {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(path) = self.file_path() {
            write!(f, "{}:{}", path, self.range.start)
        } else {
            write!(f, "{}:{}", self.uri, self.range.start)
        }
    }
}

/// Diagnostic severity levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    /// Reports an error.
    Error = 1,
    /// Reports a warning.
    Warning = 2,
    /// Reports an information.
    Information = 3,
    /// Reports a hint.
    Hint = 4,
}

impl DiagnosticSeverity {
    /// Convert from LSP protocol number.
    pub fn from_lsp(value: i32) -> Option<Self> {
        match value {
            1 => Some(Self::Error),
            2 => Some(Self::Warning),
            3 => Some(Self::Information),
            4 => Some(Self::Hint),
            _ => None,
        }
    }

    /// Convert to LSP protocol number.
    pub fn to_lsp(self) -> i32 {
        self as i32
    }

    /// Get a short label for display.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Information => "info",
            Self::Hint => "hint",
        }
    }

    /// Get an icon/symbol for display.
    pub fn icon(&self) -> &'static str {
        match self {
            Self::Error => "✗",
            Self::Warning => "⚠",
            Self::Information => "ℹ",
            Self::Hint => "💡",
        }
    }
}

impl Default for DiagnosticSeverity {
    fn default() -> Self {
        Self::Information
    }
}

impl std::fmt::Display for DiagnosticSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// Diagnostic tags (additional metadata).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticTag {
    /// Unused or unnecessary code.
    Unnecessary = 1,
    /// Deprecated or obsolete code.
    Deprecated = 2,
}

impl DiagnosticTag {
    /// Convert from LSP protocol number.
    pub fn from_lsp(value: i32) -> Option<Self> {
        match value {
            1 => Some(Self::Unnecessary),
            2 => Some(Self::Deprecated),
            _ => None,
        }
    }

    /// Convert to LSP protocol number.
    pub fn to_lsp(self) -> i32 {
        self as i32
    }
}

/// A diagnostic message from the language server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    /// Range in the document.
    pub range: Range,
    /// Severity level.
    #[serde(default)]
    pub severity: DiagnosticSeverity,
    /// Diagnostic code (e.g., "E0001").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Source of the diagnostic (e.g., "rustc", "typescript").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Human-readable message.
    pub message: String,
    /// Diagnostic tags.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<DiagnosticTag>,
    /// Related information (e.g., "see also" locations).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_information: Vec<DiagnosticRelatedInformation>,
}

impl Diagnostic {
    /// Create a new diagnostic.
    pub fn new(range: Range, severity: DiagnosticSeverity, message: impl Into<String>) -> Self {
        Self {
            range,
            severity,
            code: None,
            source: None,
            message: message.into(),
            tags: Vec::new(),
            related_information: Vec::new(),
        }
    }

    /// Add a code to the diagnostic.
    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    /// Add a source to the diagnostic.
    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    /// Add a tag to the diagnostic.
    pub fn with_tag(mut self, tag: DiagnosticTag) -> Self {
        self.tags.push(tag);
        self
    }

    /// Check if this is an error.
    pub fn is_error(&self) -> bool {
        self.severity == DiagnosticSeverity::Error
    }

    /// Check if this is deprecated.
    pub fn is_deprecated(&self) -> bool {
        self.tags.contains(&DiagnosticTag::Deprecated)
    }

    /// Check if this is unnecessary/unused.
    pub fn is_unnecessary(&self) -> bool {
        self.tags.contains(&DiagnosticTag::Unnecessary)
    }
}

impl std::fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} {}: {}",
            self.severity.icon(),
            self.range.start,
            self.message
        )?;
        if let Some(ref code) = self.code {
            write!(f, " [{}]", code)?;
        }
        Ok(())
    }
}

/// Related information for a diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticRelatedInformation {
    /// Location of the related information.
    pub location: Location,
    /// Message explaining the relation.
    pub message: String,
}

/// Count of diagnostics by severity.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticCounts {
    /// Number of errors.
    pub errors: u32,
    /// Number of warnings.
    pub warnings: u32,
    /// Number of info messages.
    pub info: u32,
    /// Number of hints.
    pub hints: u32,
}

impl DiagnosticCounts {
    /// Create empty counts.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a diagnostic to the counts.
    pub fn add(&mut self, severity: DiagnosticSeverity) {
        match severity {
            DiagnosticSeverity::Error => self.errors += 1,
            DiagnosticSeverity::Warning => self.warnings += 1,
            DiagnosticSeverity::Information => self.info += 1,
            DiagnosticSeverity::Hint => self.hints += 1,
        }
    }

    /// Get total count.
    pub fn total(&self) -> u32 {
        self.errors + self.warnings + self.info + self.hints
    }

    /// Check if there are any errors.
    pub fn has_errors(&self) -> bool {
        self.errors > 0
    }

    /// Check if there are any issues (errors or warnings).
    pub fn has_issues(&self) -> bool {
        self.errors > 0 || self.warnings > 0
    }

    /// Merge another DiagnosticCounts into this one.
    pub fn merge(&mut self, other: &DiagnosticCounts) {
        self.errors += other.errors;
        self.warnings += other.warnings;
        self.info += other.info;
        self.hints += other.hints;
    }
}

impl std::fmt::Display for DiagnosticCounts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut parts = Vec::new();
        if self.errors > 0 {
            parts.push(format!("{} errors", self.errors));
        }
        if self.warnings > 0 {
            parts.push(format!("{} warnings", self.warnings));
        }
        if self.info > 0 {
            parts.push(format!("{} info", self.info));
        }
        if self.hints > 0 {
            parts.push(format!("{} hints", self.hints));
        }
        if parts.is_empty() {
            write!(f, "no issues")
        } else {
            write!(f, "{}", parts.join(", "))
        }
    }
}

/// LSP server state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerState {
    /// Server is starting up.
    Starting,
    /// Server is ready for requests.
    Ready,
    /// Server encountered an error.
    Error,
    /// Server is disabled.
    Disabled,
    /// Server has shut down.
    Shutdown,
}

impl Default for ServerState {
    fn default() -> Self {
        Self::Starting
    }
}

impl std::fmt::Display for ServerState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Starting => write!(f, "starting"),
            Self::Ready => write!(f, "ready"),
            Self::Error => write!(f, "error"),
            Self::Disabled => write!(f, "disabled"),
            Self::Shutdown => write!(f, "shutdown"),
        }
    }
}

/// Information about a text document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextDocumentInfo {
    /// Document URI.
    pub uri: String,
    /// Language identifier (e.g., "rust", "typescript").
    pub language_id: String,
    /// Document version.
    pub version: i32,
}

impl TextDocumentInfo {
    /// Create new document info.
    pub fn new(uri: impl Into<String>, language_id: impl Into<String>, version: i32) -> Self {
        Self {
            uri: uri.into(),
            language_id: language_id.into(),
            version,
        }
    }
}

/// Symbol kind for document/workspace symbols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum LspSymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
}

impl LspSymbolKind {
    /// Convert from LSP protocol number.
    pub fn from_lsp(value: i32) -> Option<Self> {
        match value {
            1 => Some(Self::File),
            2 => Some(Self::Module),
            3 => Some(Self::Namespace),
            4 => Some(Self::Package),
            5 => Some(Self::Class),
            6 => Some(Self::Method),
            7 => Some(Self::Property),
            8 => Some(Self::Field),
            9 => Some(Self::Constructor),
            10 => Some(Self::Enum),
            11 => Some(Self::Interface),
            12 => Some(Self::Function),
            13 => Some(Self::Variable),
            14 => Some(Self::Constant),
            15 => Some(Self::String),
            16 => Some(Self::Number),
            17 => Some(Self::Boolean),
            18 => Some(Self::Array),
            19 => Some(Self::Object),
            20 => Some(Self::Key),
            21 => Some(Self::Null),
            22 => Some(Self::EnumMember),
            23 => Some(Self::Struct),
            24 => Some(Self::Event),
            25 => Some(Self::Operator),
            26 => Some(Self::TypeParameter),
            _ => None,
        }
    }

    /// Convert to the symbol_index SymbolKind.
    pub fn to_symbol_kind(self) -> crate::symbol_index::SymbolKind {
        match self {
            Self::File | Self::Module | Self::Package => crate::symbol_index::SymbolKind::Module,
            Self::Namespace => crate::symbol_index::SymbolKind::Namespace,
            Self::Class => crate::symbol_index::SymbolKind::Class,
            Self::Method | Self::Constructor => crate::symbol_index::SymbolKind::Method,
            Self::Property => crate::symbol_index::SymbolKind::Property,
            Self::Field => crate::symbol_index::SymbolKind::Field,
            Self::Enum => crate::symbol_index::SymbolKind::Enum,
            Self::Interface => crate::symbol_index::SymbolKind::Interface,
            Self::Function => crate::symbol_index::SymbolKind::Function,
            Self::Variable => crate::symbol_index::SymbolKind::Variable,
            Self::Constant => crate::symbol_index::SymbolKind::Constant,
            Self::EnumMember => crate::symbol_index::SymbolKind::EnumMember,
            Self::Struct => crate::symbol_index::SymbolKind::Struct,
            Self::TypeParameter => crate::symbol_index::SymbolKind::Type,
            _ => crate::symbol_index::SymbolKind::Unknown,
        }
    }
}

/// Document symbol from LSP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSymbol {
    /// Symbol name.
    pub name: String,
    /// Symbol kind.
    pub kind: LspSymbolKind,
    /// Full range of the symbol.
    pub range: Range,
    /// Range of the symbol name.
    pub selection_range: Range,
    /// Detail information (e.g., signature).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Children symbols.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<DocumentSymbol>,
}

/// Workspace symbol from LSP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSymbol {
    /// Symbol name.
    pub name: String,
    /// Symbol kind.
    pub kind: LspSymbolKind,
    /// Location of the symbol.
    pub location: Location,
    /// Container name (e.g., class name for a method).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position() {
        let pos = Position::new(10, 5);
        assert_eq!(pos.line, 10);
        assert_eq!(pos.character, 5);
        assert_eq!(pos.display_line(), 11);
        assert_eq!(pos.to_string(), "11:6");
    }

    #[test]
    fn test_range_contains() {
        let range = Range::from_coords(5, 0, 10, 0);
        assert!(range.contains(Position::new(7, 0)));
        assert!(!range.contains(Position::new(4, 0)));
        assert!(!range.contains(Position::new(10, 0)));
    }

    #[test]
    fn test_diagnostic_severity() {
        assert_eq!(DiagnosticSeverity::from_lsp(1), Some(DiagnosticSeverity::Error));
        assert_eq!(DiagnosticSeverity::Error.to_lsp(), 1);
        assert_eq!(DiagnosticSeverity::Error.label(), "error");
        assert_eq!(DiagnosticSeverity::Warning.icon(), "⚠");
    }

    #[test]
    fn test_diagnostic_counts() {
        let mut counts = DiagnosticCounts::new();
        counts.add(DiagnosticSeverity::Error);
        counts.add(DiagnosticSeverity::Error);
        counts.add(DiagnosticSeverity::Warning);

        assert_eq!(counts.errors, 2);
        assert_eq!(counts.warnings, 1);
        assert_eq!(counts.total(), 3);
        assert!(counts.has_errors());
        assert!(counts.has_issues());
    }

    #[test]
    fn test_diagnostic_display() {
        let diag = Diagnostic::new(
            Range::from_coords(10, 5, 10, 15),
            DiagnosticSeverity::Error,
            "expected `;`",
        ).with_code("E0001");

        let display = diag.to_string();
        assert!(display.contains("11:6"));
        assert!(display.contains("expected `;`"));
        assert!(display.contains("E0001"));
    }

    #[test]
    fn test_location_file_path() {
        let loc = Location::new("file:///home/user/project/src/main.rs", Range::default());
        assert_eq!(loc.file_path(), Some("/home/user/project/src/main.rs"));

        let loc2 = Location::new("untitled:1", Range::default());
        assert_eq!(loc2.file_path(), None);
    }

    #[test]
    fn test_server_state_display() {
        assert_eq!(ServerState::Ready.to_string(), "ready");
        assert_eq!(ServerState::Error.to_string(), "error");
    }
}
