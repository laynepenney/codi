// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! OpenAI-compatible provider implementation.
//!
//! This module provides a [`Provider`] implementation for OpenAI and any
//! OpenAI-compatible API (Ollama, Azure OpenAI, Together, Groq, etc.).
//!
//! # Supported Endpoints
//!
//! - **OpenAI** - `https://api.openai.com/v1` (default)
//! - **Ollama** - `http://localhost:11434/v1` (no API key needed)
//! - **Azure OpenAI** - Custom base URL with api-version query param
//! - **Any OpenAI-compatible** - Just set base_url
//!
//! # API Reference
//!
//! See [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[cfg(feature = "telemetry")]
use tracing::debug;

use crate::error::ProviderError;
use crate::types::{
    ContentBlockType, ImageMediaType, Message, MessageContent,
    ModelCapabilities, ModelInfo, ModelPricing, Provider, ProviderConfig, ProviderResponse,
    Role, StopReason, StreamEvent, TokenUsage, ToolCall, ToolDefinition,
};

/// Default OpenAI API base URL.
pub const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

/// Default Ollama API base URL.
pub const OLLAMA_BASE_URL: &str = "http://localhost:11434/v1";

/// Default max tokens if not specified.
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// Default request timeout in seconds.
const DEFAULT_TIMEOUT_SECS: u64 = 300;

/// OpenAI-compatible provider.
///
/// Works with OpenAI, Ollama, Azure OpenAI, and any OpenAI-compatible API.
pub struct OpenAIProvider {
    client: Client,
    api_key: Option<String>,
    model: String,
    base_url: String,
    max_tokens: u32,
    temperature: Option<f32>,
    provider_name: String,
}

impl OpenAIProvider {
    /// Create a new OpenAI provider.
    pub fn new(
        api_key: Option<String>,
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

        let base_url = base_url.into();
        let provider_name = Self::detect_provider_name(&base_url);

        Self {
            client,
            api_key,
            model: model.into(),
            base_url,
            max_tokens: config.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
            temperature: config.temperature,
            provider_name,
        }
    }

    /// Create a provider for OpenAI.
    pub fn openai(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self::new(
            Some(api_key.into()),
            model,
            OPENAI_BASE_URL,
            ProviderConfig::default(),
        )
    }

    /// Create a provider for Ollama (no API key needed).
    pub fn ollama(model: impl Into<String>) -> Self {
        Self::new(
            None,
            model,
            OLLAMA_BASE_URL,
            ProviderConfig::default(),
        )
    }

    /// Create a provider for Ollama with custom base URL.
    pub fn ollama_with_url(model: impl Into<String>, base_url: impl Into<String>) -> Self {
        Self::new(
            None,
            model,
            base_url,
            ProviderConfig::default(),
        )
    }

    /// Detect provider name from base URL.
    fn detect_provider_name(base_url: &str) -> String {
        if base_url.contains("openai.com") {
            "OpenAI".to_string()
        } else if base_url.contains("localhost:11434") || base_url.contains("ollama") {
            "Ollama".to_string()
        } else if base_url.contains("azure") {
            "Azure OpenAI".to_string()
        } else if base_url.contains("together") {
            "Together".to_string()
        } else if base_url.contains("groq") {
            "Groq".to_string()
        } else if base_url.contains("deepseek") {
            "DeepSeek".to_string()
        } else {
            "OpenAI-Compatible".to_string()
        }
    }

    /// Build the request body for the Chat Completions API.
    fn build_request(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<&str>,
    ) -> ChatRequest {
        let mut api_messages: Vec<ChatMessage> = Vec::new();

        // Add system message if provided
        if let Some(system) = system_prompt {
            api_messages.push(ChatMessage {
                role: "system".to_string(),
                content: Some(ChatContent::Text(system.to_string())),
                tool_calls: None,
                tool_call_id: None,
            });
        }

        // Convert messages
        for msg in messages {
            api_messages.push(msg.into());
        }

        let tools_json: Option<Vec<ChatTool>> = tools.map(|t| t.iter().map(|t| t.into()).collect());

        ChatRequest {
            model: self.model.clone(),
            messages: api_messages,
            tools: tools_json,
            max_tokens: Some(self.max_tokens),
            temperature: self.temperature,
            stream: Some(false),
        }
    }

