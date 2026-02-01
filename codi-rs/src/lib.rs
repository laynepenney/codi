// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Codi - Your AI coding wingman.
//!
//! A hybrid AI assistant supporting Claude, OpenAI, and local models.
//! This is the Rust implementation, being developed incrementally alongside
//! the TypeScript version.
//!
//! # Architecture
//!
//! The crate is organized into the following modules:
//!
//! - [`types`] - Core type definitions (Message, ToolDefinition, ProviderResponse, etc.)
//! - [`error`] - Error types and result aliases
//! - [`config`] - Configuration loading and merging
//! - [`providers`] - AI provider implementations (Anthropic, OpenAI, Ollama)
//! - [`telemetry`] - Tracing, metrics, and observability infrastructure
//! - [`tools`] - Tool handlers and registry
//! - [`agent`] - Core agentic orchestration loop
//!
//! # Migration Status
//!
//! This Rust implementation is being developed in phases:
//!
//! - **Phase 0**: Foundation - types, errors, config, CLI shell ✓
//! - **Phase 1**: Tool layer - file tools, grep, glob, bash ✓
//! - **Phase 2**: Provider layer - Anthropic, OpenAI, Ollama ✓
//! - **Phase 3** (Current): Agent loop - core agentic orchestration
//! - **Phase 4**: Symbol index - tree-sitter based code navigation
//! - **Phase 5**: RAG system - vector search with lance
//! - **Phase 6**: Terminal UI - ratatui based interface
//! - **Phase 7**: Multi-agent - IPC-based worker orchestration
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::config::{load_config, CliOptions};
//! use codi::types::Message;
//!
//! // Load configuration
//! let config = load_config(".", CliOptions::default())?;
//!
//! // Create a message
//! let msg = Message::user("Hello, Codi!");
//! ```

pub mod agent;
pub mod config;
pub mod error;
pub mod providers;
pub mod telemetry;
pub mod tools;
pub mod types;

// Re-export commonly used types at crate root
pub use error::{AgentError, ConfigError, ProviderError, Result, ToolError};
pub use providers::{
    create_provider, create_provider_from_env,
    anthropic, openai, ollama, ollama_at,
    AnthropicProvider, OpenAIProvider, ProviderType,
};
pub use types::{
    // Message types
    ContentBlock, Message, MessageContent, Role,
    // Tool types
    ToolCall, ToolDefinition, ToolResult,
    // Provider types
    BoxedProvider, ModelInfo, Provider, ProviderConfig, ProviderResponse, SharedProvider,
    StopReason, StreamEvent, TokenUsage,
};

/// Codi version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Migration phase identifier.
pub const MIGRATION_PHASE: u8 = 3;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert!(!VERSION.is_empty());
    }

    #[test]
    fn test_migration_phase() {
        assert_eq!(MIGRATION_PHASE, 3);
    }

    #[test]
    fn test_public_exports() {
        // Verify key types are accessible
        let _msg = Message::user("test");
        let _response = ProviderResponse::empty();
    }
}
