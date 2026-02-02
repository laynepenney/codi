// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Core types for the Model Map multi-model orchestration system.
//!
//! This module defines the data structures for Docker-compose style model configuration,
//! including model definitions, task categories, pipelines, and role mappings.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Provider Context and Role Mappings
// ============================================================================

/// Provider context for role resolution.
///
/// Examples: "anthropic", "openai", "ollama"
pub type ProviderContext = String;

/// Role to model mapping per provider.
///
/// Maps provider contexts to model names, enabling provider-agnostic pipelines.
pub type RoleMapping = HashMap<ProviderContext, String>;

/// Collection of named roles with their provider mappings.
pub type ModelRoles = HashMap<String, RoleMapping>;

// ============================================================================
// Model Definition
// ============================================================================

/// Named model definition with provider and settings.
///
/// Defines a model alias that can be referenced throughout the configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDefinition {
    /// Provider type (anthropic, openai, ollama, runpod)
    pub provider: String,

    /// Model name/ID (e.g., "claude-sonnet-4-20250514", "gpt-4o")
    pub model: String,

    /// Human-readable description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Maximum output tokens
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,

    /// Temperature setting (0.0 - 1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,

    /// Custom API base URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

// ============================================================================
// Task Categories
// ============================================================================

/// Task type categories for built-in command routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    /// Fast, cheap operations (commits, summaries)
    Fast,
    /// Standard coding tasks
    Code,
    /// Complex reasoning tasks (debugging, architecture)
    Complex,
    /// Context summarization
    Summarize,
}

impl TaskType {
    /// Get all task types.
    pub fn all() -> &'static [TaskType] {
        &[
            TaskType::Fast,
            TaskType::Code,
            TaskType::Complex,
            TaskType::Summarize,
        ]
    }
}

impl std::fmt::Display for TaskType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskType::Fast => write!(f, "fast"),
            TaskType::Code => write!(f, "code"),
            TaskType::Complex => write!(f, "complex"),
            TaskType::Summarize => write!(f, "summarize"),
        }
    }
}

impl std::str::FromStr for TaskType {
    type Err = TaskTypeParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "fast" => Ok(TaskType::Fast),
            "code" => Ok(TaskType::Code),
            "complex" => Ok(TaskType::Complex),
            "summarize" => Ok(TaskType::Summarize),
            _ => Err(TaskTypeParseError(s.to_string())),
        }
    }
}

/// Error type for parsing TaskType.
#[derive(Debug, Clone)]
pub struct TaskTypeParseError(pub String);

impl std::fmt::Display for TaskTypeParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown task type: {}", self.0)
    }
}

impl std::error::Error for TaskTypeParseError {}

/// Task definition with associated model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDefinition {
    /// Model name reference (from models section)
    pub model: String,

    /// Human-readable description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ============================================================================
// Command Configuration
// ============================================================================

/// Per-command configuration override.
///
/// Each command can specify exactly one of: model, task, or pipeline.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CommandConfig {
    /// Direct model reference (from models section)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// Task category reference (from tasks section)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<TaskType>,

    /// Pipeline reference (from pipelines section)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline: Option<String>,
}

// ============================================================================
// Pipeline Definitions
// ============================================================================

/// Single step in a multi-model pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStep {
    /// Step name (for variable reference and logging)
    pub name: String,

    /// Model name reference (mutually exclusive with role)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// Role reference for provider-agnostic steps (mutually exclusive with model)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,

    /// Prompt template with variable substitution (e.g., "{input}", "{analysis}")
    pub prompt: String,

    /// Output variable name to store the result
    pub output: String,

    /// Optional condition expression (e.g., "varname" or "!varname")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
}

/// Multi-model pipeline definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineDefinition {
    /// Human-readable description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Default provider context for role resolution (e.g., 'anthropic', 'openai', 'ollama')
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,

    /// Ordered list of steps
    pub steps: Vec<PipelineStep>,

    /// Result template with variable substitution
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

// ============================================================================
// Resolved Types
// ============================================================================

/// Resolved model with full details for execution.
#[derive(Debug, Clone)]
pub struct ResolvedModel {
    /// Original model name from config
    pub name: String,

    /// Full model definition
    pub definition: ModelDefinition,
}

impl ResolvedModel {
    /// Get the provider type.
    pub fn provider(&self) -> &str {
        &self.definition.provider
    }

    /// Get the model ID.
    pub fn model(&self) -> &str {
        &self.definition.model
    }
}

/// Routing result - either a model or a pipeline.
#[derive(Debug, Clone)]
pub enum RoutingResult {
    /// Route to a specific model
    Model(ResolvedModel),

    /// Route to a pipeline
    Pipeline {
        /// Pipeline name
        name: String,
        /// Pipeline definition
        definition: PipelineDefinition,
    },
}

impl RoutingResult {
    /// Check if this is a model result.
    pub fn is_model(&self) -> bool {
        matches!(self, RoutingResult::Model(_))
    }

    /// Check if this is a pipeline result.
    pub fn is_pipeline(&self) -> bool {
        matches!(self, RoutingResult::Pipeline { .. })
    }

    /// Get the model if this is a model result.
    pub fn as_model(&self) -> Option<&ResolvedModel> {
        match self {
            RoutingResult::Model(m) => Some(m),
            _ => None,
        }
    }

