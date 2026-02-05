// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Diff view component for rendering unified diffs in the TUI.
//!
//! This component renders a unified diff with color coding:
//! - Green for added lines
//! - Red for removed lines
//! - Gray for context lines
//!
//! It handles scrolling for large diffs and displays line numbers.

use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Paragraph, StatefulWidget, Widget},
};

use crate::tui::diff::{DiffLine, UnifiedDiff};

/// Scroll state for the diff view.
#[derive(Debug, Clone, Default)]
pub struct DiffViewState {
    /// Vertical scroll offset.
    pub scroll_offset: usize,
    /// Whether the view is focused.
    pub focused: bool,
}

impl DiffViewState {
    /// Create a new state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Scroll up by n lines.
    pub fn scroll_up(&mut self, n: usize) {
        self.scroll_offset = self.scroll_offset.saturating_sub(n);
    }

    /// Scroll down by n lines.
    pub fn scroll_down(&mut self, n: usize, max_scroll: usize) {
        self.scroll_offset = (self.scroll_offset + n).min(max_scroll);
    }

    /// Scroll to the top.
    pub fn scroll_to_top(&mut self) {
        self.scroll_offset = 0;
    }

    /// Scroll to the bottom.
    pub fn scroll_to_bottom(&mut self, max_scroll: usize) {
        self.scroll_offset = max_scroll;
    }
}

/// Configuration for the diff view appearance.
#[derive(Debug, Clone)]
pub struct DiffViewConfig {
    /// Style for added lines (default: green).
    pub added_style: Style,
    /// Style for removed lines (default: red).
    pub removed_style: Style,
    /// Style for context lines (default: gray).
    pub context_style: Style,
    /// Style for line numbers (default: dark gray).
    pub line_number_style: Style,
    /// Style for the header (default: cyan).
    pub header_style: Style,
    /// Style for hunk headers (default: yellow).
    pub hunk_header_style: Style,
    /// Whether to show line numbers.
    pub show_line_numbers: bool,
    /// Width of the line number column.
    pub line_number_width: u16,
    /// Whether to use a block border.
    pub show_border: bool,
}

impl Default for DiffViewConfig {
    fn default() -> Self {
        Self {
            added_style: Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
            removed_style: Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            context_style: Style::default().fg(Color::Gray),
            line_number_style: Style::default().fg(Color::DarkGray),
            header_style: Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
            hunk_header_style: Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
            show_line_numbers: true,
            line_number_width: 6,
            show_border: true,
        }
    }
}

/// A widget for rendering unified diffs.
#[derive(Debug, Clone)]
pub struct DiffView<'a> {
    diff: &'a UnifiedDiff,
    config: DiffViewConfig,
    block: Option<Block<'a>>,
}

impl<'a> DiffView<'a> {
    /// Create a new diff view with default configuration.
    pub fn new(diff: &'a UnifiedDiff) -> Self {
        Self {
            diff,
            config: DiffViewConfig::default(),
            block: None,
        }
    }

    /// Create a new diff view with custom configuration.
    pub fn with_config(diff: &'a UnifiedDiff, config: DiffViewConfig) -> Self {
        Self {
            diff,
            config,
            block: None,
        }
    }

    /// Set the block (border) for the diff view.
    pub fn block(mut self, block: Block<'a>) -> Self {
        self.block = Some(block);
        self
    }

    /// Disable line numbers.
    pub fn hide_line_numbers(mut self) -> Self {
        self.config.show_line_numbers = false;
        self
    }

    /// Set whether to show the border.
    pub fn show_border(mut self, show: bool) -> Self {
        self.config.show_border = show;
        self
    }

    /// Calculate the total number of lines in the rendered diff.
    pub fn total_lines(&self) -> usize {
        let mut count = 0;

        // Header lines
        count += 2; // --- and +++ lines

        // Hunk lines
        for hunk in &self.diff.hunks {
            count += 1; // Hunk header
            count += hunk.lines.len();
        }

        count
    }

    /// Render the diff into a vector of styled lines.
    fn render_lines(&self) -> Vec<Line<'a>> {
        let mut lines = Vec::new();
        let cfg = &self.config;

        // Header lines
        lines.push(Line::from(vec![
            Span::styled("--- ", cfg.header_style),
            Span::styled(self.diff.old_file.clone(), cfg.context_style),
        ]));
        lines.push(Line::from(vec![
            Span::styled("+++ ", cfg.header_style),
            Span::styled(self.diff.new_file.clone(), cfg.context_style),
        ]));

