// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pipeline Executor for multi-model workflows.
//!
//! Executes multi-model pipelines with variable substitution,
//! conditional step execution, and streaming support.

use once_cell::sync::Lazy;
use regex::Regex;
use std::sync::Arc;

use crate::error::ProviderError;
use crate::types::{Message, StreamEvent};

/// Static regex for variable substitution (compiled once).
static VAR_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{(\w+)\}").unwrap());

use super::config::ModelMapError;
use super::registry::ModelRegistry;
use super::router::TaskRouter;
use super::types::{
    PipelineContext, PipelineDefinition, PipelineResult, PipelineStep, ProviderContext,
    ResolvedModel,
};

// ============================================================================
// Callbacks
// ============================================================================

/// Callbacks for pipeline step execution.
pub trait PipelineCallbacks: Send + Sync {
    /// Called when a step starts.
    fn on_step_start(&self, step_name: &str, model_name: &str);

    /// Called when a step completes.
    fn on_step_complete(&self, step_name: &str, output: &str);

    /// Called for streaming text during step execution.
    fn on_step_text(&self, step_name: &str, text: &str);

    /// Called when a step errors.
    fn on_error(&self, step_name: &str, error: &str);
}

/// No-op implementation of callbacks.
pub struct NoOpCallbacks;

impl PipelineCallbacks for NoOpCallbacks {
    fn on_step_start(&self, _step_name: &str, _model_name: &str) {}
    fn on_step_complete(&self, _step_name: &str, _output: &str) {}
    fn on_step_text(&self, _step_name: &str, _text: &str) {}
    fn on_error(&self, _step_name: &str, _error: &str) {}
}

// ============================================================================
// Execution Options
// ============================================================================

/// Options for pipeline execution.
#[derive(Debug, Clone, Default)]
pub struct PipelineExecuteOptions {
    /// Provider context for role resolution (e.g., "anthropic", "openai", "ollama")
    pub provider_context: Option<ProviderContext>,

    /// Override model role for this execution (from triage suggestion)
    pub model_override: Option<String>,
}

// ============================================================================
// Executor Error
// ============================================================================

