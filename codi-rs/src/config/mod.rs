// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Configuration module for Codi.
//!
//! Handles loading, merging, and validation of configuration from multiple sources:
//! - Global config: ~/.codi/config.json
//! - Workspace config: .codi.json, .codi/config.json, or codi.config.json
//! - Local config: .codi.local.json (gitignored, for personal overrides)
//! - CLI options: command-line arguments
//!
//! Configuration is merged with precedence (CLI > local > workspace > global > defaults).

mod loader;
mod merger;
mod types;

// Re-export public types
pub use loader::{
    find_workspace_root, get_example_config, get_global_config_dir, get_global_config_path,
    init_config, load_config_file, load_global_config, load_local_config, load_workspace_config,
    save_workspace_config, CONFIG_FILES, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE, LOCAL_CONFIG_FILE,
};

pub use merger::{
    default_config, get_custom_dangerous_patterns, get_tool_defaults, is_tool_disabled,
    merge_config, merge_tool_input, should_auto_approve, CliOptions,
};

pub use types::{
    ApprovedPathPatternConfig, ApprovedPatternConfig, ContextOptimizationConfig,
    ImportanceWeightsConfig, McpServerConfig, ModelRef, ModelsConfig, RagConfig, ResolvedConfig,
    ResolvedSecurityModelConfig, ResolvedWebSearchConfig, SecurityModelConfig, ToolFallbackConfig,
    ToolsConfig, ToolsConfigPartial, WebSearchConfig, WorkspaceConfig,
};

use crate::error::ConfigError;
use std::path::Path;

/// Load and merge all configuration sources for a workspace.
///
/// This is the main entry point for configuration loading.
/// It handles all the complexity of finding and merging configs.
pub fn load_config(
    workspace_root: &Path,
    cli_options: CliOptions,
) -> Result<ResolvedConfig, ConfigError> {
    let global = load_global_config()?;
    let workspace = load_workspace_config(workspace_root)?;
    let local = load_local_config(workspace_root)?;

    Ok(merge_config(global, workspace, local, cli_options))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_load_config_with_no_files() {
        let temp = TempDir::new().unwrap();
        let result = load_config(temp.path(), CliOptions::default());
        assert!(result.is_ok());

        let config = result.unwrap();
        // Provider could be from global config or default
        // Just verify the config loaded successfully
        assert!(!config.provider.is_empty());
    }

    #[test]
    fn test_load_config_with_workspace_config() {
        let temp = TempDir::new().unwrap();
        std::fs::write(
            temp.path().join(".codi.json"),
            r#"{"provider": "openai", "model": "gpt-4"}"#,
        )
        .unwrap();

        let result = load_config(temp.path(), CliOptions::default());
        assert!(result.is_ok());

        let config = result.unwrap();
        assert_eq!(config.provider, "openai");
        assert_eq!(config.model, Some("gpt-4".to_string()));
    }

    #[test]
    fn test_load_config_cli_override() {
        let temp = TempDir::new().unwrap();
        std::fs::write(
            temp.path().join(".codi.json"),
            r#"{"provider": "openai"}"#,
        )
        .unwrap();

        let cli = CliOptions {
            provider: Some("anthropic".to_string()),
            ..Default::default()
        };

        let result = load_config(temp.path(), cli);
        assert!(result.is_ok());

        let config = result.unwrap();
        assert_eq!(config.provider, "anthropic"); // CLI wins
    }
}
