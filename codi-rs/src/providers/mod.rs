// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! AI Provider implementations for Codi.
//!
//! This module provides implementations of the [`Provider`] trait for various
//! AI model backends:
//!
//! - [`anthropic::AnthropicProvider`] - Claude models via Anthropic API
//! - [`openai::OpenAIProvider`] - OpenAI, Ollama, and OpenAI-compatible APIs
//!
//! # Quick Start
//!
//! Just set an environment variable and go:
//!
//! ```bash
//! # For Anthropic Claude
//! export ANTHROPIC_API_KEY=your-key
//!
//! # For OpenAI
//! export OPENAI_API_KEY=your-key
//!
//! # For Ollama (no key needed, just have it running)
//! # Ollama is auto-detected at localhost:11434
//! ```
//!
//! Then in code:
//!
//! ```rust,ignore
//! use codi::providers::create_provider_from_env;
//!
//! // Auto-detects provider from environment
//! let provider = create_provider_from_env()?;
//! let response = provider.chat(&messages, Some(&tools), None).await?;
//! ```
//!
//! # Manual Configuration
//!
//! ```rust,ignore
//! use codi::providers::{create_provider, ProviderType};
//! use codi::types::ProviderConfig;
//!
//! // Explicit provider selection
//! let config = ProviderConfig::new("your-api-key", "gpt-4o");
//! let provider = create_provider(ProviderType::OpenAI, config)?;
//! ```

pub mod anthropic;
pub mod openai;

pub use anthropic::AnthropicProvider;
pub use openai::OpenAIProvider;

use crate::config::ResolvedConfig;
use crate::error::ProviderError;
use crate::types::{BoxedProvider, ProviderConfig};

/// Supported provider types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderType {
    /// Anthropic Claude models
    Anthropic,
    /// OpenAI GPT models
    OpenAI,
    /// Ollama local models
    Ollama,
    /// Any OpenAI-compatible API
    OpenAICompatible,
}

impl ProviderType {
    /// Get the default model for this provider.
    pub fn default_model(&self) -> &'static str {
        match self {
            Self::Anthropic => "claude-sonnet-4-20250514",
            Self::OpenAI => "gpt-4o",
            Self::Ollama => "llama3.2",
            Self::OpenAICompatible => "gpt-4o",
        }
    }

    /// Get the default base URL for this provider.
    pub fn default_base_url(&self) -> &'static str {
        match self {
            Self::Anthropic => "https://api.anthropic.com",
            Self::OpenAI => "https://api.openai.com/v1",
            Self::Ollama => "http://localhost:11434/v1",
            Self::OpenAICompatible => "https://api.openai.com/v1",
        }
    }

    /// Check if this provider requires an API key.
    pub fn requires_api_key(&self) -> bool {
        match self {
            Self::Anthropic | Self::OpenAI => true,
            Self::Ollama | Self::OpenAICompatible => false,
        }
    }
}

/// Error type for parsing a provider type from a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParseProviderTypeError;

impl std::fmt::Display for ParseProviderTypeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "invalid provider type")
    }
}

impl std::error::Error for ParseProviderTypeError {}

impl std::str::FromStr for ProviderType {
    type Err = ParseProviderTypeError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "anthropic" | "claude" => Ok(Self::Anthropic),
            "openai" | "gpt" => Ok(Self::OpenAI),
            "ollama" => Ok(Self::Ollama),
            "openai-compatible" | "openai_compatible" => Ok(Self::OpenAICompatible),
            _ => Err(ParseProviderTypeError),
        }
    }
}

impl std::fmt::Display for ProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Anthropic => write!(f, "Anthropic"),
            Self::OpenAI => write!(f, "OpenAI"),
            Self::Ollama => write!(f, "Ollama"),
            Self::OpenAICompatible => write!(f, "OpenAI-Compatible"),
        }
    }
}

