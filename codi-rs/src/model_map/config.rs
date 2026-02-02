// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Model Map configuration loading and validation.
//!
//! Loads configuration from:
//! - Global: `~/.codi/models.yaml`
//! - Project: `codi-models.yaml` or `codi-models.yml`
//!
//! Project config overrides global config through deep merging.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

use super::types::{
    CommandConfig, ModelDefinition, ModelRoles, PipelineDefinition, TaskDefinition, TaskType,
};

// ============================================================================
// Configuration File Names
// ============================================================================

/// Project config file name
const MODEL_MAP_FILE: &str = "codi-models.yaml";

/// Alternative project config file name
const MODEL_MAP_FILE_ALT: &str = "codi-models.yml";

/// Global config file name
const GLOBAL_MODEL_MAP_FILE: &str = "models.yaml";

/// Alternative global config file name
const GLOBAL_MODEL_MAP_FILE_ALT: &str = "models.yml";

// ============================================================================
// Configuration Types
// ============================================================================

/// Complete model map configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelMapConfig {
    /// Config version
    #[serde(default = "default_version")]
    pub version: String,

    /// Named model definitions
    #[serde(default)]
    pub models: HashMap<String, ModelDefinition>,

    /// Role mappings for provider-agnostic pipelines
    #[serde(default, rename = "model-roles")]
    pub model_roles: ModelRoles,

    /// Task categories
    #[serde(default)]
    pub tasks: HashMap<TaskType, TaskDefinition>,

    /// Per-command overrides
    #[serde(default)]
    pub commands: HashMap<String, CommandConfig>,

    /// Fallback chains
    #[serde(default)]
    pub fallbacks: HashMap<String, Vec<String>>,

    /// Multi-model pipelines
    #[serde(default)]
    pub pipelines: HashMap<String, PipelineDefinition>,
}

fn default_version() -> String {
    "1".to_string()
}

/// Result of loading model map configuration.
#[derive(Debug)]
pub struct ModelMapLoadResult {
    /// Merged configuration (or None if no config found)
    pub config: Option<ModelMapConfig>,

    /// Project config path (if exists)
    pub config_path: Option<PathBuf>,

    /// Global config path (if exists)
    pub global_config_path: Option<PathBuf>,
}

// ============================================================================
// Errors
// ============================================================================

/// Errors that can occur during model map operations.
#[derive(Error, Debug)]
pub enum ModelMapError {
    #[error("Failed to read config file: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Failed to parse YAML: {0}")]
    YamlError(#[from] serde_yaml::Error),

    #[error("Validation error in {field}: {message}")]
    ValidationError { field: String, message: String },

    #[error("Config file already exists: {0}")]
    AlreadyExists(PathBuf),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Pipeline not found: {0}")]
    PipelineNotFound(String),

    #[error("Role not found: {role} for provider {provider}")]
    RoleNotFound { role: String, provider: String },

    #[error("Fallback chain not found: {0}")]
    FallbackChainNotFound(String),

    #[error("All models in fallback chain failed: {0}")]
    AllFallbacksFailed(String),
}

// ============================================================================
// Validation
// ============================================================================

/// Validation warning (non-fatal).
#[derive(Debug, Clone)]
pub struct ConfigWarning {
    pub field: String,
    pub message: String,
}

impl std::fmt::Display for ConfigWarning {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

/// Validation result.
#[derive(Debug, Default)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ModelMapError>,
    pub warnings: Vec<ConfigWarning>,
}

impl ValidationResult {
    fn new() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn add_error(&mut self, field: impl Into<String>, message: impl Into<String>) {
        self.valid = false;
        self.errors.push(ModelMapError::ValidationError {
            field: field.into(),
            message: message.into(),
        });
    }

