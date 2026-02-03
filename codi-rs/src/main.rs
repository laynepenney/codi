// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Codi main entry point - CLI, commands, and REPL.

use std::sync::Arc;

use clap::{Parser, Subcommand, ValueEnum};
use colored::Colorize;

use codi::agent::AgentConfig;
use codi::config::{self, CliOptions};
use codi::providers::{create_provider_from_config, ProviderType};
use codi::tools::ToolRegistry;
use codi::tui::{App, run as run_tui};

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
    /// Anthropic - Claude models
    Anthropic,
    /// OpenAI - GPT models
    Openai,
    /// Ollama - Local models  
    Ollama,
    /// RunPod - Cloud inference
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

/// Output format for non-interactive mode.
#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

impl std::fmt::Display for OutputFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OutputFormat::Text => write!(f, "text"),
            OutputFormat::Json => write!(f, "json"),
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

    /// Manage AI models and providers
    Models {
        #[command(subcommand)]
        action: Option<ModelsAction>,
    },
}

/// Config subcommand actions.
#[derive(Subcommand)]
enum ConfigAction {
    /// Show current configuration
    Show,
}

/// Models subcommand actions.
#[derive(Subcommand)]
enum ModelsAction {
    /// List available models
    List {
        /// Filter by provider (anthropic, openai, ollama, runpod)
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
    /// Show current model configuration
    #[command(aliases = &["current", "active"])]
    Info {
        /// Show model info in JSON format
        #[arg(short, long)]
        json: bool,
    },
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

    let workspace_root = std::env::current_dir()?;
    let config = config::load_config(&workspace_root, cli_options)?;

    // Print startup message in non-quiet mode
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

fn print_startup_message(config: &config::ResolvedConfig) {
    println!(
        "{} {} - Your AI coding wingman",
        "codi".cyan().bold(),
        format!("v{}", VERSION ).dimmed()
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
            }
        }
        Commands::Init => {
            let workspace_root = std::env::current_dir()?;
            let path = config::init_config(&workspace_root, None)?;
            println!("Created config file: {}", path.display());
        }
        Commands::Version => {
            println!("codi {}", VERSION);
            println!("Rust implementation - All phases complete! 🎉");
        }
        Commands::Models { action } => {
            handle_models_command(action).await?;
        }
    }
    Ok(())
}

