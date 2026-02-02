// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Context windowing and token management.
//!
//! Provides functionality for:
//! - Token counting for messages
//! - Context window management
//! - Auto-summarization when context is full
//! - Working set tracking for recently accessed files

use std::collections::HashSet;
use std::time::Instant;

use crate::types::{ContentBlockType, Message};

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

/// Default tokens per character ratio (approximate).
const TOKENS_PER_CHAR: f64 = 0.25;

/// Configuration for context windowing.
#[derive(Debug, Clone)]
pub struct ContextConfig {
    /// Maximum context window size in tokens.
    pub max_context_tokens: u64,
    /// Buffer to keep below max (trigger summarization when remaining < buffer).
    pub context_buffer: u64,
    /// Minimum recent messages to always keep.
    pub min_recent_messages: usize,
    /// Maximum messages to keep (hard cap).
    pub max_messages: usize,
    /// Whether to preserve tool_use/tool_result pairs.
    pub preserve_tool_pairs: bool,
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            max_context_tokens: 128_000,
            context_buffer: 20_000,
            min_recent_messages: 4,
            max_messages: 50,
            preserve_tool_pairs: true,
        }
    }
}

impl ContextConfig {
    /// Create config for a specific model context window size.
    pub fn for_model(context_window: u64) -> Self {
        // Use 20% buffer for small windows, fixed 20K for large windows
        let buffer = if context_window > 200_000 {
            20_000
        } else {
            (context_window as f64 * 0.2) as u64
        };

        Self {
            max_context_tokens: context_window,
            context_buffer: buffer,
            ..Default::default()
        }
    }

    /// Get the threshold at which we should trigger summarization.
    pub fn summarization_threshold(&self) -> u64 {
        self.max_context_tokens.saturating_sub(self.context_buffer)
    }
}

/// Tracks the current working context.
#[derive(Debug, Clone, Default)]
pub struct WorkingSet {
    /// Files modified/read recently.
    pub recent_files: HashSet<String>,
    /// Active entities (patterns, symbols, etc.).
    pub active_entities: HashSet<String>,
    /// Maximum files to track.
    pub max_files: usize,
}

impl WorkingSet {
    /// Create a new working set.
    pub fn new() -> Self {
        Self {
            recent_files: HashSet::new(),
            active_entities: HashSet::new(),
            max_files: 100,
        }
    }

    /// Add a file to the working set.
    pub fn add_file(&mut self, path: &str) {
        self.recent_files.insert(path.to_string());

        // LRU eviction (simple: just clear oldest if too many)
        while self.recent_files.len() > self.max_files {
            if let Some(first) = self.recent_files.iter().next().cloned() {
                self.recent_files.remove(&first);
            }
        }
    }

    /// Add an entity (pattern, symbol) to track.
    pub fn add_entity(&mut self, entity: &str) {
        self.active_entities.insert(entity.to_string());
    }

    /// Check if a message references any files in the working set.
    pub fn references_files(&self, text: &str) -> bool {
        for file in &self.recent_files {
            if text.contains(file) {
                return true;
            }
            // Also check basename
            if let Some(name) = std::path::Path::new(file).file_name() {
                if text.contains(name.to_string_lossy().as_ref()) {
                    return true;
                }
            }
        }
        false
    }

    /// Clear the working set.
    pub fn clear(&mut self) {
        self.recent_files.clear();
        self.active_entities.clear();
    }
}

/// Context window state.
#[derive(Debug, Clone)]
pub struct ContextWindow {
    /// Current estimated token count.
    pub token_count: u64,
    /// Configuration.
    pub config: ContextConfig,
    /// Working set of active files.
    pub working_set: WorkingSet,
}

impl ContextWindow {
    /// Create a new context window.
    pub fn new(config: ContextConfig) -> Self {
        Self {
            token_count: 0,
            config,
            working_set: WorkingSet::new(),
        }
    }

    /// Check if we need to summarize (context is getting full).
    pub fn needs_summarization(&self) -> bool {
        self.token_count >= self.config.summarization_threshold()
    }

    /// Get remaining tokens before we hit the threshold.
    pub fn remaining_tokens(&self) -> u64 {
        self.config
            .summarization_threshold()
            .saturating_sub(self.token_count)
    }

    /// Get the usage percentage.
    pub fn usage_percent(&self) -> f64 {
        if self.config.max_context_tokens == 0 {
            return 0.0;
        }
        (self.token_count as f64 / self.config.max_context_tokens as f64) * 100.0
    }

    /// Update token count from messages.
    pub fn update_token_count(&mut self, messages: &[Message]) {
        self.token_count = estimate_messages_tokens(messages);
    }
}

/// Estimate tokens for a single message.
pub fn estimate_message_tokens(message: &Message) -> u64 {
    let start = Instant::now();

    let text = get_message_text(message);
    let tokens = estimate_text_tokens(&text);

    // Add overhead for role, formatting
    let overhead = 4;

    #[cfg(feature = "telemetry")]
    GLOBAL_METRICS.record_operation("session.context.estimate_tokens", start.elapsed());

    tokens + overhead
}