    fn add_warning(&mut self, field: impl Into<String>, message: impl Into<String>) {
        self.warnings.push(ConfigWarning {
            field: field.into(),
            message: message.into(),
        });
    }
}

// ============================================================================
// Loading Functions
// ============================================================================

/// Load model map configuration from global and/or project directory.
///
/// Global config (`~/.codi/models.yaml`) is loaded first, then project config
/// (`codi-models.yaml`) overrides global settings through deep merging.
///
/// # Arguments
///
/// * `project_path` - Path to the project directory
///
/// # Returns
///
/// Load result containing merged config and paths to source files.
pub fn load_model_map(project_path: &Path) -> ModelMapLoadResult {
    // Load global config (if exists)
    let global_result = load_global_config();

    // Load project config (if exists)
    let project_result = load_project_config(project_path);

    // Merge configs (project overrides global)
    let config = merge_configs(global_result.config, project_result.config);

    ModelMapLoadResult {
        config,
        config_path: project_result.path,
        global_config_path: global_result.path,
    }
}

/// Load only the project model map (no global).
pub fn load_project_model_map(project_path: &Path) -> Result<Option<ModelMapConfig>, ModelMapError> {
    let result = load_project_config(project_path);
    Ok(result.config)
}

struct SingleLoadResult {
    config: Option<ModelMapConfig>,
    path: Option<PathBuf>,
}

fn load_global_config() -> SingleLoadResult {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return SingleLoadResult { config: None, path: None },
    };

    let codi_dir = home.join(".codi");
    load_single_config(&codi_dir, GLOBAL_MODEL_MAP_FILE, GLOBAL_MODEL_MAP_FILE_ALT)
}

fn load_project_config(project_path: &Path) -> SingleLoadResult {
    load_single_config(project_path, MODEL_MAP_FILE, MODEL_MAP_FILE_ALT)
}

fn load_single_config(dir: &Path, primary: &str, alt: &str) -> SingleLoadResult {
    // Try primary name first
    let mut config_path = dir.join(primary);
    if !config_path.exists() {
        // Try alternative name
        config_path = dir.join(alt);
        if !config_path.exists() {
            return SingleLoadResult { config: None, path: None };
        }
    }

    match std::fs::read_to_string(&config_path) {
        Ok(content) => match serde_yaml::from_str::<ModelMapConfig>(&content) {
            Ok(config) => SingleLoadResult {
                config: Some(config),
                path: Some(config_path),
            },
            Err(e) => {
                tracing::warn!("Failed to parse {}: {}", config_path.display(), e);
                SingleLoadResult { config: None, path: Some(config_path) }
            }
        },
        Err(e) => {
            tracing::warn!("Failed to read {}: {}", config_path.display(), e);
            SingleLoadResult { config: None, path: None }
        }
    }
}

fn merge_configs(
    global: Option<ModelMapConfig>,
    project: Option<ModelMapConfig>,
) -> Option<ModelMapConfig> {
    match (global, project) {
        (None, None) => None,
        (Some(g), None) => Some(g),
        (None, Some(p)) => Some(p),
        (Some(g), Some(p)) => Some(deep_merge(g, p)),
    }
}

/// Deep merge two configs (project overrides global).
fn deep_merge(mut global: ModelMapConfig, project: ModelMapConfig) -> ModelMapConfig {
    // Use project version
    global.version = project.version;

    // Merge models (project overrides)
    for (name, def) in project.models {
        global.models.insert(name, def);
    }

    // Merge model_roles (deep merge)
    for (role_name, role_mapping) in project.model_roles {
        let entry = global.model_roles.entry(role_name).or_default();
        for (provider, model) in role_mapping {
            entry.insert(provider, model);
        }
    }

    // Merge tasks (project overrides)
    for (task_type, def) in project.tasks {
        global.tasks.insert(task_type, def);
    }

    // Merge commands (project overrides)
    for (name, cmd) in project.commands {
        global.commands.insert(name, cmd);
    }

    // Merge fallbacks (project overrides)
    for (name, chain) in project.fallbacks {
        global.fallbacks.insert(name, chain);
    }

    // Merge pipelines (project overrides)
    for (name, pipeline) in project.pipelines {
        global.pipelines.insert(name, pipeline);
    }

    global
}

// ============================================================================
// Validation
// ============================================================================

