// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tool registry and handler trait.
//!
//! This module defines the core abstractions for the tool system:
//! - [`ToolHandler`] trait that all tools must implement
//! - [`ToolRegistry`] for managing and dispatching tool calls
//! - [`ToolOutput`] for returning results from tool execution

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::ToolError;
use crate::types::ToolDefinition;

/// Output from executing a tool.
#[derive(Debug, Clone)]
pub enum ToolOutput {
    /// Simple text content result
    Text {
        content: String,
        success: bool,
    },
    /// Structured result with optional metadata
    Structured {
        content: String,
        success: bool,
        metadata: Option<serde_json::Value>,
    },
}

impl ToolOutput {
    /// Create a successful text output.
    pub fn success(content: impl Into<String>) -> Self {
        Self::Text {
            content: content.into(),
            success: true,
        }
    }

    /// Create an error text output.
    pub fn error(content: impl Into<String>) -> Self {
        Self::Text {
            content: content.into(),
            success: false,
        }
    }

    /// Create a structured output with metadata.
    pub fn structured(content: impl Into<String>, success: bool, metadata: serde_json::Value) -> Self {
        Self::Structured {
            content: content.into(),
            success,
            metadata: Some(metadata),
        }
    }

    /// Get the content string.
    pub fn content(&self) -> &str {
        match self {
            Self::Text { content, .. } => content,
            Self::Structured { content, .. } => content,
        }
    }

    /// Check if the output indicates success.
    pub fn is_success(&self) -> bool {
        match self {
            Self::Text { success, .. } => *success,
            Self::Structured { success, .. } => *success,
        }
    }

    /// Get a preview suitable for logging (truncated).
    pub fn log_preview(&self, max_bytes: usize) -> String {
        let content = self.content();
        if content.len() <= max_bytes {
            content.to_string()
        } else {
            format!("{}... [truncated]", &content[..max_bytes])
        }
    }
}

impl From<ToolError> for ToolOutput {
    fn from(err: ToolError) -> Self {
        Self::error(err.to_string())
    }
}

/// Trait that all tool handlers must implement.
///
/// This is the core abstraction for tools in Codi. Each tool is a struct
/// that implements this trait, providing its definition and execution logic.
///
/// # Example
///
/// ```rust,ignore
/// use codi::tools::{ToolHandler, ToolOutput};
/// use codi::types::ToolDefinition;
///
/// struct MyTool;
///
/// #[async_trait]
/// impl ToolHandler for MyTool {
///     fn definition(&self) -> ToolDefinition {
///         ToolDefinition::new("my_tool", "Does something useful")
///     }
///
///     async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
///         Ok(ToolOutput::success("Done!"))
///     }
/// }
/// ```
#[async_trait]
pub trait ToolHandler: Send + Sync {
    /// Get the tool definition (name, description, input schema).
    fn definition(&self) -> ToolDefinition;

    /// Returns true if this tool may mutate the environment (files, processes, etc.).
    ///
    /// Mutating tools may require user confirmation before execution.
    fn is_mutating(&self) -> bool {
        false
    }

    /// Execute the tool with the given input parameters.
    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError>;
}

/// Registry of available tools, maps names to handlers.
pub struct ToolRegistry {
    handlers: HashMap<String, Arc<dyn ToolHandler>>,
}

