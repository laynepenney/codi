// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! MCP client implementation.
//!
//! This module provides the `McpClient` for connecting to a single MCP server
//! and the `ConnectionManager` for managing multiple servers.
//!
//! # Current Status
//!
//! This is a foundational implementation that provides:
//! - Configuration parsing and validation
//! - Connection state management
//! - Tool discovery and wrapping
//!
//! Full rmcp SDK integration for actual protocol communication will be added
//! in a follow-up PR once the patterns are finalized.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::RwLock;

use super::config::{ServerConfig, TransportType};
use super::error::McpError;
use super::types::{ConnectionState, McpContent, McpToolInfo, McpToolResult, ServerInfo};

#[cfg(feature = "telemetry")]
use std::time::Instant;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

/// Client for a single MCP server connection.
pub struct McpClient {
    /// Server name.
    name: String,

    /// Server configuration.
    config: ServerConfig,

    /// Connection state.
    state: ConnectionState,

    /// Child process (for stdio transport).
    process: Option<Child>,

    /// Server info (after initialization).
    server_info: Option<ServerInfo>,

    /// Available tools (after initialization).
    tools: Vec<McpToolInfo>,

    /// Last error message.
    last_error: Option<String>,

    /// Request ID counter.
    request_id: u64,
}

impl McpClient {
    /// Create a new MCP client.
    pub fn new(name: impl Into<String>, config: ServerConfig) -> Self {
        Self {
            name: name.into(),
            config,
            state: ConnectionState::Disconnected,
            process: None,
            server_info: None,
            tools: Vec::new(),
            last_error: None,
            request_id: 0,
        }
    }

    /// Get the server name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Get the connection state.
    pub fn state(&self) -> ConnectionState {
        self.state
    }

    /// Get server info (if available).
    pub fn server_info(&self) -> Option<&ServerInfo> {
        self.server_info.as_ref()
    }

    /// Get available tools.
    pub fn tools(&self) -> &[McpToolInfo] {
        &self.tools
    }

    /// Get the last error message.
    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    /// Check if the client is ready for tool calls.
    pub fn is_ready(&self) -> bool {
        self.state == ConnectionState::Ready
    }

