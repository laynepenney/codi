// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Search functionality for TUI message history.
//!
//! Provides incremental search with highlighting and navigation.

use std::collections::HashMap;

/// A search result found in a message.
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// Message ID containing the match.
    pub message_id: String,
    /// Line number within the message (0-indexed).
    pub line_number: usize,
    /// Character index (Unicode scalar values) within the line where match starts.
    pub char_index: usize,
    /// Length of the match in characters.
    pub match_length: usize,
    /// Context text around the match.
    pub context: String,
}

impl SearchResult {
    /// Convert the character index to a byte range for a given line.
    pub fn byte_range(&self, line: &str) -> Option<(usize, usize)> {
        let char_starts = SearchState::char_starts(line);
        if self.char_index >= char_starts.len() {
            return None;
        }
        let start = char_starts[self.char_index];
        let end_char = self.char_index.saturating_add(self.match_length);
        let end = *char_starts.get(end_char).unwrap_or(&line.len());
        Some((start, end))
    }
}

/// Search state for incremental search.
#[derive(Debug, Default, Clone)]
pub struct SearchState {
    /// Current search query.
    pub query: String,
    /// All found results.
    pub results: Vec<SearchResult>,
    /// Currently selected result index.
    pub current_index: usize,
    /// Whether search is currently active.
    pub is_active: bool,
    /// Case sensitive search.
    pub case_sensitive: bool,
}

impl SearchState {
    /// Create a new empty search state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Activate search mode.
    pub fn activate(&mut self) {
        self.is_active = true;
        self.query.clear();
        self.results.clear();
        self.current_index = 0;
    }

    /// Deactivate search mode.
    pub fn deactivate(&mut self) {
        self.is_active = false;
    }

    /// Update search query and find results.
    pub fn search(&mut self, query: &str, messages: &[(String, String)]) {
        self.query = query.to_string();
        self.results.clear();
        self.current_index = 0;

        if query.is_empty() {
            return;
        }

        let pattern = regex::escape(query);
        let regex = match regex::RegexBuilder::new(&pattern)
            .case_insensitive(!self.case_sensitive)
            .build()
        {
            Ok(re) => re,
            Err(_) => return,
        };

        for (msg_id, content) in messages {
            for (line_num, line) in content.lines().enumerate() {
                let mut char_starts: Option<Vec<usize>> = None;

                for m in regex.find_iter(line) {
                    let char_starts = char_starts.get_or_insert_with(|| Self::char_starts(line));
                    let match_start = m.start();
                    let match_end = m.end();
                    let char_start = Self::byte_to_char_index(char_starts, match_start);
                    let char_end = Self::byte_to_char_index(char_starts, match_end);
                    let match_len = char_end.saturating_sub(char_start);

                    // Extract context (60 chars around match)
                    let total_chars = char_starts.len().saturating_sub(1);
                    let context_start_char = char_start.saturating_sub(20);
                    let context_end_char = (char_end + 40).min(total_chars);
                    let context_start = char_starts[context_start_char];
                    let context_end = char_starts[context_end_char];
                    let context = &line[context_start..context_end];

                    self.results.push(SearchResult {
                        message_id: msg_id.clone(),
                        line_number: line_num,
                        char_index: char_start,
                        match_length: match_len,
                        context: context.to_string(),
                    });
                }
            }
        }
    }

    fn char_starts(line: &str) -> Vec<usize> {
        let mut starts: Vec<usize> = line.char_indices().map(|(i, _)| i).collect();
        starts.push(line.len());
        starts
    }

    fn byte_to_char_index(char_starts: &[usize], byte_index: usize) -> usize {
        match char_starts.binary_search(&byte_index) {
            Ok(idx) => idx,
            Err(idx) => idx.saturating_sub(1),
        }
    }

    /// Navigate to next result.
    pub fn next_result(&mut self) {
        if !self.results.is_empty() {
            self.current_index = (self.current_index + 1) % self.results.len();
        }
    }

    /// Navigate to previous result.
    pub fn prev_result(&mut self) {
        if !self.results.is_empty() {
            self.current_index = if self.current_index == 0 {
                self.results.len() - 1
            } else {
                self.current_index - 1
            };
        }
    }

    /// Get current result.
    pub fn current_result(&self) -> Option<&SearchResult> {
        self.results.get(self.current_index)
    }

    /// Check if there are any results.
    pub fn has_results(&self) -> bool {
        !self.results.is_empty()
    }

    /// Get result count.
    pub fn result_count(&self) -> usize {
        self.results.len()
    }

    /// Toggle case sensitivity.
    pub fn toggle_case_sensitive(&mut self) {
        self.case_sensitive = !self.case_sensitive;
    }
}

/// Searchable content manager.
pub struct SearchableContent {
    /// Map of message ID to content.
    content: HashMap<String, String>,
}

impl SearchableContent {
    /// Create new searchable content.
    pub fn new() -> Self {
        Self {
            content: HashMap::new(),
        }
    }

    /// Add or update message content.
    pub fn set_message(&mut self, id: String, content: String) {
        self.content.insert(id, content);
    }

    /// Get all content as slice of tuples for searching.
    pub fn as_search_slice(&self) -> Vec<(String, String)> {
        self.content
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Get message content by ID.
    pub fn get(&self, id: &str) -> Option<&str> {
        self.content.get(id).map(|s| s.as_str())
    }

    /// Clear all content.
    pub fn clear(&mut self) {
        self.content.clear();
    }
}

impl Default for SearchableContent {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_finds_matches() {
        let mut state = SearchState::new();
        let messages = vec![
            ("msg1".to_string(), "Hello world\nSecond line".to_string()),
            ("msg2".to_string(), "World of code".to_string()),
        ];

        state.search("world", &messages);

        assert_eq!(state.result_count(), 2);
        assert_eq!(state.results[0].message_id, "msg1");
        assert_eq!(state.results[0].line_number, 0);
        assert_eq!(state.results[1].message_id, "msg2");
    }

    #[test]
    fn test_search_case_insensitive() {
        let mut state = SearchState::new();
        state.case_sensitive = false;

        let messages = vec![("msg1".to_string(), "Hello World".to_string())];

        state.search("world", &messages);

        assert_eq!(state.result_count(), 1);
    }

    #[test]
    fn test_search_navigation() {
        let mut state = SearchState::new();
        let messages = vec![("msg1".to_string(), "test test test".to_string())];

        state.search("test", &messages);
        assert_eq!(state.result_count(), 3);

        assert_eq!(state.current_index, 0);
        state.next_result();
        assert_eq!(state.current_index, 1);
        state.next_result();
        assert_eq!(state.current_index, 2);
        state.next_result();
        assert_eq!(state.current_index, 0); // Wrap around
    }

    #[test]
    fn test_empty_query() {
        let mut state = SearchState::new();
        let messages = vec![("msg1".to_string(), "Hello world".to_string())];

        state.search("", &messages);

        assert_eq!(state.result_count(), 0);
    }

    #[test]
    fn test_no_matches() {
        let mut state = SearchState::new();
        let messages = vec![("msg1".to_string(), "Hello world".to_string())];

        state.search("xyz", &messages);

        assert_eq!(state.result_count(), 0);
        assert!(!state.has_results());
    }

    #[test]
    fn test_search_unicode_indices() {
        let mut state = SearchState::new();
        let messages = vec![("msg1".to_string(), "café 👍".to_string())];

        state.search("👍", &messages);

        assert_eq!(state.result_count(), 1);
        let result = &state.results[0];
        assert_eq!(result.char_index, 5);
        assert_eq!(result.match_length, 1);
        assert_eq!(result.context, "café 👍");
    }
}
