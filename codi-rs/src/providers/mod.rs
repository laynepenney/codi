// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! AI Provider implementations for Codi.
//!
//! This module provides implementations of the [`Provider`] trait for various
//! AI model backends:
//!
//! - [`anthropic::AnthropicProvider`] - Claude models via Anthropic API
//!
//! # Architecture
//!
//! Providers are the bridge between Codi's internal types and external AI APIs.
//! Each provider handles:
//!
//! - API authentication and request formatting
//! - Streaming response parsing
//! - Tool call extraction and formatting
//! - Token usage tracking
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::providers::{create_provider, ProviderType};
//! use codi::types::ProviderConfig;
//!
//! let config = ProviderConfig::new("your-api-key", "claude-sonnet-4-20250514");
//! let provider = create_provider(ProviderType::Anthropic, config)?;
//!
//! let response = provider.chat(&messages, Some(&tools), None).await?;
//! ```

pub mod anthropic;

pub use anthropic::AnthropicProvider;

use crate::error::ProviderError;
use crate::types::{BoxedProvider, ProviderConfig};

/// Supported provider types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderType {
    /// Anthropic Claude models
    Anthropic,
    /// OpenAI GPT models (planned)
    OpenAI,
    /// Ollama local models (planned)
    Ollama,
    /// RunPod serverless (planned)
    RunPod,
}

impl ProviderType {
    /// Get the default model for this provider.
    pub fn default_model(&self) -> &'static str {
        match self {
            Self::Anthropic => "claude-sonnet-4-20250514",
            Self::OpenAI => "gpt-4o",
            Self::Ollama => "llama3.2",
            Self::RunPod => "llama3.2",
        }
    }

    /// Get the default base URL for this provider.
    pub fn default_base_url(&self) -> &'static str {
        match self {
            Self::Anthropic => "https://api.anthropic.com",
            Self::OpenAI => "https://api.openai.com/v1",
            Self::Ollama => "http://localhost:11434",
            Self::RunPod => "https://api.runpod.ai/v2",
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
            "runpod" => Ok(Self::RunPod),
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
            Self::RunPod => write!(f, "RunPod"),
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
/// Returns an error if:
/// - Required configuration is missing (e.g., API key)
/// - The provider type is not yet implemented
pub fn create_provider(
    provider_type: ProviderType,
    config: ProviderConfig,
) -> Result<BoxedProvider, ProviderError> {
    match provider_type {
        ProviderType::Anthropic => {
            let api_key = config
                .api_key
                .clone()
                .ok_or_else(|| ProviderError::NotConfigured("API key required".to_string()))?;

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
            Err(ProviderError::UnsupportedOperation(
                "OpenAI provider not yet implemented".to_string(),
            ))
        }
        ProviderType::Ollama => {
            Err(ProviderError::UnsupportedOperation(
                "Ollama provider not yet implemented".to_string(),
            ))
        }
        ProviderType::RunPod => {
            Err(ProviderError::UnsupportedOperation(
                "RunPod provider not yet implemented".to_string(),
            ))
        }
    }
}

/// Create a provider from environment variables.
///
/// Looks for:
/// - `ANTHROPIC_API_KEY` for Anthropic
/// - `OPENAI_API_KEY` for OpenAI
/// - `CODI_PROVIDER` to override default provider
/// - `CODI_MODEL` to override default model
pub fn create_provider_from_env() -> Result<BoxedProvider, ProviderError> {
    // Check for explicit provider override
    let provider_type = std::env::var("CODI_PROVIDER")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            // Auto-detect based on available API keys
            if std::env::var("ANTHROPIC_API_KEY").is_ok() {
                ProviderType::Anthropic
            } else if std::env::var("OPENAI_API_KEY").is_ok() {
                ProviderType::OpenAI
            } else {
                ProviderType::Anthropic // Default
            }
        });

    let config = match provider_type {
        ProviderType::Anthropic => {
            let api_key = std::env::var("ANTHROPIC_API_KEY")
                .map_err(|_| ProviderError::NotConfigured("ANTHROPIC_API_KEY not set".to_string()))?;

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
        _ => {
            return Err(ProviderError::NotConfigured(format!(
                "{} provider not yet implemented",
                provider_type
            )));
        }
    };

    create_provider(provider_type, config)
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
        assert_eq!("runpod".parse::<ProviderType>(), Ok(ProviderType::RunPod));
        assert!("invalid".parse::<ProviderType>().is_err());
    }

    #[test]
    fn test_provider_type_default_model() {
        assert_eq!(ProviderType::Anthropic.default_model(), "claude-sonnet-4-20250514");
        assert_eq!(ProviderType::OpenAI.default_model(), "gpt-4o");
    }

    #[test]
    fn test_create_provider_missing_api_key() {
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
    fn test_create_provider_openai_not_implemented() {
        let config = ProviderConfig::new("test-key", "gpt-4o");
        let result = create_provider(ProviderType::OpenAI, config);
        assert!(result.is_err());
        match result {
            Err(ProviderError::UnsupportedOperation(_)) => {}
            _ => panic!("Expected UnsupportedOperation error"),
        }
    }
}