    /// Get the pipeline if this is a pipeline result.
    pub fn as_pipeline(&self) -> Option<(&str, &PipelineDefinition)> {
        match self {
            RoutingResult::Pipeline { name, definition } => Some((name, definition)),
            _ => None,
        }
    }
}

// ============================================================================
// Pipeline Execution Context
// ============================================================================

/// Pipeline execution context with accumulated variables.
#[derive(Debug, Clone, Default)]
pub struct PipelineContext {
    /// Original input value
    pub input: String,

    /// Accumulated step outputs (variable name -> value)
    pub variables: HashMap<String, String>,

    /// Provider context for role resolution
    pub provider_context: Option<ProviderContext>,
}

impl PipelineContext {
    /// Create a new pipeline context with the given input.
    pub fn new(input: impl Into<String>) -> Self {
        let input_str = input.into();
        let mut variables = HashMap::new();
        variables.insert("input".to_string(), input_str.clone());

        Self {
            input: input_str,
            variables,
            provider_context: None,
        }
    }

    /// Create a context with a specific provider context.
    pub fn with_provider(mut self, provider: impl Into<String>) -> Self {
        self.provider_context = Some(provider.into());
        self
    }

    /// Get a variable value.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.variables.get(name).map(|s| s.as_str())
    }

    /// Set a variable value.
    pub fn set(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.variables.insert(name.into(), value.into());
    }
}

/// Pipeline execution result.
#[derive(Debug, Clone)]
pub struct PipelineResult {
    /// Final output after result template substitution
    pub output: String,

    /// All step outputs (step name -> output)
    pub step_outputs: HashMap<String, String>,

    /// Models used during execution
    pub models_used: Vec<String>,
}

impl PipelineResult {
    /// Create a new pipeline result.
    pub fn new(output: impl Into<String>) -> Self {
        Self {
            output: output.into(),
            step_outputs: HashMap::new(),
            models_used: Vec::new(),
        }
    }
}

// ============================================================================
// Default Command Tasks
// ============================================================================

/// Get the default task type for a built-in command.
pub fn default_task_for_command(command: &str) -> Option<TaskType> {
    match command {
        // Fast tasks - quick, simple operations
        "commit" | "pr" | "branch" | "stash" | "gitstatus" | "log" => Some(TaskType::Fast),

        // Code tasks - standard coding operations
        "explain" | "refactor" | "test" | "review" | "doc" | "optimize" => Some(TaskType::Code),

        // Complex tasks - require deeper reasoning
        "fix" | "debug" | "scaffold" | "migrate" => Some(TaskType::Complex),

        // No default task
        _ => None,
    }
}

// ============================================================================
// Pool Statistics
// ============================================================================

/// Statistics about a pooled provider.
#[derive(Debug, Clone)]
pub struct PooledProviderStats {
    /// Model name
    pub name: String,

    /// Number of times this provider has been used
    pub use_count: u64,

    /// Last time this provider was used
    pub last_used: std::time::Instant,
}

/// Provider pool statistics.
#[derive(Debug, Clone)]
pub struct PoolStats {
    /// Current number of providers in the pool
    pub size: usize,

    /// Maximum pool size
    pub max_size: usize,

    /// Statistics for each pooled provider
    pub providers: Vec<PooledProviderStats>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_type_parse() {
        assert_eq!("fast".parse::<TaskType>().unwrap(), TaskType::Fast);
        assert_eq!("code".parse::<TaskType>().unwrap(), TaskType::Code);
        assert_eq!("complex".parse::<TaskType>().unwrap(), TaskType::Complex);
        assert_eq!("summarize".parse::<TaskType>().unwrap(), TaskType::Summarize);
        assert_eq!("FAST".parse::<TaskType>().unwrap(), TaskType::Fast);
        assert!("invalid".parse::<TaskType>().is_err());
    }

    #[test]
    fn test_task_type_display() {
        assert_eq!(TaskType::Fast.to_string(), "fast");
        assert_eq!(TaskType::Code.to_string(), "code");
        assert_eq!(TaskType::Complex.to_string(), "complex");
        assert_eq!(TaskType::Summarize.to_string(), "summarize");
    }

    #[test]
    fn test_default_task_for_command() {
        assert_eq!(default_task_for_command("commit"), Some(TaskType::Fast));
        assert_eq!(default_task_for_command("fix"), Some(TaskType::Complex));
        assert_eq!(default_task_for_command("review"), Some(TaskType::Code));
        assert_eq!(default_task_for_command("unknown"), None);
    }

    #[test]
    fn test_pipeline_context() {
        let mut ctx = PipelineContext::new("test input");
        assert_eq!(ctx.get("input"), Some("test input"));

        ctx.set("analysis", "result of analysis");
        assert_eq!(ctx.get("analysis"), Some("result of analysis"));
    }

    #[test]
    fn test_routing_result() {
        let model = ResolvedModel {
            name: "haiku".to_string(),
            definition: ModelDefinition {
                provider: "anthropic".to_string(),
                model: "claude-3-5-haiku-latest".to_string(),
                description: None,
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        };

        let result = RoutingResult::Model(model);
        assert!(result.is_model());
        assert!(!result.is_pipeline());
        assert!(result.as_model().is_some());
        assert!(result.as_pipeline().is_none());
    }
}