/// Errors that can occur during pipeline execution.
#[derive(Debug, thiserror::Error)]
pub enum ExecutorError {
    #[error("Model map error: {0}")]
    ModelMap(#[from] ModelMapError),

    #[error("Provider error: {0}")]
    Provider(#[from] ProviderError),

    #[error("Step '{step}' has no model and role could not be resolved")]
    NoModelOrRole { step: String },

    #[error("Undefined variable: {0}")]
    UndefinedVariable(String),

    #[error("Step '{step}' failed: {message}")]
    StepFailed { step: String, message: String },
}

// ============================================================================
// Pipeline Executor
// ============================================================================

/// Pipeline Executor for running multi-model workflows.
///
/// Features:
/// - Sequential step execution
/// - Variable substitution between steps
/// - Conditional step execution (optional)
/// - Result aggregation
/// - Role-based model resolution for provider-agnostic pipelines
///
/// # Example
///
/// ```rust,ignore
/// use codi::model_map::{PipelineExecutor, ModelRegistry, TaskRouter};
///
/// let registry = Arc::new(ModelRegistry::new(config.clone()));
/// let router = TaskRouter::new(config.clone(), registry.clone());
/// let executor = PipelineExecutor::new(registry, Some(Arc::new(router)));
///
/// let result = executor.execute(&pipeline, "input text", None).await?;
/// println!("Output: {}", result.output);
/// ```
pub struct PipelineExecutor {
    registry: Arc<ModelRegistry>,
    router: Option<Arc<TaskRouter>>,
}

impl PipelineExecutor {
    /// Create a new pipeline executor.
    pub fn new(registry: Arc<ModelRegistry>, router: Option<Arc<TaskRouter>>) -> Self {
        Self { registry, router }
    }

    /// Execute a pipeline with the given input.
    pub async fn execute(
        &self,
        pipeline: &PipelineDefinition,
        input: &str,
        options: Option<PipelineExecuteOptions>,
    ) -> Result<PipelineResult, ExecutorError> {
        self.execute_with_callbacks(pipeline, input, options, Arc::new(NoOpCallbacks))
            .await
    }

    /// Execute a pipeline with callbacks for progress reporting.
    ///
    /// Takes an `Arc<dyn PipelineCallbacks>` to allow sharing the callbacks
    /// across async streaming boundaries.
    pub async fn execute_with_callbacks(
        &self,
        pipeline: &PipelineDefinition,
        input: &str,
        options: Option<PipelineExecuteOptions>,
        callbacks: Arc<dyn PipelineCallbacks>,
    ) -> Result<PipelineResult, ExecutorError> {
        let options = options.unwrap_or_default();

        // Determine provider context
        let provider_context = options
            .provider_context
            .or_else(|| pipeline.provider.clone())
            .unwrap_or_else(|| "anthropic".to_string());

        // Initialize context
        let mut context = PipelineContext::new(input).with_provider(provider_context.clone());

        let mut models_used = Vec::new();
        let mut step_outputs = std::collections::HashMap::new();

        // Execute each step
        for step in &pipeline.steps {
            // Check condition if specified
            if let Some(condition) = &step.condition {
                if !self.evaluate_condition(condition, &context) {
                    tracing::debug!("Skipping step '{}' (condition not met)", step.name);
                    continue;
                }
            }

            // Resolve the model name
            let model = self
                .resolve_step_model(step, &provider_context, options.model_override.as_deref())
                .await?;

            callbacks.on_step_start(&step.name, &model.name);

            // Execute the step
            match self
                .execute_step(step, &model, &context, callbacks.clone())
                .await
            {
                Ok(output) => {
                    // Store output in context
                    context.set(&step.output, &output);
                    step_outputs.insert(step.name.clone(), output.clone());

                    if !models_used.contains(&model.name) {
                        models_used.push(model.name.clone());
                    }

                    callbacks.on_step_complete(&step.name, &output);
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    callbacks.on_error(&step.name, &error_msg);
                    return Err(e);
                }
            }
        }

        // Generate final result
        let output = if let Some(result_template) = &pipeline.result {
            self.substitute_variables(result_template, &context)?
        } else {
            // Use the last step's output
            pipeline
                .steps
                .last()
                .and_then(|s| context.get(&s.output))
                .unwrap_or("")
                .to_string()
        };

        Ok(PipelineResult {
            output,
            step_outputs,
            models_used,
        })
    }

    /// Execute a pipeline by name.
    pub async fn execute_by_name(
        &self,
        pipeline_name: &str,
        input: &str,
        options: Option<PipelineExecuteOptions>,
    ) -> Result<PipelineResult, ExecutorError> {
        let router = self.router.as_ref().ok_or_else(|| ExecutorError::ModelMap(
            ModelMapError::ValidationError {
                field: "router".to_string(),
                message: "Router required for execute_by_name".to_string(),
            },
        ))?;

        let pipeline = router
            .get_pipeline(pipeline_name)
            .ok_or_else(|| ModelMapError::PipelineNotFound(pipeline_name.to_string()))?
            .clone();

        self.execute(&pipeline, input, options).await
    }

    // --- Private methods ---

    /// Resolve the model for a pipeline step.
    async fn resolve_step_model(
        &self,
        step: &PipelineStep,
        provider_context: &ProviderContext,
        model_override: Option<&str>,
    ) -> Result<ResolvedModel, ExecutorError> {
        // Direct model reference takes precedence
        if let Some(model_name) = &step.model {
            return self
                .registry
                .resolve_model(model_name)
                .await
                .map_err(ExecutorError::ModelMap);
        }

        // Use model override if provided (from triage suggestion)
        let role_to_resolve = model_override.or(step.role.as_deref());

        // Try to resolve role
        if let Some(role) = role_to_resolve {
            if let Some(router) = &self.router {
                if let Ok(model) = router.resolve_role(role, provider_context).await {
                    let source = if model_override.is_some() {
                        format!("override \"{}\"", role)
                    } else {
                        format!("role \"{}\"", role)
                    };
                    tracing::debug!(
                        "Resolved {} to model \"{}\" for provider \"{}\"",
                        source,
                        model.name,
                        provider_context
                    );
                    return Ok(model);
                }
                tracing::warn!(
                    "Failed to resolve role \"{}\" for provider \"{}\", no fallback available",
                    role,
                    provider_context
                );
            }
        }

        Err(ExecutorError::NoModelOrRole {
            step: step.name.clone(),
        })
    }

    /// Execute a single pipeline step.
    async fn execute_step(
        &self,
        step: &PipelineStep,
        model: &ResolvedModel,
        context: &PipelineContext,
        callbacks: Arc<dyn PipelineCallbacks>,
    ) -> Result<String, ExecutorError> {
        let prompt = self.substitute_variables(&step.prompt, context)?;

        tracing::debug!("Pipeline step \"{}\" using model \"{}\"", step.name, model.name);
        tracing::trace!("Prompt: {}...", &prompt[..prompt.len().min(200)]);

        // Get provider
        let provider = self
            .registry
            .get_provider(&model.name)
            .await
            .map_err(ExecutorError::ModelMap)?;

        // Create messages
        let messages = vec![Message::user(&prompt)];

        // Clone Arc for the streaming callback
        let step_name = step.name.clone();
        let callbacks_clone = callbacks.clone();

        let on_event = Box::new(move |event: StreamEvent| {
            if let StreamEvent::TextDelta(text) = event {
                // Forward streaming text to callbacks for UI updates
                callbacks_clone.on_step_text(&step_name, &text);
            }
        });

        let response = provider
            .stream_chat(&messages, None, None, on_event)
            .await
            .map_err(ExecutorError::Provider)?;

        // Get output from response content
        Ok(response.content)
    }

    /// Substitute variables in a template string.
    fn substitute_variables(
        &self,
        template: &str,
        context: &PipelineContext,
    ) -> Result<String, ExecutorError> {
        let mut result = template.to_string();
        let mut undefined_vars = Vec::new();

        for cap in VAR_REGEX.captures_iter(template) {
            let var_name = &cap[1];
            if let Some(value) = context.get(var_name) {
                result = result.replace(&cap[0], value);
            } else {
                undefined_vars.push(var_name.to_string());
            }
        }

        if !undefined_vars.is_empty() {
            // For now, we'll warn but not error - some variables might be intentionally undefined
            tracing::warn!("Undefined variables in template: {:?}", undefined_vars);
        }

        Ok(result)
    }

    /// Evaluate a condition expression.
    ///
    /// Simple implementation - checks if a variable is truthy.
    /// Supports: "varname" (truthy) or "!varname" (falsy)
    fn evaluate_condition(&self, condition: &str, context: &PipelineContext) -> bool {
        let trimmed = condition.trim();
        let negated = trimmed.starts_with('!');
        let var_name = if negated { &trimmed[1..] } else { trimmed };

        let value = context.get(var_name);
        let result = value.map(|v| !v.trim().is_empty()).unwrap_or(false);

        if negated {
            !result
        } else {
            result
        }
    }
}

/// Create a pipeline executor.
pub fn create_pipeline_executor(
    registry: Arc<ModelRegistry>,
    router: Option<Arc<TaskRouter>>,
) -> PipelineExecutor {
    PipelineExecutor::new(registry, router)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_map::config::ModelMapConfig;
    use crate::model_map::types::ModelDefinition;
    use std::collections::HashMap;

    fn test_config() -> ModelMapConfig {
        let mut config = ModelMapConfig::default();

        config.models.insert(
            "test-model".to_string(),
            ModelDefinition {
                provider: "ollama".to_string(),
                model: "llama3.2".to_string(),
                description: None,
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );

        let mut fast_role = HashMap::new();
        fast_role.insert("ollama".to_string(), "test-model".to_string());
        config.model_roles.insert("fast".to_string(), fast_role);

        config
    }

    #[test]
    fn test_substitute_variables() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config));
        let executor = PipelineExecutor::new(registry, None);

        let mut context = PipelineContext::new("test input");
        context.set("analysis", "detailed analysis");
        context.set("result", "final result");

        let template = "Input: {input}\nAnalysis: {analysis}\nResult: {result}";
        let result = executor.substitute_variables(template, &context).unwrap();

        assert!(result.contains("test input"));
        assert!(result.contains("detailed analysis"));
        assert!(result.contains("final result"));
    }