        // Render each hunk
        for hunk in &self.diff.hunks {
            // Hunk header: @@ -old_start,old_lines +new_start,new_lines @@
            let header_text = format!(
                "@@ -{},{} +{},{} @@",
                hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
            );
            lines.push(Line::from(Span::styled(header_text, cfg.hunk_header_style)));

            // Track line numbers for display
            let mut old_line = hunk.old_start;
            let mut new_line = hunk.new_start;

            // Render each line in the hunk
            for line in &hunk.lines {
                let (prefix, content, style, old_num, new_num) = match line {
                    DiffLine::Context(text) => {
                        let num = old_line;
                        old_line += 1;
                        new_line += 1;
                        (
                            ' ',
                            text.as_str(),
                            cfg.context_style,
                            Some(num),
                            Some(new_line - 1),
                        )
                    }
                    DiffLine::Added(text) => {
                        let num = new_line;
                        new_line += 1;
                        ('+', text.as_str(), cfg.added_style, None, Some(num))
                    }
                    DiffLine::Removed(text) => {
                        let num = old_line;
                        old_line += 1;
                        ('-', text.as_str(), cfg.removed_style, Some(num), None)
                    }
                };

                let line_content = if cfg.show_line_numbers {
                    // Format: " old | new | content"
                    let old_str: String = old_num
                        .map(|n: usize| {
                            format!("{:>width$}", n, width = cfg.line_number_width as usize - 1)
                        })
                        .unwrap_or_else(|| " ".repeat(cfg.line_number_width as usize - 1));
                    let new_str: String = new_num
                        .map(|n: usize| {
                            format!("{:>width$}", n, width = cfg.line_number_width as usize - 1)
                        })
                        .unwrap_or_else(|| " ".repeat(cfg.line_number_width as usize - 1));

                    vec![
                        Span::styled(format!("{} ", old_str), cfg.line_number_style),
                        Span::styled(format!("{} ", new_str), cfg.line_number_style),
                        Span::styled(format!("{} ", prefix), style),
                        Span::styled(content.to_string(), style),
                    ]
                } else {
                    vec![
                        Span::styled(format!("{} ", prefix), style),
                        Span::styled(content.to_string(), style),
                    ]
                };

                lines.push(Line::from(line_content));
            }
        }

        lines
    }
}

impl<'a> StatefulWidget for DiffView<'a> {
    type State = DiffViewState;

    fn render(self, area: Rect, buf: &mut Buffer, state: &mut Self::State) {
        let inner_area = if let Some(ref block) = self.block {
            block.inner(area)
        } else {
            area
        };

        // Render block if present
        if let Some(ref block) = self.block {
            block.render(area, buf);
        }

        // Calculate available space
        let available_height = inner_area.height as usize;
        let total_lines = self.total_lines();

        // Calculate scroll offset
        let max_scroll = total_lines.saturating_sub(available_height);
        let scroll = state.scroll_offset.min(max_scroll);

        // Render lines
        let lines = self.render_lines();
        let visible_lines: Vec<Line> = lines
            .into_iter()
            .skip(scroll)
            .take(available_height)
            .collect();

        // Create paragraph and render
        let paragraph = Paragraph::new(visible_lines);
        paragraph.render(inner_area, buf);

        // Update state
        state.scroll_offset = scroll;
    }
}

impl<'a> Widget for DiffView<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let mut state = DiffViewState::default();
        StatefulWidget::render(self, area, buf, &mut state);
    }
}

/// A convenience function to create a diff view with statistics header.
pub fn diff_view_with_stats<'a>(diff: &'a UnifiedDiff) -> DiffView<'a> {
    DiffView::new(diff)
}

