// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! MCP server configuration.
//!
//! Supports configuration of MCP servers via the `.codi.json` config file.
//!
//! # Example Configuration
//!
//! ```json
//! {
//!   "mcp_servers": {
//!     "filesystem": {
//!       "transport": "stdio",
//!       "command": "npx",
//!       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
//!       "enabled": true,
//!       "startup_timeout_sec": 30,
//!       "tool_timeout_sec": 300
//!     },
//!     "github": {
//!       "transport": "http",
//!       "url": "https://mcp.github.com/v1",
//!       "bearer_token": "${GITHUB_TOKEN}",
//!       "enabled_tools": ["get_issue", "create_pr"]
//!     }
//!   }
//! }
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use super::error::McpError;

/// MCP configuration containing all server definitions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct McpConfig {
    /// Map of server name to server configuration.
    #[serde(default)]
    pub servers: HashMap<String, ServerConfig>,
}

impl McpConfig {
    /// Create an empty configuration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Load configuration from a file.
    pub fn load_from_file(path: impl AsRef<Path>) -> Result<Self, McpError> {
        let path = path.as_ref();
        let content = std::fs::read_to_string(path)
            .map_err(|e| McpError::Config(format!("Failed to read config file: {}", e)))?;

        Self::from_json(&content)
    }

    /// Parse configuration from JSON string.
    pub fn from_json(json: &str) -> Result<Self, McpError> {
        // Try to parse as full config with mcp_servers field
        #[derive(Deserialize)]
        struct FullConfig {
            #[serde(default)]
            mcp_servers: HashMap<String, ServerConfig>,
        }

        let full: FullConfig = serde_json::from_str(json)?;
        Ok(Self {
            servers: full.mcp_servers,
        })
    }

    /// Get enabled servers.
    pub fn enabled_servers(&self) -> impl Iterator<Item = (&String, &ServerConfig)> {
        self.servers.iter().filter(|(_, c)| c.enabled)
    }

    /// Add a server configuration.
    pub fn add_server(&mut self, name: impl Into<String>, config: ServerConfig) {
        self.servers.insert(name.into(), config);
    }

    /// Remove a server configuration.
    pub fn remove_server(&mut self, name: &str) -> Option<ServerConfig> {
        self.servers.remove(name)
    }
}

/// Configuration for a single MCP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Transport type.
    pub transport: TransportType,

    /// Whether this server is enabled.
    #[serde(default = "default_enabled")]
    pub enabled: bool,

    /// Startup timeout in seconds.
    #[serde(default = "default_startup_timeout")]
    pub startup_timeout_sec: u64,

    /// Tool call timeout in seconds.
    #[serde(default = "default_tool_timeout")]
    pub tool_timeout_sec: u64,

    /// List of enabled tools (if empty, all tools are enabled).
    #[serde(default)]
    pub enabled_tools: Vec<String>,

    /// List of disabled tools.
    #[serde(default)]
    pub disabled_tools: Vec<String>,

    /// Auto-approve these tools (skip confirmation).
    #[serde(default)]
    pub auto_approve: Vec<String>,

    /// Environment variables for stdio transport.
    #[serde(default)]
    pub env: HashMap<String, String>,

    /// Working directory for stdio transport.
    pub cwd: Option<String>,

    /// Command for stdio transport.
    pub command: Option<String>,

    /// Arguments for stdio transport.
    #[serde(default)]
    pub args: Vec<String>,

    /// URL for HTTP/SSE transport.
    pub url: Option<String>,

    /// Bearer token for HTTP transport (supports ${ENV_VAR} expansion).
    pub bearer_token: Option<String>,
}

fn default_enabled() -> bool {
    true
}

fn default_startup_timeout() -> u64 {
    30
}

fn default_tool_timeout() -> u64 {
    300
}

