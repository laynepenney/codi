// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Syntax highlighting module for TUI.
//!
//! Provides tree-sitter based syntax highlighting for code blocks
//! with support for multiple languages and dark theme by default.

pub mod highlighter;

pub use highlighter::{HighlightType, SupportedLanguage, SyntaxHighlighter, Theme};