/// Estimate tokens for a list of messages.
pub fn estimate_messages_tokens(messages: &[Message]) -> u64 {
    messages.iter().map(estimate_message_tokens).sum()
}

/// Estimate tokens for text content.
pub fn estimate_text_tokens(text: &str) -> u64 {
    // Simple estimation: ~4 chars per token on average
    // This is a rough estimate; for accurate counting, use tiktoken
    (text.len() as f64 * TOKENS_PER_CHAR) as u64
}

/// Extract text content from a message.
pub fn get_message_text(message: &Message) -> String {
    match &message.content {
        crate::types::MessageContent::Text(text) => text.clone(),
        crate::types::MessageContent::Blocks(blocks) => {
            let mut result = String::new();
            for block in blocks {
                match block.block_type {
                    ContentBlockType::Text | ContentBlockType::Thinking => {
                        if let Some(ref t) = block.text {
                            result.push_str(t);
                            result.push('\n');
                        }
                    }
                    ContentBlockType::ToolUse => {
                        if let Some(ref name) = block.name {
                            result.push_str(&format!("[Tool: {}]\n", name));
                        }
                        if let Some(ref input) = block.input {
                            result.push_str(&input.to_string());
                            result.push('\n');
                        }
                    }
                    ContentBlockType::ToolResult => {
                        if let Some(ref content) = block.content {
                            result.push_str(content);
                            result.push('\n');
                        }
                    }
                    ContentBlockType::Image => {}
                }
            }
            result
        }
    }
}

/// Check if a message has tool_use blocks.
pub fn has_tool_use_blocks(message: &Message) -> bool {
    if let crate::types::MessageContent::Blocks(blocks) = &message.content {
        blocks
            .iter()
            .any(|b| b.block_type == ContentBlockType::ToolUse)
    } else {
        false
    }
}

/// Check if a message has tool_result blocks.
pub fn has_tool_result_blocks(message: &Message) -> bool {
    if let crate::types::MessageContent::Blocks(blocks) = &message.content {
        blocks
            .iter()
            .any(|b| b.block_type == ContentBlockType::ToolResult)
    } else {
        false
    }
}

/// Find a safe start index that doesn't orphan tool_results.
pub fn find_safe_start_index(messages: &[Message]) -> usize {
    for (i, message) in messages.iter().enumerate() {
        // If this message has tool_results, we need the previous message with tool_use
        if has_tool_result_blocks(message) {
            continue;
        }
        // Safe to start here
        return i;
    }
    0
}

/// Selection result for context windowing.
#[derive(Debug, Clone)]
pub struct SelectionResult {
    /// Indices of messages to keep.
    pub keep: Vec<usize>,
    /// Indices of messages to summarize.
    pub summarize: Vec<usize>,
}

/// Select which messages to keep based on various criteria.
pub fn select_messages_to_keep(
    messages: &[Message],
    config: &ContextConfig,
    working_set: &WorkingSet,
) -> SelectionResult {
    if messages.is_empty() {
        return SelectionResult {
            keep: Vec::new(),
            summarize: Vec::new(),
        };
    }

    let mut keep = HashSet::new();

    // 1. Always keep the last min_recent_messages
    let recent_start = messages.len().saturating_sub(config.min_recent_messages);
    for i in recent_start..messages.len() {
        keep.insert(i);
    }

    // 2. Keep messages referencing working set files
    for (i, message) in messages.iter().enumerate() {
        let text = get_message_text(message);
        if working_set.references_files(&text) {
            keep.insert(i);
        }
    }

    // 3. Preserve tool_use/tool_result pairs
    if config.preserve_tool_pairs {
        let mut to_add = Vec::new();
        for &idx in &keep {
            if idx < messages.len() {
                // If this has tool_use, keep the next message (results)
                if has_tool_use_blocks(&messages[idx]) && idx + 1 < messages.len() {
                    to_add.push(idx + 1);
                }
                // If this has tool_result, keep the previous message (call)
                if has_tool_result_blocks(&messages[idx]) && idx > 0 {
                    to_add.push(idx - 1);
                }
            }
        }
        for idx in to_add {
            keep.insert(idx);
        }
    }

    // 4. Enforce max_messages cap
    if keep.len() > config.max_messages {
        // Keep the most recent ones
        let mut sorted: Vec<_> = keep.iter().copied().collect();
        sorted.sort_by(|a, b| b.cmp(a)); // Descending
        sorted.truncate(config.max_messages);
        keep = sorted.into_iter().collect();
    }

    // Build summarize list
    let summarize: Vec<usize> = (0..messages.len())
        .filter(|i| !keep.contains(i))
        .collect();

    // Sort keep indices
    let mut keep_vec: Vec<usize> = keep.into_iter().collect();
    keep_vec.sort();

    SelectionResult {
        keep: keep_vec,
        summarize,
    }
}

/// Apply selection to get kept messages.
pub fn apply_selection(messages: &[Message], selection: &SelectionResult) -> Vec<Message> {
    let kept: Vec<Message> = selection
        .keep
        .iter()
        .filter_map(|&i| messages.get(i).cloned())
        .collect();

    // Find safe start index
    let safe_start = find_safe_start_index(&kept);
    kept[safe_start..].to_vec()
}