impl ToolRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Create a registry with default tools.
    pub fn with_defaults() -> Self {
        let mut builder = ToolRegistryBuilder::new();

        // Register all default handlers
        builder.register(super::handlers::ReadFileHandler);
        builder.register(super::handlers::GrepHandler);
        builder.register(super::handlers::GlobHandler);
        builder.register(super::handlers::BashHandler);
        builder.register(super::handlers::ListDirHandler);
        builder.register(super::handlers::WriteFileHandler);
        builder.register(super::handlers::EditFileHandler);

        builder.build()
    }

    /// Get a handler by tool name.
    pub fn get(&self, name: &str) -> Option<Arc<dyn ToolHandler>> {
        self.handlers.get(name).cloned()
    }

    /// Check if a tool exists.
    pub fn contains(&self, name: &str) -> bool {
        self.handlers.contains_key(name)
    }

    /// Get all tool definitions.
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.handlers.values().map(|h| h.definition()).collect()
    }

    /// Get all tool names.
    pub fn tool_names(&self) -> Vec<&str> {
        self.handlers.keys().map(String::as_str).collect()
    }

    /// Dispatch a tool call and return the result.
    pub async fn dispatch(
        &self,
        tool_name: &str,
        input: serde_json::Value,
    ) -> Result<DispatchResult, ToolError> {
        let handler = self
            .get(tool_name)
            .ok_or_else(|| ToolError::NotFound(tool_name.to_string()))?;

        let start = Instant::now();
        let result = handler.execute(input).await;
        let duration = start.elapsed();

        match result {
            Ok(output) => Ok(DispatchResult {
                tool_name: tool_name.to_string(),
                output,
                duration,
                is_error: false,
            }),
            Err(err) => Ok(DispatchResult {
                tool_name: tool_name.to_string(),
                output: ToolOutput::from(err),
                duration,
                is_error: true,
            }),
        }
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Result of dispatching a tool call.
#[derive(Debug)]
pub struct DispatchResult {
    /// Name of the tool that was called
    pub tool_name: String,
    /// Output from the tool
    pub output: ToolOutput,
    /// Duration of execution
    pub duration: Duration,
    /// Whether the execution resulted in an error
    pub is_error: bool,
}

/// Builder for constructing a ToolRegistry.
pub struct ToolRegistryBuilder {
    handlers: HashMap<String, Arc<dyn ToolHandler>>,
}

impl ToolRegistryBuilder {
    /// Create a new empty builder.
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Register a tool handler.
    pub fn register<T: ToolHandler + 'static>(&mut self, handler: T) -> &mut Self {
        let def = handler.definition();
        self.handlers.insert(def.name.clone(), Arc::new(handler));
        self
    }

    /// Register a tool handler (boxed version for dynamic registration).
    pub fn register_boxed(&mut self, handler: Arc<dyn ToolHandler>) -> &mut Self {
        let def = handler.definition();
        self.handlers.insert(def.name.clone(), handler);
        self
    }

    /// Build the final registry.
    pub fn build(self) -> ToolRegistry {
        ToolRegistry {
            handlers: self.handlers,
        }
    }
}

impl Default for ToolRegistryBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockTool {
        name: String,
        mutating: bool,
    }

    #[async_trait]
    impl ToolHandler for MockTool {
        fn definition(&self) -> ToolDefinition {
            ToolDefinition::new(&self.name, "A mock tool")
        }

        fn is_mutating(&self) -> bool {
            self.mutating
        }

        async fn execute(&self, _input: serde_json::Value) -> Result<ToolOutput, ToolError> {
            Ok(ToolOutput::success("mock result"))
        }
    }

    #[test]
    fn test_tool_output_success() {
        let output = ToolOutput::success("test");
        assert!(output.is_success());
        assert_eq!(output.content(), "test");
    }

    #[test]
    fn test_tool_output_error() {
        let output = ToolOutput::error("failed");
        assert!(!output.is_success());
        assert_eq!(output.content(), "failed");
    }

    #[test]
    fn test_tool_output_log_preview() {
        let output = ToolOutput::success("a".repeat(100));
        let preview = output.log_preview(10);
        assert!(preview.len() < 100);
        assert!(preview.contains("truncated"));
    }

    #[test]
    fn test_registry_builder() {
        let mut builder = ToolRegistryBuilder::new();
        builder.register(MockTool {
            name: "mock1".to_string(),
            mutating: false,
        });
        builder.register(MockTool {
            name: "mock2".to_string(),
            mutating: true,
        });

        let registry = builder.build();
        assert!(registry.contains("mock1"));
        assert!(registry.contains("mock2"));
        assert!(!registry.contains("mock3"));
    }

    #[tokio::test]
    async fn test_registry_dispatch() {
        let mut builder = ToolRegistryBuilder::new();
        builder.register(MockTool {
            name: "test_tool".to_string(),
            mutating: false,
        });

        let registry = builder.build();
        let result = registry
            .dispatch("test_tool", serde_json::json!({}))
            .await
            .unwrap();

        assert_eq!(result.tool_name, "test_tool");
        assert!(result.output.is_success());
        assert!(!result.is_error);
    }

    #[tokio::test]
    async fn test_registry_dispatch_not_found() {
        let registry = ToolRegistry::new();
        let result = registry.dispatch("nonexistent", serde_json::json!({})).await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::NotFound(_)));
    }
}