/// Validate model map configuration.
pub fn validate_model_map(config: &ModelMapConfig) -> ValidationResult {
    let mut result = ValidationResult::new();

    // Validate models section
    if config.models.is_empty() {
        result.add_error("models", "At least one model must be defined");
    } else {
        for (name, model) in &config.models {
            if model.provider.is_empty() {
                result.add_error(format!("models.{}.provider", name), "Provider is required");
            }
            if model.model.is_empty() {
                result.add_error(format!("models.{}.model", name), "Model name is required");
            }
            if let Some(temp) = model.temperature {
                if !(0.0..=2.0).contains(&temp) {
                    result.add_warning(
                        format!("models.{}.temperature", name),
                        format!("Temperature {} is outside typical range 0-2", temp),
                    );
                }
            }
        }
    }

    // Validate model_roles section
    let valid_roles: std::collections::HashSet<_> = config.model_roles.keys().collect();
    for (role_name, mapping) in &config.model_roles {
        for (provider_ctx, model_name) in mapping {
            if !config.models.contains_key(model_name) {
                result.add_error(
                    format!("model-roles.{}.{}", role_name, provider_ctx),
                    format!("References unknown model \"{}\"", model_name),
                );
            }
        }
    }

    // Validate tasks section
    for (task_type, task) in &config.tasks {
        if !config.models.contains_key(&task.model) {
            result.add_error(
                format!("tasks.{}.model", task_type),
                format!("References unknown model \"{}\"", task.model),
            );
        }
    }

    // Validate commands section
    for (name, cmd) in &config.commands {
        let has_model = cmd.model.is_some();
        let has_task = cmd.task.is_some();
        let has_pipeline = cmd.pipeline.is_some();
        let count = [has_model, has_task, has_pipeline].iter().filter(|&&b| b).count();

        if count == 0 {
            result.add_error(
                format!("commands.{}", name),
                "Must specify model, task, or pipeline",
            );
        } else if count > 1 {
            result.add_warning(
                format!("commands.{}", name),
                "Has multiple routing options; only one will be used",
            );
        }

        if let Some(model) = &cmd.model {
            if !config.models.contains_key(model) {
                result.add_error(
                    format!("commands.{}.model", name),
                    format!("References unknown model \"{}\"", model),
                );
            }
        }

        if let Some(task) = &cmd.task {
            if !config.tasks.contains_key(task) {
                result.add_error(
                    format!("commands.{}.task", name),
                    format!("References unknown task \"{}\"", task),
                );
            }
        }

        if let Some(pipeline) = &cmd.pipeline {
            if !config.pipelines.contains_key(pipeline) {
                result.add_error(
                    format!("commands.{}.pipeline", name),
                    format!("References unknown pipeline \"{}\"", pipeline),
                );
            }
        }
    }

    // Validate fallbacks section
    for (name, chain) in &config.fallbacks {
        if chain.is_empty() {
            result.add_error(
                format!("fallbacks.{}", name),
                "Fallback chain must not be empty",
            );
            continue;
        }
        for model_name in chain {
            if !config.models.contains_key(model_name) {
                result.add_error(
                    format!("fallbacks.{}", name),
                    format!("References unknown model \"{}\"", model_name),
                );
            }
        }
    }

    // Validate pipelines section
    for (name, pipeline) in &config.pipelines {
        if pipeline.steps.is_empty() {
            result.add_error(
                format!("pipelines.{}.steps", name),
                "Pipeline must have at least one step",
            );
            continue;
        }

        let mut defined_outputs: std::collections::HashSet<&str> =
            std::collections::HashSet::from(["input"]);

        for (i, step) in pipeline.steps.iter().enumerate() {
            if step.name.is_empty() {
                result.add_error(
                    format!("pipelines.{}.steps[{}].name", name, i),
                    "Step name is required",
                );
            }

            // Step must have either model or role
            let has_model = step.model.is_some();
            let has_role = step.role.is_some();

            if !has_model && !has_role {
                result.add_error(
                    format!("pipelines.{}.steps[{}]", name, i),
                    format!("Step \"{}\" must have either model or role", step.name),
                );
            } else if has_model && has_role {
                result.add_warning(
                    format!("pipelines.{}.steps[{}]", name, i),
                    format!("Step \"{}\" has both model and role; model will be used", step.name),
                );
            }

            if let Some(model) = &step.model {
                if !config.models.contains_key(model) {
                    result.add_error(
                        format!("pipelines.{}.steps[{}].model", name, i),
                        format!("Step \"{}\" references unknown model \"{}\"", step.name, model),
                    );
                }
            }

            if has_role && !has_model {
                if let Some(role) = &step.role {
                    if !valid_roles.contains(role) {
                        result.add_error(
                            format!("pipelines.{}.steps[{}].role", name, i),
                            format!("Step \"{}\" references unknown role \"{}\"", step.name, role),
                        );
                    }
                }
            }

            if step.prompt.is_empty() {
                result.add_error(
                    format!("pipelines.{}.steps[{}].prompt", name, i),
                    format!("Step \"{}\" is missing prompt", step.name),
                );
            } else {
                // Check for undefined variable references
                for var in extract_variables(&step.prompt) {
                    if !defined_outputs.contains(var.as_str()) {
                        result.add_warning(
                            format!("pipelines.{}.steps[{}].prompt", name, i),
                            format!(
                                "Step \"{}\" references variable \"{}\" not yet defined",
                                step.name, var
                            ),
                        );
                    }
                }
            }

            if step.output.is_empty() {
                result.add_error(
                    format!("pipelines.{}.steps[{}].output", name, i),
                    format!("Step \"{}\" is missing output name", step.name),
                );
            } else {
                defined_outputs.insert(&step.output);
            }
        }

        // Check result template variable references
        if let Some(result_template) = &pipeline.result {
            for var in extract_variables(result_template) {
                if !defined_outputs.contains(var.as_str()) {
                    result.add_error(
                        format!("pipelines.{}.result", name),
                        format!("Result references undefined variable \"{}\"", var),
                    );
                }
            }
        }
    }

    result
}