/// Create a provider instance from type and configuration.
///
/// # Arguments
///
/// * `provider_type` - The type of provider to create
/// * `config` - Configuration including API key, model, etc.
///
/// # Returns
///
/// A boxed provider instance ready for use.
///
/// # Errors
///
/// Returns an error if required configuration is missing (e.g., API key for Anthropic/OpenAI).
///
/// # Example
///
/// ```rust,ignore
/// // Create Anthropic provider
/// let config = ProviderConfig::new("your-key", "claude-sonnet-4-20250514");
/// let provider = create_provider(ProviderType::Anthropic, config)?;
///
/// // Create Ollama provider (no API key needed)
/// let config = ProviderConfig::default().with_model("llama3.2");
/// let provider = create_provider(ProviderType::Ollama, config)?;
/// ```
pub fn create_provider(
    provider_type: ProviderType,
    config: ProviderConfig,
) -> Result<BoxedProvider, ProviderError> {
    match provider_type {
        ProviderType::Anthropic => {
            let api_key = config
                .api_key
                .clone()
                .ok_or_else(|| ProviderError::NotConfigured("API key required for Anthropic".to_string()))?;

            let model = config
                .model
                .clone()
                .unwrap_or_else(|| provider_type.default_model().to_string());

            let base_url = config
                .base_url
                .clone()
                .unwrap_or_else(|| provider_type.default_base_url().to_string());

            Ok(Box::new(AnthropicProvider::new(api_key, model, base_url, config)))
        }
        ProviderType::OpenAI => {
            let api_key = config
                .api_key
                .clone()
                .ok_or_else(|| ProviderError::NotConfigured("API key required for OpenAI".to_string()))?;

            let model = config
                .model
                .clone()
                .unwrap_or_else(|| provider_type.default_model().to_string());

            let base_url = config
                .base_url
                .clone()
                .unwrap_or_else(|| provider_type.default_base_url().to_string());

            Ok(Box::new(OpenAIProvider::new(Some(api_key), model, base_url, config)))
        }
        ProviderType::Ollama => {
            let model = config
                .model
                .clone()
                .unwrap_or_else(|| provider_type.default_model().to_string());

            let base_url = config
                .base_url
                .clone()
                .unwrap_or_else(|| provider_type.default_base_url().to_string());

            // Ollama doesn't need an API key
            Ok(Box::new(OpenAIProvider::new(None, model, base_url, config)))
        }
        ProviderType::OpenAICompatible => {
            let model = config
                .model
                .clone()
                .unwrap_or_else(|| provider_type.default_model().to_string());

            let base_url = config
                .base_url
                .clone()
                .ok_or_else(|| ProviderError::NotConfigured("base_url required for OpenAI-Compatible".to_string()))?;

            Ok(Box::new(OpenAIProvider::new(config.api_key.clone(), model, base_url, config)))
        }
    }
}