    /// Build a streaming request body.
    fn build_streaming_request(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<&str>,
    ) -> ChatRequest {
        let mut request = self.build_request(messages, tools, system_prompt);
        request.stream = Some(true);
        request
    }

    /// Get context window size for a model.
    fn get_context_window(model: &str) -> u32 {
        // GPT-4 variants
        if model.contains("gpt-4o") || model.contains("gpt-4-turbo") {
            128_000
        } else if model.contains("gpt-4-32k") {
            32_768
        } else if model.contains("gpt-4") {
            8_192
        }
        // GPT-3.5 variants
        else if model.contains("gpt-3.5-turbo-16k") {
            16_384
        } else if model.contains("gpt-3.5") {
            4_096
        }
        // O1/O3 models
        else if model.contains("o1") || model.contains("o3") {
            200_000
        }
        // Default for unknown models
        else {
            8_192
        }
    }

    /// Check if a model supports vision.
    fn model_supports_vision(model: &str) -> bool {
        model.contains("gpt-4o")
            || model.contains("gpt-4-turbo")
            || model.contains("gpt-4-vision")
            || model.contains("vision")
    }

    /// Check if a model supports tool use.
    fn model_supports_tools(model: &str) -> bool {
        // Most modern models support tools
        !model.contains("instruct") && !model.contains("davinci") && !model.contains("babbage")
    }
}

#[async_trait]
impl Provider for OpenAIProvider {
    async fn chat(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<&str>,
    ) -> Result<ProviderResponse, ProviderError> {
        let request = self.build_request(messages, tools, system_prompt);

        #[cfg(feature = "telemetry")]
        debug!(model = %self.model, messages = messages.len(), "Sending chat request");

        let mut req = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .header("content-type", "application/json");

        // Add auth header if API key is set
        if let Some(ref api_key) = self.api_key {
            req = req.header("authorization", format!("Bearer {}", api_key));
        }

        let response = req
            .json(&request)
            .send()
            .await
            .map_err(|e| ProviderError::NetworkError(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(self.handle_error_response(status.as_u16(), &error_text));
        }

        let api_response: ChatResponse = response
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

        let mut req = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .header("content-type", "application/json");

        if let Some(ref api_key) = self.api_key {
            req = req.header("authorization", format!("Bearer {}", api_key));
        }

        let response = req
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

        for line in text.lines() {
            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" {
                    break;
                }

                if let Ok(chunk) = serde_json::from_str::<ChatStreamChunk>(data) {
                    self.process_stream_chunk(&chunk, &mut stream_state, &on_event);
                }
            }
        }

        // Finalize any pending tool calls
        stream_state.finalize_pending_tool_call();

        // Emit final events
        let usage = TokenUsage {
            input_tokens: stream_state.input_tokens,
            output_tokens: stream_state.output_tokens,
            ..Default::default()
        };
        on_event(StreamEvent::Usage(usage));
        on_event(StreamEvent::Done(stream_state.stop_reason.unwrap_or(StopReason::EndTurn)));

        Ok(stream_state.into_response())
    }

    fn supports_tool_use(&self) -> bool {
        Self::model_supports_tools(&self.model)
    }

    fn supports_vision(&self) -> bool {
        Self::model_supports_vision(&self.model)
    }

    fn name(&self) -> &str {
        &self.provider_name
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn context_window(&self) -> u32 {
        Self::get_context_window(&self.model)
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        // Try to fetch models from API
        let mut req = self
            .client
            .get(format!("{}/models", self.base_url));

        if let Some(ref api_key) = self.api_key {
            req = req.header("authorization", format!("Bearer {}", api_key));
        }

        let response = req.send().await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(models_response) = resp.json::<ModelsResponse>().await {
                    return Ok(models_response.data.into_iter().map(|m| {
                        ModelInfo {
                            id: m.id.clone(),
                            name: m.id.clone(),
                            provider: self.provider_name.clone(),
                            capabilities: ModelCapabilities {
                                vision: Self::model_supports_vision(&m.id),
                                tool_use: Self::model_supports_tools(&m.id),
                            },
                            context_window: Some(Self::get_context_window(&m.id)),
                            pricing: None,
                            deprecated: None,
                        }
                    }).collect());
                }
            }
            _ => {}
        }

        // Fallback to known models for OpenAI
        if self.base_url.contains("openai.com") {
            Ok(Self::known_openai_models())
        } else {
            // For other providers, return empty list
            Ok(vec![])
        }
    }
}