impl ServerConfig {
    /// Create a stdio transport configuration.
    pub fn stdio(command: impl Into<String>) -> Self {
        Self {
            transport: TransportType::Stdio,
            enabled: true,
            startup_timeout_sec: 30,
            tool_timeout_sec: 300,
            enabled_tools: Vec::new(),
            disabled_tools: Vec::new(),
            auto_approve: Vec::new(),
            env: HashMap::new(),
            cwd: None,
            command: Some(command.into()),
            args: Vec::new(),
            url: None,
            bearer_token: None,
        }
    }

    /// Create an HTTP transport configuration.
    pub fn http(url: impl Into<String>) -> Self {
        Self {
            transport: TransportType::Http,
            enabled: true,
            startup_timeout_sec: 30,
            tool_timeout_sec: 300,
            enabled_tools: Vec::new(),
            disabled_tools: Vec::new(),
            auto_approve: Vec::new(),
            env: HashMap::new(),
            cwd: None,
            command: None,
            args: Vec::new(),
            url: Some(url.into()),
            bearer_token: None,
        }
    }

    /// Create an SSE transport configuration.
    pub fn sse(url: impl Into<String>) -> Self {
        Self {
            transport: TransportType::Sse,
            enabled: true,
            startup_timeout_sec: 30,
            tool_timeout_sec: 300,
            enabled_tools: Vec::new(),
            disabled_tools: Vec::new(),
            auto_approve: Vec::new(),
            env: HashMap::new(),
            cwd: None,
            command: None,
            args: Vec::new(),
            url: Some(url.into()),
            bearer_token: None,
        }
    }

    /// Add command arguments.
    pub fn with_args(mut self, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.args = args.into_iter().map(|s| s.into()).collect();
        self
    }

    /// Set environment variables.
    pub fn with_env(
        mut self,
        env: impl IntoIterator<Item = (impl Into<String>, impl Into<String>)>,
    ) -> Self {
        self.env = env
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .collect();
        self
    }

    /// Set working directory.
    pub fn with_cwd(mut self, cwd: impl Into<String>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    /// Set bearer token.
    pub fn with_bearer_token(mut self, token: impl Into<String>) -> Self {
        self.bearer_token = Some(token.into());
        self
    }

    /// Set enabled tools.
    pub fn with_enabled_tools(mut self, tools: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.enabled_tools = tools.into_iter().map(|s| s.into()).collect();
        self
    }

    /// Set auto-approve tools.
    pub fn with_auto_approve(mut self, tools: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.auto_approve = tools.into_iter().map(|s| s.into()).collect();
        self
    }

    /// Check if a tool is enabled.
    pub fn is_tool_enabled(&self, tool_name: &str) -> bool {
        // If disabled_tools contains the tool, it's disabled
        if self.disabled_tools.contains(&tool_name.to_string()) {
            return false;
        }

        // If enabled_tools is empty, all tools are enabled
        // Otherwise, tool must be in enabled_tools
        self.enabled_tools.is_empty() || self.enabled_tools.contains(&tool_name.to_string())
    }

    /// Check if a tool should be auto-approved.
    pub fn should_auto_approve(&self, tool_name: &str) -> bool {
        self.auto_approve.contains(&tool_name.to_string())
    }

    /// Expand environment variables in bearer token.
    pub fn expanded_bearer_token(&self) -> Option<String> {
        self.bearer_token.as_ref().map(|token| {
            let mut result = token.clone();
            // Simple ${VAR} expansion
            while let Some(start) = result.find("${") {
                if let Some(end) = result[start..].find('}') {
                    let var_name = &result[start + 2..start + end];
                    let value = std::env::var(var_name).unwrap_or_default();
                    result = format!("{}{}{}", &result[..start], value, &result[start + end + 1..]);
                } else {
                    break;
                }
            }
            result
        })
    }
}

/// Transport type for MCP connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportType {
    /// Stdio transport (child process).
    Stdio,

    /// HTTP transport.
    Http,

    /// Server-Sent Events transport.
    Sse,
}

impl Default for TransportType {
    fn default() -> Self {
        Self::Stdio
    }
}

