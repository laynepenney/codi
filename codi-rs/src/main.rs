// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Codi CLI entry point.
//!
//! Your AI coding wingman - a hybrid assistant supporting Claude, OpenAI, and local models.

use clap::{Parser, Subcommand, ValueEnum};
use colored::Colorize;
use serde_json;

use codi::config::{self, CliOptions};
use codi::agent::{Agent, AgentCallbacks, AgentConfig, AgentOptions};
use codi::providers::ProviderType;
use codi::tools::ToolRegistry;
use codi::tui::{App, run as run_tui};
use codi::types::{ProviderConfig, BoxedProvider};
use std::sync::Arc;

/// Codi version string.
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Codi - Your AI coding wingman.
#[derive(Parser)]
#[command(name = "codi")]
#[command(author, version, about = "Your AI coding wingman", long_about = None)]
struct Cli {
    /// AI provider to use
    #[arg(short, long, env = "CODI_PROVIDER")]
    provider: Option<Provider>,

    /// Model to use
    #[arg(short, long, env = "CODI_MODEL")]
    model: Option<String>,

    /// Base URL for the API
    #[arg(long, env = "CODI_BASE_URL")]
    base_url: Option<String>,

    /// RunPod endpoint ID
    #[arg(long, env = "RUNPOD_ENDPOINT_ID")]
    endpoint_id: Option<String>,

    /// Disable all tool use
    #[arg(long)]
    no_tools: bool,

    /// Enable context compression
    #[arg(short, long)]
    compress: bool,

    /// Provider for summarization
    #[arg(long)]
    summarize_provider: Option<String>,

    /// Model for summarization
    #[arg(long)]
    summarize_model: Option<String>,

    /// Session to load on startup
    #[arg(short, long)]
    session: Option<String>,

    /// Run a single prompt and exit
    #[arg(short = 'P', long)]
    prompt: Option<String>,

    /// Output format for non-interactive mode
    #[arg(short = 'f', long, value_enum, default_value = "text")]
    output_format: OutputFormat,

    /// Suppress spinners and progress output
    #[arg(short, long)]
    quiet: bool,

    /// Auto-approve all tool operations
    #[arg(short = 'y', long)]
    yes: bool,

    /// Show verbose output
    #[arg(long)]
    verbose: bool,

    /// Show debug output
    #[arg(long)]
    debug: bool,

    /// Show trace output (full payloads)
    #[arg(long)]
    trace: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

/// Available AI providers.
#[derive(Debug, Clone, Copy, ValueEnum)]
enum Provider {
    Anthropic,
    Openai,
    Ollama,
    Runpod,
}

impl std::fmt::Display for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Provider::Anthropic => write!(f, "anthropic"),
            Provider::Openai => write!(f, "openai"),
            Provider::Ollama => write!(f, "ollama"),
            Provider::Runpod => write!(f, "runpod"),
        }
    }
}

impl From<Provider> for ProviderType {
    fn from(provider: Provider) -> Self {
        match provider {
            Provider::Anthropic => ProviderType::Anthropic,
            Provider::Openai => ProviderType::OpenAI,
            Provider::Ollama => ProviderType::Ollama,
            Provider::Runpod => ProviderType::OpenAICompatible,
        }
    }
}

/// Output format for non-interactive mode.
#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

/// Subcommands for codi.
#[derive(Subcommand)]
enum Commands {
    /// Show configuration
    Config {
        #[command(subcommand)]
        action: Option<ConfigAction>,
    },

    /// Initialize a new configuration file
    Init,

    /// Show version information
    Version,
}

/// Config subcommand actions.
#[derive(Subcommand)]
enum ConfigAction {
    /// Show current configuration
    Show,
    /// Initialize a new config file
    Init,
    /// Show example configuration
    Example,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    init_tracing();

    let cli = Cli::parse();

    // Handle subcommands
    if let Some(command) = cli.command {
        return handle_command(command).await;
    }

    // Convert CLI args to CliOptions
    let cli_options = config::CliOptions {
        provider: cli.provider.map(|p| p.to_string()),
        model: cli.model,
        base_url: cli.base_url,
        endpoint_id: cli.endpoint_id,
        no_tools: if cli.no_tools { Some(true) } else { None },
        compress: if cli.compress { Some(true) } else { None },
        summarize_provider: cli.summarize_provider,
        summarize_model: cli.summarize_model,
        session: cli.session,
    };

