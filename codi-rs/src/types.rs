// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Core types for the Codi AI assistant.
//!
//! This module defines the fundamental data structures used throughout the application,
//! including messages, tool definitions, provider responses, and configuration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Message Types
// ============================================================================

/// Role of a message sender in a conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    System,
}

/// Supported image media types for vision capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageMediaType {
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/gif")]
    Gif,
    #[serde(rename = "image/webp")]
    Webp,
}

/// Image source data for vision content blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String, // Always "base64"
    pub media_type: ImageMediaType,
    pub data: String,
}

impl ImageSource {
    /// Create a new base64-encoded image source.
    pub fn new_base64(media_type: ImageMediaType, data: String) -> Self {
        Self {
            source_type: "base64".to_string(),
            media_type,
            data,
        }
    }
}

/// Type of content block within a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentBlockType {
    Text,
    ToolUse,
    ToolResult,
    Image,
    Thinking,
}

/// A block of content within a message.
///
/// Messages can contain multiple content blocks of different types,
/// including text, tool calls, tool results, images, and thinking/reasoning.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub block_type: ContentBlockType,

    /// Text content (for text and thinking blocks)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,

    /// Unique identifier for tool_use or tool_result blocks
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Tool name for tool_use blocks
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Input parameters for tool_use blocks
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,

    /// Associated tool_use_id for tool_result blocks
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,

    /// Result content for tool_result blocks
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,

    /// Whether this tool_result represents an error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,

    /// Image data for image blocks
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageSource>,
}

impl ContentBlock {
    /// Create a text content block.
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            block_type: ContentBlockType::Text,
            text: Some(text.into()),
            id: None,
            name: None,
            input: None,
            tool_use_id: None,
            content: None,
            is_error: None,
            image: None,
        }
    }

    /// Create a tool_use content block.
    pub fn tool_use(id: impl Into<String>, name: impl Into<String>, input: serde_json::Value) -> Self {
        Self {
            block_type: ContentBlockType::ToolUse,
            text: None,
            id: Some(id.into()),
            name: Some(name.into()),
            input: Some(input),
            tool_use_id: None,
            content: None,
            is_error: None,
            image: None,
        }
    }

    /// Create a tool_result content block.
    pub fn tool_result(tool_use_id: impl Into<String>, content: impl Into<String>, is_error: bool) -> Self {
        Self {
            block_type: ContentBlockType::ToolResult,
            text: None,
            id: None,
            name: None,
            input: None,
            tool_use_id: Some(tool_use_id.into()),
            content: Some(content.into()),
            is_error: if is_error { Some(true) } else { None },
            image: None,
        }
    }

    /// Create an image content block.
    pub fn image(source: ImageSource) -> Self {
        Self {
            block_type: ContentBlockType::Image,
            text: None,
            id: None,
            name: None,
            input: None,
            tool_use_id: None,
            content: None,
            is_error: None,
            image: Some(source),
        }
    }

    /// Create a thinking/reasoning content block.
    pub fn thinking(text: impl Into<String>) -> Self {
        Self {
            block_type: ContentBlockType::Thinking,
            text: Some(text.into()),
            id: None,
            name: None,
            input: None,
            tool_use_id: None,
            content: None,
            is_error: None,
            image: None,
        }
    }
}

/// Message content - either a simple string or structured content blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

impl From<String> for MessageContent {
    fn from(s: String) -> Self {
        MessageContent::Text(s)
    }
}

impl From<&str> for MessageContent {
    fn from(s: &str) -> Self {
        MessageContent::Text(s.to_string())
    }
}

impl From<Vec<ContentBlock>> for MessageContent {
    fn from(blocks: Vec<ContentBlock>) -> Self {
        MessageContent::Blocks(blocks)
    }
}

/// A message in a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: MessageContent,
}