impl OpenAIProvider {
    /// Handle an error response from the API.
    fn handle_error_response(&self, status_code: u16, body: &str) -> ProviderError {
        if let Ok(error) = serde_json::from_str::<ApiError>(body) {
            let message = error.error.message;
            match error.error.error_type.as_deref() {
                Some("authentication_error") | Some("invalid_api_key") => {
                    ProviderError::AuthError(message)
                }
                Some("rate_limit_error") | Some("rate_limit_exceeded") => {
                    ProviderError::RateLimited(message)
                }
                Some("model_not_found") => ProviderError::ModelNotFound(message),
                Some("context_length_exceeded") => ProviderError::ContextWindowExceeded {
                    used: 0,
                    limit: self.context_window(),
                },
                _ => ProviderError::api(message, status_code),
            }
        } else {
            ProviderError::api(body.to_string(), status_code)
        }
    }

    /// Process a streaming chunk.
    fn process_stream_chunk(
        &self,
        chunk: &ChatStreamChunk,
        state: &mut StreamState,
        on_event: &(dyn Fn(StreamEvent) + Send + Sync),
    ) {
        // Update usage if present
        if let Some(usage) = &chunk.usage {
            state.input_tokens = usage.prompt_tokens;
            state.output_tokens = usage.completion_tokens;
        }

        for choice in &chunk.choices {
            // Check for stop reason
            if let Some(ref finish_reason) = choice.finish_reason {
                state.stop_reason = Some(match finish_reason.as_str() {
                    "stop" => StopReason::EndTurn,
                    "tool_calls" => StopReason::ToolUse,
                    "length" => StopReason::MaxTokens,
                    _ => StopReason::EndTurn,
                });
            }

            let delta = &choice.delta;

            // Handle content delta
            if let Some(ref content) = delta.content {
                state.text_content.push_str(content);
                on_event(StreamEvent::TextDelta(content.clone()));
            }

            // Handle tool calls
            if let Some(ref tool_calls) = delta.tool_calls {
                for tc in tool_calls {
                    // Start new tool call if we have an ID
                    if let Some(ref id) = tc.id {
                        // Finalize previous tool call if any
                        state.finalize_pending_tool_call();

                        state.current_tool_id = Some(id.clone());
                        if let Some(ref func) = tc.function {
                            state.current_tool_name = func.name.clone();
                        }

                        if let (Some(id), Some(name)) = (&state.current_tool_id, &state.current_tool_name) {
                            on_event(StreamEvent::ToolUseStart {
                                id: id.clone(),
                                name: name.clone(),
                            });
                        }
                    }

                    // Accumulate arguments
                    if let Some(ref func) = tc.function {
                        if let Some(ref args) = func.arguments {
                            state.current_tool_input.push_str(args);
                            on_event(StreamEvent::ToolInputDelta(args.clone()));
                        }
                    }
                }
            }
        }
    }