    // Get current directory as workspace root
    let workspace_root = std::env::current_dir()?;

    // Load configuration
    let config = config::load_config(&workspace_root, cli_options)?;

    // Display startup message
    if !cli.quiet {
        print_startup_message(&config);
    }

    // Handle non-interactive mode
    if let Some(prompt) = cli.prompt {
        return handle_prompt(&config, &prompt, cli.output_format, cli.quiet, cli.yes).await;
    }

    // Start interactive REPL
    run_repl(&config, cli.yes).await
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
}

fn print_startup_message(config: &config::ResolvedConfig) {
    println!(
        "{} {} - Your AI coding wingman",
        "codi".cyan().bold(),
        format!("v{}", VERSION).dimmed()
    );
    println!(
        "Provider: {} | Model: {}",
        config.provider.green(),
        config.model.as_deref().unwrap_or("default").yellow()
    );
    println!();
}

async fn handle_command(command: Commands) -> anyhow::Result<()> {
    match command {
        Commands::Config { action } => {
            let workspace_root = std::env::current_dir()?;
            match action {
                Some(ConfigAction::Show) | None => {
                    let config = config::load_config(&workspace_root, CliOptions::default())?;
                    println!("{}", serde_json::to_string_pretty(&config)?);
                }
                Some(ConfigAction::Init) => {
                    let path = config::init_config(&workspace_root, None)?;
                    println!("Created config file: {}", path.display());
                }
                Some(ConfigAction::Example) => {
                    let example = config::get_example_config();
                    println!("{}", serde_json::to_string_pretty(&example)?);
                }
            }
        }
        Commands::Init => {
            let workspace_root = std::env::current_dir()?;
            let path = config::init_config(&workspace_root, None)?;
            println!("Created config file: {}", path.display());
        }
        Commands::Version => {
            println!("codi {}", VERSION);
            println!("Rust implementation - Phase 0");
        }
    }
    Ok(())
}

async fn handle_prompt(
    config: &config::ResolvedConfig,
    prompt: &str,
    format: OutputFormat,
    quiet: bool,
    auto_approve: bool,
) -> anyhow::Result<()> {
    if !quiet {
        println!("{} Processing prompt...", "→".cyan());
    }

    // Create provider from configuration
    let provider = match create_provider_from_config(config).await {
        Ok(provider) => provider,
        Err(e) => {
            let error_msg = format!("Failed to create provider: {}", e);
            return match format {
                OutputFormat::Text => {
                    eprintln!("{}", error_msg.red());
                    Ok(())
                }
                OutputFormat::Json => {
                    let response = serde_json::json!({
                        "success": false,
                        "response": "",
                        "toolCalls": [],
                        "usage": null,
                        "error": error_msg
                    });
                    println!("{}", serde_json::to_string_pretty(&response)?);
                    Ok(())
                }
            };
        }
    };

    // Create tool registry
    let registry = Arc::new(ToolRegistry::with_defaults());

    // Create agent callbacks for non-interactive mode
    use std::sync::Mutex;
    let tool_calls = Arc::new(Mutex::new(Vec::new()));
    let tool_calls_clone = tool_calls.clone();
    
    let callbacks = AgentCallbacks {
        on_text: None, // No streaming in non-interactive mode
        on_tool_call: Some(Box::new(move |name, input| {
            if let Ok(mut calls) = tool_calls_clone.lock() {
                calls.push(serde_json::json!({
                    "name": name,
                    "input": input
                }));
            }
        })),
        on_tool_result: None,
        on_confirm: None, // Use default confirmation logic
        on_compaction: None,
        on_turn_complete: None,
    };

    // Create agent configuration from resolved config
    let agent_config = create_agent_config(config, auto_approve);

    // Create and run agent
    let mut agent = Agent::new(AgentOptions {
        provider,
        tool_registry: registry,
        system_prompt: Some(build_system_prompt(config)),
        config: agent_config,
        callbacks,
    });

    let result = agent.chat(prompt).await;
    
    // Extract tool calls after completion
    let tool_calls_result = tool_calls.lock().unwrap().clone();
    
    match result {
        Ok(response) => {
            let usage = calculate_usage(&agent);
            
            match format {
                OutputFormat::Text => {
                    println!("{}", response);
                }
                OutputFormat::Json => {
                    let response_json = serde_json::json!({
                        "success": true,
                        "response": response,
                        "toolCalls": tool_calls_result,
                        "usage": usage
                    });
                    println!("{}", serde_json::to_string_pretty(&response_json)?);
                }
            }
        }
        Err(e) => {
            let error_msg = format!("Agent error: {}", e);
            match format {
                OutputFormat::Text => {
                    eprintln!("{}", error_msg.red());
                }
                OutputFormat::Json => {
                    let response = serde_json::json!({
                        "success": false,
                        "response": "",
                        "toolCalls": tool_calls_result,
                        "usage": null,
                        "error": error_msg
                    });
                    println!("{}", serde_json::to_string_pretty(&response)?);
                }
            }
        }
    }

    Ok(())
}

