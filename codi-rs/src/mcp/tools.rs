// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! MCP tool wrapper for integrating MCP tools with Codi's tool system.
//!
//! This module provides `McpToolWrapper` which wraps an MCP tool and implements
//! the Codi tool handler trait, allowing MCP tools to be used seamlessly with
//! the agent loop.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use super::client::McpClient;
use super::error::McpError;
use super::types::{McpToolInfo, McpToolResult};
use crate::error::ToolError;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::{InputSchema, ToolDefinition};

/// Wrapper that exposes an MCP tool as a Codi tool handler.
pub struct McpToolWrapper {
    /// Tool information.
    tool_info: McpToolInfo,

    /// Client connection for tool calls.
    client: Arc<RwLock<McpClient>>,
}

impl McpToolWrapper {
    /// Create a new MCP tool wrapper.
    pub fn new(tool_info: McpToolInfo, client: Arc<RwLock<McpClient>>) -> Self {
        Self { tool_info, client }
    }

    /// Get the tool info.
    pub fn info(&self) -> &McpToolInfo {
        &self.tool_info
    }

    /// Get the qualified tool name.
    pub fn qualified_name(&self) -> String {
        self.tool_info.qualified_name()
    }

    /// Check if this tool should be auto-approved.
    pub fn is_auto_approved(&self, auto_approve_list: &[String]) -> bool {
        // Check both the full qualified name and the base tool name
        auto_approve_list.iter().any(|pattern| {
            pattern == &self.tool_info.name
                || pattern == &self.qualified_name()
                || pattern == "*"
        })
    }
}

#[async_trait]
impl ToolHandler for McpToolWrapper {
    fn definition(&self) -> ToolDefinition {
        // Convert MCP's JSON Schema to Codi's InputSchema
        let input_schema = convert_json_schema_to_input_schema(&self.tool_info.input_schema);

        ToolDefinition {
            name: self.qualified_name(),
            description: self.tool_info.description.clone().unwrap_or_else(|| {
                format!("MCP tool from {} server", self.tool_info.server)
            }),
            input_schema,
        }
    }

    fn is_mutating(&self) -> bool {
        // MCP tools that are not read-only are considered mutating
        !self.tool_info.read_only
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let mut guard = self.client.write().await;

        if !guard.is_ready() {
            return Err(ToolError::ExecutionFailed(format!(
                "MCP server '{}' is not connected",
                self.tool_info.server
            )));
        }

        match guard.call_tool(&self.tool_info.name, input).await {
            Ok(result) => {
                if result.is_error {
                    Ok(ToolOutput::error(result.as_text()))
                } else {
                    Ok(ToolOutput::success(result.as_text()))
                }
            }
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }
}

/// Convert an MCP JSON Schema (serde_json::Value) to Codi's InputSchema.
fn convert_json_schema_to_input_schema(schema: &serde_json::Value) -> InputSchema {
    let mut input_schema = InputSchema::new();

    // Extract properties from JSON Schema
    if let Some(props) = schema.get("properties").and_then(|p| p.as_object()) {
        for (key, value) in props {
            input_schema.properties.insert(key.clone(), value.clone());
        }
    }

    // Extract required fields
    if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
        let required_fields: Vec<String> = required
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
        if !required_fields.is_empty() {
            input_schema.required = Some(required_fields);
        }
    }

    input_schema
}

/// Create tool handlers for all tools from a connection manager.
pub async fn create_tool_handlers(
    manager: &super::client::ConnectionManager,
) -> Vec<Arc<dyn ToolHandler + Send + Sync>> {
    let mut handlers: Vec<Arc<dyn ToolHandler + Send + Sync>> = Vec::new();

    for server_name in manager.server_names() {
        if let Some(client) = manager.get_client(server_name) {
            let guard = client.read().await;
            for tool_info in guard.tools() {
                let wrapper = McpToolWrapper::new(tool_info.clone(), client.clone());
                handlers.push(Arc::new(wrapper));
            }
        }
    }

    handlers
}