    /// Return known OpenAI models with metadata.
    fn known_openai_models() -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "gpt-4o".to_string(),
                name: "GPT-4o".to_string(),
                provider: "OpenAI".to_string(),
                capabilities: ModelCapabilities {
                    vision: true,
                    tool_use: true,
                },
                context_window: Some(128_000),
                pricing: Some(ModelPricing {
                    input: 2.50,
                    output: 10.0,
                }),
                deprecated: None,
            },
            ModelInfo {
                id: "gpt-4o-mini".to_string(),
                name: "GPT-4o Mini".to_string(),
                provider: "OpenAI".to_string(),
                capabilities: ModelCapabilities {
                    vision: true,
                    tool_use: true,
                },
                context_window: Some(128_000),
                pricing: Some(ModelPricing {
                    input: 0.15,
                    output: 0.60,
                }),
                deprecated: None,
            },
            ModelInfo {
                id: "gpt-4-turbo".to_string(),
                name: "GPT-4 Turbo".to_string(),
                provider: "OpenAI".to_string(),
                capabilities: ModelCapabilities {
                    vision: true,
                    tool_use: true,
                },
                context_window: Some(128_000),
                pricing: Some(ModelPricing {
                    input: 10.0,
                    output: 30.0,
                }),
                deprecated: None,
            },
            ModelInfo {
                id: "gpt-3.5-turbo".to_string(),
                name: "GPT-3.5 Turbo".to_string(),
                provider: "OpenAI".to_string(),
                capabilities: ModelCapabilities {
                    vision: false,
                    tool_use: true,
                },
                context_window: Some(16_384),
                pricing: Some(ModelPricing {
                    input: 0.50,
                    output: 1.50,
                }),
                deprecated: None,
            },
        ]
    }
}

// ============================================================================
// Stream State
// ============================================================================

/// State accumulated during streaming.
struct StreamState {
    text_content: String,
    tool_calls: Vec<ToolCall>,
    stop_reason: Option<StopReason>,
    input_tokens: u32,
    output_tokens: u32,
    current_tool_id: Option<String>,
    current_tool_name: Option<String>,
    current_tool_input: String,
}

impl StreamState {
    fn new() -> Self {
        Self {
            text_content: String::new(),
            tool_calls: Vec::new(),
            stop_reason: None,
            input_tokens: 0,
            output_tokens: 0,
            current_tool_id: None,
            current_tool_name: None,
            current_tool_input: String::new(),
        }
    }

    /// Finalize any pending tool call.
    fn finalize_pending_tool_call(&mut self) {
        if let (Some(id), Some(name)) = (self.current_tool_id.take(), self.current_tool_name.take()) {
            let input: serde_json::Value = serde_json::from_str(&self.current_tool_input)
                .unwrap_or(serde_json::Value::Object(Default::default()));

            self.tool_calls.push(ToolCall { id, name, input });
            self.current_tool_input.clear();
        }
    }

    fn into_response(self) -> ProviderResponse {
        ProviderResponse {
            content: self.text_content,
            tool_calls: self.tool_calls,
            stop_reason: self.stop_reason.unwrap_or(StopReason::EndTurn),
            reasoning_content: None,
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

/// Request body for Chat Completions API.
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ChatTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

/// Chat message format.
#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<ChatContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<ChatToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

/// Content can be a string or array of parts.
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ChatContent {
    Text(String),
    Parts(Vec<ChatContentPart>),
}

/// A content part (text or image).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ChatContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrl },
}

/// Image URL for vision.
#[derive(Debug, Serialize, Deserialize)]
struct ImageUrl {
    url: String,
}

/// Tool call in a message.
#[derive(Debug, Serialize, Deserialize)]
struct ChatToolCall {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    call_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    function: Option<ChatFunction>,
}

/// Function details in a tool call.
#[derive(Debug, Serialize, Deserialize)]
struct ChatFunction {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    arguments: Option<String>,
}

/// Tool definition in Chat API format.
#[derive(Debug, Serialize)]
struct ChatTool {
    #[serde(rename = "type")]
    tool_type: String,
    function: ChatToolFunction,
}

/// Function definition within a tool.
#[derive(Debug, Serialize)]
struct ChatToolFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

/// Chat completion response.
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

/// A choice in the response.
#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
    finish_reason: Option<String>,
}

/// Token usage.
#[derive(Debug, Deserialize)]
struct ChatUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

/// Streaming chunk.
#[derive(Debug, Deserialize)]
struct ChatStreamChunk {
    choices: Vec<ChatStreamChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

/// Choice in streaming chunk.
#[derive(Debug, Deserialize)]
struct ChatStreamChoice {
    delta: ChatStreamDelta,
    finish_reason: Option<String>,
}

/// Delta in streaming.
#[derive(Debug, Deserialize)]
struct ChatStreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ChatToolCall>>,
}

/// Models list response.
#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelData>,
}

