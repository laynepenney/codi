// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Anthropic Claude provider implementation.
//!
//! This module provides a [`Provider`] implementation for Anthropic's Claude models
//! using the Messages API with streaming support.
//!
//! # Features
//!
//! - Streaming chat completions with Server-Sent Events (SSE)
//! - Tool use / function calling support
//! - Vision/image analysis support
//! - Extended thinking (reasoning) support
//! - Token usage tracking with cache statistics
//!
//! # API Reference
//!
//! See [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) for details.

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[cfg(feature = "telemetry")]
use tracing::debug;

use crate::error::ProviderError;
use crate::types::{
    ContentBlock, ContentBlockType, ImageMediaType, Message, MessageContent,
    ModelCapabilities, ModelInfo, ModelPricing, Provider, ProviderConfig, ProviderResponse, Role,
    StopReason, StreamEvent, TokenUsage, ToolCall, ToolDefinition,
};

/// Anthropic API version header value.
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Default max tokens if not specified.
const DEFAULT_MAX_TOKENS: u32 = 8192;

/// Default request timeout in seconds.
const DEFAULT_TIMEOUT_SECS: u64 = 300;

/// Anthropic Claude provider.
///
/// Implements the [`Provider`] trait for Anthropic's Claude models.
pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    model: String,
    base_url: String,
    max_tokens: u32,
    temperature: Option<f32>,
}

