// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Configuration type definitions.
//!
//! Defines the structure of workspace and resolved configuration,
//! supporting JSON and YAML formats.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Workspace configuration for Codi.
/// Can be defined in .codi.json or .codi/config.json in the project root.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    /// Provider to use (anthropic, openai, ollama, runpod)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,

    /// Model name to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// Custom base URL for API
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,

    /// Endpoint ID for RunPod serverless
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint_id: Option<String>,

    /// Tools that don't require confirmation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<Vec<String>>,

    /// Auto-approved bash command patterns
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_patterns: Option<Vec<ApprovedPatternConfig>>,

    /// Auto-approved bash command categories
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_categories: Option<Vec<String>>,

    /// Auto-approved file path patterns
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_path_patterns: Option<Vec<ApprovedPathPatternConfig>>,

    /// Auto-approved file path categories
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_path_categories: Option<Vec<String>>,

    /// Additional dangerous patterns for bash commands
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dangerous_patterns: Option<Vec<String>>,

    /// Additional text to append to the system prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_additions: Option<String>,

    /// Whether to disable tools entirely
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_tools: Option<bool>,

    /// Whether to extract tool calls from text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extract_tools_from_text: Option<bool>,

    /// Default session to load on startup
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_session: Option<String>,

    /// Custom command aliases
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_aliases: Option<HashMap<String, String>>,

    /// Project-specific context to include in system prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_context: Option<String>,

    /// Enable context compression
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_compression: Option<bool>,

    /// Maximum context tokens before compaction
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_context_tokens: Option<u32>,

    /// Strip hallucinated tool traces from provider content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clean_hallucinated_traces: Option<bool>,

    /// Context optimization settings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_optimization: Option<ContextOptimizationConfig>,

    /// Multi-model orchestration settings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<ModelsConfig>,

    /// Enhanced web search settings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_search: Option<WebSearchConfig>,

    /// RAG settings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rag: Option<RagConfig>,

    /// MCP server configurations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<HashMap<String, McpServerConfig>>,

    /// Per-tool configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<ToolsConfigPartial>,

    /// Tool fallback settings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_fallback: Option<ToolFallbackConfig>,

    /// Security model validation settings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_model: Option<SecurityModelConfig>,
}

/// Approved pattern stored in config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedPatternConfig {
    pub pattern: String,
    pub approved_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Approved path pattern stored in config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedPathPatternConfig {
    pub pattern: String,
    pub tool_name: String,
    pub approved_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Context optimization settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextOptimizationConfig {
    /// Enable semantic deduplication
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_case_variants: Option<bool>,

    /// Enable merging similar names
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_similar_names: Option<bool>,

    /// Minimum messages to always keep during compaction
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_recent_messages: Option<u32>,

    /// Importance score threshold for keeping messages (0-1)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub importance_threshold: Option<f64>,

    /// Maximum multiplier for output reserve scaling
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_reserve_scale: Option<f64>,

    /// Custom importance weights
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weights: Option<ImportanceWeightsConfig>,
}

/// Custom importance weights for context optimization.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportanceWeightsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recency: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_count: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_emphasis: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_relevance: Option<f64>,
}

/// Multi-model orchestration settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsConfig {
    /// Primary model configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<ModelRef>,

    /// Model to use for summarization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summarize: Option<ModelRef>,
}

/// Reference to a model with provider and model name.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRef {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// Enhanced web search settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchConfig {
    /// Search engines to use (order indicates priority)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engines: Option<Vec<String>>,

    /// Whether to cache search results
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_enabled: Option<bool>,

    /// Maximum cache size (number of entries)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_max_size: Option<u32>,

    /// Default TTL for cached results (seconds)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_ttl: Option<u32>,

    /// Maximum results per search
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_results: Option<u32>,
}

/// RAG (Retrieval-Augmented Generation) settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagConfig {
    /// Enable RAG code indexing and search
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,

    /// Embedding provider
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_provider: Option<String>,

    /// Task name from model map for embeddings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_task: Option<String>,

    /// OpenAI embedding model
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_model: Option<String>,

    /// Ollama embedding model
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ollama_model: Option<String>,

    /// Ollama base URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ollama_base_url: Option<String>,

    /// Number of results to return
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,

    /// Minimum similarity score 0-1
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_score: Option<f64>,

    /// File patterns to include
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_patterns: Option<Vec<String>>,

    /// File patterns to exclude
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_patterns: Option<Vec<String>>,

    /// Auto-index on startup
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_index: Option<bool>,

    /// Watch for file changes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watch_files: Option<bool>,

    /// Number of parallel indexing jobs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel_jobs: Option<u32>,
}

/// MCP server configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    /// Command to start the MCP server
    pub command: String,

    /// Arguments to pass to the command
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,

    /// Environment variables
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,

    /// Working directory for the server process
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,

    /// Whether this server is enabled
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

/// Per-tool configuration (partial, for workspace config).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsConfigPartial {
    /// Tools to disable
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<Vec<String>>,

    /// Default settings per tool
    #[serde(skip_serializing_if = "Option::is_none")]
    pub defaults: Option<HashMap<String, serde_json::Value>>,
}

/// Tool-specific configuration (resolved).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsConfig {
    /// Tools to disable
    pub disabled: Vec<String>,
    /// Default settings per tool
    pub defaults: HashMap<String, serde_json::Value>,
}