/// Extract variable names from a template string.
fn extract_variables(template: &str) -> Vec<String> {
    let re = regex::Regex::new(r"\{(\w+)\}").unwrap();
    re.captures_iter(template)
        .map(|cap| cap[1].to_string())
        .collect()
}

// ============================================================================
// Initialization
// ============================================================================

/// Initialize a new model map configuration file.
///
/// # Arguments
///
/// * `dir` - Directory to create the file in
/// * `global` - If true, creates in `~/.codi/` instead
///
/// # Returns
///
/// Path to the created file.
pub fn init_model_map(dir: &Path, global: bool) -> Result<PathBuf, ModelMapError> {
    let target_dir = if global {
        match dirs::home_dir() {
            Some(h) => {
                let codi_dir = h.join(".codi");
                if !codi_dir.exists() {
                    std::fs::create_dir_all(&codi_dir)?;
                }
                codi_dir
            }
            None => {
                return Err(ModelMapError::IoError(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Could not determine home directory",
                )))
            }
        }
    } else {
        dir.to_path_buf()
    };

    let file_name = if global { GLOBAL_MODEL_MAP_FILE } else { MODEL_MAP_FILE };
    let config_path = target_dir.join(file_name);

    // Check if file already exists
    if config_path.exists() {
        return Err(ModelMapError::AlreadyExists(config_path));
    }

    // Also check alternate name
    let alt_name = if global { GLOBAL_MODEL_MAP_FILE_ALT } else { MODEL_MAP_FILE_ALT };
    let alt_path = target_dir.join(alt_name);
    if alt_path.exists() {
        return Err(ModelMapError::AlreadyExists(alt_path));
    }

    // Write example config
    let example = get_example_model_map();
    std::fs::write(&config_path, example)?;

    Ok(config_path)
}

