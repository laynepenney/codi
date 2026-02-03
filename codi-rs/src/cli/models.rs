// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Model-related commands for the CLI interface.

use clap::{Parser, Subcommand};
use colored::{Colorize, Colors};
use crate::error::{CliError, ModelError}; 
use crate::tools::handlers::models::{list_available_models, format_models_list, get_available_providers};
use crate::providers::{create_provider_from_env, ProviderType, create_provider};
use crate::tools::handlers::models as model_handler;
use serde_json::{json, Value};
use std::env;

/// Model-related commands.
#[derive(Debug, Subcommand)]
pub enum ModelsCommand {
    /// List available models for each provider
    #[command(aliases = &["ls", "show"])]
    List {
        /// Filter by provider: anthropic, openai, ollama, runpod
        provider: Option<String>,
        /// Show only local Ollama models
        #[arg(long)]
        local: bool,
        /// Output format (text or json)
        #[arg(short, long, default_value = "text")]
        format: OutputFormat,
    },
    /// Show available providers
    Providers {
        /// Output format (text or json)
        #[arg(short, long, default_value = "text")]
        format: OutputFormat,
    },
    /// Get/set current model configuration
    #[command(aliases = &["current", "active"])]
    Info {
        /// Show model info in JSON format
        #[arg(short, long)]
        json: bool,
    },
}

/// Output format for commands
#[derive(Debug, Clone, Copy, clap::ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

/// Model management commands
#[derive(Debug, Parser)]
#[command(name = "models", about = "Manage AI models and providers")]
pub struct ModelsArgs {
    #[command(subcommand)]
    pub command: Option<ModelsCommand>,
}

impl ModelsArgs {
    /// Execute the models command
    pub async fn execute(self) -> Result<(), CliError> {
        match self.command {
            Some(cmd) => match cmd {
                ModelsCommand::List { provider, local, format } => {
                    self.list_models(provider.as_deref(), local, format).await
                }
                ModelsCommand::Providers { format } => {
                    self.list_providers(format).await
                }
                ModelsCommand::Info { json } => {
                    self.show_current_model(!json).await
                }
            }
            None => {
                // Default to list
                self.list_models(None, false, OutputFormat::Text).await
            }
        }
    }

    async fn list_models(&self, provider_filter: Option<&str>, local_only: bool, format: OutputFormat) -> Result<(), CliError> {
        let models = list_available_models(provider_filter, local_only).await?;
        let errors = Vec::new(); // TODO: collect actual errors

        match format {
            OutputFormat::Json => {
                let output = json!({
                    "models": models.iter().map(|m| serde_json::json!({
                        "id": m.id,
                        "provider": m.provider,
                        "name": m.name,
                        "description": m.description,
                        "supports_tools": m.supports_tools,
                        "supports_vision": m.supports_vision,
                        "context_window": m.context_window,
                        "pricing": m.pricing,
                    })).collect::<Vec<_>>(),
                    "errors": errors
                });
                println!("{}", serde_json::to_string_pretty(&output)?);
            }
            OutputFormat::Text => {
                let display = format!(
                    "{}
{}",
                    "🤖 Available Models".bright_blue().bold(),  
                    format_models_list(&models, &errors)
                );
                println!("{}", display);
            }
        }
        Ok(())
    }

    async fn list_providers(&self, format: OutputFormat) -> Result<(), CliError> {
        let providers = get_available_providers();
        
        match format {
            OutputFormat::Json => {
                let output = json!({ "providers": providers });
                println!("{}", serde_json::to_string_pretty(&output)?);
            }
            OutputFormat::Text => {
                println!("{}", "📋 Available Providers\n".bright_blue().bold());
                for provider in providers {
                    match provider {
                        "anthropic" => println!("{} {}", "●".bright_magenta(), "Anthropic - Claude models"),
                        "openai" => println!("{} {}", "●".bright_green(), "OpenAI - GPT models"),
                        "ollama" => println!("{} {}", "●".bright_cyan(), "Ollama - Local models"),
                        "runpod" => println!("{} {}", "●".bright_yellow(), "RunPod - Cloud GPU endpoints"),
                        _ => println!("{}", provider),
                    }
                }
            }
        }
        Ok(())
    }

    async fn show_current_model(&self, pretty: bool) -> Result<(), CliError> {
        // Get current model from environment/config
        let config = crate::config::load_config()?;
        
        let current_model = json!({
            "provider": config.provider,
            "model": config.model,
            "base_url": config.base_url,
            "endpoint_id": config.endpoint_id,
        });

        if pretty {
            println!("{}", "🤖 Current Model Configuration\n".bright_blue().bold());
            println!("{}", format!("Provider: {}", config.provider).bright_white());
            println!("{}", format!("Model: {}", config.model).bright_white());
            if let Some(url) = config.base_url {
                println!("{}", format!("Base URL: {}", url).bright_white());
            }
            if let Some(endpoint) = config.endpoint_id {
                println!("{}", format!("Endpoint ID: {}", endpoint).bright_white());
            }
        } else {
            println!("{}", serde_json::to_string_pretty(&current_model)?);
        }
        Ok(())
    }
}

/// Add models subcommands to main CLI
pub fn add_models_commands(command: clap::Command) -> clap::Command {
    command.subcommand(
        clap::Command::new("models")
            .about("Manage AI models and providers")
            .subcommand(
                clap::Command::new("list")
                    .about("List available models")
                    .aliases(&["ls", "show"])
                    .arg(clap::Arg::new("provider")
                        .help("Filter by provider (anthropic, openai, ollama, runpod)"))
                    .arg(clap::Arg::new("local")
                        .long("local")
                        .help("Show only local Ollama models"))
                    .arg(clap::Arg::new("format")
                        .short('f')
                        .long("format")
                        .value_parser(["text", "json"])
                        .default_value("text")
                        .help("Output format"))
            )
            .subcommand(
                clap::Command::new("providers")
                    .about("Show available providers")
                    .arg(clap::Arg::new("format")
                        .short('f')
                        .long("format")
                        .value_parser(["text", "json"])
                        .default_value("text")
                        .help("Output format"))
            )
            .subcommand(
                clap::Command::new("info")
                    .about("Show current model configuration")
                    .aliases(&["current", "active"])
                    .arg(clap::Arg::new("json")
                        .short('j')
                        .long("json")
                        .help("Output as JSON"))
            )
    )
}