/// Result from an MCP tool call for agent integration.
#[derive(Debug, Clone)]
pub struct McpToolCallResult {
    /// Whether the call was successful.
    pub success: bool,

    /// Output text.
    pub output: String,

    /// Whether this was an error.
    pub is_error: bool,
}

impl From<McpToolResult> for McpToolCallResult {
    fn from(result: McpToolResult) -> Self {
        Self {
            success: result.success,
            output: result.as_text(),
            is_error: result.is_error,
        }
    }
}

impl From<McpError> for McpToolCallResult {
    fn from(error: McpError) -> Self {
        Self {
            success: false,
            output: error.to_string(),
            is_error: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::config::ServerConfig;

    #[test]
    fn test_tool_wrapper_qualified_name() {
        let tool_info = McpToolInfo {
            name: "read_file".to_string(),
            description: Some("Read a file".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }),
            server: "filesystem".to_string(),
            destructive: false,
            read_only: true,
            idempotent: true,
        };

        let config = ServerConfig::stdio("test");
        let client = McpClient::new("filesystem", config);
        let wrapper = McpToolWrapper::new(tool_info, Arc::new(RwLock::new(client)));

        assert_eq!(wrapper.qualified_name(), "mcp__filesystem_read_file");
    }

    #[test]
    fn test_auto_approve_matching() {
        let tool_info = McpToolInfo {
            name: "read_file".to_string(),
            description: None,
            input_schema: serde_json::json!({}),
            server: "filesystem".to_string(),
            destructive: false,
            read_only: true,
            idempotent: true,
        };

        let config = ServerConfig::stdio("test");
        let client = McpClient::new("filesystem", config);
        let wrapper = McpToolWrapper::new(tool_info, Arc::new(RwLock::new(client)));

        // Match by base name
        assert!(wrapper.is_auto_approved(&["read_file".to_string()]));

        // Match by qualified name
        assert!(wrapper.is_auto_approved(&["mcp__filesystem_read_file".to_string()]));

        // Match by wildcard
        assert!(wrapper.is_auto_approved(&["*".to_string()]));

        // No match
        assert!(!wrapper.is_auto_approved(&["write_file".to_string()]));
    }

    #[test]
    fn test_tool_definition() {
        let tool_info = McpToolInfo {
            name: "bash".to_string(),
            description: Some("Execute a bash command".to_string()),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" }
                }
            }),
            server: "shell".to_string(),
            destructive: true,
            read_only: false,
            idempotent: false,
        };

        let config = ServerConfig::stdio("test");
        let client = McpClient::new("shell", config);
        let wrapper = McpToolWrapper::new(tool_info, Arc::new(RwLock::new(client)));

        let definition = wrapper.definition();
        assert_eq!(definition.name, "mcp__shell_bash");
        // Non-read-only tools should be mutating (requires confirmation)
        assert!(wrapper.is_mutating());
    }

    #[test]
    fn test_mcp_call_result_from_success() {
        let result = McpToolResult::text("File contents here");
        let call_result: McpToolCallResult = result.into();

        assert!(call_result.success);
        assert!(!call_result.is_error);
        assert_eq!(call_result.output, "File contents here");
    }

    #[test]
    fn test_mcp_call_result_from_error() {
        let result = McpToolResult::error("File not found");
        let call_result: McpToolCallResult = result.into();

        assert!(!call_result.success);
        assert!(call_result.is_error);
        assert_eq!(call_result.output, "File not found");
    }

    #[test]
    fn test_mcp_call_result_from_mcp_error() {
        let error = McpError::ServerNotFound("test".to_string());
        let call_result: McpToolCallResult = error.into();

        assert!(!call_result.success);
        assert!(call_result.is_error);
        assert!(call_result.output.contains("test"));
    }
}
