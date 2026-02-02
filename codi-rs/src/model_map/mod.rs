// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Model Map - Multi-Model Orchestration System
//!
//! This module implements a Docker-compose style configuration system for
//! multi-model orchestration, enabling:
//!
//! - **Named model definitions** with provider/settings
//! - **Task categories** (fast, code, complex, summarize) with model assignments
//! - **Provider-agnostic model roles** for portable pipelines
//! - **Multi-step pipeline execution** with variable chaining
//! - **Fallback chains** for reliability
//!
//! # Configuration Format
//!
//! Configuration is loaded from:
//! - Global: `~/.codi/models.yaml`
//! - Project: `codi-models.yaml` or `codi-models.yml`
//!
//! Project config overrides global config through deep merging.
//!
//! ```yaml
//! version: "1"
//!
//! models:
//!   haiku:
//!     provider: anthropic
//!     model: claude-3-5-haiku-latest
//!     description: "Fast, cheap model for quick tasks"
//!   sonnet:
//!     provider: anthropic
//!     model: claude-sonnet-4-20250514
//!   local:
//!     provider: ollama
//!     model: llama3.2
//!
//! # Provider-agnostic role mappings
//! model-roles:
//!   fast:
//!     anthropic: haiku
//!     openai: gpt-5-nano
//!     ollama: local
//!   capable:
//!     anthropic: sonnet
//!     openai: gpt-5
//!     ollama: local
//!
//! tasks:
//!   fast:
//!     model: haiku
//!   code:
//!     model: sonnet
//!   complex:
//!     model: sonnet
//!   summarize:
//!     model: local
//!
//! commands:
//!   commit:
//!     task: fast
//!   fix:
//!     task: complex
//!
//! fallbacks:
//!   primary: [sonnet, haiku, local]
//!
//! pipelines:
//!   code-review:
//!     description: "Multi-step code review"
//!     provider: anthropic
//!     steps:
//!       - name: scan
//!         role: fast
//!         prompt: "Quick scan for issues: {input}"
//!         output: issues
//!       - name: analyze
//!         role: capable
//!         prompt: "Deep analysis based on: {issues}"
//!         output: analysis
//!     result: "{analysis}"
//! ```
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    ModelMapConfig                           │
//! │  ┌─────────────────────────────────────────────────────┐   │
//! │  │  models: HashMap<String, ModelDefinition>            │   │
//! │  │  model_roles: HashMap<String, RoleMapping>          │   │
//! │  │  tasks: HashMap<TaskType, TaskDefinition>           │   │
//! │  │  commands: HashMap<String, CommandConfig>           │   │
//! │  │  fallbacks: HashMap<String, Vec<String>>            │   │
//! │  │  pipelines: HashMap<String, PipelineDefinition>     │   │
//! │  └─────────────────────────────────────────────────────┘   │
//! └───────────────────────────┬─────────────────────────────────┘
//!                             │
//!             ┌───────────────┼───────────────┐
//!             ▼               ▼               ▼
//!     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
//!     │   Registry   │ │    Router    │ │   Executor   │
//!     │  (Provider   │ │  (Task/Cmd   │ │  (Pipeline   │
//!     │   Pooling)   │ │   Routing)   │ │   Execute)   │
//!     └──────────────┘ └──────────────┘ └──────────────┘
//! ```
//!
//! # Usage
//!
//! ```rust,ignore
//! use codi::model_map::{
//!     load_model_map, validate_model_map,
//!     ModelRegistry, TaskRouter, PipelineExecutor,
//! };
//! use std::sync::Arc;
//!
//! // Load configuration
//! let result = load_model_map(Path::new("."));
//! let config = result.config.expect("No config found");
//!
//! // Validate configuration
//! let validation = validate_model_map(&config);
//! if !validation.valid {
//!     for error in &validation.errors {
//!         eprintln!("Error: {}", error);
//!     }
//! }
//!
//! // Create registry and router
//! let registry = Arc::new(ModelRegistry::new(config.clone()));
//! let router = Arc::new(TaskRouter::new(config.clone(), registry.clone()));
//!
//! // Route a command
//! let result = router.route_command("commit").await?;
//! match result {
//!     RoutingResult::Model(model) => {
//!         println!("Using model: {}", model.name);
//!     }
//!     RoutingResult::Pipeline { name, .. } => {
//!         println!("Using pipeline: {}", name);
//!     }
//! }
//!
//! // Execute a pipeline
//! let executor = PipelineExecutor::new(registry.clone(), Some(router.clone()));
//! let result = executor.execute_by_name("code-review", "fn main() {}", None).await?;
//! println!("Output: {}", result.output);
//! ```
//!
//! # Module Structure
//!
//! - [`types`] - Core type definitions
//! - [`config`] - YAML loading, validation, and merging
//! - [`registry`] - Provider pool management
//! - [`router`] - Task/command routing and role resolution
//! - [`executor`] - Pipeline execution

