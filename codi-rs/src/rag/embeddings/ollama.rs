// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Ollama embedding provider.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use crate::error::ToolError;
use crate::rag::types::EmbeddingVector;

#[cfg(feature = "telemetry")]
use crate::telemetry::metrics::GLOBAL_METRICS;

use super::base::EmbeddingProvider;
use super::cache::EmbeddingCache;

/// Ollama embedding request.
#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    prompt: String,
}

/// Ollama embedding response.
#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    embedding: Vec<f32>,
}

/// Ollama tags response (for model listing).
#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    name: String,
}

/// Ollama embedding provider.
pub struct OllamaEmbeddingProvider {
    client: Client,
    model: String,
    base_url: String,
    dimensions: AtomicUsize,
    cache: Arc<EmbeddingCache>,
    /// Semaphore to limit concurrent requests.
    request_semaphore: Arc<Semaphore>,
}

impl OllamaEmbeddingProvider {
    /// Default embedding dimensions (will be detected on first request).
    const DEFAULT_DIMENSIONS: usize = 768;

    /// Max concurrent requests to Ollama.
    const MAX_CONCURRENT_REQUESTS: usize = 5;

    /// Create a new Ollama embedding provider.
    pub fn new(model: &str, base_url: Option<&str>) -> Self {
        let base_url = base_url
            .unwrap_or("http://localhost:11434")
            .trim_end_matches('/');

        // Known dimensions for common models
        let dimensions = match model {
            "nomic-embed-text" => 768,
            "mxbai-embed-large" => 1024,
            "all-minilm" => 384,
            "snowflake-arctic-embed" => 1024,
            _ => Self::DEFAULT_DIMENSIONS,
        };

        Self {
            client: Client::new(),
            model: model.to_string(),
            base_url: base_url.to_string(),
            dimensions: AtomicUsize::new(dimensions),
            cache: Arc::new(EmbeddingCache::new()),
            request_semaphore: Arc::new(Semaphore::new(Self::MAX_CONCURRENT_REQUESTS)),
        }
    }

    /// Make API request for a single embedding.
    async fn request_embedding(&self, text: &str) -> Result<EmbeddingVector, ToolError> {
        let start = Instant::now();

        // Acquire semaphore permit to limit concurrency
        let _permit = self.request_semaphore.acquire().await.map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to acquire request permit: {}", e))
        })?;

        let request = EmbeddingRequest {
            model: self.model.clone(),
            prompt: text.to_string(),
        };

        let response = self
            .client
            .post(format!("{}/api/embeddings", self.base_url))
            .json(&request)
            .send()
            .await
            .map_err(|e| ToolError::ExecutionFailed(format!("Ollama API request failed: {}", e)))?;

        let status = response.status();
        let body = response.text().await.map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to read response body: {}", e))
        })?;

        if !status.is_success() {
            return Err(ToolError::ExecutionFailed(format!(
                "Ollama API error ({}): {}",
                status, body
            )));
        }

        let embedding_response: EmbeddingResponse = serde_json::from_str(&body).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to parse embedding response: {}", e))
        })?;

        // Update dimensions if different from expected
        let actual_dimensions = embedding_response.embedding.len();
        let stored_dimensions = self.dimensions.load(Ordering::SeqCst);
        if actual_dimensions != stored_dimensions && actual_dimensions > 0 {
            self.dimensions.store(actual_dimensions, Ordering::SeqCst);
        }

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.embeddings.ollama.request", start.elapsed());

        Ok(EmbeddingVector::new(embedding_response.embedding))
    }

    /// Check if the model is available.
    async fn check_model_available(&self) -> bool {
        let response = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.text().await {
                    if let Ok(tags) = serde_json::from_str::<TagsResponse>(&body) {
                        return tags.models.iter().any(|m| {
                            // Model name might have :latest suffix
                            m.name == self.model || m.name.starts_with(&format!("{}:", self.model))
                        });
                    }
                }
                // API responded but couldn't parse - assume available
                true
            }
            Ok(_) => false,
            Err(_) => false,
        }
    }
}

