// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Base trait for embedding providers.

use async_trait::async_trait;

use crate::error::ToolError;
use crate::rag::types::{EmbeddingModelInfo, EmbeddingVector};

/// Trait for embedding providers.
#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    /// Get the provider name.
    fn name(&self) -> &str;

    /// Get the model name.
    fn model(&self) -> &str;

    /// Get the embedding dimensions.
    fn dimensions(&self) -> usize;

    /// Generate embeddings for multiple texts.
    async fn embed(&self, texts: &[String]) -> Result<Vec<EmbeddingVector>, ToolError>;

    /// Generate embedding for a single text.
    async fn embed_one(&self, text: &str) -> Result<EmbeddingVector, ToolError> {
        let results = self.embed(&[text.to_string()]).await?;
        results.into_iter().next().ok_or_else(|| {
            ToolError::ExecutionFailed("No embedding returned".to_string())
        })
    }

    /// Check if the provider is available.
    async fn is_available(&self) -> bool;

    /// Get model information.
    fn model_info(&self) -> EmbeddingModelInfo {
        EmbeddingModelInfo {
            provider: self.name().to_string(),
            model: self.model().to_string(),
            dimensions: self.dimensions(),
            max_tokens: None,
        }
    }
}
