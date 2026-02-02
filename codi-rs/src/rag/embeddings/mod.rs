// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Embedding providers for the RAG system.
//!
//! Provides abstraction over different embedding APIs (OpenAI, Ollama, etc.).

mod base;
mod cache;
mod ollama;
mod openai;

use std::sync::Arc;

pub use base::EmbeddingProvider;
pub use cache::EmbeddingCache;
pub use ollama::OllamaEmbeddingProvider;
pub use openai::OpenAIEmbeddingProvider;

use crate::error::ToolError;
use crate::rag::types::{EmbeddingProviderType, RAGConfig};

/// Create an embedding provider based on configuration.
pub async fn create_embedding_provider(
    config: &RAGConfig,
) -> Result<Arc<dyn EmbeddingProvider>, ToolError> {
    match config.embedding_provider {
        EmbeddingProviderType::OpenAI => {
            let provider = OpenAIEmbeddingProvider::new(
                &config.openai_model,
                None, // Use env var
            )?;
            Ok(Arc::new(provider))
        }
        EmbeddingProviderType::Ollama => {
            let provider = OllamaEmbeddingProvider::new(
                &config.ollama_model,
                Some(&config.ollama_base_url),
            );
            Ok(Arc::new(provider))
        }
        EmbeddingProviderType::Auto => {
            // Try to detect available provider
            detect_and_create_provider(config).await
        }
        EmbeddingProviderType::ModelMap => {
            // TODO: Integrate with model map
            // For now, fall back to auto-detection
            detect_and_create_provider(config).await
        }
    }
}

/// Detect available providers and create the best one.
pub async fn detect_and_create_provider(
    config: &RAGConfig,
) -> Result<Arc<dyn EmbeddingProvider>, ToolError> {
    // Try OpenAI first if API key is available
    if std::env::var("OPENAI_API_KEY").is_ok() {
        let provider = OpenAIEmbeddingProvider::new(&config.openai_model, None)?;
        if provider.is_available().await {
            return Ok(Arc::new(provider));
        }
    }

    // Fall back to Ollama (free, local)
    let provider = OllamaEmbeddingProvider::new(
        &config.ollama_model,
        Some(&config.ollama_base_url),
    );
    if provider.is_available().await {
        return Ok(Arc::new(provider));
    }

    Err(ToolError::ExecutionFailed(
        "No embedding provider available. Set OPENAI_API_KEY or run Ollama locally.".to_string(),
    ))
}

/// Detect which providers are available.
pub async fn detect_available_providers(config: &RAGConfig) -> Vec<EmbeddingProviderType> {
    let mut available = Vec::new();

    // Check OpenAI
    if std::env::var("OPENAI_API_KEY").is_ok() {
        if let Ok(provider) = OpenAIEmbeddingProvider::new(&config.openai_model, None) {
            if provider.is_available().await {
                available.push(EmbeddingProviderType::OpenAI);
            }
        }
    }

    // Check Ollama
    let ollama = OllamaEmbeddingProvider::new(
        &config.ollama_model,
        Some(&config.ollama_base_url),
    );
    if ollama.is_available().await {
        available.push(EmbeddingProviderType::Ollama);
    }

    available
}
