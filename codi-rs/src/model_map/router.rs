// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Task Router for command and task routing.
//!
//! Routes tasks and commands to appropriate models or pipelines,
//! with support for role-based resolution for provider-agnostic pipelines.

use std::sync::Arc;

use super::config::{ModelMapConfig, ModelMapError};
use super::registry::ModelRegistry;
use super::types::{
    default_task_for_command, PipelineDefinition, ProviderContext, ResolvedModel, RoutingResult,
    TaskType,
};

// ============================================================================
// Task Router
// ============================================================================

/// Task Router for determining which model handles what.
///
/// Routing priority for commands:
/// 1. Command-level override (from config)
/// 2. Task category (from config or default)
/// 3. Primary fallback chain
///
/// # Example
///
/// ```rust,ignore
/// use codi::model_map::{TaskRouter, ModelRegistry};
///
/// let router = TaskRouter::new(config.clone(), registry);
///
/// // Route a command to its designated model or pipeline
/// let result = router.route_command("commit").await?;
///
/// // Route a task type
/// let result = router.route_task(TaskType::Fast).await?;
/// ```
pub struct TaskRouter {
    config: ModelMapConfig,
    registry: Arc<ModelRegistry>,
}

impl TaskRouter {
    /// Create a new task router.
    pub fn new(config: ModelMapConfig, registry: Arc<ModelRegistry>) -> Self {
        Self { config, registry }
    }

    /// Route a command to its designated model or pipeline.
    pub async fn route_command(&self, command_name: &str) -> Result<RoutingResult, ModelMapError> {
        // 1. Check for command-level override
        if let Some(cmd_config) = self.config.commands.get(command_name) {
            return self.resolve_command_config(command_name, cmd_config).await;
        }

        // 2. Check for default task assignment
        if let Some(default_task) = default_task_for_command(command_name) {
            return self.route_task(default_task).await;
        }

        // 3. Use 'code' task as fallback (most common)
        if self.config.tasks.contains_key(&TaskType::Code) {
            return self.route_task(TaskType::Code).await;
        }

        // 4. Use primary fallback chain
        self.get_default_model().await
    }

    /// Route a task category to its designated model.
    pub async fn route_task(&self, task_type: TaskType) -> Result<RoutingResult, ModelMapError> {
        if let Some(task_def) = self.config.tasks.get(&task_type) {
            let model = self.registry.resolve_model(&task_def.model).await?;
            return Ok(RoutingResult::Model(model));
        }

        // Task not defined, use primary fallback
        self.get_default_model().await
    }

    /// Get a model for summarization tasks.
    pub async fn get_summarize_model(&self) -> Result<ResolvedModel, ModelMapError> {
        // Check for summarize task
        if let Some(task) = self.config.tasks.get(&TaskType::Summarize) {
            return self.registry.resolve_model(&task.model).await;
        }

        // Check for 'fast' task as alternative
        if let Some(task) = self.config.tasks.get(&TaskType::Fast) {
            return self.registry.resolve_model(&task.model).await;
        }

        // Use first model in primary fallback
        if let Some(chain) = self.config.fallbacks.get("primary") {
            if let Some(first) = chain.first() {
                return self.registry.resolve_model(first).await;
            }
        }

        // Use first defined model
        let model_names = self.registry.get_model_names().await;
        if model_names.is_empty() {
            return Err(ModelMapError::ValidationError {
                field: "models".to_string(),
                message: "No models defined in configuration".to_string(),
            });
        }
        self.registry.resolve_model(&model_names[0]).await
    }

    /// Get the primary model (first in fallback chain or first defined).
    pub async fn get_primary_model(&self) -> Result<ResolvedModel, ModelMapError> {
        let result = self.get_default_model().await?;
        match result {
            RoutingResult::Model(m) => Ok(m),
            RoutingResult::Pipeline { .. } => Err(ModelMapError::ValidationError {
                field: "primary".to_string(),
                message: "Primary model returned a pipeline unexpectedly".to_string(),
            }),
        }
    }

    /// Get a pipeline by name.
    pub fn get_pipeline(&self, name: &str) -> Option<&PipelineDefinition> {
        self.config.pipelines.get(name)
    }

    /// Get all pipeline names.
    pub fn get_pipeline_names(&self) -> Vec<&str> {
        self.config.pipelines.keys().map(|s| s.as_str()).collect()
    }

    /// Check if a command has a pipeline override.
    pub fn command_has_pipeline(&self, command_name: &str) -> bool {
        self.config
            .commands
            .get(command_name)
            .map(|c| c.pipeline.is_some())
            .unwrap_or(false)
    }

