// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Agent types and configuration.

use std::sync::Arc;

use crate::tools::ToolRegistry;
use crate::types::{BoxedProvider, Message, StreamEvent};

/// Statistics for a single turn (user message -> final response).
#[derive(Debug, Clone, Default)]
pub struct TurnStats {
    /// Number of tool calls executed.
    pub tool_call_count: usize,
    /// Input tokens used.
    pub input_tokens: u64,
    /// Output tokens generated.
    pub output_tokens: u64,
    /// Total tokens (input + output).
    pub total_tokens: u64,
    /// Estimated cost in USD.
    pub cost: f64,
    /// Duration of the turn in milliseconds.
    pub duration_ms: u64,
    /// Individual tool call stats.
    pub tool_calls: Vec<TurnToolCall>,
}

/// Statistics for a single tool call.
#[derive(Debug, Clone)]
pub struct TurnToolCall {
    /// Tool name.
    pub name: String,
    /// Duration in milliseconds.
    pub duration_ms: u64,
    /// Whether the tool call resulted in an error.
    pub is_error: bool,
}

/// Information about a tool call for confirmation.
#[derive(Debug, Clone)]
pub struct ToolConfirmation {
    /// Name of the tool.
    pub tool_name: String,
    /// Tool input arguments.
    pub input: serde_json::Value,
    /// Whether this is a dangerous operation.
    pub is_dangerous: bool,
    /// Reason why it's considered dangerous.
    pub danger_reason: Option<String>,
}

/// Result of a confirmation request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfirmationResult {
    /// User approved the operation.
    Approve,
    /// User denied this specific operation.
    Deny,
    /// User wants to abort the entire conversation turn.
    Abort,
}

/// Callbacks for agent events.
///
/// Uses `Arc` instead of `Box` so callbacks can be cloned into streaming
/// closures and background tasks without lifetime issues.
pub struct AgentCallbacks {
    /// Called when the model outputs text (streaming deltas).
    pub on_text: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    /// Called when a tool is about to be executed (tool_id, tool_name, input).
    pub on_tool_call: Option<Arc<dyn Fn(&str, &str, &serde_json::Value) + Send + Sync>>,
    /// Called when a tool execution completes (tool_id, tool_name, result, is_error).
    pub on_tool_result: Option<Arc<dyn Fn(&str, &str, &str, bool) + Send + Sync>>,
    /// Called to confirm destructive operations. Returns approval result.
    pub on_confirm: Option<Arc<dyn Fn(ToolConfirmation) -> ConfirmationResult + Send + Sync>>,
    /// Called when context compaction starts/ends.
    pub on_compaction: Option<Arc<dyn Fn(bool) + Send + Sync>>,
    /// Called when a turn completes with stats.
    pub on_turn_complete: Option<Arc<dyn Fn(&TurnStats) + Send + Sync>>,
    /// Called for each raw stream event from the provider.
    pub on_stream_event: Option<Arc<dyn Fn(&StreamEvent) + Send + Sync>>,
}

impl Default for AgentCallbacks {
    fn default() -> Self {
        Self {
            on_text: None,
            on_tool_call: None,
            on_tool_result: None,
            on_confirm: None,
            on_compaction: None,
            on_turn_complete: None,
            on_stream_event: None,
        }
    }
}

impl std::fmt::Debug for AgentCallbacks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentCallbacks")
            .field("on_text", &self.on_text.is_some())
            .field("on_tool_call", &self.on_tool_call.is_some())
            .field("on_tool_result", &self.on_tool_result.is_some())
            .field("on_confirm", &self.on_confirm.is_some())
            .field("on_compaction", &self.on_compaction.is_some())
            .field("on_turn_complete", &self.on_turn_complete.is_some())
            .field("on_stream_event", &self.on_stream_event.is_some())
            .finish()
    }
}

/// Configuration for the agent.
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// Maximum number of iterations (tool call cycles) per turn.
    pub max_iterations: usize,
    /// Maximum consecutive errors before stopping.
    pub max_consecutive_errors: usize,
    /// Maximum turn duration in milliseconds.
    pub max_turn_duration_ms: u64,
    /// Maximum context tokens before compaction.
    pub max_context_tokens: usize,
    /// Whether to use tools (if provider supports them).
    pub use_tools: bool,
    /// Whether to extract tool calls from text (for models without native support).
    pub extract_tools_from_text: bool,
    /// Auto-approve all tool calls (dangerous!).
    pub auto_approve_all: bool,
    /// Auto-approve specific tools by name.
    pub auto_approve_tools: Vec<String>,
    /// Regex patterns that flag tool inputs as dangerous (from config `dangerousPatterns`).
    pub dangerous_patterns: Vec<String>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_iterations: 50,
            max_consecutive_errors: 3,
            max_turn_duration_ms: 30 * 60 * 1000, // 30 minutes
            max_context_tokens: 100_000,
            use_tools: true,
            extract_tools_from_text: true,
            auto_approve_all: false,
            auto_approve_tools: Vec::new(),
            dangerous_patterns: Vec::new(),
        }
    }
}

/// Tools that require confirmation (destructive operations).
pub const DESTRUCTIVE_TOOLS: &[&str] = &[
    "bash",
    "write_file",
    "edit_file",
    "insert_line",
    "patch_file",
];

impl AgentConfig {
    /// Check if a tool should be auto-approved.
    pub fn should_auto_approve(&self, tool_name: &str) -> bool {
        self.auto_approve_all || self.auto_approve_tools.iter().any(|t| t == tool_name)
    }

    /// Check if a tool requires confirmation.
    pub fn requires_confirmation(&self, tool_name: &str) -> bool {
        DESTRUCTIVE_TOOLS.contains(&tool_name) && !self.should_auto_approve(tool_name)
    }

    /// Check if any dangerous pattern matches the given input string.
    /// Returns the first matching pattern, or `None` if no pattern matches.
    /// Invalid regex patterns are silently skipped.
    pub fn matches_dangerous_pattern(&self, input_str: &str) -> Option<String> {
        for pat in &self.dangerous_patterns {
            match regex::Regex::new(pat) {
                Ok(re) => {
                    if re.is_match(input_str) {
                        return Some(pat.clone());
                    }
                }
                Err(e) => {
                    tracing::warn!("Invalid dangerous pattern '{}': {}", pat, e);
                }
            }
        }
        None
    }
}

/// Options for creating an agent.
pub struct AgentOptions {
    /// AI provider to use.
    pub provider: BoxedProvider,
    /// Tool registry.
    pub tool_registry: Arc<ToolRegistry>,
    /// System prompt.
    pub system_prompt: Option<String>,
    /// Agent configuration.
    pub config: AgentConfig,
    /// Event callbacks.
    pub callbacks: AgentCallbacks,
}

/// Internal state of the agent.
#[derive(Debug)]
pub struct AgentState {
    /// Conversation messages.
    pub messages: Vec<Message>,
    /// Conversation summary (from compaction).
    pub conversation_summary: Option<String>,
    /// Current iteration in the turn.
    pub current_iteration: usize,
    /// Consecutive error count.
    pub consecutive_errors: usize,
    /// Running character count across all messages (avoids re-serializing JSON each iteration).
    pub running_char_count: usize,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            messages: Vec::new(),
            conversation_summary: None,
            current_iteration: 0,
            consecutive_errors: 0,
            running_char_count: 0,
        }
    }
}
