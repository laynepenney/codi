// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Configuration merging.
//!
//! Handles merging configurations from different sources with proper precedence.

use super::types::{
    ResolvedConfig, ResolvedSecurityModelConfig, ResolvedWebSearchConfig, WorkspaceConfig,
};

/// CLI options that can override configuration.
#[derive(Debug, Clone, Default)]
pub struct CliOptions {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub endpoint_id: Option<String>,
    pub no_tools: Option<bool>,
    pub compress: Option<bool>,
    pub summarize_provider: Option<String>,
    pub summarize_model: Option<String>,
    pub session: Option<String>,
}

/// Default configuration values.
pub fn default_config() -> ResolvedConfig {
    ResolvedConfig::default()
}

/// Merge multiple configurations with precedence.
///
/// Precedence (highest to lowest):
/// 1. CLI options
/// 2. Local config (.codi.local.json)
/// 3. Workspace config (.codi.json)
/// 4. Global config (~/.codi/config.json)
/// 5. Default values
pub fn merge_config(
    global: Option<WorkspaceConfig>,
    workspace: Option<WorkspaceConfig>,
    local: Option<WorkspaceConfig>,
    cli: CliOptions,
) -> ResolvedConfig {
    let mut result = default_config();

    // Apply global config
    if let Some(config) = global {
        apply_workspace_config(&mut result, &config);
    }

    // Apply workspace config
    if let Some(config) = workspace {
        apply_workspace_config(&mut result, &config);
    }

    // Apply local config
    if let Some(config) = local {
        apply_workspace_config(&mut result, &config);
    }

    // Apply CLI options (highest precedence)
    apply_cli_options(&mut result, &cli);

    result
}

fn apply_workspace_config(result: &mut ResolvedConfig, config: &WorkspaceConfig) {
    if let Some(ref provider) = config.provider {
        result.provider = provider.clone();
    }

    if config.model.is_some() {
        result.model = config.model.clone();
    }

    if config.base_url.is_some() {
        result.base_url = config.base_url.clone();
    }

    if config.endpoint_id.is_some() {
        result.endpoint_id = config.endpoint_id.clone();
    }

    if let Some(ref auto_approve) = config.auto_approve {
        // Merge auto-approve lists
        for tool in auto_approve {
            if !result.auto_approve.contains(tool) {
                result.auto_approve.push(tool.clone());
            }
        }
    }

    if let Some(ref patterns) = config.approved_patterns {
        result.approved_patterns.extend(patterns.iter().cloned());
    }

    if let Some(ref categories) = config.approved_categories {
        for cat in categories {
            if !result.approved_categories.contains(cat) {
                result.approved_categories.push(cat.clone());
            }
        }
    }

    if let Some(ref patterns) = config.approved_path_patterns {
        result.approved_path_patterns.extend(patterns.iter().cloned());
    }

    if let Some(ref categories) = config.approved_path_categories {
        for cat in categories {
            if !result.approved_path_categories.contains(cat) {
                result.approved_path_categories.push(cat.clone());
            }
        }
    }

    if let Some(ref patterns) = config.dangerous_patterns {
        result.dangerous_patterns.extend(patterns.iter().cloned());
    }

    if config.system_prompt_additions.is_some() {
        result.system_prompt_additions = config.system_prompt_additions.clone();
    }

    if let Some(no_tools) = config.no_tools {
        result.no_tools = no_tools;
    }

    if let Some(extract) = config.extract_tools_from_text {
        result.extract_tools_from_text = extract;
    }

    if config.default_session.is_some() {
        result.default_session = config.default_session.clone();
    }

    if let Some(ref aliases) = config.command_aliases {
        result.command_aliases.extend(aliases.clone());
    }

    if config.project_context.is_some() {
        result.project_context = config.project_context.clone();
    }

    if let Some(compress) = config.enable_compression {
        result.enable_compression = compress;
    }

    if let Some(max_tokens) = config.max_context_tokens {
        result.max_context_tokens = max_tokens;
    }

    if let Some(clean) = config.clean_hallucinated_traces {
        result.clean_hallucinated_traces = clean;
    }

    if let Some(ref models) = config.models {
        if let Some(ref summarize) = models.summarize {
            if summarize.provider.is_some() {
                result.summarize_provider = summarize.provider.clone();
            }
            if summarize.model.is_some() {
                result.summarize_model = summarize.model.clone();
            }
        }
    }

    if let Some(ref tools) = config.tools {
        if let Some(ref disabled) = tools.disabled {
            result.tools_config.disabled.extend(disabled.iter().cloned());
        }
        if let Some(ref defaults) = tools.defaults {
            result.tools_config.defaults.extend(defaults.clone());
        }
    }

    if config.context_optimization.is_some() {
        result.context_optimization = config.context_optimization.clone();
    }

    if let Some(ref web_search) = config.web_search {
        result.web_search = Some(ResolvedWebSearchConfig {
            engines: web_search.engines.clone().unwrap_or_else(|| vec!["duckduckgo".to_string()]),
            cache_enabled: web_search.cache_enabled.unwrap_or(true),
            cache_max_size: web_search.cache_max_size.unwrap_or(100),
            default_ttl: web_search.default_ttl.unwrap_or(3600),
            max_results: web_search.max_results.unwrap_or(5),
        });
    }

    if let Some(ref security) = config.security_model {
        result.security_model = Some(ResolvedSecurityModelConfig {
            enabled: security.enabled.unwrap_or(false),
            model: security.model.clone().unwrap_or_else(|| "llama3.2".to_string()),
            block_threshold: security.block_threshold.unwrap_or(8),
            warn_threshold: security.warn_threshold.unwrap_or(5),
            tools: security.tools.clone().unwrap_or_else(|| vec!["bash".to_string()]),
            base_url: security.base_url.clone().unwrap_or_else(|| "http://localhost:11434".to_string()),
            timeout: security.timeout.unwrap_or(10000),
        });
    }
}