    /// Get the next request ID.
    fn next_request_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }

    /// Connect to the MCP server.
    pub async fn connect(&mut self) -> Result<(), McpError> {
        if self.state == ConnectionState::Ready {
            return Ok(());
        }

        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        self.state = ConnectionState::Connecting;

        let result = match self.config.transport {
            TransportType::Stdio => self.connect_stdio().await,
            TransportType::Http => self.connect_http().await,
            TransportType::Sse => self.connect_sse().await,
        };

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("mcp.client.connect", start.elapsed());

        match result {
            Ok(()) => {
                self.state = ConnectionState::Ready;
                self.last_error = None;
                Ok(())
            }
            Err(e) => {
                self.state = ConnectionState::Failed;
                self.last_error = Some(e.to_string());
                Err(e)
            }
        }
    }

    /// Connect via stdio transport using JSON-RPC.
    async fn connect_stdio(&mut self) -> Result<(), McpError> {
        let command = self.config.command.as_ref().ok_or_else(|| {
            McpError::Config("Stdio transport requires 'command' field".to_string())
        })?;

        // Build command
        let mut cmd = Command::new(command);
        cmd.args(&self.config.args);

        // Set environment variables
        for (key, value) in &self.config.env {
            cmd.env(key, value);
        }

        // Set working directory if specified
        if let Some(cwd) = &self.config.cwd {
            cmd.current_dir(cwd);
        }

        // Setup stdin/stdout for communication
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::null());

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| McpError::connection_failed(&self.name, e.to_string()))?;

        // Initialize with timeout
        let timeout = Duration::from_secs(self.config.startup_timeout_sec);

        // Send initialize request
        let init_result = tokio::time::timeout(timeout, async {
            self.send_initialize(&mut child).await
        })
        .await
        .map_err(|_| McpError::ConnectionTimeout {
            server: self.name.clone(),
            timeout_secs: self.config.startup_timeout_sec,
        })??;

        // Parse server info
        self.server_info = Some(init_result);

        // Store process
        self.process = Some(child);

        // Fetch tools
        self.fetch_tools().await?;

        Ok(())
    }

    /// Send initialize request and wait for response.
    async fn send_initialize(&mut self, child: &mut Child) -> Result<ServerInfo, McpError> {
        let stdin = child.stdin.as_mut().ok_or_else(|| {
            McpError::connection_failed(&self.name, "Failed to get stdin")
        })?;

        let stdout = child.stdout.as_mut().ok_or_else(|| {
            McpError::connection_failed(&self.name, "Failed to get stdout")
        })?;

        let request_id = self.next_request_id();

        // Build initialize request (JSON-RPC 2.0)
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "clientInfo": {
                    "name": "codi",
                    "version": crate::VERSION
                }
            }
        });

        // Send request
        let request_str = serde_json::to_string(&request)?;
        stdin
            .write_all(format!("{}\n", request_str).as_bytes())
            .await
            .map_err(|e| McpError::connection_failed(&self.name, e.to_string()))?;
        stdin.flush().await.map_err(|e| McpError::connection_failed(&self.name, e.to_string()))?;

        // Read response
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| McpError::connection_failed(&self.name, e.to_string()))?;

        // Parse response
        let response: serde_json::Value = serde_json::from_str(&line)?;

        // Check for error
        if let Some(error) = response.get("error") {
            let code = error.get("code").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(McpError::protocol(code, message));
        }

        // Extract server info from result
        let result = response.get("result").ok_or_else(|| {
            McpError::InvalidResponse("Missing result in initialize response".to_string())
        })?;

        let server_info = ServerInfo {
            name: result
                .get("serverInfo")
                .and_then(|s| s.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            version: result
                .get("serverInfo")
                .and_then(|s| s.get("version"))
                .and_then(|v| v.as_str())
                .unwrap_or("0.0.0")
                .to_string(),
            capabilities: Default::default(),
            protocol_version: result
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        };

        // Send initialized notification
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });

        // Get stdin again (need to reborrow)
        let stdin = child.stdin.as_mut().ok_or_else(|| {
            McpError::connection_failed(&self.name, "Failed to get stdin")
        })?;

        let notification_str = serde_json::to_string(&notification)?;
        stdin
            .write_all(format!("{}\n", notification_str).as_bytes())
            .await
            .map_err(|e| McpError::connection_failed(&self.name, e.to_string()))?;
        stdin.flush().await.map_err(|e| McpError::connection_failed(&self.name, e.to_string()))?;

        Ok(server_info)
    }

    /// Connect via HTTP transport.
    async fn connect_http(&mut self) -> Result<(), McpError> {
        Err(McpError::Config(
            "HTTP transport not yet implemented".to_string(),
        ))
    }

    /// Connect via SSE transport.
    async fn connect_sse(&mut self) -> Result<(), McpError> {
        Err(McpError::Config(
            "SSE transport not yet implemented".to_string(),
        ))
    }

    /// Fetch available tools from the server.
    async fn fetch_tools(&mut self) -> Result<(), McpError> {
        // Get request ID first to avoid borrow conflict
        let request_id = self.next_request_id();
        let server_name = self.name.clone();

        let child = self.process.as_mut().ok_or_else(|| {
            McpError::NotReady(server_name.clone())
        })?;

        let stdin = child.stdin.as_mut().ok_or_else(|| {
            McpError::connection_failed(&server_name, "Failed to get stdin")
        })?;

        let stdout = child.stdout.as_mut().ok_or_else(|| {
            McpError::connection_failed(&server_name, "Failed to get stdout")
        })?;

        // Build tools/list request
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/list"
        });

        // Send request
        let request_str = serde_json::to_string(&request)?;
        stdin
            .write_all(format!("{}\n", request_str).as_bytes())
            .await
            .map_err(|e| McpError::connection_failed(&server_name, e.to_string()))?;
        stdin.flush().await.map_err(|e| McpError::connection_failed(&server_name, e.to_string()))?;

        // Read response
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| McpError::connection_failed(&server_name, e.to_string()))?;

        // Parse response
        let response: serde_json::Value = serde_json::from_str(&line)?;

        // Check for error
        if let Some(error) = response.get("error") {
            let code = error.get("code").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(McpError::protocol(code, message));
        }

        // Extract tools from result
        let result = response.get("result").ok_or_else(|| {
            McpError::InvalidResponse("Missing result in tools/list response".to_string())
        })?;

        let tools = result
            .get("tools")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        self.tools = tools
            .into_iter()
            .filter_map(|t| {
                let name = t.get("name")?.as_str()?.to_string();

                // Check if tool is enabled
                if !self.config.is_tool_enabled(&name) {
                    return None;
                }

                Some(McpToolInfo {
                    name,
                    description: t
                        .get("description")
                        .and_then(|d| d.as_str())
                        .map(|s| s.to_string()),
                    input_schema: t.get("inputSchema").cloned().unwrap_or(serde_json::json!({})),
                    server: self.name.clone(),
                    destructive: t
                        .get("annotations")
                        .and_then(|a| a.get("destructiveHint"))
                        .and_then(|d| d.as_bool())
                        .unwrap_or(false),
                    read_only: t
                        .get("annotations")
                        .and_then(|a| a.get("readOnlyHint"))
                        .and_then(|r| r.as_bool())
                        .unwrap_or(false),
                    idempotent: t
                        .get("annotations")
                        .and_then(|a| a.get("idempotentHint"))
                        .and_then(|i| i.as_bool())
                        .unwrap_or(false),
                })
            })
            .collect();

        Ok(())
    }

    /// Call a tool on this server.
    pub async fn call_tool(
        &mut self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolResult, McpError> {
        // Get values before borrowing process to avoid borrow conflicts
        let request_id = self.next_request_id();
        let server_name = self.name.clone();
        let timeout = Duration::from_secs(self.config.tool_timeout_sec);

        #[cfg(feature = "telemetry")]
        let start = Instant::now();

        let child = self.process.as_mut().ok_or_else(|| {
            McpError::NotReady(server_name.clone())
        })?;

        let stdin = child.stdin.as_mut().ok_or_else(|| {
            McpError::connection_failed(&server_name, "Failed to get stdin")
        })?;

        let stdout = child.stdout.as_mut().ok_or_else(|| {
            McpError::connection_failed(&server_name, "Failed to get stdout")
        })?;

        // Build tools/call request
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        });

        // Send request with timeout
        let timeout_secs = timeout.as_secs();

        let result = tokio::time::timeout(timeout, async {
            // Send request
            let request_str = serde_json::to_string(&request)?;
            stdin
                .write_all(format!("{}\n", request_str).as_bytes())
                .await
                .map_err(|e| McpError::tool_failed(tool_name, e.to_string()))?;
            stdin.flush().await.map_err(|e| McpError::tool_failed(tool_name, e.to_string()))?;

            // Read response
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .await
                .map_err(|e| McpError::tool_failed(tool_name, e.to_string()))?;

            // Parse response
            let response: serde_json::Value = serde_json::from_str(&line)
                .map_err(|e| McpError::tool_failed(tool_name, e.to_string()))?;

            Ok::<_, McpError>(response)
        })
        .await
        .map_err(|_| McpError::ToolCallTimeout {
            tool: tool_name.to_string(),
            timeout_secs,
        })??;

        #[cfg(feature = "telemetry")]
        {
            let is_error = result.get("error").is_some();
            GLOBAL_METRICS.record_tool(
                &format!("mcp.{}.{}", server_name, tool_name),
                start.elapsed(),
                !is_error,
            );
        }

        // Check for error
        if let Some(error) = result.get("error") {
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Ok(McpToolResult::error(message));
        }

        // Extract content from result
        let tool_result = result.get("result").ok_or_else(|| {
            McpError::InvalidResponse("Missing result in tools/call response".to_string())
        })?;

        let is_error = tool_result
            .get("isError")
            .and_then(|e| e.as_bool())
            .unwrap_or(false);

        let content = tool_result
            .get("content")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();

        let parsed_content: Vec<McpContent> = content
            .into_iter()
            .filter_map(|c| {
                let content_type = c.get("type")?.as_str()?;
                match content_type {
                    "text" => Some(McpContent::Text {
                        text: c.get("text")?.as_str()?.to_string(),
                    }),
                    "image" => Some(McpContent::Image {
                        data: c.get("data")?.as_str()?.to_string(),
                        mime_type: c.get("mimeType")?.as_str()?.to_string(),
                    }),
                    "resource" => {
                        let resource = c.get("resource")?;
                        Some(McpContent::Resource {
                            uri: resource.get("uri")?.as_str()?.to_string(),
                            mime_type: resource
                                .get("mimeType")
                                .and_then(|m| m.as_str())
                                .map(|s| s.to_string()),
                            text: resource
                                .get("text")
                                .and_then(|t| t.as_str())
                                .map(|s| s.to_string()),
                        })
                    }
                    _ => None,
                }
            })
            .collect();

        Ok(McpToolResult {
            success: !is_error,
            content: parsed_content,
            is_error,
        })
    }

    /// Disconnect from the server.
    pub async fn disconnect(&mut self) {
        self.state = ConnectionState::Closing;

        // Kill the process if running
        if let Some(mut process) = self.process.take() {
            let _ = process.kill().await;
        }

        self.tools.clear();
        self.state = ConnectionState::Disconnected;
    }
}

