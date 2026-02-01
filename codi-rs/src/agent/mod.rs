// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Agent module - Core agentic orchestration.
//!
//! The agent orchestrates the conversation between the user, model, and tools.
//! It implements the agentic loop: send message -> receive response -> execute tools -> repeat.
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::agent::{Agent, AgentConfig, AgentOptions, AgentCallbacks};
//! use codi::tools::ToolRegistry;
//! use codi::providers::anthropic;
//! use std::sync::Arc;
//!
//! // Create provider and tool registry
//! let provider = anthropic("claude-sonnet-4-20250514")?;
//! let registry = Arc::new(ToolRegistry::with_defaults());
//!
//! // Create agent
//! let mut agent = Agent::new(AgentOptions {
//!     provider,
//!     tool_registry: registry,
//!     system_prompt: Some("You are a helpful assistant.".to_string()),
//!     config: AgentConfig::default(),
//!     callbacks: AgentCallbacks::default(),
//! });
//!
//! // Chat
//! let response = agent.chat("Hello!").await?;
//! println!("{}", response);
//! ```

mod types;

pub use types::{
    AgentCallbacks, AgentConfig, AgentOptions, AgentState,
    ConfirmationResult, ToolConfirmation,
    TurnStats, TurnToolCall,
    DESTRUCTIVE_TOOLS,
};

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::{AgentError, Result};
use crate::types::{
    BoxedProvider, ContentBlock, Message, Role,
    ToolCall, ToolDefinition, ToolResult,
};
use crate::tools::ToolRegistry;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

/// The Agent orchestrates the conversation between the user, model, and tools.
pub struct Agent {
    /// AI provider.
    provider: BoxedProvider,
    /// Tool registry.
    tool_registry: Arc<ToolRegistry>,
    /// System prompt.
    system_prompt: String,
    /// Configuration.
    config: AgentConfig,
    /// Event callbacks.
    callbacks: AgentCallbacks,
    /// Internal state.
    state: AgentState,
}

impl Agent {
    /// Create a new agent with the given options.
    pub fn new(options: AgentOptions) -> Self {
        let system_prompt = options.system_prompt.unwrap_or_else(|| {
            "You are a helpful AI assistant.".to_string()
        });

        Self {
            provider: options.provider,
            tool_registry: options.tool_registry,
            system_prompt,
            config: options.config,
            callbacks: options.callbacks,
            state: AgentState::default(),
        }
    }

    /// Get the current conversation messages.
    pub fn messages(&self) -> &[Message] {
        &self.state.messages
    }

    /// Get a mutable reference to the messages (for loading sessions).
    pub fn messages_mut(&mut self) -> &mut Vec<Message> {
        &mut self.state.messages
    }

    /// Clear the conversation history.
    pub fn clear(&mut self) {
        self.state = AgentState::default();
    }

    /// Get the system prompt.
    pub fn system_prompt(&self) -> &str {
        &self.system_prompt
    }

    /// Set the system prompt.
    pub fn set_system_prompt(&mut self, prompt: impl Into<String>) {
        self.system_prompt = prompt.into();
    }

    /// Get tool definitions if tools are enabled and supported.
    fn get_tool_definitions(&self) -> Option<Vec<ToolDefinition>> {
        if self.config.use_tools && self.provider.supports_tool_use() {
            Some(self.tool_registry.definitions())
        } else {
            None
        }
    }

    /// Build the system context including any conversation summary.
    fn build_system_context(&self) -> String {
        let mut context = self.system_prompt.clone();

        if let Some(ref summary) = self.state.conversation_summary {
            context.push_str("\n\n## Previous Conversation Summary\n");
            context.push_str(summary);
        }

        context
    }

    /// Check if a tool call should be confirmed.
    fn should_confirm(&self, tool_name: &str) -> bool {
        self.config.requires_confirmation(tool_name) && self.callbacks.on_confirm.is_some()
    }

    /// Confirm a tool call with the user.
    fn confirm_tool(&self, tool_call: &ToolCall) -> ConfirmationResult {
        if let Some(ref on_confirm) = self.callbacks.on_confirm {
            let confirmation = ToolConfirmation {
                tool_name: tool_call.name.clone(),
                input: tool_call.input.clone(),
                is_dangerous: DESTRUCTIVE_TOOLS.contains(&tool_call.name.as_str()),
                danger_reason: None, // TODO: Add danger detection
            };
            on_confirm(confirmation)
        } else {
            ConfirmationResult::Approve
        }
    }

