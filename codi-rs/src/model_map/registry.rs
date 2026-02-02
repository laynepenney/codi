// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Model Registry for provider pool management.
//!
//! Provides lazy provider instantiation with connection pooling
//! for efficient multi-model orchestration.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::providers::{create_provider, ProviderType};
use crate::types::{BoxedProvider, ProviderConfig};

use super::config::{ModelMapConfig, ModelMapError};
use super::types::{ModelDefinition, PoolStats, PooledProviderStats, ResolvedModel};

// ============================================================================
// Constants
// ============================================================================

/// Default maximum pool size
const DEFAULT_MAX_POOL_SIZE: usize = 5;

/// Default idle timeout (5 minutes)
const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

// ============================================================================
// Pool Entry
// ============================================================================

/// Pooled provider entry with usage tracking.
struct PooledProvider {
    #[allow(dead_code)]
    provider: BoxedProvider,
    model_name: String,
    last_used: Instant,
    use_count: u64,
}

// ============================================================================
// Registry Options
// ============================================================================

/// Configuration options for the model registry.
#[derive(Debug, Clone)]
pub struct RegistryOptions {
    /// Maximum number of providers to keep in pool
    pub max_pool_size: usize,

    /// Duration before idle providers are removed
    pub idle_timeout: Duration,
}

impl Default for RegistryOptions {
    fn default() -> Self {
        Self {
            max_pool_size: DEFAULT_MAX_POOL_SIZE,
            idle_timeout: DEFAULT_IDLE_TIMEOUT,
        }
    }
}

// ============================================================================
// Model Registry
// ============================================================================

/// Model Registry for managing provider instances.
///
/// Features:
/// - Lazy provider instantiation (created on first use)
/// - Connection pooling with configurable size
/// - Automatic cleanup of idle connections
/// - Fallback chain support
///
/// # Example
///
/// ```rust,ignore
/// use codi::model_map::{ModelRegistry, load_model_map};
///
/// let result = load_model_map(Path::new("."));
/// if let Some(config) = result.config {
///     let registry = ModelRegistry::new(config);
///     let provider = registry.get_provider("haiku").await?;
/// }
/// ```
pub struct ModelRegistry {
    config: RwLock<ModelMapConfig>,
    pool: RwLock<HashMap<String, PooledProvider>>,
    options: RegistryOptions,
}

impl ModelRegistry {
    /// Create a new model registry.
    pub fn new(config: ModelMapConfig) -> Self {
        Self::with_options(config, RegistryOptions::default())
    }

    /// Create a new model registry with custom options.
    pub fn with_options(config: ModelMapConfig, options: RegistryOptions) -> Self {
        Self {
            config: RwLock::new(config),
            pool: RwLock::new(HashMap::new()),
            options,
        }
    }

    /// Get a provider for a named model.
    ///
    /// Creates the provider lazily if not in pool.
    pub async fn get_provider(&self, model_name: &str) -> Result<BoxedProvider, ModelMapError> {
        // Check pool first
        {
            let mut pool = self.pool.write().await;
            if let Some(pooled) = pool.get_mut(model_name) {
                pooled.last_used = Instant::now();
                pooled.use_count += 1;

                // Clone the provider configuration to create a new instance
                // (providers are not Clone, so we need to recreate)
                let config = self.config.read().await;
                let definition = config
                    .models
                    .get(model_name)
                    .ok_or_else(|| ModelMapError::ModelNotFound(model_name.to_string()))?;

                return self.create_provider_from_definition(model_name, definition);
            }
        }

        // Get model definition
        let config = self.config.read().await;
        let definition = config
            .models
            .get(model_name)
            .ok_or_else(|| ModelMapError::ModelNotFound(model_name.to_string()))?
            .clone();
        drop(config);

        // Create provider
        let provider = self.create_provider_from_definition(model_name, &definition)?;

        // Add to pool (evict if necessary)
        self.add_to_pool(model_name.to_string(), &definition).await;

        Ok(provider)
    }

    /// Get a provider with fallback chain.
    ///
    /// Tries each model in the chain until one succeeds.
    pub async fn get_provider_with_fallback(
        &self,
        chain_name: &str,
    ) -> Result<BoxedProvider, ModelMapError> {
        let config = self.config.read().await;
        let chain = config
            .fallbacks
            .get(chain_name)
            .ok_or_else(|| ModelMapError::FallbackChainNotFound(chain_name.to_string()))?
            .clone();
        drop(config);

        let mut last_error = None;

        for model_name in &chain {
            match self.get_provider(model_name).await {
                Ok(provider) => return Ok(provider),
                Err(e) => {
                    tracing::warn!("Fallback model {} failed: {}", model_name, e);
                    last_error = Some(e);
                }
            }
        }

        Err(ModelMapError::AllFallbacksFailed(format!(
            "{}: {:?}",
            chain_name,
            last_error
        )))
    }