/// Get example model map configuration as YAML string.
pub fn get_example_model_map() -> String {
    r#"# Codi Model Map Configuration
# Docker-compose style multi-model orchestration

version: "1"

models:
  haiku:
    provider: anthropic
    model: claude-3-5-haiku-latest
    description: "Fast, cheap model for quick tasks"
  sonnet:
    provider: anthropic
    model: claude-sonnet-4-20250514
    description: "Balanced model for coding tasks"
  opus:
    provider: anthropic
    model: claude-opus-4-20250514
    description: "Most capable for complex reasoning"
  gpt-5-nano:
    provider: openai
    model: gpt-5-nano
    description: "Fast, cheap OpenAI model"
  gpt-5:
    provider: openai
    model: gpt-5.2
    description: "Latest GPT-5, best for coding"
  local:
    provider: ollama
    model: llama3.2
    description: "Free local model"

# Provider-agnostic role mappings
model-roles:
  fast:
    anthropic: haiku
    openai: gpt-5-nano
    ollama: local
  capable:
    anthropic: sonnet
    openai: gpt-5
    ollama: local
  reasoning:
    anthropic: opus
    openai: gpt-5
    ollama: local

tasks:
  fast:
    model: haiku
    description: "Quick tasks (commits, summaries)"
  code:
    model: sonnet
    description: "Standard coding tasks"
  complex:
    model: sonnet
    description: "Architecture, debugging"
  summarize:
    model: local
    description: "Context summarization"

commands:
  commit:
    task: fast
  fix:
    task: complex

fallbacks:
  primary: [sonnet, haiku, local]

pipelines:
  smart-refactor:
    description: "Analyze, plan, implement, review"
    provider: anthropic
    steps:
      - name: analyze
        role: fast
        prompt: "Analyze refactoring opportunities: {input}"
        output: analysis
      - name: plan
        role: capable
        prompt: "Create refactoring plan based on: {analysis}"
        output: plan
      - name: implement
        role: capable
        prompt: "Implement the plan: {plan}"
        output: implementation
      - name: review
        role: fast
        prompt: "Quick review: {implementation}"
        output: review
    result: "{implementation}\n\n## Review\n{review}"
"#
    .to_string()
}

/// Get the global config directory path.
pub fn get_global_config_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codi"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_parse_example_config() {
        let example = get_example_model_map();
        let config: ModelMapConfig = serde_yaml::from_str(&example).unwrap();

        assert_eq!(config.version, "1");
        assert!(config.models.contains_key("haiku"));
        assert!(config.models.contains_key("sonnet"));
        assert!(config.model_roles.contains_key("fast"));
        assert!(config.tasks.contains_key(&TaskType::Fast));
        assert!(config.pipelines.contains_key("smart-refactor"));
    }

    #[test]
    fn test_validate_valid_config() {
        let example = get_example_model_map();
        let config: ModelMapConfig = serde_yaml::from_str(&example).unwrap();
        let result = validate_model_map(&config);

        assert!(result.valid, "Errors: {:?}", result.errors);
    }

    #[test]
    fn test_validate_empty_models() {
        let config = ModelMapConfig::default();
        let result = validate_model_map(&config);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| {
            matches!(e, ModelMapError::ValidationError { field, .. } if field == "models")
        }));
    }

    #[test]
    fn test_validate_missing_model_reference() {
        let mut config = ModelMapConfig::default();
        config.models.insert(
            "test".to_string(),
            ModelDefinition {
                provider: "anthropic".to_string(),
                model: "test-model".to_string(),
                description: None,
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );
        config.tasks.insert(
            TaskType::Fast,
            TaskDefinition {
                model: "nonexistent".to_string(),
                description: None,
            },
        );

        let result = validate_model_map(&config);
        assert!(!result.valid);
    }

    #[test]
    fn test_init_model_map() {
        let temp_dir = TempDir::new().unwrap();
        let path = init_model_map(temp_dir.path(), false).unwrap();

        assert!(path.exists());
        assert_eq!(path.file_name().unwrap(), MODEL_MAP_FILE);

        // Should fail if file already exists
        let result = init_model_map(temp_dir.path(), false);
        assert!(matches!(result, Err(ModelMapError::AlreadyExists(_))));
    }

    #[test]
    fn test_merge_configs() {
        let mut global = ModelMapConfig::default();
        global.models.insert(
            "global-model".to_string(),
            ModelDefinition {
                provider: "anthropic".to_string(),
                model: "global".to_string(),
                description: None,
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );

        let mut project = ModelMapConfig::default();
        project.models.insert(
            "project-model".to_string(),
            ModelDefinition {
                provider: "openai".to_string(),
                model: "project".to_string(),
                description: None,
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );

        let merged = deep_merge(global, project);

        assert!(merged.models.contains_key("global-model"));
        assert!(merged.models.contains_key("project-model"));
    }

    #[test]
    fn test_extract_variables() {
        let vars = extract_variables("Hello {name}, the result is {result}");
        assert_eq!(vars, vec!["name", "result"]);

        let empty = extract_variables("No variables here");
        assert!(empty.is_empty());
    }
}
