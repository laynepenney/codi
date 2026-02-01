// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Codi CLI entry point.
//!
//! Your AI coding wingman - a hybrid assistant supporting Claude, OpenAI, and local models.

use clap::{Parser, Subcommand, ValueEnum};
use colored::Colorize;

use codi::config::{self, CliOptions};

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
    let cli_options = CliOptions {
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
        return handle_prompt(&config, &prompt, cli.output_format, cli.quiet).await;
    }

    // Start interactive REPL
    run_repl(&config).await
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
) -> anyhow::Result<()> {
    // TODO: Implement actual agent call in Phase 3
    // For now, just acknowledge the prompt

    if !quiet {
        println!("{} Processing prompt...", "→".cyan());
    }

    match format {
        OutputFormat::Text => {
            println!(
                "{}",
                format!(
                    "[Phase 0 stub] Would process prompt '{}' using {} provider",
                    prompt, config.provider
                )
                .dimmed()
            );
        }
        OutputFormat::Json => {
            let response = serde_json::json!({
                "success": true,
                "response": format!("[Phase 0 stub] Would process prompt using {} provider", config.provider),
                "toolCalls": [],
                "usage": null
            });
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
    }

    Ok(())
}

async fn run_repl(_config: &config::ResolvedConfig) -> anyhow::Result<()> {
    // TODO: Implement actual REPL in Phase 6 (Terminal UI)
    // For now, just show a placeholder message

    println!(
        "{}",
        "Interactive mode not yet implemented in Rust version.".yellow()
    );
    println!("Use --prompt/-P flag for non-interactive mode.");
    println!();
    println!("Example:");
    println!("  codi -P \"explain this code\" src/main.rs");
    println!();
    println!("Or use the TypeScript version for full functionality:");
    println!("  {} (in codi/ directory)", "pnpm dev".cyan());

    Ok(())
}