pub mod config;
pub mod executor;
pub mod registry;
pub mod router;
pub mod types;

// Re-export commonly used types
pub use config::{
    get_example_model_map, get_global_config_dir, init_model_map, load_model_map,
    load_project_model_map, validate_model_map, ConfigWarning, ModelMapConfig, ModelMapError,
    ModelMapLoadResult, ValidationResult,
};

pub use executor::{
    create_pipeline_executor, ExecutorError, NoOpCallbacks, PipelineCallbacks, PipelineExecuteOptions,
    PipelineExecutor,
};

pub use registry::{
    create_shared_registry, create_shared_registry_with_options, ModelRegistry, RegistryOptions,
};

pub use router::{create_task_router, TaskRouter};

pub use types::{
    default_task_for_command, CommandConfig, ModelDefinition, ModelRoles, PipelineContext,
    PipelineDefinition, PipelineResult, PipelineStep, PoolStats, PooledProviderStats,
    ProviderContext, ResolvedModel, RoleMapping, RoutingResult, TaskDefinition, TaskType,
    TaskTypeParseError,
};

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_init_and_load() {
        let temp_dir = TempDir::new().unwrap();

        // Initialize
        let path = init_model_map(temp_dir.path(), false).unwrap();
        assert!(path.exists());

        // Load
        let result = load_model_map(temp_dir.path());
        assert!(result.config.is_some());

        let config = result.config.unwrap();
        assert!(!config.models.is_empty());
    }

    #[test]
    fn test_example_config_validates() {
        let example = get_example_model_map();
        let config: ModelMapConfig = serde_yaml::from_str(&example).unwrap();
        let validation = validate_model_map(&config);

        assert!(validation.valid, "Errors: {:?}", validation.errors);
    }

    #[tokio::test]
    async fn test_full_pipeline() {
        use std::sync::Arc;

        // Create minimal config
        let mut config = ModelMapConfig::default();
        config.models.insert(
            "test".to_string(),
            ModelDefinition {
                provider: "ollama".to_string(),
                model: "llama3.2".to_string(),
                description: None,
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );

        let mut fast_role = std::collections::HashMap::new();
        fast_role.insert("ollama".to_string(), "test".to_string());
        config.model_roles.insert("fast".to_string(), fast_role);

        config.tasks.insert(
            TaskType::Fast,
            TaskDefinition {
                model: "test".to_string(),
                description: None,
            },
        );

        config.fallbacks.insert(
            "primary".to_string(),
            vec!["test".to_string()],
        );

        // Create registry and router
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = Arc::new(TaskRouter::new(config.clone(), registry.clone()));

        // Test routing
        let result = router.route_task(TaskType::Fast).await.unwrap();
        assert!(result.is_model());

        if let RoutingResult::Model(model) = result {
            assert_eq!(model.name, "test");
        }

        // Test role resolution
        let model = router.resolve_role("fast", &"ollama".to_string()).await.unwrap();
        assert_eq!(model.name, "test");
    }
}
