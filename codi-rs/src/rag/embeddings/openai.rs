// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! OpenAI embedding provider.

use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::ToolError;
use crate::rag::types::EmbeddingVector;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::base::EmbeddingProvider;
use super::cache::EmbeddingCache;

/// OpenAI embedding request.
#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: Vec<String>,
}

/// OpenAI embedding response.
#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
    usage: Option<EmbeddingUsage>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
    index: usize,
}

#[derive(Debug, Deserialize)]
struct EmbeddingUsage {
    prompt_tokens: u32,
    total_tokens: u32,
}

/// OpenAI error response.
#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    message: String,
    #[serde(rename = "type")]
    error_type: Option<String>,
}

/// OpenAI embedding provider.
pub struct OpenAIEmbeddingProvider {
    client: Client,
    api_key: String,
    model: String,
    base_url: String,
    dimensions: usize,
    cache: Arc<EmbeddingCache>,
}

impl OpenAIEmbeddingProvider {
    /// Create a new OpenAI embedding provider.
    pub fn new(model: &str, api_key: Option<&str>) -> Result<Self, ToolError> {
        let api_key = match api_key {
            Some(key) => key.to_string(),
            None => std::env::var("OPENAI_API_KEY").map_err(|_| {
                ToolError::InvalidInput("OPENAI_API_KEY environment variable not set".to_string())
            })?,
        };

        let dimensions = match model {
            "text-embedding-3-small" => 1536,
            "text-embedding-3-large" => 3072,
            "text-embedding-ada-002" => 1536,
            _ => 1536, // Default
        };

        Ok(Self {
            client: Client::new(),
            api_key,
            model: model.to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            dimensions,
            cache: Arc::new(EmbeddingCache::new()),
        })
    }

    /// Create with custom base URL (for Azure or proxies).
    pub fn with_base_url(model: &str, api_key: &str, base_url: &str) -> Self {
        let dimensions = match model {
            "text-embedding-3-small" => 1536,
            "text-embedding-3-large" => 3072,
            "text-embedding-ada-002" => 1536,
            _ => 1536,
        };

        Self {
            client: Client::new(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            base_url: base_url.to_string(),
            dimensions,
            cache: Arc::new(EmbeddingCache::new()),
        }
    }

    /// Make API request for embeddings.
    async fn request_embeddings(&self, texts: &[String]) -> Result<Vec<EmbeddingVector>, ToolError> {
        let start = Instant::now();

        let request = EmbeddingRequest {
            model: self.model.clone(),
            input: texts.to_vec(),
        };

        let response = self
            .client
            .post(format!("{}/embeddings", self.base_url))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| ToolError::ExecutionFailed(format!("OpenAI API request failed: {}", e)))?;

        let status = response.status();
        let body = response.text().await.map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to read response body: {}", e))
        })?;

        if !status.is_success() {
            // Try to parse error response
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&body) {
                return Err(ToolError::ExecutionFailed(format!(
                    "OpenAI API error: {}",
                    error_response.error.message
                )));
            }
            return Err(ToolError::ExecutionFailed(format!(
                "OpenAI API error ({}): {}",
                status, body
            )));
        }

        let embedding_response: EmbeddingResponse = serde_json::from_str(&body).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to parse embedding response: {}", e))
        })?;

        // Sort by index to maintain order
        let mut sorted_data = embedding_response.data;
        sorted_data.sort_by_key(|d| d.index);

        let embeddings: Vec<EmbeddingVector> = sorted_data
            .into_iter()
            .map(|d| EmbeddingVector::new(d.embedding))
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.embeddings.openai.request", start.elapsed());

        Ok(embeddings)
    }
}

#[async_trait]
impl EmbeddingProvider for OpenAIEmbeddingProvider {
    fn name(&self) -> &str {
        "OpenAI"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }

    async fn embed(&self, texts: &[String]) -> Result<Vec<EmbeddingVector>, ToolError> {
        let start = Instant::now();

        if texts.is_empty() {
            return Ok(Vec::new());
        }

        // Check cache for each text
        let mut results: Vec<Option<EmbeddingVector>> = vec![None; texts.len()];
        let mut uncached_indices: Vec<usize> = Vec::new();
        let mut uncached_texts: Vec<String> = Vec::new();

        for (i, text) in texts.iter().enumerate() {
            let cache_key = EmbeddingCache::make_key(self.name(), &self.model, text);
            if let Some(cached) = self.cache.get(&cache_key) {
                results[i] = Some(cached);
            } else {
                uncached_indices.push(i);
                uncached_texts.push(text.clone());
            }
        }

        // Request embeddings for uncached texts
        if !uncached_texts.is_empty() {
            // Batch requests (OpenAI limit is ~8000 tokens per batch)
            const BATCH_SIZE: usize = 100;
            let mut batch_results: Vec<EmbeddingVector> = Vec::new();

            for chunk in uncached_texts.chunks(BATCH_SIZE) {
                let batch_embeddings = self.request_embeddings(&chunk.to_vec()).await?;
                batch_results.extend(batch_embeddings);
            }

            // Cache and assign results
            for (batch_idx, original_idx) in uncached_indices.iter().enumerate() {
                if let Some(embedding) = batch_results.get(batch_idx) {
                    // Cache the result
                    let cache_key = EmbeddingCache::make_key(
                        self.name(),
                        &self.model,
                        &uncached_texts[batch_idx],
                    );
                    self.cache.put(cache_key, embedding.clone());
                    results[*original_idx] = Some(embedding.clone());
                }
            }
        }

        // Convert to final results
        let embeddings: Vec<EmbeddingVector> = results
            .into_iter()
            .enumerate()
            .map(|(i, opt)| {
                opt.unwrap_or_else(|| {
                    tracing::warn!("Missing embedding for text at index {}", i);
                    EmbeddingVector::new(vec![0.0; self.dimensions])
                })
            })
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.embeddings.openai.embed", start.elapsed());

        Ok(embeddings)
    }

    async fn is_available(&self) -> bool {
        // Try a simple embedding request to verify the API key works
        let test_result = self.request_embeddings(&["test".to_string()]).await;
        test_result.is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dimensions_by_model() {
        let small = OpenAIEmbeddingProvider::new("text-embedding-3-small", Some("test-key"));
        assert!(small.is_ok());
        assert_eq!(small.unwrap().dimensions(), 1536);

        let large = OpenAIEmbeddingProvider::new("text-embedding-3-large", Some("test-key"));
        assert!(large.is_ok());
        assert_eq!(large.unwrap().dimensions(), 3072);
    }

    #[test]
    fn test_missing_api_key() {
        // Temporarily remove env var if set
        let old_key = std::env::var("OPENAI_API_KEY").ok();
        // SAFETY: This is a test that needs to modify env vars temporarily
        unsafe {
            std::env::remove_var("OPENAI_API_KEY");
        }

        let result = OpenAIEmbeddingProvider::new("text-embedding-3-small", None);
        assert!(result.is_err());

        // Restore env var if it was set
        if let Some(key) = old_key {
            // SAFETY: Restoring the original env var
            unsafe {
                std::env::set_var("OPENAI_API_KEY", key);
            }
        }
    }
}