    /// Get task type for a command.
    pub fn get_command_task(&self, command_name: &str) -> Option<TaskType> {
        // Check command config first
        if let Some(cmd_config) = self.config.commands.get(command_name) {
            if let Some(task) = cmd_config.task {
                return Some(task);
            }
        }

        // Check defaults
        default_task_for_command(command_name)
    }

    /// Resolve a role to a model name based on provider context.
    ///
    /// # Arguments
    ///
    /// * `role` - The role name (e.g., "fast", "capable", "reasoning")
    /// * `provider_context` - The provider context (e.g., "anthropic", "openai", "ollama")
    ///
    /// # Returns
    ///
    /// The resolved model or an error if not found.
    pub async fn resolve_role(
        &self,
        role: &str,
        provider_context: &ProviderContext,
    ) -> Result<ResolvedModel, ModelMapError> {
        let role_mapping = self
            .config
            .model_roles
            .get(role)
            .ok_or_else(|| ModelMapError::RoleNotFound {
                role: role.to_string(),
                provider: provider_context.clone(),
            })?;

        let model_name =
            role_mapping
                .get(provider_context)
                .ok_or_else(|| ModelMapError::RoleNotFound {
                    role: role.to_string(),
                    provider: provider_context.clone(),
                })?;

        self.registry.resolve_model(model_name).await
    }

    /// Try to resolve a role, returning None if not found.
    pub async fn try_resolve_role(
        &self,
        role: &str,
        provider_context: &ProviderContext,
    ) -> Option<ResolvedModel> {
        self.resolve_role(role, provider_context).await.ok()
    }

    /// Get available provider contexts for a role.
    pub fn get_role_providers(&self, role: &str) -> Vec<&str> {
        self.config
            .model_roles
            .get(role)
            .map(|mapping| mapping.keys().map(|s| s.as_str()).collect())
            .unwrap_or_default()
    }

    /// Get all defined roles.
    pub fn get_roles(&self) -> Vec<&str> {
        self.config.model_roles.keys().map(|s| s.as_str()).collect()
    }

    /// Update configuration (for hot-reload).
    pub fn update_config(&mut self, config: ModelMapConfig) {
        self.config = config;
    }

    /// Get a reference to the current config.
    pub fn config(&self) -> &ModelMapConfig {
        &self.config
    }

    // --- Private methods ---

    async fn resolve_command_config(
        &self,
        _command_name: &str,
        config: &super::types::CommandConfig,
    ) -> Result<RoutingResult, ModelMapError> {
        // Pipeline takes precedence
        if let Some(pipeline_name) = &config.pipeline {
            if let Some(pipeline) = self.config.pipelines.get(pipeline_name) {
                return Ok(RoutingResult::Pipeline {
                    name: pipeline_name.clone(),
                    definition: pipeline.clone(),
                });
            }
            return Err(ModelMapError::PipelineNotFound(pipeline_name.clone()));
        }

        // Task reference
        if let Some(task_type) = config.task {
            return self.route_task(task_type).await;
        }

        // Direct model reference
        if let Some(model_name) = &config.model {
            let model = self.registry.resolve_model(model_name).await?;
            return Ok(RoutingResult::Model(model));
        }

        // Fallback
        self.get_default_model().await
    }

    async fn get_default_model(&self) -> Result<RoutingResult, ModelMapError> {
        // Try primary fallback chain
        if let Some(chain) = self.config.fallbacks.get("primary") {
            if let Some(first) = chain.first() {
                let model = self.registry.resolve_model(first).await?;
                return Ok(RoutingResult::Model(model));
            }
        }

        // Use first defined model
        let model_names = self.registry.get_model_names().await;
        if model_names.is_empty() {
            return Err(ModelMapError::ValidationError {
                field: "models".to_string(),
                message: "No models defined in configuration".to_string(),
            });
        }

        let model = self.registry.resolve_model(&model_names[0]).await?;
        Ok(RoutingResult::Model(model))
    }
}