impl Message {
    /// Create a user message with text content.
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: MessageContent::Text(content.into()),
        }
    }

    /// Create an assistant message with text content.
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: MessageContent::Text(content.into()),
        }
    }

    /// Create a system message with text content.
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: MessageContent::Text(content.into()),
        }
    }

    /// Create a message with content blocks.
    pub fn with_blocks(role: Role, blocks: Vec<ContentBlock>) -> Self {
        Self {
            role,
            content: MessageContent::Blocks(blocks),
        }
    }

    /// Get text content if this message has simple text content.
    pub fn as_text(&self) -> Option<&str> {
        match &self.content {
            MessageContent::Text(s) => Some(s),
            MessageContent::Blocks(_) => None,
        }
    }

    /// Get content blocks if this message has structured content.
    pub fn as_blocks(&self) -> Option<&[ContentBlock]> {
        match &self.content {
            MessageContent::Text(_) => None,
            MessageContent::Blocks(blocks) => Some(blocks),
        }
    }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/// JSON Schema for tool input parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputSchema {
    #[serde(rename = "type")]
    pub schema_type: String, // Always "object"
    pub properties: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
}

impl InputSchema {
    /// Create a new input schema with object type.
    pub fn new() -> Self {
        Self {
            schema_type: "object".to_string(),
            properties: HashMap::new(),
            required: None,
        }
    }

    /// Add a property to the schema.
    pub fn with_property(mut self, name: impl Into<String>, schema: serde_json::Value) -> Self {
        self.properties.insert(name.into(), schema);
        self
    }

    /// Mark properties as required.
    pub fn with_required(mut self, required: Vec<String>) -> Self {
        self.required = Some(required);
        self
    }
}

impl Default for InputSchema {
    fn default() -> Self {
        Self::new()
    }
}

/// Definition of a tool that can be called by the AI model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: InputSchema,
}

impl ToolDefinition {
    /// Create a new tool definition.
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            input_schema: InputSchema::new(),
        }
    }

    /// Set the input schema for this tool.
    pub fn with_schema(mut self, schema: InputSchema) -> Self {
        self.input_schema = schema;
        self
    }
}

/// A call to a tool made by the AI model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

/// Result from executing a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

impl ToolResult {
    /// Create a successful tool result.
    pub fn success(tool_use_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            tool_use_id: tool_use_id.into(),
            content: content.into(),
            is_error: None,
        }
    }

    /// Create an error tool result.
    pub fn error(tool_use_id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            tool_use_id: tool_use_id.into(),
            content: error.into(),
            is_error: Some(true),
        }
    }
}

// ============================================================================
// Structured Result Type
// ============================================================================

/// Structured result format for tool outputs.
///
/// Provides consistent success/error handling across all tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredResult<T = serde_json::Value> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

impl<T> StructuredResult<T> {
    /// Create a successful result.
    pub fn success(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
            warnings: None,
        }
    }

    /// Create a successful result with warnings.
    pub fn success_with_warnings(data: T, warnings: Vec<String>) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
            warnings: if warnings.is_empty() { None } else { Some(warnings) },
        }
    }

    /// Create a failed result.
    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(error.into()),
            warnings: None,
        }
    }

    /// Create a failed result with warnings.
    pub fn failure_with_warnings(error: impl Into<String>, warnings: Vec<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(error.into()),
            warnings: if warnings.is_empty() { None } else { Some(warnings) },
        }
    }
}

// ============================================================================
// Token Usage & Provider Response
// ============================================================================

/// Token usage information from a provider response.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    /// Number of tokens in the input/prompt
    pub input_tokens: u32,
    /// Number of tokens in the output/completion
    pub output_tokens: u32,
    /// Tokens used to create cache (Anthropic)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
    /// Tokens read from cache (Anthropic)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u32>,
    /// Tokens served from cache (OpenAI)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u32>,
}

impl TokenUsage {
    /// Get total tokens (input + output).
    pub fn total(&self) -> u32 {
        self.input_tokens + self.output_tokens
    }
}

/// Reason why the model stopped generating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
}

/// Response from an AI provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderResponse {
    /// Main text content of the response
    pub content: String,
    /// Tool calls made by the model
    pub tool_calls: Vec<ToolCall>,
    /// Reason for stopping generation
    pub stop_reason: StopReason,
    /// Optional reasoning/thinking content from reasoning models
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    /// Token usage information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

impl ProviderResponse {
    /// Create an empty response (end of turn, no content).
    pub fn empty() -> Self {
        Self {
            content: String::new(),
            tool_calls: Vec::new(),
            stop_reason: StopReason::EndTurn,
            reasoning_content: None,
            usage: None,
        }
    }

    /// Create a text response.
    pub fn text(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            tool_calls: Vec::new(),
            stop_reason: StopReason::EndTurn,
            reasoning_content: None,
            usage: None,
        }
    }

    /// Check if this response contains tool calls.
    pub fn has_tool_calls(&self) -> bool {
        !self.tool_calls.is_empty()
    }
}