/// Model data from list.
#[derive(Debug, Deserialize)]
struct ModelData {
    id: String,
}

/// API error response.
#[derive(Debug, Deserialize)]
struct ApiError {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    message: String,
    #[serde(rename = "type")]
    error_type: Option<String>,
}

// ============================================================================
// Type Conversions
// ============================================================================

impl From<&Message> for ChatMessage {
    fn from(msg: &Message) -> Self {
        let role = match msg.role {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::System => "system",
        };

        match &msg.content {
            MessageContent::Text(s) => Self {
                role: role.to_string(),
                content: Some(ChatContent::Text(s.clone())),
                tool_calls: None,
                tool_call_id: None,
            },
            MessageContent::Blocks(blocks) => {
                let mut content_parts = Vec::new();
                let mut tool_calls = Vec::new();
                let mut tool_result_id = None;
                let mut tool_result_content = None;

                for block in blocks {
                    match block.block_type {
                        ContentBlockType::Text => {
                            if let Some(ref text) = block.text {
                                content_parts.push(ChatContentPart::Text { text: text.clone() });
                            }
                        }
                        ContentBlockType::ToolUse => {
                            tool_calls.push(ChatToolCall {
                                id: block.id.clone(),
                                call_type: Some("function".to_string()),
                                function: Some(ChatFunction {
                                    name: block.name.clone(),
                                    arguments: block.input.as_ref().map(|v| v.to_string()),
                                }),
                            });
                        }
                        ContentBlockType::ToolResult => {
                            tool_result_id = block.tool_use_id.clone();
                            tool_result_content = block.content.clone();
                        }
                        ContentBlockType::Image => {
                            if let Some(ref img) = block.image {
                                let media_type = match img.media_type {
                                    ImageMediaType::Jpeg => "image/jpeg",
                                    ImageMediaType::Png => "image/png",
                                    ImageMediaType::Gif => "image/gif",
                                    ImageMediaType::Webp => "image/webp",
                                };
                                content_parts.push(ChatContentPart::ImageUrl {
                                    image_url: ImageUrl {
                                        url: format!("data:{};base64,{}", media_type, img.data),
                                    },
                                });
                            }
                        }
                        ContentBlockType::Thinking => {
                            // Skip thinking blocks for OpenAI
                        }
                    }
                }

                // Handle tool results specially
                if let (Some(id), Some(content)) = (tool_result_id, tool_result_content) {
                    return Self {
                        role: "tool".to_string(),
                        content: Some(ChatContent::Text(content)),
                        tool_calls: None,
                        tool_call_id: Some(id),
                    };
                }

                // Handle tool calls
                if !tool_calls.is_empty() {
                    return Self {
                        role: role.to_string(),
                        content: if content_parts.is_empty() {
                            None
                        } else if content_parts.len() == 1 {
                            if let ChatContentPart::Text { text } = &content_parts[0] {
                                Some(ChatContent::Text(text.clone()))
                            } else {
                                Some(ChatContent::Parts(content_parts))
                            }
                        } else {
                            Some(ChatContent::Parts(content_parts))
                        },
                        tool_calls: Some(tool_calls),
                        tool_call_id: None,
                    };
                }

                // Regular content
                Self {
                    role: role.to_string(),
                    content: if content_parts.is_empty() {
                        None
                    } else if content_parts.len() == 1 {
                        if let ChatContentPart::Text { text } = &content_parts[0] {
                            Some(ChatContent::Text(text.clone()))
                        } else {
                            Some(ChatContent::Parts(content_parts))
                        }
                    } else {
                        Some(ChatContent::Parts(content_parts))
                    },
                    tool_calls: None,
                    tool_call_id: None,
                }
            }
        }
    }
}

impl From<&ToolDefinition> for ChatTool {
    fn from(tool: &ToolDefinition) -> Self {
        Self {
            tool_type: "function".to_string(),
            function: ChatToolFunction {
                name: tool.name.clone(),
                description: tool.description.clone(),
                parameters: serde_json::to_value(&tool.input_schema).unwrap_or_default(),
            },
        }
    }
}