    #[test]
    fn test_evaluate_condition_truthy() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config));
        let executor = PipelineExecutor::new(registry, None);

        let mut context = PipelineContext::new("test");
        context.set("hasError", "true");
        context.set("empty", "");

        // Truthy conditions
        assert!(executor.evaluate_condition("hasError", &context));
        assert!(executor.evaluate_condition("input", &context));

        // Falsy conditions
        assert!(!executor.evaluate_condition("empty", &context));
        assert!(!executor.evaluate_condition("nonexistent", &context));
    }

    #[test]
    fn test_evaluate_condition_negated() {
        let config = test_config();
        let registry = Arc::new(ModelRegistry::new(config));
        let executor = PipelineExecutor::new(registry, None);

        let mut context = PipelineContext::new("test");
        context.set("hasError", "true");
        context.set("empty", "");

        // Negated conditions
        assert!(!executor.evaluate_condition("!hasError", &context));
        assert!(executor.evaluate_condition("!empty", &context));
        assert!(executor.evaluate_condition("!nonexistent", &context));
    }

    #[test]
    fn test_pipeline_context() {
        let context = PipelineContext::new("test input")
            .with_provider("anthropic".to_string());

        assert_eq!(context.input, "test input");
        assert_eq!(context.get("input"), Some("test input"));
        assert_eq!(context.provider_context, Some("anthropic".to_string()));
    }

    #[test]
    fn test_pipeline_result() {
        let mut result = PipelineResult::new("final output");
        result.step_outputs.insert("step1".to_string(), "step1 output".to_string());
        result.models_used.push("model1".to_string());

        assert_eq!(result.output, "final output");
        assert_eq!(result.step_outputs.get("step1"), Some(&"step1 output".to_string()));
        assert!(result.models_used.contains(&"model1".to_string()));
    }
}