// ============================================================================
// Turn Statistics
// ============================================================================

/// Details of a single tool call within a turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnToolCall {
    /// Tool name
    pub name: String,
    /// Duration of tool execution in milliseconds
    pub duration_ms: u64,
    /// Whether the tool call resulted in an error
    pub is_error: bool,
}

/// Statistics for a single conversation turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnStats {
    /// Number of tool calls in this turn
    pub tool_call_count: usize,
    /// Total input tokens used in this turn
    pub input_tokens: u32,
    /// Total output tokens used in this turn
    pub output_tokens: u32,
    /// Total tokens (input + output)
    pub total_tokens: u32,
    /// Estimated cost in USD
    pub cost: f64,
    /// Duration of the turn in milliseconds
    pub duration_ms: u64,
    /// Details of each tool call
    pub tool_calls: Vec<TurnToolCall>,
}

// ============================================================================
// Model Information
// ============================================================================

/// Model capabilities.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelCapabilities {
    /// Whether the model supports vision/image analysis
    pub vision: bool,
    /// Whether the model supports tool use/function calling
    pub tool_use: bool,
}

/// Pricing information per million tokens (USD).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    /// Input cost per million tokens
    pub input: f64,
    /// Output cost per million tokens
    pub output: f64,
}

/// Information about an available model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// Model identifier (e.g., "claude-sonnet-4-20250514")
    pub id: String,
    /// Human-readable display name
    pub name: String,
    /// Provider name (e.g., "Anthropic", "OpenAI")
    pub provider: String,
    /// Model capabilities
    pub capabilities: ModelCapabilities,
    /// Context window size in tokens
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    /// Pricing per million tokens (USD)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pricing: Option<ModelPricing>,
    /// Whether the model is deprecated
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_creation() {
        let msg = Message::user("Hello, world!");
        assert_eq!(msg.role, Role::User);
        assert_eq!(msg.as_text(), Some("Hello, world!"));
    }

    #[test]
    fn test_message_with_blocks() {
        let blocks = vec![
            ContentBlock::text("Hello"),
            ContentBlock::tool_use("123", "read_file", serde_json::json!({"path": "test.txt"})),
        ];
        let msg = Message::with_blocks(Role::Assistant, blocks);
        assert_eq!(msg.role, Role::Assistant);
        assert!(msg.as_blocks().is_some());
        assert_eq!(msg.as_blocks().unwrap().len(), 2);
    }

    #[test]
    fn test_tool_definition() {
        let tool = ToolDefinition::new("read_file", "Read contents of a file")
            .with_schema(
                InputSchema::new()
                    .with_property("path", serde_json::json!({"type": "string", "description": "File path"}))
                    .with_required(vec!["path".to_string()]),
            );

        assert_eq!(tool.name, "read_file");
        assert_eq!(tool.input_schema.properties.len(), 1);
        assert!(tool.input_schema.properties.contains_key("path"));
    }

    #[test]
    fn test_structured_result() {
        let success: StructuredResult<String> = StructuredResult::success("data".to_string());
        assert!(success.ok);
        assert_eq!(success.data, Some("data".to_string()));

        let failure: StructuredResult<String> = StructuredResult::failure("error");
        assert!(!failure.ok);
        assert_eq!(failure.error, Some("error".to_string()));
    }

    #[test]
    fn test_token_usage() {
        let usage = TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            ..Default::default()
        };
        assert_eq!(usage.total(), 150);
    }

    #[test]
    fn test_provider_response() {
        let response = ProviderResponse::text("Hello!");
        assert_eq!(response.content, "Hello!");
        assert!(!response.has_tool_calls());
        assert_eq!(response.stop_reason, StopReason::EndTurn);
    }

    #[test]
    fn test_message_serialization() {
        let msg = Message::user("test");
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"role\":\"user\""));
        assert!(json.contains("\"content\":\"test\""));
    }

    #[test]
    fn test_content_block_serialization() {
        let block = ContentBlock::tool_use("id1", "bash", serde_json::json!({"command": "ls"}));
        let json = serde_json::to_string(&block).unwrap();
        assert!(json.contains("\"type\":\"tool_use\""));
        assert!(json.contains("\"name\":\"bash\""));
    }
}