    /// Execute a single tool call.
    async fn execute_tool(&self, tool_call: &ToolCall) -> ToolResult {
        // Notify callback
        if let Some(ref on_tool_call) = self.callbacks.on_tool_call {
            on_tool_call(&tool_call.name, &tool_call.input);
        }

        // Execute the tool
        let dispatch_result = self.tool_registry
            .dispatch(&tool_call.name, tool_call.input.clone())
            .await;

        // Convert to ToolResult
        let result = match dispatch_result {
            Ok(dr) => {
                #[cfg(feature = "telemetry")]
                {
                    GLOBAL_METRICS.record_tool(&tool_call.name, dr.duration, dr.is_error);
                }

                ToolResult {
                    tool_use_id: tool_call.id.clone(),
                    content: dr.output.content().to_string(),
                    is_error: if dr.is_error { Some(true) } else { None },
                }
            }
            Err(e) => {
                ToolResult {
                    tool_use_id: tool_call.id.clone(),
                    content: format!("Error: {}", e),
                    is_error: Some(true),
                }
            }
        };

        // Notify callback
        if let Some(ref on_tool_result) = self.callbacks.on_tool_result {
            on_tool_result(&tool_call.name, &result.content, result.is_error.unwrap_or(false));
        }

        result
    }

    /// Process tool calls from a response.
    async fn process_tool_calls(
        &self,
        tool_calls: &[ToolCall],
        turn_stats: &mut TurnStats,
    ) -> std::result::Result<(Vec<ToolResult>, bool), AgentError> {
        let mut results = Vec::with_capacity(tool_calls.len());
        let mut aborted = false;
        let mut has_error = false;

        for tool_call in tool_calls {
            // Check if confirmation is needed
            if self.should_confirm(&tool_call.name) {
                match self.confirm_tool(tool_call) {
                    ConfirmationResult::Approve => {
                        // Continue to execute
                    }
                    ConfirmationResult::Deny => {
                        results.push(ToolResult {
                            tool_use_id: tool_call.id.clone(),
                            content: "User denied this operation. Please try a different approach.".to_string(),
                            is_error: Some(true),
                        });
                        has_error = true;
                        continue;
                    }
                    ConfirmationResult::Abort => {
                        results.push(ToolResult {
                            tool_use_id: tool_call.id.clone(),
                            content: "User aborted the operation.".to_string(),
                            is_error: Some(true),
                        });
                        aborted = true;
                        break;
                    }
                }
            }

            // Execute the tool
            let start = Instant::now();
            let result = self.execute_tool(tool_call).await;
            let duration_ms = start.elapsed().as_millis() as u64;

            // Track stats
            let is_err = result.is_error.unwrap_or(false);
            turn_stats.tool_call_count += 1;
            turn_stats.tool_calls.push(TurnToolCall {
                name: tool_call.name.clone(),
                duration_ms,
                is_error: is_err,
            });

            if is_err {
                has_error = true;
            }

            results.push(result);
        }

        if aborted {
            Err(AgentError::UserCancelled)
        } else {
            Ok((results, has_error))
        }
    }

    /// Add tool results to the message history.
    fn add_tool_results(&mut self, results: Vec<ToolResult>) {
        let content: Vec<ContentBlock> = results
            .into_iter()
            .map(|r| ContentBlock::tool_result(&r.tool_use_id, &r.content, r.is_error.unwrap_or(false)))
            .collect();

        self.state.messages.push(Message {
            role: Role::User,
            content: crate::types::MessageContent::Blocks(content),
        });
    }

