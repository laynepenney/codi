// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! MCP types for tool and content handling.
//!
//! These types wrap the rmcp SDK types to provide a simpler interface
//! and additional functionality for Codi integration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Information about an MCP tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    /// Tool name.
    pub name: String,

    /// Tool description.
    pub description: Option<String>,

    /// JSON Schema for tool input.
    pub input_schema: serde_json::Value,

    /// Server this tool belongs to.
    pub server: String,

    /// Whether the tool is destructive (writes files, runs commands, etc.).
    #[serde(default)]
    pub destructive: bool,

    /// Whether the tool is read-only (safe to auto-approve).
    #[serde(default)]
    pub read_only: bool,

    /// Whether the tool is idempotent (safe to retry).
    #[serde(default)]
    pub idempotent: bool,
}

impl McpToolInfo {
    /// Get the qualified tool name (server__toolname format).
    pub fn qualified_name(&self) -> String {
        format!("mcp__{}_{}", self.server, self.name)
    }
}

/// Result of a tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    /// Whether the tool call was successful.
    pub success: bool,

    /// Result content (text, images, etc.).
    pub content: Vec<McpContent>,

    /// Whether there was an error.
    #[serde(default)]
    pub is_error: bool,
}

impl McpToolResult {
    /// Create a successful text result.
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            success: true,
            content: vec![McpContent::Text {
                text: text.into(),
            }],
            is_error: false,
        }
    }

    /// Create an error result.
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            content: vec![McpContent::Text {
                text: message.into(),
            }],
            is_error: true,
        }
    }

    /// Get the text content as a single string.
    pub fn as_text(&self) -> String {
        self.content
            .iter()
            .filter_map(|c| match c {
                McpContent::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Content types that can be returned by MCP tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpContent {
    /// Plain text content.
    Text {
        /// The text content.
        text: String,
    },

    /// Image content.
    Image {
        /// Base64-encoded image data.
        data: String,
        /// MIME type of the image.
        mime_type: String,
    },

    /// Resource reference.
    Resource {
        /// URI of the resource.
        uri: String,
        /// Optional MIME type.
        mime_type: Option<String>,
        /// Optional text content.
        text: Option<String>,
    },
}

/// Server capabilities reported during initialization.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServerCapabilities {
    /// Whether the server supports tools.
    #[serde(default)]
    pub tools: bool,

    /// Whether the server supports resources.
    #[serde(default)]
    pub resources: bool,

    /// Whether the server supports prompts.
    #[serde(default)]
    pub prompts: bool,

    /// Whether the server supports logging.
    #[serde(default)]
    pub logging: bool,

    /// Whether the server supports sampling (LLM access).
    #[serde(default)]
    pub sampling: bool,

    /// Additional capabilities as key-value pairs.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Server information reported during initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    /// Server name.
    pub name: String,

    /// Server version.
    pub version: String,

    /// Server capabilities.
    #[serde(default)]
    pub capabilities: ServerCapabilities,

    /// Protocol version supported.
    #[serde(default)]
    pub protocol_version: Option<String>,
}

impl Default for ServerInfo {
    fn default() -> Self {
        Self {
            name: "unknown".to_string(),
            version: "0.0.0".to_string(),
            capabilities: ServerCapabilities::default(),
            protocol_version: None,
        }
    }
}

/// Connection state for an MCP server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionState {
    /// Not connected.
    Disconnected,

    /// Currently connecting.
    Connecting,

    /// Connected but not yet initialized.
    Connected,

    /// Fully initialized and ready.
    Ready,

    /// Connection failed.
    Failed,

    /// Closing connection.
    Closing,
}

impl Default for ConnectionState {
    fn default() -> Self {
        Self::Disconnected
    }
}

impl std::fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disconnected => write!(f, "disconnected"),
            Self::Connecting => write!(f, "connecting"),
            Self::Connected => write!(f, "connected"),
            Self::Ready => write!(f, "ready"),
            Self::Failed => write!(f, "failed"),
            Self::Closing => write!(f, "closing"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_info_qualified_name() {
        let tool = McpToolInfo {
            name: "read_file".to_string(),
            description: Some("Read a file".to_string()),
            input_schema: serde_json::json!({}),
            server: "filesystem".to_string(),
            destructive: false,
            read_only: true,
            idempotent: true,
        };

        assert_eq!(tool.qualified_name(), "mcp__filesystem_read_file");
    }

    #[test]
    fn test_tool_result_text() {
        let result = McpToolResult::text("Hello, world!");
        assert!(result.success);
        assert!(!result.is_error);
        assert_eq!(result.as_text(), "Hello, world!");
    }

    #[test]
    fn test_tool_result_error() {
        let result = McpToolResult::error("Something went wrong");
        assert!(!result.success);
        assert!(result.is_error);
        assert_eq!(result.as_text(), "Something went wrong");
    }

    #[test]
    fn test_content_serialization() {
        let content = McpContent::Text {
            text: "Hello".to_string(),
        };
        let json = serde_json::to_string(&content).unwrap();
        assert!(json.contains("\"type\":\"text\""));

        let content = McpContent::Image {
            data: "base64data".to_string(),
            mime_type: "image/png".to_string(),
        };
        let json = serde_json::to_string(&content).unwrap();
        assert!(json.contains("\"type\":\"image\""));
    }

    #[test]
    fn test_connection_state_display() {
        assert_eq!(ConnectionState::Disconnected.to_string(), "disconnected");
        assert_eq!(ConnectionState::Ready.to_string(), "ready");
        assert_eq!(ConnectionState::Failed.to_string(), "failed");
    }

    #[test]
    fn test_server_capabilities_default() {
        let caps = ServerCapabilities::default();
        assert!(!caps.tools);
        assert!(!caps.resources);
        assert!(!caps.prompts);
    }
}
