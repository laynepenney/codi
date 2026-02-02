// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Markdown stream collector for incremental text rendering.
//!
//! This module implements the newline-gated accumulator pattern:
//! - Text deltas are accumulated in a buffer
//! - When a newline is encountered, complete lines are rendered
//! - Only newly-rendered lines are returned (avoiding duplication)
//! - At finalization, any remaining partial content is rendered
//!
//! The key insight is that we re-render the entire buffer on each commit,
//! but only emit lines that weren't emitted before. This keeps markdown
//! parsing stateless and handles edge cases like loose/tight lists.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

/// Markdown stream collector for incremental rendering.
///
/// Accumulates text deltas and renders complete lines to ratatui `Line` structs.
#[derive(Debug)]
pub struct MarkdownStreamCollector {
    /// Buffer for accumulating text.
    buffer: String,
    /// Number of lines already committed (for deduplication).
    committed_line_count: usize,
    /// Optional width for text wrapping.
    #[allow(dead_code)] // Reserved for future word-wrap implementation
    width: Option<usize>,
}

impl MarkdownStreamCollector {
    /// Create a new collector with optional width for text wrapping.
    pub fn new(width: Option<usize>) -> Self {
        Self {
            buffer: String::new(),
            committed_line_count: 0,
            width,
        }
    }

    /// Push a text delta into the buffer.
    pub fn push_delta(&mut self, delta: &str) {
        self.buffer.push_str(delta);
    }

    /// Get the current buffer content.
    pub fn buffer(&self) -> &str {
        &self.buffer
    }

    /// Commit complete lines (up to the last newline).
    ///
    /// Returns only the newly-rendered lines since the last commit.
    pub fn commit_complete_lines(&mut self) -> Vec<Line<'static>> {
        // Find the last newline
        let last_newline = match self.buffer.rfind('\n') {
            Some(idx) => idx,
            None => return Vec::new(), // No complete lines yet
        };

        // Get content up to (and including) the last newline
        let source = &self.buffer[..=last_newline];

        // Render the full content
        let rendered = self.render_markdown(source);

        // Calculate how many complete lines we have
        let complete_line_count = rendered.len();