fn apply_cli_options(result: &mut ResolvedConfig, cli: &CliOptions) {
    if let Some(ref provider) = cli.provider {
        result.provider = provider.clone();
    }

    if cli.model.is_some() {
        result.model = cli.model.clone();
    }

    if cli.base_url.is_some() {
        result.base_url = cli.base_url.clone();
    }

    if cli.endpoint_id.is_some() {
        result.endpoint_id = cli.endpoint_id.clone();
    }

    if let Some(no_tools) = cli.no_tools {
        result.no_tools = no_tools;
    }

    if let Some(compress) = cli.compress {
        result.enable_compression = compress;
    }

    if cli.summarize_provider.is_some() {
        result.summarize_provider = cli.summarize_provider.clone();
    }

    if cli.summarize_model.is_some() {
        result.summarize_model = cli.summarize_model.clone();
    }

    if cli.session.is_some() {
        result.default_session = cli.session.clone();
    }
}

/// Check if a tool should be auto-approved.
pub fn should_auto_approve(config: &ResolvedConfig, tool_name: &str) -> bool {
    config.auto_approve.iter().any(|t| t == tool_name)
}

/// Check if a tool is disabled.
pub fn is_tool_disabled(config: &ResolvedConfig, tool_name: &str) -> bool {
    config.tools_config.disabled.iter().any(|t| t == tool_name)
}

/// Get custom dangerous patterns.
pub fn get_custom_dangerous_patterns(config: &ResolvedConfig) -> &[String] {
    &config.dangerous_patterns
}

/// Get tool defaults for a specific tool.
pub fn get_tool_defaults<'a>(config: &'a ResolvedConfig, tool_name: &str) -> Option<&'a serde_json::Value> {
    config.tools_config.defaults.get(tool_name)
}

