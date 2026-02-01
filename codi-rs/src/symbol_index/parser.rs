// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tree-sitter based symbol extraction.
//!
//! Parses source files using tree-sitter grammars to extract symbols,
//! imports, and structure information.

use std::path::Path;
use std::time::Instant;

use sha2::{Digest, Sha256};
use tree_sitter::{Parser, Node};

use crate::error::ToolError;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::types::{
    CodeSymbol, ExtractionMethod, ImportStatement, ImportedSymbol,
    Language as LangType, SymbolKind, SymbolVisibility,
};

/// Result of parsing a source file.
#[derive(Debug, Clone)]
pub struct ParseResult {
    /// Content hash for change detection.
    pub hash: String,
    /// Extraction method used.
    pub method: ExtractionMethod,
    /// Extracted symbols.
    pub symbols: Vec<CodeSymbol>,
    /// Extracted imports.
    pub imports: Vec<ImportStatement>,
}

/// Symbol parser using tree-sitter.
pub struct SymbolParser {
    parsers: std::collections::HashMap<LangType, Parser>,
}

impl SymbolParser {
    /// Create a new symbol parser with all supported languages.
    pub fn new() -> Result<Self, ToolError> {
        let start = Instant::now();

        let mut parsers = std::collections::HashMap::new();

        // Initialize parsers for each language
        let languages = [
            (LangType::TypeScript, tree_sitter_typescript::LANGUAGE_TYPESCRIPT),
            (LangType::JavaScript, tree_sitter_javascript::LANGUAGE),
            (LangType::Rust, tree_sitter_rust::LANGUAGE),
            (LangType::Python, tree_sitter_python::LANGUAGE),
            (LangType::Go, tree_sitter_go::LANGUAGE),
        ];

        for (lang_type, lang) in languages {
            let mut parser = Parser::new();
            parser.set_language(&lang.into()).map_err(|e| {
                ToolError::ExecutionFailed(format!(
                    "Failed to set {:?} language: {}",
                    lang_type, e
                ))
            })?;
            parsers.insert(lang_type, parser);
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.new", start.elapsed());

        Ok(Self { parsers })
    }

    /// Parse a source file and extract symbols.
    pub fn parse_file(&mut self, path: &Path, content: &str) -> Result<ParseResult, ToolError> {
        let start = Instant::now();

        // Calculate content hash
        let hash = {
            let mut hasher = Sha256::new();
            hasher.update(content.as_bytes());
            format!("{:x}", hasher.finalize())
        };

        // Detect language
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let lang = LangType::from_extension(ext);

        let result = if let Some(parser) = self.parsers.get_mut(&lang) {
            // Parse with tree-sitter
            let tree = parser.parse(content, None).ok_or_else(|| {
                ToolError::ExecutionFailed(format!("Failed to parse file: {}", path.display()))
            })?;

            let symbols = self.extract_symbols(&tree.root_node(), content, lang)?;
            let imports = self.extract_imports(&tree.root_node(), content, lang)?;

            ParseResult {
                hash,
                method: ExtractionMethod::TreeSitter,
                symbols,
                imports,
            }
        } else {
            // Fallback to regex-based extraction for unknown languages
            let symbols = self.extract_symbols_regex(content)?;

            ParseResult {
                hash,
                method: ExtractionMethod::Regex,
                symbols,
                imports: Vec::new(),
            }
        };

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.parse_file", start.elapsed());

        Ok(result)
    }

    /// Extract symbols from a parsed tree.
    fn extract_symbols(
        &self,
        root: &Node,
        source: &str,
        lang: LangType,
    ) -> Result<Vec<CodeSymbol>, ToolError> {
        let start = Instant::now();

        let symbols = match lang {
            LangType::TypeScript | LangType::JavaScript => {
                self.extract_ts_symbols(root, source)?
            }
            LangType::Rust => self.extract_rust_symbols(root, source)?,
            LangType::Python => self.extract_python_symbols(root, source)?,
            LangType::Go => self.extract_go_symbols(root, source)?,
            _ => Vec::new(),
        };

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_symbols", start.elapsed());

        Ok(symbols)
    }

    /// Extract TypeScript/JavaScript symbols.
    fn extract_ts_symbols(&self, root: &Node, source: &str) -> Result<Vec<CodeSymbol>, ToolError> {
        let start = Instant::now();
        let mut symbols = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            let kind = node.kind();

            match kind {
                "function_declaration" | "method_definition" | "arrow_function" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: if kind == "method_definition" {
                                SymbolKind::Method
                            } else {
                                SymbolKind::Function
                            },
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_ts_visibility(node, source_bytes),
                            signature: self.get_node_text(node, source_bytes),
                            doc_summary: self.get_preceding_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "class_declaration" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Class,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_ts_visibility(node, source_bytes),
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: self.get_preceding_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "interface_declaration" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Interface,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: SymbolVisibility::Public,
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: self.get_preceding_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "type_alias_declaration" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::TypeAlias,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: SymbolVisibility::Public,
                            signature: self.get_node_text(node, source_bytes),
                            doc_summary: self.get_preceding_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "enum_declaration" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Enum,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: SymbolVisibility::Public,
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: self.get_preceding_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "variable_declaration" | "lexical_declaration" => {
                    // Handle const/let/var declarations
                    for i in 0..node.child_count() {
                        if let Some(child) = node.child(i) {
                            if child.kind() == "variable_declarator" {
                                if let Some(name) = self.get_child_by_field(&child, "name", source_bytes) {
                                    symbols.push(CodeSymbol {
                                        name,
                                        kind: SymbolKind::Variable,
                                        line: node.start_position().row as u32 + 1,
                                        end_line: Some(node.end_position().row as u32 + 1),
                                        column: node.start_position().column as u32,
                                        visibility: SymbolVisibility::Unknown,
                                        signature: self.get_node_text(node, source_bytes),
                                        doc_summary: None,
                                        metadata: None,
                                    });
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_ts_symbols", start.elapsed());

        Ok(symbols)
    }

    /// Extract Rust symbols.
    fn extract_rust_symbols(&self, root: &Node, source: &str) -> Result<Vec<CodeSymbol>, ToolError> {
        let start = Instant::now();
        let mut symbols = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            let kind = node.kind();

            match kind {
                "function_item" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Function,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_rust_visibility(node, source_bytes),
                            signature: self.get_rust_signature(node, source_bytes),
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "struct_item" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Struct,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_rust_visibility(node, source_bytes),
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "enum_item" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Enum,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_rust_visibility(node, source_bytes),
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "trait_item" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Trait,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_rust_visibility(node, source_bytes),
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "impl_item" => {
                    if let Some(type_node) = node.child_by_field_name("type") {
                        let name = self.node_text(&type_node, source_bytes);
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Impl,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: SymbolVisibility::Unknown,
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: None,
                            metadata: None,
                        });
                    }
                }
                "mod_item" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Module,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_rust_visibility(node, source_bytes),
                            signature: None,
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "const_item" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Constant,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_rust_visibility(node, source_bytes),
                            signature: self.get_node_text(node, source_bytes),
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "type_item" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::TypeAlias,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: self.get_rust_visibility(node, source_bytes),
                            signature: self.get_node_text(node, source_bytes),
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "macro_definition" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name,
                            kind: SymbolKind::Macro,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: SymbolVisibility::Unknown,
                            signature: None,
                            doc_summary: self.get_rust_doc_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                _ => {}
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_rust_symbols", start.elapsed());

        Ok(symbols)
    }

    /// Extract Python symbols.
    fn extract_python_symbols(&self, root: &Node, source: &str) -> Result<Vec<CodeSymbol>, ToolError> {
        let start = Instant::now();
        let mut symbols = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            let kind = node.kind();

            match kind {
                "function_definition" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        let is_method = node.parent()
                            .map(|p| p.kind() == "class_definition")
                            .unwrap_or(false);

                        symbols.push(CodeSymbol {
                            name: name.clone(),
                            kind: if is_method { SymbolKind::Method } else { SymbolKind::Function },
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: if name.starts_with("_") && !name.starts_with("__") {
                                SymbolVisibility::Private
                            } else {
                                SymbolVisibility::Public
                            },
                            signature: self.get_python_signature(node, source_bytes),
                            doc_summary: self.get_python_docstring(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "class_definition" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name: name.clone(),
                            kind: SymbolKind::Class,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: if name.starts_with("_") {
                                SymbolVisibility::Private
                            } else {
                                SymbolVisibility::Public
                            },
                            signature: self.get_signature_line(node, source_bytes),
                            doc_summary: self.get_python_docstring(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                _ => {}
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_python_symbols", start.elapsed());

        Ok(symbols)
    }

    /// Extract Go symbols.
    fn extract_go_symbols(&self, root: &Node, source: &str) -> Result<Vec<CodeSymbol>, ToolError> {
        let start = Instant::now();
        let mut symbols = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            let kind = node.kind();

            match kind {
                "function_declaration" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name: name.clone(),
                            kind: SymbolKind::Function,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                                SymbolVisibility::Public
                            } else {
                                SymbolVisibility::Private
                            },
                            signature: self.get_go_signature(node, source_bytes),
                            doc_summary: self.get_preceding_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "method_declaration" => {
                    if let Some(name) = self.get_child_by_field(node, "name", source_bytes) {
                        symbols.push(CodeSymbol {
                            name: name.clone(),
                            kind: SymbolKind::Method,
                            line: node.start_position().row as u32 + 1,
                            end_line: Some(node.end_position().row as u32 + 1),
                            column: node.start_position().column as u32,
                            visibility: if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                                SymbolVisibility::Public
                            } else {
                                SymbolVisibility::Private
                            },
                            signature: self.get_go_signature(node, source_bytes),
                            doc_summary: self.get_preceding_comment(node, source_bytes),
                            metadata: None,
                        });
                    }
                }
                "type_declaration" => {
                    for i in 0..node.child_count() {
                        if let Some(spec) = node.child(i) {
                            if spec.kind() == "type_spec" {
                                if let Some(name) = self.get_child_by_field(&spec, "name", source_bytes) {
                                    let type_kind = spec.child_by_field_name("type")
                                        .map(|t| t.kind())
                                        .unwrap_or("");

                                    let symbol_kind = match type_kind {
                                        "struct_type" => SymbolKind::Struct,
                                        "interface_type" => SymbolKind::Interface,
                                        _ => SymbolKind::TypeAlias,
                                    };

                                    symbols.push(CodeSymbol {
                                        name: name.clone(),
                                        kind: symbol_kind,
                                        line: spec.start_position().row as u32 + 1,
                                        end_line: Some(spec.end_position().row as u32 + 1),
                                        column: spec.start_position().column as u32,
                                        visibility: if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                                            SymbolVisibility::Public
                                        } else {
                                            SymbolVisibility::Private
                                        },
                                        signature: self.get_signature_line(&spec, source_bytes),
                                        doc_summary: self.get_preceding_comment(node, source_bytes),
                                        metadata: None,
                                    });
                                }
                            }
                        }
                    }
                }
                "const_declaration" | "var_declaration" => {
                    for i in 0..node.child_count() {
                        if let Some(spec) = node.child(i) {
                            if spec.kind() == "const_spec" || spec.kind() == "var_spec" {
                                if let Some(name_node) = spec.child_by_field_name("name") {
                                    let name = self.node_text(&name_node, source_bytes);
                                    symbols.push(CodeSymbol {
                                        name: name.clone(),
                                        kind: if kind == "const_declaration" {
                                            SymbolKind::Constant
                                        } else {
                                            SymbolKind::Variable
                                        },
                                        line: spec.start_position().row as u32 + 1,
                                        end_line: Some(spec.end_position().row as u32 + 1),
                                        column: spec.start_position().column as u32,
                                        visibility: if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                                            SymbolVisibility::Public
                                        } else {
                                            SymbolVisibility::Private
                                        },
                                        signature: self.get_node_text(&spec, source_bytes),
                                        doc_summary: None,
                                        metadata: None,
                                    });
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_go_symbols", start.elapsed());

        Ok(symbols)
    }

    /// Extract imports from a parsed tree.
    fn extract_imports(
        &self,
        root: &Node,
        source: &str,
        lang: LangType,
    ) -> Result<Vec<ImportStatement>, ToolError> {
        let start = Instant::now();

        let imports = match lang {
            LangType::TypeScript | LangType::JavaScript => {
                self.extract_ts_imports(root, source)?
            }
            LangType::Rust => self.extract_rust_imports(root, source)?,
            LangType::Python => self.extract_python_imports(root, source)?,
            LangType::Go => self.extract_go_imports(root, source)?,
            _ => Vec::new(),
        };

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_imports", start.elapsed());

        Ok(imports)
    }

    /// Extract TypeScript/JavaScript imports.
    fn extract_ts_imports(&self, root: &Node, source: &str) -> Result<Vec<ImportStatement>, ToolError> {
        let start = Instant::now();
        let mut imports = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            if node.kind() == "import_statement" {
                let line = node.start_position().row as u32 + 1;

                // Get source module
                let source_path = node.child_by_field_name("source")
                    .map(|n| self.node_text(&n, source_bytes).trim_matches('"').trim_matches('\'').to_string())
                    .unwrap_or_default();

                // Check if type-only import
                let is_type_only = node.children(&mut node.walk())
                    .any(|c| c.kind() == "type");

                let mut symbols = Vec::new();

                // Handle import clause
                if let Some(clause) = node.child_by_field_name("import") {
                    // Default import
                    if clause.kind() == "identifier" {
                        symbols.push(ImportedSymbol {
                            name: self.node_text(&clause, source_bytes),
                            alias: None,
                            is_default: true,
                            is_namespace: false,
                        });
                    }

                    // Named imports
                    self.walk_tree(&clause, &mut |child| {
                        match child.kind() {
                            "import_specifier" => {
                                let name = child.child_by_field_name("name")
                                    .map(|n| self.node_text(&n, source_bytes))
                                    .unwrap_or_default();
                                let alias = child.child_by_field_name("alias")
                                    .map(|n| self.node_text(&n, source_bytes));

                                symbols.push(ImportedSymbol {
                                    name,
                                    alias,
                                    is_default: false,
                                    is_namespace: false,
                                });
                            }
                            "namespace_import" => {
                                if let Some(alias_node) = child.child_by_field_name("alias") {
                                    symbols.push(ImportedSymbol {
                                        name: "*".to_string(),
                                        alias: Some(self.node_text(&alias_node, source_bytes)),
                                        is_default: false,
                                        is_namespace: true,
                                    });
                                }
                            }
                            _ => {}
                        }
                    });
                }

                if !source_path.is_empty() {
                    imports.push(ImportStatement {
                        source: source_path,
                        line,
                        is_type_only,
                        symbols,
                    });
                }
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_ts_imports", start.elapsed());

        Ok(imports)
    }

    /// Extract Rust imports (use statements).
    fn extract_rust_imports(&self, root: &Node, source: &str) -> Result<Vec<ImportStatement>, ToolError> {
        let start = Instant::now();
        let mut imports = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            if node.kind() == "use_declaration" {
                let line = node.start_position().row as u32 + 1;
                let _use_text = self.node_text(node, source_bytes);

                // Extract the path from the use statement
                if let Some(path_node) = node.child_by_field_name("argument") {
                    let source_path = self.node_text(&path_node, source_bytes);

                    imports.push(ImportStatement {
                        source: source_path.clone(),
                        line,
                        is_type_only: false,
                        symbols: vec![ImportedSymbol {
                            name: source_path,
                            alias: None,
                            is_default: false,
                            is_namespace: false,
                        }],
                    });
                }
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_rust_imports", start.elapsed());

        Ok(imports)
    }

    /// Extract Python imports.
    fn extract_python_imports(&self, root: &Node, source: &str) -> Result<Vec<ImportStatement>, ToolError> {
        let start = Instant::now();
        let mut imports = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            match node.kind() {
                "import_statement" => {
                    let line = node.start_position().row as u32 + 1;

                    for i in 0..node.child_count() {
                        if let Some(child) = node.child(i) {
                            if child.kind() == "dotted_name" {
                                let module = self.node_text(&child, source_bytes);
                                imports.push(ImportStatement {
                                    source: module.clone(),
                                    line,
                                    is_type_only: false,
                                    symbols: vec![ImportedSymbol {
                                        name: module,
                                        alias: None,
                                        is_default: false,
                                        is_namespace: true,
                                    }],
                                });
                            }
                        }
                    }
                }
                "import_from_statement" => {
                    let line = node.start_position().row as u32 + 1;

                    let module = node.child_by_field_name("module_name")
                        .map(|n| self.node_text(&n, source_bytes))
                        .unwrap_or_default();

                    let mut symbols = Vec::new();

                    for i in 0..node.child_count() {
                        if let Some(child) = node.child(i) {
                            if child.kind() == "aliased_import" {
                                let name = child.child_by_field_name("name")
                                    .map(|n| self.node_text(&n, source_bytes))
                                    .unwrap_or_default();
                                let alias = child.child_by_field_name("alias")
                                    .map(|n| self.node_text(&n, source_bytes));

                                symbols.push(ImportedSymbol {
                                    name,
                                    alias,
                                    is_default: false,
                                    is_namespace: false,
                                });
                            } else if child.kind() == "dotted_name" && i > 1 {
                                symbols.push(ImportedSymbol {
                                    name: self.node_text(&child, source_bytes),
                                    alias: None,
                                    is_default: false,
                                    is_namespace: false,
                                });
                            }
                        }
                    }

                    if !module.is_empty() {
                        imports.push(ImportStatement {
                            source: module,
                            line,
                            is_type_only: false,
                            symbols,
                        });
                    }
                }
                _ => {}
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_python_imports", start.elapsed());

        Ok(imports)
    }

    /// Extract Go imports.
    fn extract_go_imports(&self, root: &Node, source: &str) -> Result<Vec<ImportStatement>, ToolError> {
        let start = Instant::now();
        let mut imports = Vec::new();
        let source_bytes = source.as_bytes();

        self.walk_tree(root, &mut |node| {
            if node.kind() == "import_declaration" {
                for i in 0..node.child_count() {
                    if let Some(child) = node.child(i) {
                        if child.kind() == "import_spec" || child.kind() == "import_spec_list" {
                            self.walk_tree(&child, &mut |spec| {
                                if spec.kind() == "import_spec" {
                                    let path = spec.child_by_field_name("path")
                                        .map(|n| self.node_text(&n, source_bytes).trim_matches('"').to_string())
                                        .unwrap_or_default();

                                    let alias = spec.child_by_field_name("name")
                                        .map(|n| self.node_text(&n, source_bytes));

                                    if !path.is_empty() {
                                        imports.push(ImportStatement {
                                            source: path.clone(),
                                            line: spec.start_position().row as u32 + 1,
                                            is_type_only: false,
                                            symbols: vec![ImportedSymbol {
                                                name: path,
                                                alias,
                                                is_default: false,
                                                is_namespace: true,
                                            }],
                                        });
                                    }
                                }
                            });
                        } else if child.kind() == "interpreted_string_literal" {
                            let path = self.node_text(&child, source_bytes).trim_matches('"').to_string();
                            if !path.is_empty() {
                                imports.push(ImportStatement {
                                    source: path.clone(),
                                    line: node.start_position().row as u32 + 1,
                                    is_type_only: false,
                                    symbols: vec![ImportedSymbol {
                                        name: path,
                                        alias: None,
                                        is_default: false,
                                        is_namespace: true,
                                    }],
                                });
                            }
                        }
                    }
                }
            }
        });

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_go_imports", start.elapsed());

        Ok(imports)
    }

    /// Regex-based symbol extraction fallback.
    fn extract_symbols_regex(&self, content: &str) -> Result<Vec<CodeSymbol>, ToolError> {
        let start = Instant::now();
        let mut symbols = Vec::new();

        // Simple regex patterns for common constructs
        let patterns = [
            (r"(?m)^(?:export\s+)?(?:async\s+)?function\s+(\w+)", SymbolKind::Function),
            (r"(?m)^(?:export\s+)?class\s+(\w+)", SymbolKind::Class),
            (r"(?m)^(?:export\s+)?interface\s+(\w+)", SymbolKind::Interface),
            (r"(?m)^(?:export\s+)?type\s+(\w+)", SymbolKind::TypeAlias),
            (r"(?m)^(?:export\s+)?enum\s+(\w+)", SymbolKind::Enum),
            (r"(?m)^(?:pub\s+)?fn\s+(\w+)", SymbolKind::Function),
            (r"(?m)^(?:pub\s+)?struct\s+(\w+)", SymbolKind::Struct),
            (r"(?m)^(?:pub\s+)?enum\s+(\w+)", SymbolKind::Enum),
            (r"(?m)^(?:pub\s+)?trait\s+(\w+)", SymbolKind::Trait),
            (r"(?m)^def\s+(\w+)", SymbolKind::Function),
            (r"(?m)^class\s+(\w+)", SymbolKind::Class),
            (r"(?m)^func\s+(\w+)", SymbolKind::Function),
            (r"(?m)^type\s+(\w+)\s+struct", SymbolKind::Struct),
        ];

        for (pattern, kind) in patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                for (line_num, line) in content.lines().enumerate() {
                    if let Some(caps) = re.captures(line) {
                        if let Some(name) = caps.get(1) {
                            symbols.push(CodeSymbol {
                                name: name.as_str().to_string(),
                                kind,
                                line: line_num as u32 + 1,
                                end_line: None,
                                column: 0,
                                visibility: SymbolVisibility::Unknown,
                                signature: Some(line.trim().to_string()),
                                doc_summary: None,
                                metadata: None,
                            });
                        }
                    }
                }
            }
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("symbol_index.parser.extract_symbols_regex", start.elapsed());

        Ok(symbols)
    }

    // Helper methods

    /// Walk the tree depth-first, calling the callback for each node.
    fn walk_tree<F>(&self, node: &Node, callback: &mut F)
    where
        F: FnMut(&Node),
    {
        callback(node);
        for i in 0..node.child_count() {
            if let Some(child) = node.child(i) {
                self.walk_tree(&child, callback);
            }
        }
    }

    /// Get text content of a node.
    fn node_text(&self, node: &Node, source: &[u8]) -> String {
        node.utf8_text(source).unwrap_or("").to_string()
    }

    /// Get a child node by field name and return its text.
    fn get_child_by_field(&self, node: &Node, field: &str, source: &[u8]) -> Option<String> {
        node.child_by_field_name(field)
            .map(|n| self.node_text(&n, source))
    }

    /// Get the full text of a node (for signatures).
    fn get_node_text(&self, node: &Node, source: &[u8]) -> Option<String> {
        let text = self.node_text(node, source);
        if text.len() > 200 {
            Some(format!("{}...", &text[..197]))
        } else {
            Some(text)
        }
    }

    /// Get just the first line of a node (for type signatures).
    fn get_signature_line(&self, node: &Node, source: &[u8]) -> Option<String> {
        let text = self.node_text(node, source);
        text.lines().next().map(|s| s.to_string())
    }

    /// Get TypeScript/JavaScript visibility.
    fn get_ts_visibility(&self, node: &Node, source: &[u8]) -> SymbolVisibility {
        // Check for export keyword
        if let Some(parent) = node.parent() {
            for i in 0..parent.child_count() {
                if let Some(child) = parent.child(i) {
                    let text = self.node_text(&child, source);
                    if text == "export" {
                        return SymbolVisibility::Public;
                    }
                }
            }
        }

        // Check for modifiers on the node itself
        for i in 0..node.child_count() {
            if let Some(child) = node.child(i) {
                let text = self.node_text(&child, source);
                match text.as_str() {
                    "public" | "export" => return SymbolVisibility::Public,
                    "private" => return SymbolVisibility::Private,
                    "protected" => return SymbolVisibility::Protected,
                    _ => {}
                }
            }
        }

        SymbolVisibility::Unknown
    }

    /// Get Rust visibility.
    fn get_rust_visibility(&self, node: &Node, source: &[u8]) -> SymbolVisibility {
        for i in 0..node.child_count() {
            if let Some(child) = node.child(i) {
                if child.kind() == "visibility_modifier" {
                    let text = self.node_text(&child, source);
                    if text.contains("pub(crate)") {
                        return SymbolVisibility::Internal;
                    } else if text.starts_with("pub") {
                        return SymbolVisibility::Public;
                    }
                }
            }
        }
        SymbolVisibility::Private
    }

    /// Get Rust function signature.
    fn get_rust_signature(&self, node: &Node, source: &[u8]) -> Option<String> {
        // Find the function body and exclude it
        let text = self.node_text(node, source);
        if let Some(pos) = text.find('{') {
            Some(text[..pos].trim().to_string())
        } else {
            Some(text)
        }
    }

    /// Get Rust doc comment.
    fn get_rust_doc_comment(&self, node: &Node, source: &[u8]) -> Option<String> {
        // Look for preceding doc comments
        if let Some(parent) = node.parent() {
            let mut prev_sibling = None;
            for i in 0..parent.child_count() {
                if let Some(child) = parent.child(i) {
                    if child.id() == node.id() {
                        break;
                    }
                    prev_sibling = Some(child);
                }
            }

            if let Some(prev) = prev_sibling {
                let text = self.node_text(&prev, source);
                if text.starts_with("///") || text.starts_with("//!") {
                    let lines: Vec<&str> = text
                        .lines()
                        .map(|l| l.trim_start_matches('/').trim())
                        .take(3)
                        .collect();
                    return Some(lines.join(" "));
                }
            }
        }
        None
    }

    /// Get Python function signature.
    fn get_python_signature(&self, node: &Node, source: &[u8]) -> Option<String> {
        // Get the def line including parameters
        let text = self.node_text(node, source);
        if let Some(pos) = text.find(':') {
            Some(text[..pos].trim().to_string())
        } else {
            Some(text.lines().next().unwrap_or("").to_string())
        }
    }

    /// Get Python docstring.
    fn get_python_docstring(&self, node: &Node, source: &[u8]) -> Option<String> {
        // Look for string expression as first statement in body
        if let Some(body) = node.child_by_field_name("body") {
            for i in 0..body.child_count() {
                if let Some(child) = body.child(i) {
                    if child.kind() == "expression_statement" {
                        if let Some(expr) = child.child(0) {
                            if expr.kind() == "string" {
                                let text = self.node_text(&expr, source);
                                let trimmed = text.trim_matches('"').trim_matches('\'').trim();
                                let first_line = trimmed.lines().next().unwrap_or(trimmed);
                                return Some(first_line.to_string());
                            }
                        }
                    }
                    break; // Only check first statement
                }
            }
        }
        None
    }

    /// Get Go function signature.
    fn get_go_signature(&self, node: &Node, source: &[u8]) -> Option<String> {
        let text = self.node_text(node, source);
        if let Some(pos) = text.find('{') {
            Some(text[..pos].trim().to_string())
        } else {
            Some(text.lines().next().unwrap_or("").to_string())
        }
    }

    /// Get preceding comment for documentation.
    fn get_preceding_comment(&self, node: &Node, source: &[u8]) -> Option<String> {
        if let Some(parent) = node.parent() {
            let mut prev_sibling = None;
            for i in 0..parent.child_count() {
                if let Some(child) = parent.child(i) {
                    if child.id() == node.id() {
                        break;
                    }
                    if child.kind().contains("comment") {
                        prev_sibling = Some(child);
                    }
                }
            }

            if let Some(prev) = prev_sibling {
                let text = self.node_text(&prev, source);
                let cleaned: String = text
                    .lines()
                    .map(|l| l.trim_start_matches('/').trim_start_matches('*').trim())
                    .filter(|l| !l.is_empty())
                    .take(3)
                    .collect::<Vec<_>>()
                    .join(" ");
                if !cleaned.is_empty() {
                    return Some(cleaned);
                }
            }
        }
        None
    }
}

impl Default for SymbolParser {
    fn default() -> Self {
        Self::new().expect("Failed to create SymbolParser")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_parser_new() {
        let parser = SymbolParser::new();
        assert!(parser.is_ok());
    }

    #[test]
    fn test_parse_typescript() {
        let mut parser = SymbolParser::new().unwrap();
        let path = PathBuf::from("test.ts");
        let content = r#"
export function hello(name: string): string {
    return `Hello, ${name}!`;
}

export class Greeter {
    private name: string;

    constructor(name: string) {
        this.name = name;
    }

    greet(): string {
        return hello(this.name);
    }
}

export interface Greeting {
    message: string;
}

export type GreetingType = "formal" | "casual";
"#;

        let result = parser.parse_file(&path, content).unwrap();
        assert_eq!(result.method, ExtractionMethod::TreeSitter);

        // Check symbols
        let names: Vec<&str> = result.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"hello"));
        assert!(names.contains(&"Greeter"));
        assert!(names.contains(&"Greeting"));
        assert!(names.contains(&"GreetingType"));
    }

    #[test]
    fn test_parse_rust() {
        let mut parser = SymbolParser::new().unwrap();
        let path = PathBuf::from("test.rs");
        let content = r#"
/// A greeting function.
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

pub struct Config {
    pub name: String,
    value: i32,
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Greetable {
    fn greet(&self) -> String;
}

impl Greetable for Config {
    fn greet(&self) -> String {
        greet(&self.name)
    }
}
"#;

        let result = parser.parse_file(&path, content).unwrap();
        assert_eq!(result.method, ExtractionMethod::TreeSitter);

        let names: Vec<&str> = result.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"greet"));
        assert!(names.contains(&"Config"));
        assert!(names.contains(&"Status"));
        assert!(names.contains(&"Greetable"));
    }

    #[test]
    fn test_parse_python() {
        let mut parser = SymbolParser::new().unwrap();
        let path = PathBuf::from("test.py");
        let content = r#"
def greet(name: str) -> str:
    """Greet someone by name."""
    return f"Hello, {name}!"

class Greeter:
    """A greeter class."""

    def __init__(self, name: str):
        self._name = name

    def greet(self) -> str:
        return greet(self._name)

    def _private_method(self):
        pass
"#;

        let result = parser.parse_file(&path, content).unwrap();
        assert_eq!(result.method, ExtractionMethod::TreeSitter);

        let names: Vec<&str> = result.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"greet"));
        assert!(names.contains(&"Greeter"));
    }

    #[test]
    fn test_parse_go() {
        let mut parser = SymbolParser::new().unwrap();
        let path = PathBuf::from("test.go");
        let content = r#"
package main

import "fmt"

// Greet greets someone.
func Greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}

type Config struct {
    Name string
    value int
}

type Greeter interface {
    Greet() string
}

func (c *Config) Greet() string {
    return Greet(c.Name)
}
"#;

        let result = parser.parse_file(&path, content).unwrap();
        assert_eq!(result.method, ExtractionMethod::TreeSitter);

        let names: Vec<&str> = result.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"Greet"));
        assert!(names.contains(&"Config"));
        assert!(names.contains(&"Greeter"));
    }

    #[test]
    fn test_parse_unknown_language() {
        let mut parser = SymbolParser::new().unwrap();
        let path = PathBuf::from("test.xyz");
        let content = "function hello() {}";

        let result = parser.parse_file(&path, content).unwrap();
        assert_eq!(result.method, ExtractionMethod::Regex);
    }

    #[test]
    fn test_content_hash() {
        let mut parser = SymbolParser::new().unwrap();
        let path = PathBuf::from("test.ts");

        let result1 = parser.parse_file(&path, "const a = 1;").unwrap();
        let result2 = parser.parse_file(&path, "const a = 1;").unwrap();
        let result3 = parser.parse_file(&path, "const b = 2;").unwrap();

        assert_eq!(result1.hash, result2.hash);
        assert_ne!(result1.hash, result3.hash);
    }

    #[test]
    fn test_ts_imports() {
        let mut parser = SymbolParser::new().unwrap();
        let path = PathBuf::from("test.ts");
        let content = r#"
import { foo, bar as baz } from './module';
import * as utils from '../utils';
import type { Config } from './types';
import defaultExport from 'package';
"#;

        let result = parser.parse_file(&path, content).unwrap();
        assert!(!result.imports.is_empty());

        let sources: Vec<&str> = result.imports.iter().map(|i| i.source.as_str()).collect();
        assert!(sources.contains(&"./module"));
        assert!(sources.contains(&"../utils"));
        assert!(sources.contains(&"./types"));
        assert!(sources.contains(&"package"));
    }
}
