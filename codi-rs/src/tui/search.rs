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
    /// Character index within the line where match starts.
    pub char_index: usize,
    /// Length of the match in characters.
    pub match_length: usize,
    /// Context text around the match.
    pub context: String,
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

        let search_fn = if self.case_sensitive {
            |line: &str, q: &str| line.contains(q)
        } else {
            |line: &str, q: &str| line.to_lowercase().contains(&q.to_lowercase())
        };

        for (msg_id, content) in messages {
            let lines: Vec<&str> = content.lines().collect();

            for (line_num, line) in lines.iter().enumerate() {
                if search_fn(line, query) {
                    // Find all occurrences in this line
                    let search_line = if self.case_sensitive {
                        line.to_string()
                    } else {
                        line.to_lowercase()
                    };
                    let search_query = if self.case_sensitive {
                        query.to_string()
                    } else {
                        query.to_lowercase()
                    };

                    let mut start = 0;
                    while let Some(pos) = search_line[start..].find(&search_query) {
                        let match_start = start + pos;
                        let match_len = query.len();

                        // Extract context (80 chars around match)
                        let context_start = match_start.saturating_sub(20);
                        let context_end = (match_start + match_len + 40).min(line.len());
                        let context = &line[context_start..context_end];

                        self.results.push(SearchResult {
                            message_id: msg_id.clone(),
                            line_number: line_num,
                            char_index: match_start,
                            match_length: match_len,
                            context: context.to_string(),
                        });

                        start = match_start + match_len;
                        if start >= line.len() {
                            break;
                        }
                    }
                }
            }
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
}