/// Create a provider from environment variables with smart defaults.
///
/// # Detection Order
///
/// 1. Check `CODI_PROVIDER` env var for explicit provider selection
/// 2. Check `ANTHROPIC_API_KEY` → use Anthropic
/// 3. Check `OPENAI_API_KEY` → use OpenAI
/// 4. Check if Ollama is running at localhost:11434 → use Ollama
/// 5. Default to Anthropic (will fail if no API key)
///
/// # Environment Variables
///
/// | Variable | Description |
/// |----------|-------------|
/// | `CODI_PROVIDER` | Override provider: `anthropic`, `openai`, `ollama` |
/// | `CODI_MODEL` | Override default model |
/// | `ANTHROPIC_API_KEY` | Anthropic API key |
/// | `ANTHROPIC_BASE_URL` | Custom Anthropic base URL |
/// | `OPENAI_API_KEY` | OpenAI API key |
/// | `OPENAI_BASE_URL` | Custom OpenAI base URL |
/// | `OLLAMA_BASE_URL` | Custom Ollama URL (default: localhost:11434) |
///
/// # Example
///
/// ```bash
/// # Just set an API key and go
/// export ANTHROPIC_API_KEY=sk-ant-...
/// ```
///
/// ```rust,ignore
/// let provider = create_provider_from_env()?;
/// ```
pub fn create_provider_from_env() -> Result<BoxedProvider, ProviderError> {
    // Check for explicit provider override
    let provider_type = if let Ok(p) = std::env::var("CODI_PROVIDER") {
        p.parse().ok()
    } else {
        None
    };

    // Auto-detect if not explicitly set
    let provider_type = provider_type.unwrap_or_else(|| {
        if std::env::var("ANTHROPIC_API_KEY").is_ok() {
            ProviderType::Anthropic
        } else if std::env::var("OPENAI_API_KEY").is_ok() {
            ProviderType::OpenAI
        } else {
            // Default to Ollama for local-first experience
            // (will work if Ollama is running, fail gracefully if not)
            ProviderType::Ollama
        }
    });

    let config = match provider_type {
        ProviderType::Anthropic => {
            let api_key = std::env::var("ANTHROPIC_API_KEY")
                .map_err(|_| ProviderError::NotConfigured(
                    "ANTHROPIC_API_KEY not set. Set it or use CODI_PROVIDER=ollama for local models.".to_string()
                ))?;

            let model = std::env::var("CODI_MODEL")
                .unwrap_or_else(|_| provider_type.default_model().to_string());

            let base_url = std::env::var("ANTHROPIC_BASE_URL")
                .unwrap_or_else(|_| provider_type.default_base_url().to_string());

            ProviderConfig {
                api_key: Some(api_key),
                model: Some(model),
                base_url: Some(base_url),
                ..Default::default()
            }
        }
        ProviderType::OpenAI => {
            let api_key = std::env::var("OPENAI_API_KEY")
                .map_err(|_| ProviderError::NotConfigured(
                    "OPENAI_API_KEY not set. Set it or use CODI_PROVIDER=ollama for local models.".to_string()
                ))?;

            let model = std::env::var("CODI_MODEL")
                .unwrap_or_else(|_| provider_type.default_model().to_string());

            let base_url = std::env::var("OPENAI_BASE_URL")
                .unwrap_or_else(|_| provider_type.default_base_url().to_string());

            ProviderConfig {
                api_key: Some(api_key),
                model: Some(model),
                base_url: Some(base_url),
                ..Default::default()
            }
        }
        ProviderType::Ollama => {
            let model = std::env::var("CODI_MODEL")
                .unwrap_or_else(|_| provider_type.default_model().to_string());

            let base_url = std::env::var("OLLAMA_BASE_URL")
                .unwrap_or_else(|_| provider_type.default_base_url().to_string());

            ProviderConfig {
                api_key: None,
                model: Some(model),
                base_url: Some(base_url),
                ..Default::default()
            }
        }
        ProviderType::OpenAICompatible => {
            let api_key = std::env::var("OPENAI_API_KEY").ok();
            let model = std::env::var("CODI_MODEL")
                .unwrap_or_else(|_| provider_type.default_model().to_string());
            let base_url = std::env::var("OPENAI_BASE_URL")
                .map_err(|_| ProviderError::NotConfigured(
                    "OPENAI_BASE_URL required for OpenAI-Compatible provider".to_string()
                ))?;

            ProviderConfig {
                api_key,
                model: Some(model),
                base_url: Some(base_url),
                ..Default::default()
            }
        }
    };

    create_provider(provider_type, config)
}

/// Convenience function to create an Anthropic provider.
///
/// # Example
///
/// ```rust,ignore
/// let provider = anthropic("your-key", "claude-sonnet-4-20250514")?;
/// ```
pub fn anthropic(api_key: impl Into<String>, model: impl Into<String>) -> Result<BoxedProvider, ProviderError> {
    let config = ProviderConfig::new(api_key, model);
    create_provider(ProviderType::Anthropic, config)
}

/// Convenience function to create an OpenAI provider.
///
/// # Example
///
/// ```rust,ignore
/// let provider = openai("your-key", "gpt-4o")?;
/// ```
pub fn openai(api_key: impl Into<String>, model: impl Into<String>) -> Result<BoxedProvider, ProviderError> {
    let config = ProviderConfig::new(api_key, model);
    create_provider(ProviderType::OpenAI, config)
}

/// Convenience function to create an Ollama provider.
///
/// No API key needed - just have Ollama running locally.
///
/// # Example
///
/// ```rust,ignore
/// let provider = ollama("llama3.2")?;
/// ```
pub fn ollama(model: impl Into<String>) -> Result<BoxedProvider, ProviderError> {
    let config = ProviderConfig {
        model: Some(model.into()),
        ..Default::default()
    };
    create_provider(ProviderType::Ollama, config)
}

/// Convenience function to create an Ollama provider with custom URL.
///
/// # Example
///
/// ```rust,ignore
/// let provider = ollama_at("http://my-server:11434/v1", "llama3.2")?;
/// ```
pub fn ollama_at(base_url: impl Into<String>, model: impl Into<String>) -> Result<BoxedProvider, ProviderError> {
    let config = ProviderConfig {
        model: Some(model.into()),
        base_url: Some(base_url.into()),
        ..Default::default()
    };
    create_provider(ProviderType::Ollama, config)
}