        // Only return lines we haven't committed yet
        if complete_line_count > self.committed_line_count {
            let new_lines = rendered[self.committed_line_count..complete_line_count].to_vec();
            self.committed_line_count = complete_line_count;
            new_lines
        } else {
            Vec::new()
        }
    }

    /// Finalize the stream and return any remaining partial content.
    pub fn finalize_and_drain(&mut self) -> Vec<Line<'static>> {
        if self.buffer.is_empty() {
            return Vec::new();
        }

        // Render everything remaining
        let rendered = self.render_markdown(&self.buffer);

        // Return only uncommitted lines
        let new_lines = if rendered.len() > self.committed_line_count {
            rendered[self.committed_line_count..].to_vec()
        } else if self.committed_line_count == 0 && !rendered.is_empty() {
            rendered
        } else {
            Vec::new()
        };

        // Clear state
        self.buffer.clear();
        self.committed_line_count = 0;

        new_lines
    }

    /// Reset the collector for a new message.
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.committed_line_count = 0;
    }

    /// Render markdown text to ratatui Lines.
    ///
    /// This is a simple markdown renderer that handles:
    /// - Headings (#, ##, ###)
    /// - Code blocks (```)
    /// - Inline code (`code`)
    /// - Bold (**text**)
    /// - Italic (*text* or _text_)
    /// - Lists (- or *)
    /// - Blockquotes (>)
    fn render_markdown(&self, text: &str) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        let mut in_code_block = false;
        let mut code_block_lang = String::new();

        for line in text.lines() {
            if line.starts_with("```") {
                in_code_block = !in_code_block;
                if in_code_block {
                    code_block_lang = line.trim_start_matches('`').to_string();
                    // Don't emit the opening fence
                    continue;
                } else {
                    // Don't emit the closing fence
                    code_block_lang.clear();
                    continue;
                }
            }

            if in_code_block {
                // Code block content - render as plain text with code style
                let styled_line = Line::from(Span::styled(
                    line.to_string(),
                    Style::default().fg(Color::Yellow),
                ));
                lines.push(styled_line);
                continue;
            }

            // Handle different line types
            let rendered_line = if line.starts_with("### ") {
                // H3
                Line::from(Span::styled(
                    line[4..].to_string(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ))
            } else if line.starts_with("## ") {
                // H2
                Line::from(Span::styled(
                    line[3..].to_string(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ))
            } else if line.starts_with("# ") {
                // H1
                Line::from(Span::styled(
                    line[2..].to_string(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
                ))
            } else if line.starts_with("> ") {
                // Blockquote
                Line::from(vec![
                    Span::styled("│ ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        line[2..].to_string(),
                        Style::default().fg(Color::White).add_modifier(Modifier::ITALIC),
                    ),
                ])
            } else if line.starts_with("- ") || line.starts_with("* ") {
                // Unordered list
                let content = &line[2..];
                Line::from(vec![
                    Span::styled("• ", Style::default().fg(Color::Blue)),
                    Span::raw(self.render_inline_markdown(content)),
                ])
            } else if line.chars().next().map_or(false, |c| c.is_ascii_digit())
                && line.chars().nth(1) == Some('.')
            {
                // Ordered list (simple: 1. 2. etc)
                let dot_pos = line.find('.').unwrap_or(1);
                let number = &line[..dot_pos];
                let content = &line[dot_pos + 1..].trim_start();
                Line::from(vec![
                    Span::styled(
                        format!("{}. ", number),
                        Style::default().fg(Color::Blue),
                    ),
                    Span::raw(self.render_inline_markdown(content)),
                ])
            } else {
                // Regular paragraph
                self.render_inline_line(line)
            };

            lines.push(rendered_line);
        }

        lines
    }

    /// Render inline markdown (bold, italic, code) and return the text.
    fn render_inline_markdown(&self, text: &str) -> String {
        // For simplicity, strip markdown formatting for now
        // A full implementation would preserve styled spans
        text.replace("**", "")
            .replace("__", "")
            .replace('*', "")
            .replace('_', "")
    }

    /// Render a line with inline markdown to a ratatui Line.
    fn render_inline_line(&self, text: &str) -> Line<'static> {
        let mut spans = Vec::new();
        let mut current_text = String::new();
        let mut in_code = false;
        let mut in_bold = false;
        let mut chars = text.chars().peekable();

        while let Some(c) = chars.next() {
            if c == '`' && !in_bold {
                // Toggle code
                if !current_text.is_empty() {
                    let style = if in_code {
                        Style::default().fg(Color::Yellow)
                    } else {
                        Style::default()
                    };
                    spans.push(Span::styled(current_text.clone(), style));
                    current_text.clear();
                }
                in_code = !in_code;
            } else if c == '*' && !in_code {
                // Check for bold (**)
                if chars.peek() == Some(&'*') {
                    chars.next(); // consume second *
                    if !current_text.is_empty() {
                        let style = if in_bold {
                            Style::default().add_modifier(Modifier::BOLD)
                        } else {
                            Style::default()
                        };
                        spans.push(Span::styled(current_text.clone(), style));
                        current_text.clear();
                    }
                    in_bold = !in_bold;
                } else {
                    // Single * is italic, but for simplicity we ignore it
                    current_text.push(c);
                }
            } else {
                current_text.push(c);
            }
        }

        // Push remaining text
        if !current_text.is_empty() {
            let style = if in_code {
                Style::default().fg(Color::Yellow)
            } else if in_bold {
                Style::default().add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            spans.push(Span::styled(current_text, style));
        }

        if spans.is_empty() {
            Line::from("")
        } else {
            Line::from(spans)
        }
    }
}

impl Default for MarkdownStreamCollector {
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collector_basic() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        // Push partial line
        collector.push_delta("Hello");
        let lines = collector.commit_complete_lines();
        assert!(lines.is_empty()); // No newline yet

        // Complete the line
        collector.push_delta(", world!\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn test_collector_multiple_lines() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("Line 1\nLine 2\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 2);

        // No duplicates on second call
        let lines = collector.commit_complete_lines();
        assert!(lines.is_empty());
    }

    #[test]
    fn test_collector_incremental() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("Line 1\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 1);

        collector.push_delta("Line 2\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 1); // Only the new line
    }

    #[test]
    fn test_collector_finalize() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("Partial content without newline");
        let lines = collector.commit_complete_lines();
        assert!(lines.is_empty());

        // Finalize should emit the partial content
        let lines = collector.finalize_and_drain();
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn test_collector_heading() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("# Heading 1\n## Heading 2\n### Heading 3\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn test_collector_code_block() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("```rust\nfn main() {\n    println!(\"Hello\");\n}\n```\n");
        let lines = collector.commit_complete_lines();
        // Should have 3 lines of code content (fence lines are not emitted)
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn test_collector_list() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("- Item 1\n- Item 2\n* Item 3\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn test_collector_blockquote() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("> This is a quote\n> Continued quote\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn test_collector_inline_code() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("Use `code` here\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 1);
        // The line should have multiple spans (text, code, text)
    }

    #[test]
    fn test_collector_reset() {
        let mut collector = MarkdownStreamCollector::new(Some(80));

        collector.push_delta("Some content\n");
        collector.commit_complete_lines();

        collector.reset();
        assert!(collector.buffer().is_empty());

        collector.push_delta("New content\n");
        let lines = collector.commit_complete_lines();
        assert_eq!(lines.len(), 1);
    }
}
