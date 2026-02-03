// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Model listing and management tools.
//! 
//! This module provides functions to list available models for each provider
//! and handle model switching similar to the TypeScript implementation.

use crate::providers::{create_provider, ProviderType, create_provider_from_env, list_models};
use crate::types::ModelInfo;
use crate::error::ToolError;

/// List available models for a specific provider or all providers.
pub async fn list_available_models(
    provider_filter: Option<&str>,
    local_only: bool,
) -> Result<Vec<ModelInfo>, ToolError> {
    let mut all_models = Vec::new();
    let mut errors = Vec::new();

    // Fetch from each provider
    if !local_only {
        // Anthropic models
        if provider_filter.is_none() || provider_filter == Some("anthropic") {
            match create_provider(ProviderType::Anthropic, Default::default()) {
                Ok(provider) => {
                    match list_models(&*provider).await {
                        Ok(models) => all_models.extend(models),
                        Err(e) => errors.push(format!("Anthropic: {}", e)),
                    }
                }
                Err(e) => errors.push(format!("Anthropic provider error: {}", e)),
            }
        }

        // OpenAI models  
        if provider_filter.is_none() || provider_filter == Some("openai") {
            match create_provider(ProviderType::OpenAI, Default::default()) {
                Ok(provider) => {
                    match list_models(&*provider).await {
                        Ok(models) => all_models.extend(models),
                        Err(e) => errors.push(format!("OpenAI: {}", e)),
                    }
                }
                Err(e) => errors.push(format!("OpenAI provider error: {}", e)),
            }
        }
    }

    // Ollama models (local)
    if provider_filter.is_none() || provider_filter == Some("ollama") || local_only {
        // Try to get environment-based Ollama provider
        match create_provider_from_env(None, None) {
            Some(provider) => {
                if let ProviderType::Ollama = provider.get_type() {
                    match list_models(&*provider).await {
                        Ok(models) => all_models.extend(models),
                        Err(e) => errors.push(format!("Ollama: {}", e)),
                    }
                }
            }
            None if provider_filter == Some("ollama") || local_only => {
                // Try direct Ollama creation
                match create_provider(ProviderType::Ollama, Default::default()) {
                    Ok(provider) => {
                        match list_models(&*provider).await {
                            Ok(models) => all_models.extend(models),
                            Err(e) => errors.push(format!("Ollama: {}", e)),
                        }
                    }
                    Err(e) => errors.push(format!("Ollama provider error: {}", e)),
                }
            }
            _ => {}
        }
    }

    if !errors.is_empty() && all_models.is_empty() {
        return Err(ToolError::ExecutionFailed(format!("Failed to fetch models: {}", errors.join(", "))));
    }

    Ok(all_models)
}

/// Get available providers that have models.
pub fn get_available_providers() -> Vec<&'static str> {
    vec!["anthropic", "openai", "ollama", "runpod"]
}

/// Format models output for display.
pub fn format_models_list(models: &[ModelInfo], errors: &[String]) -> String {
    if models.is_empty() && errors.is_empty() {
        return "No models available".to_string();
    }

    let mut output = String::new();

    // Group by provider
    let mut providers: std::collections::HashMap<String, Vec<&ModelInfo>> = std::collections::HashMap::new();
    
    for model in models {
        providers.entry(model.provider.clone()).or_default().push(model);
    }

    for (provider, models) in providers {
        output.push_str(&format!("\n## {} Models\n", provider.to_uppercase()));
        
        for model in models {
            // Format similar to TypeScript version
            let capability_str = match (model.supports_vision, model.supports_tools) {
                (true, true) => " 👁️  ✓  ",
                (true, false) => " 👁️  ✗  ",
                (false, true) => " ✓  ",
                (false, false) => " ✗  ",
            };
            
            let pricing_str = if let Some(pricing) = &model.pricing {
                format!(" ${}/${}", 
                    pricing.input_tokens_per_million as f64 / 1_000_000.0,
                    pricing.output_tokens_per_million as f64 / 1_000_000.0)
            } else {
                String::new()
            };

            let context_info = if let Some(context_window) = model.context_window {
                format!(" {}K tokens", context_window / 1024)
            } else {
                String::new()
            };

            output.push_str(&format!(
                "{icon} {name}{pricing} {context}\n",
                icon = capability_str,
                name = model.id,
                pricing = pricing_str,
                context = context_info
            ));
        }
    }

    if !errors.is_empty() {
        output.push_str("\n⚠️  Errors while fetching models:\n");
        for error in errors {
            output.push_str(&format!("  - {}\n", error));
        }
    }

    output
}