    /// The main agentic loop.
    ///
    /// Takes a user message, sends it to the model, handles any tool calls,
    /// and returns the final text response.
    pub async fn chat(&mut self, user_message: &str) -> Result<String> {
        let start_time = Instant::now();
        let max_duration = Duration::from_millis(self.config.max_turn_duration_ms);

        // Initialize turn stats
        let mut turn_stats = TurnStats::default();

        // Add user message to history
        self.state.messages.push(Message::user(user_message));

        // Reset iteration state
        self.state.current_iteration = 0;
        self.state.consecutive_errors = 0;

        let mut final_response = String::new();

        // Main loop
        loop {
            self.state.current_iteration += 1;

            // Check iteration limit
            if self.state.current_iteration > self.config.max_iterations {
                final_response.push_str("\n\n(Reached iteration limit, stopping)");
                break;
            }

            // Check time limit
            if start_time.elapsed() > max_duration {
                final_response.push_str("\n\n(Reached time limit, stopping)");
                break;
            }

            // Build request parameters
            let tools = self.get_tool_definitions();
            let system_context = self.build_system_context();

            // Call the provider
            let response = self.provider.chat(
                &self.state.messages,
                tools.as_deref(),
                Some(&system_context),
            ).await?;

            // Update token stats
            if let Some(ref usage) = response.usage {
                turn_stats.input_tokens += usage.input_tokens as u64;
                turn_stats.output_tokens += usage.output_tokens as u64;
                turn_stats.total_tokens = turn_stats.input_tokens + turn_stats.output_tokens;
            }

            // Stream text to callback
            if !response.content.is_empty() {
                if let Some(ref on_text) = self.callbacks.on_text {
                    on_text(&response.content);
                }
                final_response = response.content.clone();
            }

            // Build assistant message
            let mut assistant_blocks: Vec<ContentBlock> = Vec::new();

            if !response.content.is_empty() {
                assistant_blocks.push(ContentBlock::text(&response.content));
            }

            for tc in &response.tool_calls {
                assistant_blocks.push(ContentBlock::tool_use(&tc.id, &tc.name, tc.input.clone()));
            }

            if !assistant_blocks.is_empty() {
                self.state.messages.push(Message {
                    role: Role::Assistant,
                    content: crate::types::MessageContent::Blocks(assistant_blocks),
                });
            }

            // If no tool calls, we're done
            if response.tool_calls.is_empty() {
                break;
            }

            // Process tool calls
            match self.process_tool_calls(&response.tool_calls, &mut turn_stats).await {
                Ok((results, has_error)) => {
                    // Add tool results to history
                    self.add_tool_results(results);

                    // Track consecutive errors
                    if has_error {
                        self.state.consecutive_errors += 1;
                        if self.state.consecutive_errors >= self.config.max_consecutive_errors {
                            final_response.push_str("\n\n(Stopping due to repeated errors)");
                            break;
                        }
                    } else {
                        self.state.consecutive_errors = 0;
                    }
                }
                Err(AgentError::UserCancelled) => {
                    final_response.push_str("\n\n(Operation aborted by user)");
                    break;
                }
                Err(e) => {
                    return Err(e.into());
                }
            }
        }

        // Calculate duration
        turn_stats.duration_ms = start_time.elapsed().as_millis() as u64;

        // Record telemetry
        #[cfg(feature = "telemetry")]
        {
            GLOBAL_METRICS.record_operation("agent.chat", start_time.elapsed());
            GLOBAL_METRICS.record_tokens(turn_stats.input_tokens, turn_stats.output_tokens);
        }

        // Notify turn complete
        if let Some(ref on_turn_complete) = self.callbacks.on_turn_complete {
            on_turn_complete(&turn_stats);
        }

        Ok(final_response)
    }

    /// Chat with streaming output.
    ///
    /// Similar to `chat()` but streams text output via the `on_text` callback
    /// as it's received from the model.
    pub async fn stream_chat(&mut self, user_message: &str) -> Result<String> {
        // For now, delegate to chat() - streaming will be added when we implement stream_chat on providers
        self.chat(user_message).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_config_default() {
        let config = AgentConfig::default();
        assert_eq!(config.max_iterations, 50);
        assert_eq!(config.max_consecutive_errors, 3);
        assert!(config.use_tools);
    }

    #[test]
    fn test_agent_config_auto_approve() {
        let mut config = AgentConfig::default();

        // Not auto-approved by default
        assert!(!config.should_auto_approve("bash"));

        // Add to auto-approve list
        config.auto_approve_tools.push("bash".to_string());
        assert!(config.should_auto_approve("bash"));

        // Auto-approve all
        config.auto_approve_all = true;
        assert!(config.should_auto_approve("any_tool"));
    }

    #[test]
    fn test_agent_config_requires_confirmation() {
        let config = AgentConfig::default();

        // Destructive tools require confirmation
        assert!(config.requires_confirmation("bash"));
        assert!(config.requires_confirmation("write_file"));
        assert!(config.requires_confirmation("edit_file"));

        // Non-destructive tools don't
        assert!(!config.requires_confirmation("read_file"));
        assert!(!config.requires_confirmation("glob"));
    }

    #[test]
    fn test_turn_stats_default() {
        let stats = TurnStats::default();
        assert_eq!(stats.tool_call_count, 0);
        assert_eq!(stats.input_tokens, 0);
        assert_eq!(stats.output_tokens, 0);
    }

    #[test]
    fn test_confirmation_result() {
        assert_eq!(ConfirmationResult::Approve, ConfirmationResult::Approve);
        assert_ne!(ConfirmationResult::Approve, ConfirmationResult::Deny);
    }
}