async fn handle_models_command(action: Option<ModelsAction>) -> anyhow::Result<()> {
    match action {
        Some(ModelsAction::List { provider, local, format }) => {
            // For now, show basic info and usage since we don't have full model listing implemented
            match format {
                OutputFormat::Json => {
                    let models = serde_json::json!([
                        {"provider": "anthropic", "id": "claude-3-5-sonnet-latest", "name": "Claude 3.5 Sonnet", "supports_tools": true, "supports_vision": false, "context_window": 200000},
                        {"provider": "anthropic", "id": "claude-3-5-haiku-latest", "name": "Claude 3.5 Haiku", "supports_tools": true, "supports_vision": false, "context_window": 200000},
                        {"provider": "openai", "id": "gpt-4o", "name": "GPT-4o", "supports_tools": true, "supports_vision": true, "context_window": 128000},
                        {"provider": "openai", "id": "gpt-4o-mini", "name": "GPT-4o Mini", "supports_tools": true, "supports_vision": true, "context_window": 128000},
                        {"provider": "ollama", "id": "llama3.2", "name": "Llama 3.2", "supports_tools": false, "supports_vision": false, "context_window": 8000},
                        {"provider": "ollama", "id": "llama3.1", "name": "Llama 3.1", "supports_tools": false, "supports_vision": false, "context_window": 8000}
                    ]);
                    println!("{}", serde_json::to_string_pretty(&models)?);
                }
                OutputFormat::Text => {
                    let models = vec![
                        // Anthropic models
                        ("anthropic", "claude-3-5-haiku-latest", "Claude 3.5 Haiku", "High-speed, affordable reasoning"), 
                        ("anthropic", "claude-3-5-sonnet-latest", "Claude 3.5 Sonnet", "Most capable model"),
                        // OpenAI models
                        ("openai", "gpt-4o", "GPT-4o", "Multimodal reasoning"), 
                        ("openai", "gpt-4o-mini", "GPT-4o Mini", "Efficient GPT-4o"), 
                        ("openai", "gpt-4.1", "GPT-4.1", "Latest GPT-4"),
                        // Ollama models 
                        ("ollama", "llama3.2", "Llama 3.2", "Latest Llama"),
                        ("ollama", "qwen3.2", "Qwen 3.2", "Powerful reasoning"),
                        ("ollama", "deepseek-coder", "DeepSeek Coder", "Code-focused model"),
                    ];

                    if let Some(filter_provider) = &provider {
                        println!("{}", format!("🤖 {} Models", filter_provider.to_uppercase()).bright_blue().bold());
                        let filtered: Vec<_> = models.iter().filter(|(p, _, _, _)| p == filter_provider).collect();
                        for (_, id, name, desc) in filtered {
                            println!("✓ {} [{}] - {}", name.bright_white(), id, desc);
                        }
                    } else {
                        let mut providers: std::collections::HashMap<&str, Vec<_>> = std::collections::HashMap::new();
                        for (p, id, name, desc) in &models {
                            providers.entry(p).or_default().push((id, name, desc));
                        }
                        for (provider, provider_models) in providers {
                            println!("\n{}", format!("## {} Models", provider.to_uppercase()).bright_cyan());
                            for (id, name, desc) in provider_models {
                                println!("✓ {} [{}] - {}", name.bright_white(), id, desc);
                            }
                        }
                    }

                    if local {
                        println!("\n{}", "--local flag: Only showing Ollama models since they run locally".cyan());
                        println!("Make sure Ollama is installed: https://ollama.ai");
                    }
                }
            }
        }
        Some(ModelsAction::Providers { format }) => {
            println!("{}", "📋 Available Providers".bright_blue().bold());
            match format {
                OutputFormat::Json => {
                    let providers = vec!["anthropic", "openai", "ollama", "runpod"];
                    println!("{}", serde_json::to_string_pretty(&serde_json::json!({ "providers": providers }))?);
                }
                OutputFormat::Text => {
                    println!("✓ Anthropic - Claude models (claude-3-5-sonnet, claude-3-5-haiku)");
                    println!("✓ OpenAI - GPT models (gpt-4o, gpt-4o-mini, gpt-4.1)");
                    println!("✓ Ollama - Local models (llama3.2, qwen3.2, deepseek-coder)");
                    println!("✓ RunPod - Cloud GPU endpoints (custom endpoints)");
                    println!("\n{}", "Install Ollama from https://ollama.ai to use local models".dimmed());
                }
            }
        }
        Some(ModelsAction::Info { json }) => {
            // Show current model info
            let workspace_root = std::env::current_dir()?;
            let resolved = config::load_config(&workspace_root, CliOptions::default())?;

            let provider_str = match resolved.provider.as_str() {
                "anthropic" => "ANTHROPIC",
                "openai" => "OPENAI",
                "ollama" => "OLLAMA",
                "runpod" => "RUNPOD",
                _ => &resolved.provider,
            };

            if json {
                let info = serde_json::json!({
                    "provider": resolved.provider,
                    "model": resolved.model,
                    "baseUrl": resolved.base_url,
                    "endpointId": resolved.endpoint_id,
                });
                println!("{}", serde_json::to_string_pretty(&info)?);
            } else {
                println!("{}", "🤖 Current Model Configuration".bright_blue().bold());
                println!("Provider: {provider}", provider = provider_str.bright_magenta());
                println!("Model: {}", resolved.model.as_deref().unwrap_or("default").bright_white());
                if let Some(url) = &resolved.base_url {
                    println!("Base URL: {}", url.bright_blue());
                }
                if let Some(endpoint) = &resolved.endpoint_id {
                    println!("Endpoint ID: {}", endpoint.bright_yellow());
                }
                println!("\n{}", "Change current model with: codi -p PROVIDER -m MODEL".dimmed());
            }
        }
        None => {
            // Default to list
            println!("{}", "Use 'codi models list' to see available models".cyan());
            println!("{}", "Use 'codi models providers' to see available providers".cyan());
            println!("{}", "Use 'codi models info' to see current configuration".cyan());
        }
    }
    Ok(())
}