impl From<ChatResponse> for ProviderResponse {
    fn from(response: ChatResponse) -> Self {
        let choice = response.choices.into_iter().next();

        let (content, tool_calls, stop_reason) = if let Some(choice) = choice {
            let content = match choice.message.content {
                Some(ChatContent::Text(s)) => s,
                Some(ChatContent::Parts(parts)) => {
                    parts
                        .into_iter()
                        .filter_map(|p| match p {
                            ChatContentPart::Text { text } => Some(text),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("")
                }
                None => String::new(),
            };

            let tool_calls = choice
                .message
                .tool_calls
                .unwrap_or_default()
                .into_iter()
                .filter_map(|tc| {
                    let id = tc.id?;
                    let func = tc.function?;
                    let name = func.name?;
                    let input: serde_json::Value = func
                        .arguments
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default();
                    Some(ToolCall { id, name, input })
                })
                .collect();

            let stop_reason = match choice.finish_reason.as_deref() {
                Some("stop") => StopReason::EndTurn,
                Some("tool_calls") => StopReason::ToolUse,
                Some("length") => StopReason::MaxTokens,
                _ => StopReason::EndTurn,
            };

            (content, tool_calls, stop_reason)
        } else {
            (String::new(), Vec::new(), StopReason::EndTurn)
        };

        Self {
            content,
            tool_calls,
            stop_reason,
            reasoning_content: None,
            usage: response.usage.map(|u| TokenUsage {
                input_tokens: u.prompt_tokens,
                output_tokens: u.completion_tokens,
                ..Default::default()
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_provider_creation() {
        let provider = OpenAIProvider::openai("test-key", "gpt-4o");
        assert_eq!(provider.name(), "OpenAI");
        assert_eq!(provider.model(), "gpt-4o");
        assert!(provider.supports_tool_use());
        assert!(provider.supports_vision());
    }

    #[test]
    fn test_ollama_provider_creation() {
        let provider = OpenAIProvider::ollama("llama3.2");
        assert_eq!(provider.name(), "Ollama");
        assert_eq!(provider.model(), "llama3.2");
    }

    #[test]
    fn test_context_window() {
        assert_eq!(OpenAIProvider::get_context_window("gpt-4o"), 128_000);
        assert_eq!(OpenAIProvider::get_context_window("gpt-4-turbo"), 128_000);
        assert_eq!(OpenAIProvider::get_context_window("gpt-4"), 8_192);
        assert_eq!(OpenAIProvider::get_context_window("gpt-3.5-turbo"), 4_096);
    }

    #[test]
    fn test_vision_support() {
        assert!(OpenAIProvider::model_supports_vision("gpt-4o"));
        assert!(OpenAIProvider::model_supports_vision("gpt-4-turbo"));
        assert!(!OpenAIProvider::model_supports_vision("gpt-3.5-turbo"));
    }

    #[test]
    fn test_message_conversion() {
        let msg = Message::user("Hello!");
        let chat_msg: ChatMessage = (&msg).into();

        assert_eq!(chat_msg.role, "user");
        match chat_msg.content {
            Some(ChatContent::Text(s)) => assert_eq!(s, "Hello!"),
            _ => panic!("Expected text content"),
        }
    }

    #[test]
    fn test_tool_conversion() {
        let tool = ToolDefinition::new("test_tool", "A test tool");
        let chat_tool: ChatTool = (&tool).into();

        assert_eq!(chat_tool.tool_type, "function");
        assert_eq!(chat_tool.function.name, "test_tool");
    }

    #[test]
    fn test_provider_name_detection() {
        assert_eq!(OpenAIProvider::detect_provider_name("https://api.openai.com/v1"), "OpenAI");
        assert_eq!(OpenAIProvider::detect_provider_name("http://localhost:11434/v1"), "Ollama");
        assert_eq!(OpenAIProvider::detect_provider_name("https://mycompany.azure.com"), "Azure OpenAI");
        assert_eq!(OpenAIProvider::detect_provider_name("https://custom.example.com"), "OpenAI-Compatible");
    }
}