#[async_trait]
impl EmbeddingProvider for OllamaEmbeddingProvider {
    fn name(&self) -> &str {
        "Ollama"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn dimensions(&self) -> usize {
        self.dimensions.load(Ordering::SeqCst)
    }

    async fn embed(&self, texts: &[String]) -> Result<Vec<EmbeddingVector>, ToolError> {
        let start = Instant::now();

        if texts.is_empty() {
            return Ok(Vec::new());
        }

        // Check cache for each text
        let mut results: Vec<Option<EmbeddingVector>> = vec![None; texts.len()];
        let mut uncached: Vec<(usize, String)> = Vec::new();

        for (i, text) in texts.iter().enumerate() {
            let cache_key = EmbeddingCache::make_key(self.name(), &self.model, text);
            if let Some(cached) = self.cache.get(&cache_key) {
                results[i] = Some(cached);
            } else {
                uncached.push((i, text.clone()));
            }
        }

        // Request embeddings for uncached texts (limited concurrency)
        if !uncached.is_empty() {
            // Process in parallel with semaphore-controlled concurrency
            let mut handles = Vec::new();

            for (original_idx, text) in uncached {
                let provider_clone = OllamaEmbeddingProvider {
                    client: self.client.clone(),
                    model: self.model.clone(),
                    base_url: self.base_url.clone(),
                    dimensions: AtomicUsize::new(self.dimensions.load(Ordering::SeqCst)),
                    cache: self.cache.clone(),
                    request_semaphore: self.request_semaphore.clone(),
                };
                let text_clone = text.clone();

                let handle = tokio::spawn(async move {
                    let result = provider_clone.request_embedding(&text_clone).await;
                    (original_idx, text_clone, result)
                });

                handles.push(handle);
            }

            // Collect results
            for handle in handles {
                match handle.await {
                    Ok((idx, text, Ok(embedding))) => {
                        // Cache the result
                        let cache_key = EmbeddingCache::make_key(self.name(), &self.model, &text);
                        self.cache.put(cache_key, embedding.clone());
                        results[idx] = Some(embedding);
                    }
                    Ok((idx, _, Err(e))) => {
                        tracing::warn!("Failed to get embedding for index {}: {}", idx, e);
                        // Return zero vector as fallback
                        results[idx] = Some(EmbeddingVector::new(vec![
                            0.0;
                            self.dimensions.load(Ordering::SeqCst)
                        ]));
                    }
                    Err(e) => {
                        tracing::warn!("Task failed: {}", e);
                    }
                }
            }
        }

        // Convert to final results
        let dimensions = self.dimensions.load(Ordering::SeqCst);
        let embeddings: Vec<EmbeddingVector> = results
            .into_iter()
            .enumerate()
            .map(|(i, opt)| {
                opt.unwrap_or_else(|| {
                    tracing::warn!("Missing embedding for text at index {}", i);
                    EmbeddingVector::new(vec![0.0; dimensions])
                })
            })
            .collect();

        #[cfg(feature = "telemetry")]
        GLOBAL_METRICS.record_operation("rag.embeddings.ollama.embed", start.elapsed());

        Ok(embeddings)
    }

    async fn is_available(&self) -> bool {
        self.check_model_available().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_model_dimensions() {
        let nomic = OllamaEmbeddingProvider::new("nomic-embed-text", None);
        assert_eq!(nomic.dimensions(), 768);

        let mxbai = OllamaEmbeddingProvider::new("mxbai-embed-large", None);
        assert_eq!(mxbai.dimensions(), 1024);

        let minilm = OllamaEmbeddingProvider::new("all-minilm", None);
        assert_eq!(minilm.dimensions(), 384);
    }

    #[test]
    fn test_unknown_model_default_dimensions() {
        let unknown = OllamaEmbeddingProvider::new("unknown-model", None);
        assert_eq!(unknown.dimensions(), OllamaEmbeddingProvider::DEFAULT_DIMENSIONS);
    }

    #[test]
    fn test_custom_base_url() {
        let provider = OllamaEmbeddingProvider::new("test", Some("http://custom:8080/"));
        assert_eq!(provider.base_url, "http://custom:8080");
    }
}