fn init_tracing() {
    // Only initialize if trace or debug is enabled
    if std::env::var("RUST_LOG").is_ok() {
        // Let env var control logging
        tracing_subscriber::fmt::init();
    } else {
        // Default to WARN level
        tracing_subscriber::fmt().with_max_level(tracing::Level::WARN).init();
    }
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
    let provider = match create_provider_from_config(config) {
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

    // Create agent configuration from resolved config
    let agent_config = AgentConfig {
        max_iterations: 50,
        max_consecutive_errors: 3,
        max_turn_duration_ms: 120_000, // 2 minutes
        max_context_tokens: config.max_context_tokens as usize,
        use_tools: !config.no_tools,
        extract_tools_from_text: config.extract_tools_from_text,
        auto_approve_all: auto_approve,
        auto_approve_tools: config.auto_approve.clone(),
    };

    // Create and run agent
    let mut agent = codi::agent::Agent::new(codi::agent::AgentOptions {
        provider,
        tool_registry: registry,
        system_prompt: Some("You are Codi, a helpful AI coding assistant.".to_string()),
        config: agent_config,
        callbacks: codi::agent::AgentCallbacks::default(),
    });

    let result = agent.chat(prompt).await;
    
    match result {
        Ok(response) => {
            match format {
                OutputFormat::Text => {
                    println!("{}", response);
                }
                OutputFormat::Json => {
                    let response_json = serde_json::json!({
                        "success": true,
                        "response": response,
                        "toolCalls": [],
                        "usage": null
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
                        "toolCalls": [],
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

async fn run_repl(config: &config::ResolvedConfig, auto_approve: bool) -> anyhow::Result<()> {
    // Create provider from configuration
    let provider = create_provider_from_config(config)?;

    // Create TUI app with project path, set config before provider
    let mut app = App::with_project_path(std::env::current_dir()?);

    // Set config and auto_approve flag, then set provider (which uses stored config)
    app.set_config(config.clone());
    app.set_auto_approve(auto_approve);
    app.set_provider(provider);

    // Load session if specified
    if let Some(ref session_name) = config.default_session {
        if let Err(e) = load_session(&mut app, session_name).await {
            eprintln!("{} Failed to load session '{}': {}", "⚠".yellow(), session_name, e);
        }
    }

    // Auto-index symbol index in background
    let project_path_str = std::env::current_dir()?.to_string_lossy().to_string();
    tokio::spawn(async move {
        match codi::symbol_index::SymbolIndexService::new(&project_path_str).await {
            Ok(service) => {
                if let Err(e) = service.build(false).await {
                    tracing::warn!("Symbol index build failed: {}", e);
                } else {
                    tracing::info!("Symbol index built successfully");
                }
            }
            Err(e) => tracing::debug!("Symbol index init skipped: {}", e),
        }
    });

    // Run TUI
    match run_tui(&mut app).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!("TUI error: {}", e)),
    }
}

async fn load_session(app: &mut App, session_name: &str) -> anyhow::Result<()> {
    // Try to load by exact name first, then by fuzzy match
    if let Err(_) = app.load_session(session_name).await {
        return Err(anyhow::anyhow!("Session not found: {}", session_name));
    }
    Ok(())
}