/// Calculate the optimal size for a diff view.
pub fn calculate_diff_size(diff: &UnifiedDiff, max_width: u16, max_height: u16) -> (u16, u16) {
    let config = DiffViewConfig::default();

    // Calculate width based on content
    let mut max_content_width = 0usize;

    // Check header lines
    max_content_width = max_content_width.max(diff.old_file.len() + 4);
    max_content_width = max_content_width.max(diff.new_file.len() + 4);

    // Check hunk lines
    for hunk in &diff.hunks {
        // Hunk header
        let header_len = format!(
            "@@ -{},{} +{},{} @@",
            hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
        )
        .len();
        max_content_width = max_content_width.max(header_len);

        // Content lines
        for line in &hunk.lines {
            let content_len: usize = line.content().len();
            let total_len = if config.show_line_numbers {
                (config.line_number_width as usize * 2) + 3 + content_len
            } else {
                2 + content_len
            };
            max_content_width = max_content_width.max(total_len);
        }
    }

    let width = ((max_content_width + 2) as u16).min(max_width).max(40);

    // Calculate height based on content
    let total_lines = 2 + diff.hunks.iter().map(|h| 1 + h.lines.len()).sum::<usize>();
    let height = ((total_lines + 2) as u16).min(max_height).max(10);

    (width, height)
}

/// Create a compact diff view for embedding in small spaces.
pub fn compact_diff_view<'a>(diff: &'a UnifiedDiff) -> DiffView<'a> {
    let config = DiffViewConfig {
        show_line_numbers: false,
        show_border: false,
        ..Default::default()
    };

    DiffView::with_config(diff, config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tui::diff::generate_unified_diff;
    use ratatui::backend::TestBackend;
    use ratatui::widgets::Borders;
    use ratatui::Terminal;

    fn create_test_terminal(width: u16, height: u16) -> Terminal<TestBackend> {
        let backend = TestBackend::new(width, height);
        Terminal::new(backend).unwrap()
    }

    #[test]
    fn test_diff_view_render() {
        let old = "line1\nline2\nline3";
        let new = "line1\nmodified\nline3";
        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 3);

        let view = DiffView::new(&diff);
        assert!(view.total_lines() > 0);
    }

    #[test]
    fn test_diff_view_state_scrolling() {
        let mut state = DiffViewState::new();

        assert_eq!(state.scroll_offset, 0);

        state.scroll_down(5, 100);
        assert_eq!(state.scroll_offset, 5);

        state.scroll_down(100, 10);
        assert_eq!(state.scroll_offset, 10); // Should be clamped

        state.scroll_up(3);
        assert_eq!(state.scroll_offset, 7);

        state.scroll_to_top();
        assert_eq!(state.scroll_offset, 0);

        state.scroll_to_bottom(50);
        assert_eq!(state.scroll_offset, 50);
    }

    #[test]
    fn test_diff_view_widget_render() {
        let old = "foo\nbar\nbaz";
        let new = "foo\nqux\nbaz";
        let diff = generate_unified_diff(Some(old), new, Some("file.txt"), 3);

        let mut terminal = create_test_terminal(80, 24);
        let view = DiffView::new(&diff);

        terminal
            .draw(|f| {
                f.render_widget(view, f.area());
            })
            .unwrap();

        // Check that something was rendered (no panic)
        let _buffer = terminal.backend();
    }

    #[test]
    fn test_diff_view_with_border() {
        let old = "a\nb\nc";
        let new = "a\nX\nc";
        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 2);

        let view = DiffView::new(&diff).block(Block::default().borders(Borders::ALL).title("Diff"));

        let mut terminal = create_test_terminal(80, 24);
        terminal
            .draw(|f| {
                f.render_widget(view, f.area());
            })
            .unwrap();
    }

    #[test]
    fn test_compact_diff_view() {
        let old = "line1\nline2";
        let new = "line1\nmodified";
        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 3);

        let view = compact_diff_view(&diff);
        assert!(!view.config.show_line_numbers);
        assert!(!view.config.show_border);
    }

    #[test]
    fn test_calculate_diff_size() {
        let old = "a\nb\nc";
        let new = "a\nX\nc";
        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 3);

        let (width, height) = calculate_diff_size(&diff, 100, 50);

        assert!(width > 0);
        assert!(width <= 100);
        assert!(height > 0);
        assert!(height <= 50);
    }

    #[test]
    fn test_stateful_widget_render() {
        let old = "foo\nbar";
        let new = "foo\nbaz";
        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 3);

        let mut terminal = create_test_terminal(80, 24);
        let view = DiffView::new(&diff);
        let mut state = DiffViewState::new();

        terminal
            .draw(|f| {
                StatefulWidget::render(view, f.area(), f.buffer_mut(), &mut state);
            })
            .unwrap();

        assert_eq!(state.scroll_offset, 0);
    }
}