/// Create a task router from configuration and registry.
pub fn create_task_router(config: ModelMapConfig, registry: Arc<ModelRegistry>) -> TaskRouter {
    TaskRouter::new(config, registry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_map::types::{CommandConfig, ModelDefinition, PipelineStep, TaskDefinition};
    use std::collections::HashMap;

    fn test_config() -> ModelMapConfig {
        let mut config = ModelMapConfig::default();

        // Add models
        config.models.insert(
            "haiku".to_string(),
            ModelDefinition {
                provider: "ollama".to_string(),
                model: "llama3.2".to_string(),
                description: Some("Fast model".to_string()),
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );
        config.models.insert(
            "sonnet".to_string(),
            ModelDefinition {
                provider: "ollama".to_string(),
                model: "llama3.2".to_string(),
                description: Some("Capable model".to_string()),
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );

        // Add model roles
        let mut fast_role = HashMap::new();
        fast_role.insert("anthropic".to_string(), "haiku".to_string());
        fast_role.insert("ollama".to_string(), "haiku".to_string());
        config.model_roles.insert("fast".to_string(), fast_role);

        let mut capable_role = HashMap::new();
        capable_role.insert("anthropic".to_string(), "sonnet".to_string());
        capable_role.insert("ollama".to_string(), "sonnet".to_string());
        config.model_roles.insert("capable".to_string(), capable_role);

        // Add tasks
        config.tasks.insert(
            TaskType::Fast,
            TaskDefinition {
                model: "haiku".to_string(),
                description: Some("Quick tasks".to_string()),
            },
        );
        config.tasks.insert(
            TaskType::Code,
            TaskDefinition {
                model: "sonnet".to_string(),
                description: Some("Coding tasks".to_string()),
            },
        );

        // Add commands
        config.commands.insert(
            "commit".to_string(),
            CommandConfig {
                task: Some(TaskType::Fast),
                ..Default::default()
            },
        );

        // Add fallbacks
        config
            .fallbacks
            .insert("primary".to_string(), vec!["sonnet".to_string(), "haiku".to_string()]);

        // Add pipeline
        config.pipelines.insert(
            "test-pipeline".to_string(),
            PipelineDefinition {
                description: Some("Test pipeline".to_string()),
                provider: Some("anthropic".to_string()),
                steps: vec![PipelineStep {
                    name: "step1".to_string(),
                    model: Some("haiku".to_string()),
                    role: None,
                    prompt: "Test: {input}".to_string(),
                    output: "result".to_string(),
                    condition: None,
                }],
                result: Some("{result}".to_string()),
            },
        );

        config
    }

    #[tokio::test]
    async fn test_route_command_with_task() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        let result = router.route_command("commit").await.unwrap();
        assert!(result.is_model());

        if let RoutingResult::Model(model) = result {
            assert_eq!(model.name, "haiku");
        }
    }

    #[tokio::test]
    async fn test_route_command_default() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        // "fix" has a default task of Complex, which isn't defined,
        // so it should fall back to primary
        let result = router.route_command("fix").await.unwrap();
        assert!(result.is_model());

        if let RoutingResult::Model(model) = result {
            // Should get primary fallback (sonnet)
            assert_eq!(model.name, "sonnet");
        }
    }

    #[tokio::test]
    async fn test_route_task() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        let result = router.route_task(TaskType::Fast).await.unwrap();
        assert!(result.is_model());

        if let RoutingResult::Model(model) = result {
            assert_eq!(model.name, "haiku");
        }
    }

    #[tokio::test]
    async fn test_resolve_role() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        let model = router
            .resolve_role("fast", &"anthropic".to_string())
            .await
            .unwrap();
        assert_eq!(model.name, "haiku");

        let model = router
            .resolve_role("capable", &"anthropic".to_string())
            .await
            .unwrap();
        assert_eq!(model.name, "sonnet");
    }

    #[tokio::test]
    async fn test_resolve_role_not_found() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        let result = router
            .resolve_role("nonexistent", &"anthropic".to_string())
            .await;
        assert!(matches!(result, Err(ModelMapError::RoleNotFound { .. })));
    }

    #[tokio::test]
    async fn test_get_pipeline() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        let pipeline = router.get_pipeline("test-pipeline");
        assert!(pipeline.is_some());
        assert_eq!(pipeline.unwrap().steps.len(), 1);

        assert!(router.get_pipeline("nonexistent").is_none());
    }

    #[test]
    fn test_get_roles() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        let roles = router.get_roles();
        assert!(roles.contains(&"fast"));
        assert!(roles.contains(&"capable"));
    }

    #[test]
    fn test_get_role_providers() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        let providers = router.get_role_providers("fast");
        assert!(providers.contains(&"anthropic"));
        assert!(providers.contains(&"ollama"));
    }

    #[test]
    fn test_command_has_pipeline() {
        let mut config = test_config();
        config.commands.insert(
            "review".to_string(),
            CommandConfig {
                pipeline: Some("test-pipeline".to_string()),
                ..Default::default()
            },
        );

        let registry = Arc::new(ModelRegistry::new(config.clone()));
        let router = TaskRouter::new(config, registry);

        assert!(router.command_has_pipeline("review"));
        assert!(!router.command_has_pipeline("commit"));
    }
}