/// Merge tool input with defaults.
pub fn merge_tool_input(
    config: &ResolvedConfig,
    tool_name: &str,
    input: serde_json::Value,
) -> serde_json::Value {
    let defaults = match get_tool_defaults(config, tool_name) {
        Some(d) => d,
        None => return input,
    };

    if let (serde_json::Value::Object(mut input_obj), serde_json::Value::Object(defaults_obj)) =
        (input.clone(), defaults.clone())
    {
        // Apply defaults for missing keys
        for (key, value) in defaults_obj {
            if !input_obj.contains_key(&key) {
                input_obj.insert(key, value);
            }
        }
        serde_json::Value::Object(input_obj)
    } else {
        input
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::ToolsConfig;
    use std::collections::HashMap;

    #[test]
    fn test_default_config() {
        let config = default_config();
        assert_eq!(config.provider, "anthropic");
        assert!(!config.no_tools);
    }

    #[test]
    fn test_merge_config_precedence() {
        let global = WorkspaceConfig {
            provider: Some("anthropic".to_string()),
            model: Some("global-model".to_string()),
            ..Default::default()
        };

        let workspace = WorkspaceConfig {
            model: Some("workspace-model".to_string()),
            ..Default::default()
        };

        let local = WorkspaceConfig {
            model: Some("local-model".to_string()),
            ..Default::default()
        };

        let cli = CliOptions {
            provider: Some("openai".to_string()),
            ..Default::default()
        };

        let result = merge_config(Some(global), Some(workspace), Some(local), cli);

        // CLI provider takes precedence
        assert_eq!(result.provider, "openai");
        // Local model takes precedence over workspace and global
        assert_eq!(result.model, Some("local-model".to_string()));
    }

    #[test]
    fn test_merge_auto_approve() {
        let global = WorkspaceConfig {
            auto_approve: Some(vec!["read_file".to_string()]),
            ..Default::default()
        };

        let workspace = WorkspaceConfig {
            auto_approve: Some(vec!["glob".to_string(), "read_file".to_string()]),
            ..Default::default()
        };

        let result = merge_config(Some(global), Some(workspace), None, CliOptions::default());

        // Should have both tools without duplicates
        assert!(result.auto_approve.contains(&"read_file".to_string()));
        assert!(result.auto_approve.contains(&"glob".to_string()));
        assert_eq!(result.auto_approve.len(), 2);
    }

    #[test]
    fn test_should_auto_approve() {
        let config = ResolvedConfig {
            auto_approve: vec!["read_file".to_string(), "glob".to_string()],
            ..Default::default()
        };

        assert!(should_auto_approve(&config, "read_file"));
        assert!(should_auto_approve(&config, "glob"));
        assert!(!should_auto_approve(&config, "bash"));
    }

    #[test]
    fn test_is_tool_disabled() {
        let config = ResolvedConfig {
            tools_config: ToolsConfig {
                disabled: vec!["web_search".to_string()],
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(is_tool_disabled(&config, "web_search"));
        assert!(!is_tool_disabled(&config, "read_file"));
    }

    #[test]
    fn test_merge_tool_input() {
        let config = ResolvedConfig {
            tools_config: ToolsConfig {
                defaults: HashMap::from([(
                    "bash".to_string(),
                    serde_json::json!({"timeout": 30000}),
                )]),
                ..Default::default()
            },
            ..Default::default()
        };

        let input = serde_json::json!({"command": "ls"});
        let merged = merge_tool_input(&config, "bash", input);

        assert_eq!(merged["command"], "ls");
        assert_eq!(merged["timeout"], 30000);
    }

    #[test]
    fn test_cli_options_override() {
        let workspace = WorkspaceConfig {
            provider: Some("anthropic".to_string()),
            no_tools: Some(false),
            ..Default::default()
        };

        let cli = CliOptions {
            no_tools: Some(true),
            compress: Some(true),
            ..Default::default()
        };

        let result = merge_config(None, Some(workspace), None, cli);

        assert!(result.no_tools);
        assert!(result.enable_compression);
    }
}