    /// Resolve a model name to its full definition.
    pub async fn resolve_model(&self, model_name: &str) -> Result<ResolvedModel, ModelMapError> {
        let config = self.config.read().await;
        let definition = config
            .models
            .get(model_name)
            .ok_or_else(|| ModelMapError::ModelNotFound(model_name.to_string()))?
            .clone();

        Ok(ResolvedModel {
            name: model_name.to_string(),
            definition,
        })
    }

    /// Get all model names in the configuration.
    pub async fn get_model_names(&self) -> Vec<String> {
        let config = self.config.read().await;
        config.models.keys().cloned().collect()
    }

    /// Get model definition by name.
    pub async fn get_model_definition(&self, name: &str) -> Option<ModelDefinition> {
        let config = self.config.read().await;
        config.models.get(name).cloned()
    }

    /// Check if a model exists in the configuration.
    pub async fn has_model(&self, name: &str) -> bool {
        let config = self.config.read().await;
        config.models.contains_key(name)
    }

    /// Get pool statistics.
    pub async fn get_pool_stats(&self) -> PoolStats {
        let pool = self.pool.read().await;

        let providers: Vec<PooledProviderStats> = pool
            .values()
            .map(|p| PooledProviderStats {
                name: p.model_name.clone(),
                use_count: p.use_count,
                last_used: p.last_used,
            })
            .collect();

        PoolStats {
            size: pool.len(),
            max_size: self.options.max_pool_size,
            providers,
        }
    }

    /// Clear the provider pool.
    pub async fn clear_pool(&self) {
        let mut pool = self.pool.write().await;
        pool.clear();
    }

    /// Cleanup idle providers from the pool.
    pub async fn cleanup_idle(&self) {
        let mut pool = self.pool.write().await;
        let now = Instant::now();
        let timeout = self.options.idle_timeout;

        pool.retain(|name, entry| {
            let idle = now.duration_since(entry.last_used) < timeout;
            if !idle {
                tracing::debug!("Evicting idle provider: {}", name);
            }
            idle
        });
    }

    /// Update the configuration (for hot-reload).
    pub async fn update_config(&self, config: ModelMapConfig) {
        let mut cfg = self.config.write().await;
        *cfg = config;

        // Clear pool since models may have changed
        let mut pool = self.pool.write().await;
        pool.clear();
    }

    /// Get a reference to the current config.
    pub async fn config(&self) -> tokio::sync::RwLockReadGuard<'_, ModelMapConfig> {
        self.config.read().await
    }

    // --- Private methods ---

    fn create_provider_from_definition(
        &self,
        model_name: &str,
        definition: &ModelDefinition,
    ) -> Result<BoxedProvider, ModelMapError> {
        let provider_type = parse_provider_type(&definition.provider)?;

        let mut config = ProviderConfig::default();
        config.model = Some(definition.model.clone());

        if let Some(base_url) = &definition.base_url {
            config.base_url = Some(base_url.clone());
        }

        if let Some(temp) = definition.temperature {
            config.temperature = Some(temp);
        }

        if let Some(max_tokens) = definition.max_tokens {
            config.max_tokens = Some(max_tokens);
        }

        // Get API key from environment based on provider
        match provider_type {
            ProviderType::Anthropic => {
                config.api_key = std::env::var("ANTHROPIC_API_KEY").ok();
            }
            ProviderType::OpenAI => {
                config.api_key = std::env::var("OPENAI_API_KEY").ok();
            }
            ProviderType::Ollama | ProviderType::OpenAICompatible => {
                // Ollama doesn't need an API key
            }
        }

        create_provider(provider_type, config).map_err(|e| {
            ModelMapError::ValidationError {
                field: format!("models.{}", model_name),
                message: format!("Failed to create provider: {}", e),
            }
        })
    }

    async fn add_to_pool(&self, model_name: String, definition: &ModelDefinition) {
        let mut pool = self.pool.write().await;

        // Evict oldest if at capacity
        if pool.len() >= self.options.max_pool_size {
            self.evict_oldest_from_pool(&mut pool);
        }

        // Create a dummy provider for tracking
        // (actual provider is created on each get_provider call)
        if let Ok(provider) = self.create_provider_from_definition(&model_name, definition) {
            pool.insert(
                model_name.clone(),
                PooledProvider {
                    provider,
                    model_name,
                    last_used: Instant::now(),
                    use_count: 1,
                },
            );
        }
    }

    fn evict_oldest_from_pool(&self, pool: &mut HashMap<String, PooledProvider>) {
        if let Some(oldest) = pool
            .iter()
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(name, _)| name.clone())
        {
            tracing::debug!("Evicting oldest provider from pool: {}", oldest);
            pool.remove(&oldest);
        }
    }
}