impl std::fmt::Display for TransportType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Stdio => write!(f, "stdio"),
            Self::Http => write!(f, "http"),
            Self::Sse => write!(f, "sse"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_config() {
        let json = r#"
        {
            "mcp_servers": {
                "filesystem": {
                    "transport": "stdio",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                },
                "github": {
                    "transport": "http",
                    "url": "https://mcp.github.com/v1",
                    "bearer_token": "${GITHUB_TOKEN}",
                    "enabled": false
                }
            }
        }
        "#;

        let config = McpConfig::from_json(json).unwrap();
        assert_eq!(config.servers.len(), 2);

        let fs = config.servers.get("filesystem").unwrap();
        assert_eq!(fs.transport, TransportType::Stdio);
        assert_eq!(fs.command.as_deref(), Some("npx"));
        assert!(fs.enabled);

        let gh = config.servers.get("github").unwrap();
        assert_eq!(gh.transport, TransportType::Http);
        assert!(!gh.enabled);
    }

    #[test]
    fn test_server_config_builders() {
        let config = ServerConfig::stdio("npx")
            .with_args(["-y", "@modelcontextprotocol/server-filesystem"])
            .with_cwd("/tmp")
            .with_env([("NODE_ENV", "production")]);

        assert_eq!(config.transport, TransportType::Stdio);
        assert_eq!(config.command.as_deref(), Some("npx"));
        assert_eq!(config.args.len(), 2);
        assert_eq!(config.cwd.as_deref(), Some("/tmp"));
        assert_eq!(config.env.get("NODE_ENV").map(|s| s.as_str()), Some("production"));

        let config = ServerConfig::http("https://api.example.com")
            .with_bearer_token("secret");

        assert_eq!(config.transport, TransportType::Http);
        assert_eq!(config.url.as_deref(), Some("https://api.example.com"));
        assert_eq!(config.bearer_token.as_deref(), Some("secret"));
    }

    #[test]
    fn test_tool_filtering() {
        let config = ServerConfig::stdio("test")
            .with_enabled_tools(["read_file", "write_file"]);

        assert!(config.is_tool_enabled("read_file"));
        assert!(config.is_tool_enabled("write_file"));
        assert!(!config.is_tool_enabled("delete_file"));

        // Empty enabled_tools means all enabled
        let config = ServerConfig::stdio("test");
        assert!(config.is_tool_enabled("any_tool"));
    }

    #[test]
    fn test_auto_approve() {
        let config = ServerConfig::stdio("test")
            .with_auto_approve(["read_file", "glob"]);

        assert!(config.should_auto_approve("read_file"));
        assert!(config.should_auto_approve("glob"));
        assert!(!config.should_auto_approve("write_file"));
    }

    #[test]
    fn test_env_var_expansion() {
        // SAFETY: This test runs single-threaded and we clean up the env var after
        unsafe {
            std::env::set_var("TEST_TOKEN", "my_secret_token");
        }

        let config = ServerConfig::http("https://api.example.com")
            .with_bearer_token("${TEST_TOKEN}");

        assert_eq!(
            config.expanded_bearer_token().as_deref(),
            Some("my_secret_token")
        );

        // SAFETY: Cleanup after test
        unsafe {
            std::env::remove_var("TEST_TOKEN");
        }
    }

    #[test]
    fn test_enabled_servers() {
        let mut config = McpConfig::new();
        config.add_server("enabled1", ServerConfig::stdio("cmd1"));
        config.add_server("enabled2", ServerConfig::stdio("cmd2"));

        let mut disabled = ServerConfig::stdio("cmd3");
        disabled.enabled = false;
        config.add_server("disabled", disabled);

        let enabled: Vec<_> = config.enabled_servers().collect();
        assert_eq!(enabled.len(), 2);
    }

    #[test]
    fn test_transport_display() {
        assert_eq!(TransportType::Stdio.to_string(), "stdio");
        assert_eq!(TransportType::Http.to_string(), "http");
        assert_eq!(TransportType::Sse.to_string(), "sse");
    }
}
