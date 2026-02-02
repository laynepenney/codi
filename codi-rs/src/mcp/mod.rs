// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Model Context Protocol (MCP) support for tool extensibility.
//!
//! This module implements MCP client functionality allowing Codi to connect
//! to external MCP servers and use their tools. It also provides server
//! functionality to expose Codi's tools via MCP.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                    ConnectionManager                     │
//! │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
//! │  │ McpClient   │  │ McpClient   │  │ McpClient   │     │
//! │  │ (server1)   │  │ (server2)   │  │ (server3)   │     │
//! │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
//! └─────────┼────────────────┼────────────────┼─────────────┘
//!           │                │                │
//!     ┌─────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐
//!     │  Stdio    │    │   HTTP    │    │   SSE     │
//!     │ Transport │    │ Transport │    │ Transport │
//!     └───────────┘    └───────────┘    └───────────┘
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::mcp::{McpConfig, ConnectionManager};
//!
//! // Load configuration
//! let config = McpConfig::load_from_file(".codi.json")?;
//!
//! // Create connection manager
//! let mut manager = ConnectionManager::new();
//!
//! // Connect to configured servers
//! for (name, server_config) in config.servers {
//!     manager.connect(&name, server_config).await?;
//! }
//!
//! // Get all available tools
//! let tools = manager.list_tools().await?;
//!
//! // Call a tool
//! let result = manager.call_tool("server__tool_name", input).await?;
//! ```

pub mod client;
pub mod config;
pub mod error;
pub mod tools;
pub mod types;

pub use client::{ConnectionManager, McpClient};
pub use config::McpConfig;
pub use error::McpError;
pub use tools::McpToolWrapper;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        // Verify module exports compile
        let _ = std::any::type_name::<McpConfig>();
        let _ = std::any::type_name::<McpError>();
    }
}