/// Parse provider type from string.
fn parse_provider_type(provider: &str) -> Result<ProviderType, ModelMapError> {
    match provider.to_lowercase().as_str() {
        "anthropic" | "claude" => Ok(ProviderType::Anthropic),
        "openai" | "gpt" => Ok(ProviderType::OpenAI),
        "ollama" => Ok(ProviderType::Ollama),
        "openai-compatible" | "openai_compatible" => Ok(ProviderType::OpenAICompatible),
        _ => Err(ModelMapError::ValidationError {
            field: "provider".to_string(),
            message: format!("Unknown provider type: {}", provider),
        }),
    }
}

/// Create an Arc-wrapped registry for shared access.
pub fn create_shared_registry(config: ModelMapConfig) -> Arc<ModelRegistry> {
    Arc::new(ModelRegistry::new(config))
}

/// Create an Arc-wrapped registry with custom options.
pub fn create_shared_registry_with_options(
    config: ModelMapConfig,
    options: RegistryOptions,
) -> Arc<ModelRegistry> {
    Arc::new(ModelRegistry::with_options(config, options))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> ModelMapConfig {
        let mut config = ModelMapConfig::default();
        config.models.insert(
            "test-model".to_string(),
            ModelDefinition {
                provider: "ollama".to_string(),
                model: "llama3.2".to_string(),
                description: Some("Test model".to_string()),
                max_tokens: None,
                temperature: None,
                base_url: None,
            },
        );
        config.fallbacks.insert(
            "primary".to_string(),
            vec!["test-model".to_string()],
        );
        config
    }

    #[tokio::test]
    async fn test_registry_creation() {
        let config = test_config();
        let registry = ModelRegistry::new(config);

        assert!(registry.has_model("test-model").await);
        assert!(!registry.has_model("nonexistent").await);
    }

    #[tokio::test]
    async fn test_resolve_model() {
        let config = test_config();
        let registry = ModelRegistry::new(config);

        let resolved = registry.resolve_model("test-model").await.unwrap();
        assert_eq!(resolved.name, "test-model");
        assert_eq!(resolved.definition.provider, "ollama");
        assert_eq!(resolved.definition.model, "llama3.2");
    }

    #[tokio::test]
    async fn test_resolve_nonexistent_model() {
        let config = test_config();
        let registry = ModelRegistry::new(config);

        let result = registry.resolve_model("nonexistent").await;
        assert!(matches!(result, Err(ModelMapError::ModelNotFound(_))));
    }

    #[tokio::test]
    async fn test_get_model_names() {
        let config = test_config();
        let registry = ModelRegistry::new(config);

        let names = registry.get_model_names().await;
        assert!(names.contains(&"test-model".to_string()));
    }

    #[tokio::test]
    async fn test_pool_stats() {
        let config = test_config();
        let registry = ModelRegistry::new(config);

        let stats = registry.get_pool_stats().await;
        assert_eq!(stats.max_size, DEFAULT_MAX_POOL_SIZE);
    }

    #[tokio::test]
    async fn test_clear_pool() {
        let config = test_config();
        let registry = ModelRegistry::new(config);

        // Add something to pool (indirectly through update_config)
        registry.clear_pool().await;

        let stats = registry.get_pool_stats().await;
        assert_eq!(stats.size, 0);
    }

    #[test]
    fn test_parse_provider_type() {
        assert_eq!(
            parse_provider_type("anthropic").unwrap(),
            ProviderType::Anthropic
        );
        assert_eq!(
            parse_provider_type("ANTHROPIC").unwrap(),
            ProviderType::Anthropic
        );
        assert_eq!(
            parse_provider_type("claude").unwrap(),
            ProviderType::Anthropic
        );
        assert_eq!(
            parse_provider_type("openai").unwrap(),
            ProviderType::OpenAI
        );
        assert_eq!(
            parse_provider_type("ollama").unwrap(),
            ProviderType::Ollama
        );
        assert!(parse_provider_type("invalid").is_err());
    }
}