async fn run_repl(config: &config::ResolvedConfig, _auto_approve: bool) -> anyhow::Result<()> {
    // Create provider from configuration
    let provider = create_provider_from_config(config).await?;

    // Create TUI app with provider
    let mut app = App::with_provider_and_path(provider, std::env::current_dir()?);

    // Load session if specified
    if let Some(ref session_name) = config.default_session {
        if let Err(e) = load_session(&mut app, session_name).await {
            eprintln!("{} Failed to load session '{}': {}", "⚠".yellow(), session_name, e);
        }
    }

    // Run TUI
    match run_tui(&mut app).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!("TUI error: {}", e)),
    }
}

async fn load_session(app: &mut App, session_name: &str) -> anyhow::Result<()> {
    // Try to load by exact name first, then by fuzzy match
    if let Err(_) = app.load_session(session_name).await {
        // Try fuzzy matching - this would need to be implemented in the App
        // For now, just propagate the error
        return Err(anyhow::anyhow!("Session not found: {}", session_name));
    }
    Ok(())
}

async fn create_provider_from_config(config: &config::ResolvedConfig) -> anyhow::Result<BoxedProvider> {
    let provider_type = match config.provider.as_str() {
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::OpenAI,
        "ollama" => ProviderType::Ollama,
        "runpod" => ProviderType::OpenAICompatible,
        _ => return Err(anyhow::anyhow!("Unknown provider: {}", config.provider)),
    };

    let api_key = get_api_key(&provider_type, config);
    
    let provider_config = ProviderConfig {
        api_key,
        model: config.model.clone(),
        base_url: config.base_url.clone(),
        max_tokens: None,
        temperature: None,
        clean_hallucinated_traces: Some(true),
        timeout_ms: None,
    };

    codi::providers::create_provider(provider_type, provider_config)
        .map_err(|e| anyhow::anyhow!("Failed to create provider: {}", e))
}

fn get_api_key(provider_type: &ProviderType, _config: &config::ResolvedConfig) -> Option<String> {
    match provider_type {
        ProviderType::Anthropic => std::env::var("ANTHROPIC_API_KEY").ok(),
        ProviderType::OpenAI => std::env::var("OPENAI_API_KEY").ok(),
        ProviderType::Ollama => None, // Ollama doesn't need API key
        ProviderType::OpenAICompatible => {
            std::env::var("RUNPOD_API_KEY").ok()
                .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        }
    }
}

fn create_agent_config(config: &config::ResolvedConfig, auto_approve: bool) -> AgentConfig {
    AgentConfig {
        max_iterations: 50,
        max_consecutive_errors: 3,
        max_turn_duration_ms: 120_000, // 2 minutes
        max_context_tokens: config.max_context_tokens as usize,
        use_tools: !config.no_tools,
        extract_tools_from_text: config.extract_tools_from_text,
        auto_approve_all: auto_approve,
        auto_approve_tools: config.auto_approve.clone(),
    }
}

fn build_system_prompt(config: &config::ResolvedConfig) -> String {
    let mut prompt = "You are Codi, a helpful AI coding assistant.".to_string();
    
    if let Some(ref additions) = config.system_prompt_additions {
        prompt.push_str("\n\n");
        prompt.push_str(additions);
    }
    
    if let Some(ref context) = config.project_context {
        prompt.push_str("\n\n## Project Context\n");
        prompt.push_str(context);
    }
    
    prompt
}

fn calculate_usage(_agent: &Agent) -> Option<serde_json::Value> {
    // TODO: Implement usage tracking when agent provides usage metrics
    // For now, return null until usage tracking is added to the agent
    None
}