/// Tool fallback settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolFallbackConfig {
    /// Enable semantic tool fallback
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,

    /// Threshold for auto-correcting tool names (0-1)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_correct_threshold: Option<f64>,

    /// Threshold for suggesting similar tools (0-1)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion_threshold: Option<f64>,

    /// Auto-execute corrected tools without confirmation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_execute: Option<bool>,

    /// Enable parameter aliasing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_aliasing: Option<bool>,
}

/// Security model validation settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityModelConfig {
    /// Enable security model validation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,

    /// Ollama model to use for validation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// Risk score threshold for blocking (7-10)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_threshold: Option<u32>,

    /// Risk score threshold for warning (4-6)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warn_threshold: Option<u32>,

    /// Tools to validate
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<String>>,

    /// Ollama base URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,

    /// Timeout for validation in milliseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
}

/// Resolved configuration with all values set.
/// This is the merged result of global, workspace, local, and CLI configs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedConfig {
    pub provider: String,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub endpoint_id: Option<String>,
    pub auto_approve: Vec<String>,
    pub approved_patterns: Vec<ApprovedPatternConfig>,
    pub approved_categories: Vec<String>,
    pub approved_path_patterns: Vec<ApprovedPathPatternConfig>,
    pub approved_path_categories: Vec<String>,
    pub dangerous_patterns: Vec<String>,
    pub system_prompt_additions: Option<String>,
    pub no_tools: bool,
    pub extract_tools_from_text: bool,
    pub default_session: Option<String>,
    pub command_aliases: HashMap<String, String>,
    pub project_context: Option<String>,
    pub enable_compression: bool,
    pub max_context_tokens: u32,
    pub clean_hallucinated_traces: bool,
    pub summarize_provider: Option<String>,
    pub summarize_model: Option<String>,
    pub tools_config: ToolsConfig,
    pub context_optimization: Option<ContextOptimizationConfig>,
    pub web_search: Option<ResolvedWebSearchConfig>,
    pub security_model: Option<ResolvedSecurityModelConfig>,
}

/// Resolved web search configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWebSearchConfig {
    pub engines: Vec<String>,
    pub cache_enabled: bool,
    pub cache_max_size: u32,
    pub default_ttl: u32,
    pub max_results: u32,
}

/// Resolved security model configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSecurityModelConfig {
    pub enabled: bool,
    pub model: String,
    pub block_threshold: u32,
    pub warn_threshold: u32,
    pub tools: Vec<String>,
    pub base_url: String,
    pub timeout: u64,
}

impl Default for ResolvedConfig {
    fn default() -> Self {
        Self {
            provider: "anthropic".to_string(),
            model: None,
            base_url: None,
            endpoint_id: None,
            auto_approve: Vec::new(),
            approved_patterns: Vec::new(),
            approved_categories: Vec::new(),
            approved_path_patterns: Vec::new(),
            approved_path_categories: Vec::new(),
            dangerous_patterns: Vec::new(),
            system_prompt_additions: None,
            no_tools: false,
            extract_tools_from_text: false,
            default_session: None,
            command_aliases: HashMap::new(),
            project_context: None,
            enable_compression: false,
            max_context_tokens: 128000,
            clean_hallucinated_traces: false,
            summarize_provider: None,
            summarize_model: None,
            tools_config: ToolsConfig::default(),
            context_optimization: None,
            web_search: None,
            security_model: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workspace_config_default() {
        let config = WorkspaceConfig::default();
        assert!(config.provider.is_none());
        assert!(config.model.is_none());
    }

    #[test]
    fn test_workspace_config_json_serialization() {
        let config = WorkspaceConfig {
            provider: Some("anthropic".to_string()),
            model: Some("claude-sonnet-4-20250514".to_string()),
            auto_approve: Some(vec!["read_file".to_string(), "glob".to_string()]),
            ..Default::default()
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        assert!(json.contains("\"provider\": \"anthropic\""));
        assert!(json.contains("\"autoApprove\""));

        let parsed: WorkspaceConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.provider, Some("anthropic".to_string()));
    }

    #[test]
    fn test_workspace_config_yaml_serialization() {
        let config = WorkspaceConfig {
            provider: Some("ollama".to_string()),
            model: Some("llama3.2".to_string()),
            ..Default::default()
        };

        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: WorkspaceConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.provider, Some("ollama".to_string()));
    }

    #[test]
    fn test_resolved_config_default() {
        let config = ResolvedConfig::default();
        assert_eq!(config.provider, "anthropic");
        assert!(!config.no_tools);
        assert_eq!(config.max_context_tokens, 128000);
    }

    #[test]
    fn test_approved_pattern_config() {
        let pattern = ApprovedPatternConfig {
            pattern: "npm test*".to_string(),
            approved_at: "2026-01-01T00:00:00Z".to_string(),
            description: Some("Allow npm test commands".to_string()),
        };

        let json = serde_json::to_string(&pattern).unwrap();
        assert!(json.contains("\"pattern\":\"npm test*\""));
        assert!(json.contains("\"approvedAt\""));
    }

    #[test]
    fn test_mcp_server_config() {
        let server = McpServerConfig {
            command: "npx".to_string(),
            args: Some(vec!["-y".to_string(), "@modelcontextprotocol/server".to_string()]),
            env: Some(HashMap::from([("NODE_ENV".to_string(), "production".to_string())])),
            cwd: None,
            enabled: Some(true),
        };

        let json = serde_json::to_string(&server).unwrap();
        assert!(json.contains("\"command\":\"npx\""));
    }
}