impl AnthropicProvider {
    /// Create a new Anthropic provider.
    ///
    /// # Arguments
    ///
    /// * `api_key` - Anthropic API key
    /// * `model` - Model identifier (e.g., "claude-sonnet-4-20250514")
    /// * `base_url` - API base URL
    /// * `config` - Additional configuration options
    pub fn new(
        api_key: impl Into<String>,
        model: impl Into<String>,
        base_url: impl Into<String>,
        config: ProviderConfig,
    ) -> Self {
        let timeout = config
            .timeout_ms
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECS));

        let client = Client::builder()
            .timeout(timeout)
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key: api_key.into(),
            model: model.into(),
            base_url: base_url.into(),
            max_tokens: config.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
            temperature: config.temperature,
        }
    }

    /// Build the request body for the Messages API.
    fn build_request(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<&str>,
    ) -> AnthropicRequest {
        let api_messages: Vec<ApiMessage> = messages.iter().map(|m| m.into()).collect();

        let api_tools: Option<Vec<ApiTool>> = tools.map(|t| t.iter().map(|t| t.into()).collect());

        AnthropicRequest {
            model: self.model.clone(),
            max_tokens: self.max_tokens,
            messages: api_messages,
            system: system_prompt.map(String::from),
            tools: api_tools,
            stream: Some(false),
            temperature: self.temperature,
        }
    }

    /// Build a streaming request body.
    fn build_streaming_request(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<&str>,
    ) -> AnthropicRequest {
        let mut request = self.build_request(messages, tools, system_prompt);
        request.stream = Some(true);
        request
    }

    /// Parse an SSE event line.
    fn parse_sse_event(line: &str) -> Option<(&str, &str)> {
        if let Some(data) = line.strip_prefix("event: ") {
            Some(("event", data.trim()))
        } else if let Some(data) = line.strip_prefix("data: ") {
            Some(("data", data.trim()))
        } else {
            None
        }
    }

    /// Get context window size for a model.
    fn get_context_window(model: &str) -> u32 {
        // All Claude 3+ models have 200k context
        if model.contains("claude-3") || model.contains("claude-sonnet-4") || model.contains("claude-opus-4") {
            200_000
        } else {
            100_000
        }
    }

    /// Check if a model supports vision.
    fn model_supports_vision(model: &str) -> bool {
        // All Claude 3+ models support vision
        model.contains("claude-3") || model.contains("claude-sonnet-4") || model.contains("claude-opus-4")
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    async fn chat(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<&str>,
    ) -> Result<ProviderResponse, ProviderError> {
        let request = self.build_request(messages, tools, system_prompt);

        #[cfg(feature = "telemetry")]
        debug!(model = %self.model, messages = messages.len(), "Sending chat request");

        let response = self
            .client
            .post(format!("{}/v1/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| ProviderError::NetworkError(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(self.handle_error_response(status.as_u16(), &error_text));
        }

        let api_response: ApiResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::ParseError(e.to_string()))?;

        Ok(api_response.into())
    }

    async fn stream_chat(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<&str>,
        on_event: Box<dyn Fn(StreamEvent) + Send + Sync>,
    ) -> Result<ProviderResponse, ProviderError> {
        let request = self.build_streaming_request(messages, tools, system_prompt);

        #[cfg(feature = "telemetry")]
        debug!(model = %self.model, messages = messages.len(), "Sending streaming chat request");

        let response = self
            .client
            .post(format!("{}/v1/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| ProviderError::NetworkError(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(self.handle_error_response(status.as_u16(), &error_text));
        }

        // Process SSE stream
        let mut stream_state = StreamState::new();
        let text = response
            .text()
            .await
            .map_err(|e| ProviderError::StreamError(e.to_string()))?;

        let mut current_event_type = String::new();

        for line in text.lines() {
            if line.is_empty() {
                continue;
            }

            if let Some((field, value)) = Self::parse_sse_event(line) {
                match field {
                    "event" => {
                        current_event_type = value.to_string();
                    }
                    "data" => {
                        if let Err(e) = self.process_stream_data(
                            &current_event_type,
                            value,
                            &mut stream_state,
                            &on_event,
                        ) {
                            on_event(StreamEvent::Error(e.to_string()));
                        }
                    }
                    _ => {}
                }
            }
        }

        // Build final response
        Ok(stream_state.into_response())
    }

    fn supports_tool_use(&self) -> bool {
        true
    }

    fn supports_vision(&self) -> bool {
        Self::model_supports_vision(&self.model)
    }

    fn name(&self) -> &str {
        "Anthropic"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn context_window(&self) -> u32 {
        Self::get_context_window(&self.model)
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        // Anthropic doesn't have a models list API, so we return known models
        Ok(vec![
            ModelInfo {
                id: "claude-opus-4-20250514".to_string(),
                name: "Claude Opus 4".to_string(),
                provider: "Anthropic".to_string(),
                capabilities: ModelCapabilities {
                    vision: true,
                    tool_use: true,
                },
                context_window: Some(200_000),
                pricing: Some(ModelPricing {
                    input: 15.0,
                    output: 75.0,
                }),
                deprecated: None,
            },
            ModelInfo {
                id: "claude-sonnet-4-20250514".to_string(),
                name: "Claude Sonnet 4".to_string(),
                provider: "Anthropic".to_string(),
                capabilities: ModelCapabilities {
                    vision: true,
                    tool_use: true,
                },
                context_window: Some(200_000),
                pricing: Some(ModelPricing {
                    input: 3.0,
                    output: 15.0,
                }),
                deprecated: None,
            },
            ModelInfo {
                id: "claude-3-5-sonnet-latest".to_string(),
                name: "Claude 3.5 Sonnet".to_string(),
                provider: "Anthropic".to_string(),
                capabilities: ModelCapabilities {
                    vision: true,
                    tool_use: true,
                },
                context_window: Some(200_000),
                pricing: Some(ModelPricing {
                    input: 3.0,
                    output: 15.0,
                }),
                deprecated: None,
            },
            ModelInfo {
                id: "claude-3-5-haiku-latest".to_string(),
                name: "Claude 3.5 Haiku".to_string(),
                provider: "Anthropic".to_string(),
                capabilities: ModelCapabilities {
                    vision: true,
                    tool_use: true,
                },
                context_window: Some(200_000),
                pricing: Some(ModelPricing {
                    input: 0.80,
                    output: 4.0,
                }),
                deprecated: None,
            },
        ])
    }
}

impl AnthropicProvider {
    /// Handle an error response from the API.
    fn handle_error_response(&self, status_code: u16, body: &str) -> ProviderError {
        // Try to parse as JSON error
        if let Ok(error) = serde_json::from_str::<ApiError>(body) {
            match error.error.error_type.as_str() {
                "authentication_error" => ProviderError::AuthError(error.error.message),
                "rate_limit_error" => ProviderError::RateLimited(error.error.message),
                "invalid_request_error" => {
                    if error.error.message.contains("model") {
                        ProviderError::ModelNotFound(error.error.message)
                    } else {
                        ProviderError::api(error.error.message, status_code)
                    }
                }
                "overloaded_error" => ProviderError::RateLimited("API overloaded".to_string()),
                _ => ProviderError::api(error.error.message, status_code),
            }
        } else {
            ProviderError::api(body.to_string(), status_code)
        }
    }

    /// Process a single SSE data event.
    fn process_stream_data(
        &self,
        event_type: &str,
        data: &str,
        state: &mut StreamState,
        on_event: &(dyn Fn(StreamEvent) + Send + Sync),
    ) -> Result<(), ProviderError> {
        match event_type {
            "message_start" => {
                let msg: MessageStartEvent =
                    serde_json::from_str(data).map_err(|e| ProviderError::ParseError(e.to_string()))?;
                if let Some(usage) = msg.message.usage {
                    state.input_tokens = usage.input_tokens;
                }
            }
            "content_block_start" => {
                let block: ContentBlockStartEvent =
                    serde_json::from_str(data).map_err(|e| ProviderError::ParseError(e.to_string()))?;

                match block.content_block.block_type.as_str() {
                    "text" => {
                        state.current_block_type = Some(BlockType::Text);
                    }
                    "tool_use" => {
                        state.current_block_type = Some(BlockType::ToolUse);
                        state.current_tool_id = block.content_block.id.clone();
                        state.current_tool_name = block.content_block.name.clone();

                        if let (Some(id), Some(name)) = (&state.current_tool_id, &state.current_tool_name) {
                            on_event(StreamEvent::ToolUseStart {
                                id: id.clone(),
                                name: name.clone(),
                            });
                        }
                    }
                    "thinking" => {
                        state.current_block_type = Some(BlockType::Thinking);
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let delta: ContentBlockDeltaEvent =
                    serde_json::from_str(data).map_err(|e| ProviderError::ParseError(e.to_string()))?;

                match delta.delta.delta_type.as_str() {
                    "text_delta" => {
                        if let Some(text) = &delta.delta.text {
                            state.text_content.push_str(text);
                            on_event(StreamEvent::TextDelta(text.clone()));
                        }
                    }
                    "input_json_delta" => {
                        if let Some(partial) = &delta.delta.partial_json {
                            state.current_tool_input.push_str(partial);
                            on_event(StreamEvent::ToolInputDelta(partial.clone()));
                        }
                    }
                    "thinking_delta" => {
                        if let Some(thinking) = &delta.delta.thinking {
                            state.reasoning_content.push_str(thinking);
                            on_event(StreamEvent::ReasoningDelta(thinking.clone()));
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                if state.current_block_type == Some(BlockType::ToolUse) {
                    // Finalize tool call
                    if let (Some(id), Some(name)) = (state.current_tool_id.take(), state.current_tool_name.take()) {
                        let input: serde_json::Value = serde_json::from_str(&state.current_tool_input)
                            .unwrap_or(serde_json::Value::Object(Default::default()));

                        state.tool_calls.push(ToolCall {
                            id,
                            name,
                            input,
                        });
                        state.current_tool_input.clear();
                    }
                    on_event(StreamEvent::ToolUseEnd);
                }
                state.current_block_type = None;
            }
            "message_delta" => {
                let delta: MessageDeltaEvent =
                    serde_json::from_str(data).map_err(|e| ProviderError::ParseError(e.to_string()))?;

                if let Some(stop_reason) = delta.delta.stop_reason {
                    state.stop_reason = Some(match stop_reason.as_str() {
                        "end_turn" => StopReason::EndTurn,
                        "tool_use" => StopReason::ToolUse,
                        "max_tokens" => StopReason::MaxTokens,
                        _ => StopReason::EndTurn,
                    });
                }
                if let Some(usage) = delta.usage {
                    state.output_tokens = usage.output_tokens;
                }
            }
            "message_stop" => {
                let usage = TokenUsage {
                    input_tokens: state.input_tokens,
                    output_tokens: state.output_tokens,
                    ..Default::default()
                };
                on_event(StreamEvent::Usage(usage));
                on_event(StreamEvent::Done(state.stop_reason.unwrap_or(StopReason::EndTurn)));
            }
            "error" => {
                let error: StreamErrorEvent =
                    serde_json::from_str(data).map_err(|e| ProviderError::ParseError(e.to_string()))?;
                on_event(StreamEvent::Error(error.error.message));
            }
            _ => {}
        }

        Ok(())
    }
}

// ============================================================================
// Stream State
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockType {
    Text,
    ToolUse,
    Thinking,
}

/// State accumulated during streaming.
struct StreamState {
    text_content: String,
    reasoning_content: String,
    tool_calls: Vec<ToolCall>,
    stop_reason: Option<StopReason>,
    input_tokens: u32,
    output_tokens: u32,
    current_block_type: Option<BlockType>,
    current_tool_id: Option<String>,
    current_tool_name: Option<String>,
    current_tool_input: String,
}

impl StreamState {
    fn new() -> Self {
        Self {
            text_content: String::new(),
            reasoning_content: String::new(),
            tool_calls: Vec::new(),
            stop_reason: None,
            input_tokens: 0,
            output_tokens: 0,
            current_block_type: None,
            current_tool_id: None,
            current_tool_name: None,
            current_tool_input: String::new(),
        }
    }

    fn into_response(self) -> ProviderResponse {
        ProviderResponse {
            content: self.text_content,
            tool_calls: self.tool_calls,
            stop_reason: self.stop_reason.unwrap_or(StopReason::EndTurn),
            reasoning_content: if self.reasoning_content.is_empty() {
                None
            } else {
                Some(self.reasoning_content)
            },
            usage: Some(TokenUsage {
                input_tokens: self.input_tokens,
                output_tokens: self.output_tokens,
                ..Default::default()
            }),
        }
    }
}

// ============================================================================
// API Types
// ============================================================================

/// Request body for the Messages API.
#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ApiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ApiTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

/// API message format.
#[derive(Debug, Serialize, Deserialize)]
struct ApiMessage {
    role: String,
    content: ApiContent,
}

/// Content can be a string or array of blocks.
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ApiContent {
    Text(String),
    Blocks(Vec<ApiContentBlock>),
}

/// A content block in the API format.
#[derive(Debug, Serialize, Deserialize)]
struct ApiContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<ApiImageSource>,
}

/// Image source in API format.
#[derive(Debug, Serialize, Deserialize)]
struct ApiImageSource {
    #[serde(rename = "type")]
    source_type: String,
    media_type: String,
    data: String,
}

/// Tool definition in API format.
#[derive(Debug, Serialize)]
struct ApiTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

/// API response format.
#[derive(Debug, Deserialize)]
struct ApiResponse {
    content: Vec<ApiContentBlock>,
    stop_reason: String,
    usage: ApiUsage,
}

/// Token usage in API format.
#[derive(Debug, Deserialize)]
struct ApiUsage {
    input_tokens: u32,
    output_tokens: u32,
    #[serde(default)]
    cache_creation_input_tokens: Option<u32>,
    #[serde(default)]
    cache_read_input_tokens: Option<u32>,
}

/// API error response.
#[derive(Debug, Deserialize)]
struct ApiError {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    #[serde(rename = "type")]
    error_type: String,
    message: String,
}

// ============================================================================
// Streaming Event Types
// ============================================================================

#[derive(Debug, Deserialize)]
struct MessageStartEvent {
    message: MessageStartMessage,
}

#[derive(Debug, Deserialize)]
struct MessageStartMessage {
    usage: Option<ApiUsage>,
}

#[derive(Debug, Deserialize)]
struct ContentBlockStartEvent {
    content_block: ContentBlockStart,
}

#[derive(Debug, Deserialize)]
struct ContentBlockStart {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContentBlockDeltaEvent {
    delta: ContentBlockDelta,
}

#[derive(Debug, Deserialize)]
struct ContentBlockDelta {
    #[serde(rename = "type")]
    delta_type: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    partial_json: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageDeltaEvent {
    delta: MessageDelta,
    #[serde(default)]
    usage: Option<MessageDeltaUsage>,
}

#[derive(Debug, Deserialize)]
struct MessageDelta {
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageDeltaUsage {
    output_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct StreamErrorEvent {
    error: ApiErrorDetail,
}

// ============================================================================
// Type Conversions
// ============================================================================

impl From<&Message> for ApiMessage {
    fn from(msg: &Message) -> Self {
        let role = match msg.role {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::System => "user", // System messages become user messages in the API
        };

        let content = match &msg.content {
            MessageContent::Text(s) => ApiContent::Text(s.clone()),
            MessageContent::Blocks(blocks) => {
                ApiContent::Blocks(blocks.iter().map(|b| b.into()).collect())
            }
        };

        Self {
            role: role.to_string(),
            content,
        }
    }
}

impl From<&ContentBlock> for ApiContentBlock {
    fn from(block: &ContentBlock) -> Self {
        match block.block_type {
            ContentBlockType::Text => Self {
                block_type: "text".to_string(),
                text: block.text.clone(),
                id: None,
                name: None,
                input: None,
                tool_use_id: None,
                content: None,
                is_error: None,
                source: None,
            },
            ContentBlockType::ToolUse => Self {
                block_type: "tool_use".to_string(),
                text: None,
                id: block.id.clone(),
                name: block.name.clone(),
                input: block.input.clone(),
                tool_use_id: None,
                content: None,
                is_error: None,
                source: None,
            },
            ContentBlockType::ToolResult => Self {
                block_type: "tool_result".to_string(),
                text: None,
                id: None,
                name: None,
                input: None,
                tool_use_id: block.tool_use_id.clone(),
                content: block.content.clone(),
                is_error: block.is_error,
                source: None,
            },
            ContentBlockType::Image => {
                let source = block.image.as_ref().map(|img| ApiImageSource {
                    source_type: "base64".to_string(),
                    media_type: match img.media_type {
                        ImageMediaType::Jpeg => "image/jpeg".to_string(),
                        ImageMediaType::Png => "image/png".to_string(),
                        ImageMediaType::Gif => "image/gif".to_string(),
                        ImageMediaType::Webp => "image/webp".to_string(),
                    },
                    data: img.data.clone(),
                });
                Self {
                    block_type: "image".to_string(),
                    text: None,
                    id: None,
                    name: None,
                    input: None,
                    tool_use_id: None,
                    content: None,
                    is_error: None,
                    source,
                }
            }
            ContentBlockType::Thinking => Self {
                block_type: "thinking".to_string(),
                text: block.text.clone(),
                id: None,
                name: None,
                input: None,
                tool_use_id: None,
                content: None,
                is_error: None,
                source: None,
            },
        }
    }
}

impl From<&ToolDefinition> for ApiTool {
    fn from(tool: &ToolDefinition) -> Self {
        Self {
            name: tool.name.clone(),
            description: tool.description.clone(),
            input_schema: serde_json::to_value(&tool.input_schema).unwrap_or_default(),
        }
    }
}

impl From<ApiResponse> for ProviderResponse {
    fn from(response: ApiResponse) -> Self {
        let mut content = String::new();
        let mut tool_calls = Vec::new();
        let mut reasoning_content = None;

        for block in response.content {
            match block.block_type.as_str() {
                "text" => {
                    if let Some(text) = block.text {
                        content.push_str(&text);
                    }
                }
                "tool_use" => {
                    if let (Some(id), Some(name), Some(input)) = (block.id, block.name, block.input) {
                        tool_calls.push(ToolCall { id, name, input });
                    }
                }
                "thinking" => {
                    if let Some(text) = block.text {
                        reasoning_content = Some(text);
                    }
                }
                _ => {}
            }
        }

        let stop_reason = match response.stop_reason.as_str() {
            "end_turn" => StopReason::EndTurn,
            "tool_use" => StopReason::ToolUse,
            "max_tokens" => StopReason::MaxTokens,
            _ => StopReason::EndTurn,
        };

        Self {
            content,
            tool_calls,
            stop_reason,
            reasoning_content,
            usage: Some(TokenUsage {
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
                cache_read_input_tokens: response.usage.cache_read_input_tokens,
                cached_input_tokens: None,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_creation() {
        let config = ProviderConfig::default();
        let provider = AnthropicProvider::new(
            "test-key",
            "claude-sonnet-4-20250514",
            "https://api.anthropic.com",
            config,
        );

        assert_eq!(provider.name(), "Anthropic");
        assert_eq!(provider.model(), "claude-sonnet-4-20250514");
        assert!(provider.supports_tool_use());
        assert!(provider.supports_vision());
    }

    #[test]
    fn test_context_window() {
        assert_eq!(AnthropicProvider::get_context_window("claude-sonnet-4-20250514"), 200_000);
        assert_eq!(AnthropicProvider::get_context_window("claude-3-5-sonnet-latest"), 200_000);
        assert_eq!(AnthropicProvider::get_context_window("claude-2.1"), 100_000);
    }

    #[test]
    fn test_vision_support() {
        assert!(AnthropicProvider::model_supports_vision("claude-sonnet-4-20250514"));
        assert!(AnthropicProvider::model_supports_vision("claude-3-5-sonnet-latest"));
        assert!(!AnthropicProvider::model_supports_vision("claude-2.1"));
    }

    #[test]
    fn test_message_conversion() {
        let msg = Message::user("Hello, Claude!");
        let api_msg: ApiMessage = (&msg).into();

        assert_eq!(api_msg.role, "user");
        match api_msg.content {
            ApiContent::Text(s) => assert_eq!(s, "Hello, Claude!"),
            _ => panic!("Expected text content"),
        }
    }

    #[test]
    fn test_tool_conversion() {
        let tool = ToolDefinition::new("test_tool", "A test tool");
        let api_tool: ApiTool = (&tool).into();

        assert_eq!(api_tool.name, "test_tool");
        assert_eq!(api_tool.description, "A test tool");
    }

    #[test]
    fn test_sse_parsing() {
        assert_eq!(
            AnthropicProvider::parse_sse_event("event: message_start"),
            Some(("event", "message_start"))
        );
        assert_eq!(
            AnthropicProvider::parse_sse_event("data: {\"type\": \"message_start\"}"),
            Some(("data", "{\"type\": \"message_start\"}"))
        );
        assert_eq!(AnthropicProvider::parse_sse_event(""), None);
        assert_eq!(AnthropicProvider::parse_sse_event("invalid"), None);
    }

    #[test]
    fn test_stream_state() {
        let mut state = StreamState::new();
        state.text_content = "Hello".to_string();
        state.stop_reason = Some(StopReason::EndTurn);
        state.input_tokens = 100;
        state.output_tokens = 50;

        let response = state.into_response();
        assert_eq!(response.content, "Hello");
        assert_eq!(response.stop_reason, StopReason::EndTurn);
        assert!(response.tool_calls.is_empty());
        assert!(response.usage.is_some());
        assert_eq!(response.usage.unwrap().total(), 150);
    }
}