/// Manager for multiple MCP server connections.
pub struct ConnectionManager {
    /// Connected clients.
    clients: HashMap<String, Arc<RwLock<McpClient>>>,
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionManager {
    /// Create a new connection manager.
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
        }
    }

    /// Add a server configuration and optionally connect.
    pub async fn add_server(
        &mut self,
        name: impl Into<String>,
        config: ServerConfig,
        connect: bool,
    ) -> Result<(), McpError> {
        let name = name.into();

        if self.clients.contains_key(&name) {
            return Err(McpError::AlreadyConnected(name));
        }

        let mut client = McpClient::new(name.clone(), config);

        if connect {
            client.connect().await?;
        }

        self.clients.insert(name, Arc::new(RwLock::new(client)));
        Ok(())
    }

    /// Remove a server connection.
    pub async fn remove_server(&mut self, name: &str) -> Option<()> {
        if let Some(client) = self.clients.remove(name) {
            let mut guard = client.write().await;
            guard.disconnect().await;
            Some(())
        } else {
            None
        }
    }

    /// Get a client by name.
    pub fn get_client(&self, name: &str) -> Option<Arc<RwLock<McpClient>>> {
        self.clients.get(name).cloned()
    }

    /// List all server names.
    pub fn server_names(&self) -> Vec<&str> {
        self.clients.keys().map(|s| s.as_str()).collect()
    }

    /// Get all available tools across all connected servers.
    pub async fn list_all_tools(&self) -> Vec<McpToolInfo> {
        let mut tools = Vec::new();

        for client in self.clients.values() {
            let guard = client.read().await;
            if guard.is_ready() {
                tools.extend(guard.tools().iter().cloned());
            }
        }

        tools
    }

    /// Find a tool by qualified name (mcp__server_tool format).
    pub async fn find_tool(&self, qualified_name: &str) -> Option<(String, McpToolInfo)> {
        // Parse qualified name
        if !qualified_name.starts_with("mcp__") {
            return None;
        }

        let rest = &qualified_name[5..]; // Skip "mcp__"
        let parts: Vec<&str> = rest.splitn(2, '_').collect();
        if parts.len() != 2 {
            return None;
        }

        let server_name = parts[0];
        let tool_name = parts[1];

        if let Some(client) = self.clients.get(server_name) {
            let guard = client.read().await;
            if let Some(tool) = guard.tools().iter().find(|t| t.name == tool_name) {
                return Some((server_name.to_string(), tool.clone()));
            }
        }

        None
    }

    /// Call a tool by qualified name.
    pub async fn call_tool(
        &self,
        qualified_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolResult, McpError> {
        // Parse qualified name
        if !qualified_name.starts_with("mcp__") {
            return Err(McpError::ToolNotFound {
                server: "".to_string(),
                tool: qualified_name.to_string(),
            });
        }

        let rest = &qualified_name[5..]; // Skip "mcp__"
        let parts: Vec<&str> = rest.splitn(2, '_').collect();
        if parts.len() != 2 {
            return Err(McpError::ToolNotFound {
                server: "".to_string(),
                tool: qualified_name.to_string(),
            });
        }

        let server_name = parts[0];
        let tool_name = parts[1];

        let client = self.clients.get(server_name).ok_or_else(|| {
            McpError::ServerNotFound(server_name.to_string())
        })?;

        let mut guard = client.write().await;
        guard.call_tool(tool_name, arguments).await
    }

    /// Connect to all configured servers.
    pub async fn connect_all(&mut self) -> Vec<(String, Result<(), McpError>)> {
        let mut results = Vec::new();

        for (name, client) in &self.clients {
            let mut guard = client.write().await;
            let result = guard.connect().await;
            results.push((name.clone(), result));
        }

        results
    }

    /// Disconnect from all servers.
    pub async fn disconnect_all(&mut self) {
        for client in self.clients.values() {
            let mut guard = client.write().await;
            guard.disconnect().await;
        }
    }

    /// Get connection states for all servers.
    pub async fn connection_states(&self) -> HashMap<String, ConnectionState> {
        let mut states = HashMap::new();

        for (name, client) in &self.clients {
            let guard = client.read().await;
            states.insert(name.clone(), guard.state());
        }

        states
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let config = ServerConfig::stdio("echo");
        let client = McpClient::new("test", config);

        assert_eq!(client.name(), "test");
        assert_eq!(client.state(), ConnectionState::Disconnected);
        assert!(!client.is_ready());
        assert!(client.tools().is_empty());
    }

    #[test]
    fn test_connection_manager_creation() {
        let manager = ConnectionManager::new();
        assert!(manager.server_names().is_empty());
    }

    #[tokio::test]
    async fn test_add_server_no_connect() {
        let mut manager = ConnectionManager::new();
        let config = ServerConfig::stdio("echo");

        let result = manager.add_server("test", config, false).await;
        assert!(result.is_ok());
        assert_eq!(manager.server_names().len(), 1);
    }

    #[tokio::test]
    async fn test_duplicate_server() {
        let mut manager = ConnectionManager::new();
        let config1 = ServerConfig::stdio("echo");
        let config2 = ServerConfig::stdio("cat");

        manager.add_server("test", config1, false).await.unwrap();
        let result = manager.add_server("test", config2, false).await;

        assert!(matches!(result, Err(McpError::AlreadyConnected(_))));
    }

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
    fn test_request_id_increment() {
        let config = ServerConfig::stdio("echo");
        let mut client = McpClient::new("test", config);

        assert_eq!(client.next_request_id(), 1);
        assert_eq!(client.next_request_id(), 2);
        assert_eq!(client.next_request_id(), 3);
    }
}
