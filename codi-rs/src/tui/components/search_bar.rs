// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Search bar UI component.

use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Widget},
};

use crate::tui::search::SearchState;

/// Search bar widget for incremental search.
pub struct SearchBar<'a> {
    state: &'a SearchState,
}

impl<'a> SearchBar<'a> {
    /// Create a new search bar.
    pub fn new(state: &'a SearchState) -> Self {
        Self { state }
    }
}

impl<'a> Widget for SearchBar<'a> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        // Build status text
        let status = if self.state.query.is_empty() {
            "Search...".to_string()
        } else if self.state.has_results() {
            format!(
                "{}/{} matches | {} | {}",
                self.state.current_index + 1,
                self.state.result_count(),
                if self.state.case_sensitive {
                    "Aa"
                } else {
                    "aa"
                },
                self.state.query
            )
        } else {
            format!(
                "No matches | {} | {}",
                if self.state.case_sensitive {
                    "Aa"
                } else {
                    "aa"
                },
                self.state.query
            )
        };

        let style = if self.state.has_results() || self.state.query.is_empty() {
            Style::default().fg(Color::Yellow)
        } else {
            Style::default().fg(Color::Red)
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(style)
            .title(format!(" Search: {} ", status));

        let paragraph = Paragraph::new("").block(block);

        paragraph.render(area, buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;

    #[test]
    fn test_search_bar_empty() {
        let state = SearchState::new();
        let backend = TestBackend::new(80, 3);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();

        terminal
            .draw(|f| {
                let area = f.area();
                let bar = SearchBar::new(&state);
                bar.render(area, f.buffer_mut());
            })
            .unwrap();

        // Should render without panic
        let buffer = terminal.backend().buffer().clone();
        assert!(buffer.content.len() > 0);
    }

    #[test]
    fn test_search_bar_with_results() {
        let mut state = SearchState::new();
        state.query = "test".to_string();
        state.results.push(crate::tui::search::SearchResult {
            message_id: "1".to_string(),
            line_number: 0,
            char_index: 0,
            match_length: 4,
            context: "test".to_string(),
        });

        let backend = TestBackend::new(80, 3);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();

        terminal
            .draw(|f| {
                let area = f.area();
                let bar = SearchBar::new(&state);
                bar.render(area, f.buffer_mut());
            })
            .unwrap();

        let buffer = terminal.backend().buffer().clone();
        // Should show "1/1 matches"
        let content: String = buffer.content.iter().map(|c| c.symbol()).collect();
        assert!(content.contains("1/1 matches"));
    }
}