/// Create a provider from a resolved configuration.
///
/// This is the main entry point for creating providers from CLI/config file settings.
///
/// # Example
///
/// ```rust,ignore
/// let config = codi::config::resolve_config(&cli_options)?;
/// let provider = create_provider_from_config(&config)?;
/// ```
pub fn create_provider_from_config(config: &ResolvedConfig) -> Result<BoxedProvider, ProviderError> {
    let provider_type: ProviderType = config.provider.parse().map_err(|_| {
        ProviderError::NotConfigured(format!("Unknown provider: {}", config.provider))
    })?;

    let mut provider_config = ProviderConfig::default();
    provider_config.model = config.model.clone();
    provider_config.base_url = config.base_url.clone();

    // Get API key from environment based on provider type
    match provider_type {
        ProviderType::Anthropic => {
            provider_config.api_key = std::env::var("ANTHROPIC_API_KEY").ok();
        }
        ProviderType::OpenAI => {
            provider_config.api_key = std::env::var("OPENAI_API_KEY").ok();
        }
        ProviderType::Ollama | ProviderType::OpenAICompatible => {
            // These don't require API keys (or use env vars differently)
        }
    }

    create_provider(provider_type, provider_config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_type_from_str() {
        assert_eq!("anthropic".parse::<ProviderType>(), Ok(ProviderType::Anthropic));
        assert_eq!("claude".parse::<ProviderType>(), Ok(ProviderType::Anthropic));
        assert_eq!("ANTHROPIC".parse::<ProviderType>(), Ok(ProviderType::Anthropic));
        assert_eq!("openai".parse::<ProviderType>(), Ok(ProviderType::OpenAI));
        assert_eq!("gpt".parse::<ProviderType>(), Ok(ProviderType::OpenAI));
        assert_eq!("ollama".parse::<ProviderType>(), Ok(ProviderType::Ollama));
        assert!("invalid".parse::<ProviderType>().is_err());
    }

    #[test]
    fn test_provider_type_default_model() {
        assert_eq!(ProviderType::Anthropic.default_model(), "claude-sonnet-4-20250514");
        assert_eq!(ProviderType::OpenAI.default_model(), "gpt-4o");
        assert_eq!(ProviderType::Ollama.default_model(), "llama3.2");
    }

    #[test]
    fn test_provider_type_requires_api_key() {
        assert!(ProviderType::Anthropic.requires_api_key());
        assert!(ProviderType::OpenAI.requires_api_key());
        assert!(!ProviderType::Ollama.requires_api_key());
    }

    #[test]
    fn test_create_provider_anthropic_missing_key() {
        let config = ProviderConfig::default();
        let result = create_provider(ProviderType::Anthropic, config);
        assert!(result.is_err());
        match result {
            Err(ProviderError::NotConfigured(_)) => {}
            _ => panic!("Expected NotConfigured error"),
        }
    }

    #[test]
    fn test_create_provider_anthropic() {
        let config = ProviderConfig::new("test-key", "claude-sonnet-4-20250514");
        let result = create_provider(ProviderType::Anthropic, config);
        assert!(result.is_ok());

        let provider = result.unwrap();
        assert_eq!(provider.name(), "Anthropic");
        assert_eq!(provider.model(), "claude-sonnet-4-20250514");
    }

    #[test]
    fn test_create_provider_openai() {
        let config = ProviderConfig::new("test-key", "gpt-4o");
        let result = create_provider(ProviderType::OpenAI, config);
        assert!(result.is_ok());

        let provider = result.unwrap();
        assert_eq!(provider.name(), "OpenAI");
        assert_eq!(provider.model(), "gpt-4o");
    }

    #[test]
    fn test_create_provider_ollama() {
        let config = ProviderConfig {
            model: Some("llama3.2".to_string()),
            ..Default::default()
        };
        let result = create_provider(ProviderType::Ollama, config);
        assert!(result.is_ok());

        let provider = result.unwrap();
        assert_eq!(provider.name(), "Ollama");
        assert_eq!(provider.model(), "llama3.2");
    }

    #[test]
    fn test_convenience_functions() {
        // These should all succeed
        assert!(anthropic("key", "claude-sonnet-4-20250514").is_ok());
        assert!(openai("key", "gpt-4o").is_ok());
        assert!(ollama("llama3.2").is_ok());
        assert!(ollama_at("http://localhost:11434/v1", "llama3.2").is_ok());
    }
}