/// Statistics about context selection.
#[derive(Debug, Clone)]
pub struct SelectionStats {
    /// Total messages before selection.
    pub total_messages: usize,
    /// Messages kept.
    pub kept_messages: usize,
    /// Messages to be summarized.
    pub summarized_messages: usize,
    /// Percentage of messages kept.
    pub kept_percent: f64,
    /// Files in working set.
    pub working_set_size: usize,
}

impl SelectionStats {
    /// Create stats from a selection.
    pub fn from_selection(
        messages: &[Message],
        selection: &SelectionResult,
        working_set: &WorkingSet,
    ) -> Self {
        let total = messages.len();
        let kept = selection.keep.len();

        Self {
            total_messages: total,
            kept_messages: kept,
            summarized_messages: selection.summarize.len(),
            kept_percent: if total > 0 {
                (kept as f64 / total as f64) * 100.0
            } else {
                100.0
            },
            working_set_size: working_set.recent_files.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ContentBlock, Role};

    fn create_text_message(role: Role, text: &str) -> Message {
        Message {
            role,
            content: crate::types::MessageContent::Text(text.to_string()),
        }
    }

    #[test]
    fn test_estimate_text_tokens() {
        let text = "Hello, world!"; // 13 chars
        let tokens = estimate_text_tokens(text);
        // 13 * 0.25 = 3.25, rounded to 3
        assert!(tokens >= 3 && tokens <= 5);
    }

    #[test]
    fn test_estimate_message_tokens() {
        let message = create_text_message(Role::User, "Hello, world!");
        let tokens = estimate_message_tokens(&message);
        // Text tokens + overhead
        assert!(tokens > 0);
    }

    #[test]
    fn test_context_config_for_model() {
        let config = ContextConfig::for_model(200_000);
        assert_eq!(config.max_context_tokens, 200_000);
        assert_eq!(config.context_buffer, 40_000); // 20% of 200K

        let config_large = ContextConfig::for_model(500_000);
        assert_eq!(config_large.context_buffer, 20_000); // Fixed 20K for large
    }

    #[test]
    fn test_context_window_needs_summarization() {
        let config = ContextConfig {
            max_context_tokens: 100_000,
            context_buffer: 20_000,
            ..Default::default()
        };
        let mut window = ContextWindow::new(config);

        window.token_count = 50_000;
        assert!(!window.needs_summarization());

        window.token_count = 85_000; // Above 80K threshold
        assert!(window.needs_summarization());
    }

    #[test]
    fn test_working_set() {
        let mut ws = WorkingSet::new();

        ws.add_file("/path/to/file.rs");
        assert!(ws.references_files("Looking at /path/to/file.rs"));
        assert!(ws.references_files("The file.rs contains..."));
        assert!(!ws.references_files("Some other content"));
    }

    #[test]
    fn test_select_messages_to_keep() {
        let messages: Vec<Message> = (0..10)
            .map(|i| create_text_message(Role::User, &format!("Message {}", i)))
            .collect();

        let config = ContextConfig {
            min_recent_messages: 3,
            max_messages: 5,
            ..Default::default()
        };
        let working_set = WorkingSet::new();

        let result = select_messages_to_keep(&messages, &config, &working_set);

        // Should keep at least min_recent_messages
        assert!(result.keep.len() >= 3);
        // Should keep the last messages
        assert!(result.keep.contains(&7));
        assert!(result.keep.contains(&8));
        assert!(result.keep.contains(&9));
    }

    #[test]
    fn test_has_tool_blocks() {
        let tool_use_msg = Message {
            role: Role::Assistant,
            content: crate::types::MessageContent::Blocks(vec![ContentBlock::tool_use(
                "1",
                "test",
                serde_json::json!({}),
            )]),
        };

        let tool_result_msg = Message {
            role: Role::User,
            content: crate::types::MessageContent::Blocks(vec![ContentBlock::tool_result(
                "1",
                "result",
                false,
            )]),
        };

        assert!(has_tool_use_blocks(&tool_use_msg));
        assert!(!has_tool_result_blocks(&tool_use_msg));

        assert!(!has_tool_use_blocks(&tool_result_msg));
        assert!(has_tool_result_blocks(&tool_result_msg));
    }

    #[test]
    fn test_selection_stats() {
        let messages: Vec<Message> = (0..10)
            .map(|i| create_text_message(Role::User, &format!("Message {}", i)))
            .collect();

        let selection = SelectionResult {
            keep: vec![7, 8, 9],
            summarize: vec![0, 1, 2, 3, 4, 5, 6],
        };

        let working_set = WorkingSet::new();
        let stats = SelectionStats::from_selection(&messages, &selection, &working_set);

        assert_eq!(stats.total_messages, 10);
        assert_eq!(stats.kept_messages, 3);
        assert_eq!(stats.summarized_messages, 7);
        assert!((stats.kept_percent - 30.0).abs() < 0.1);
    }
}
