// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Terminal-style UI for Codi.
//!
//! This module provides a traditional terminal interface (like a shell REPL)
//! instead of a full-screen TUI. It behaves like a normal terminal with:
//! - Scrollable history (you can scroll up to see previous output)
//! - Standard line input with visible typing
//! - No alternate screen mode
//! - Normal terminal behavior

use std::io::{self, Write};
use std::sync::Arc;
use std::time::Instant;

use crossterm::{
    style::{Color, Print, ResetColor, SetForegroundColor},
    ExecutableCommand,
};

use crate::agent::{AgentCallbacks, AgentConfig, AgentOptions, TurnStats};
use crate::config::ResolvedConfig;
use crate::providers::create_provider_from_config;
use crate::tools::ToolRegistry;

use super::app::App;
use super::commands::{execute_async_command, handle_command, CommandResult};

/// Run the terminal-style REPL.
pub async fn run_terminal_repl(
    config: &ResolvedConfig,
    auto_approve: bool,
) -> anyhow::Result<()> {
    // Print welcome banner
    print_welcome(config)?;
    
    // Check if debug mode is enabled via environment variable
    let debug_mode = std::env::var("CODI_DEBUG").is_ok();
    if debug_mode {
        println!("{} Debug mode enabled - tool calls will be shown", "⚙".yellow());
        println!();
    }
    
    // Create app state
    let mut app = TerminalApp::new(config.clone(), auto_approve, debug_mode).await?;
    
    // Main loop
    loop {
        // Get input from user with visible prompt
        let input = get_input_with_prompt()?;
        
        if input.trim().is_empty() {
            continue;
        }
        
        let trimmed = input.trim();
        
        // Handle commands
        if trimmed.starts_with('/') {
            match handle_command(&mut app.app, trimmed) {
                CommandResult::Ok => {
                    // Check for debug toggle command
                    if trimmed == "/debug" {
                        app.debug_mode = !app.debug_mode;
                        if app.debug_mode {
                            println!("{} Debug mode enabled - tool calls will be shown", "⚙".yellow());
                        } else {
                            println!("{} Debug mode disabled", "⚙".yellow());
                        }
                        continue;
                    }
                    
                    // Check if we should exit
                    if app.app.should_quit {
                        println!("Goodbye!");
                        break;
                    }
                }
                CommandResult::Async(cmd) => {
                    // Execute async command and handle result
                    match execute_async_command(&mut app.app, cmd).await {
                        CommandResult::Ok => {
                            if app.app.should_quit {
                                println!("Goodbye!");
                                break;
                            }
                        }
                        CommandResult::Error(msg) => {
                            eprintln!("Error: {}", msg);
                        }
                        _ => {}
                    }
                }
                CommandResult::Prompt(prompt) => {
                    // Send prompt to AI
                    if let Err(e) = app.send_message(&prompt).await {
                        eprintln!("Error: {}", e);
                    }
                }
                CommandResult::Error(msg) => {
                    eprintln!("Error: {}", msg);
                }
            }
        } else {
            // Regular chat message
            if let Err(e) = app.send_message(trimmed).await {
                eprintln!("Error: {}", e);
            }
        }
    }
    
    Ok(())
}

/// Get input with a prompt, handling visible typing
fn get_input_with_prompt() -> anyhow::Result<String> {
    use std::io::{self, Write};
    
    // Print prompt
    let mut stdout = io::stdout();
    stdout.execute(SetForegroundColor(Color::Cyan))?;
    stdout.execute(Print("› "))?;
    stdout.execute(ResetColor)?;
    stdout.flush()?;
    
    // Read line - this shows visible typing
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    
    Ok(input)
}

/// Terminal app wrapper.
pub struct TerminalApp {
    pub app: App,
    pub config: ResolvedConfig,
    pub tool_registry: Arc<ToolRegistry>,
    pub debug_mode: bool,
}

impl TerminalApp {
    pub async fn new(config: ResolvedConfig, auto_approve: bool, debug_mode: bool) -> anyhow::Result<Self> {
        let mut app = App::with_project_path(std::env::current_dir()?);
        
        app.set_config(config.clone());
        app.set_auto_approve(auto_approve);
        
        let tool_registry = Arc::new(ToolRegistry::with_defaults());
        
        Ok(Self {
            app,
            config,
            tool_registry,
            debug_mode,
        })
    }
    
    pub async fn send_message(
        &mut self,
        content: &str,
    ) -> anyhow::Result<()> {
        // Print user message with prefix
        print_user_message(content);
        
        // Create provider fresh each time (can't clone it)
        let provider = create_provider_from_config(&self.config)?;
        
        // Setup agent callbacks for streaming
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<StreamEvent>();
        
        // Clone content for the spawned task
        let content_owned = content.to_string();
        
        let callbacks = if self.debug_mode {
            AgentCallbacks {
                on_text: Some(Arc::new({
                    let tx = tx.clone();
                    move |text: &str| {
                        let _ = tx.send(StreamEvent::Text(text.to_string()));
                    }
                })),
                on_tool_call: Some(Arc::new({
                    let tx = tx.clone();
                    move |_id: &str, name: &str, input: &serde_json::Value| {
                        let _ = tx.send(StreamEvent::ToolStart(name.to_string(), input.clone()));
                    }
                })),
                on_tool_result: Some(Arc::new({
                    let tx = tx.clone();
                    move |_id: &str, _name: &str, result: &str, is_error: bool| {
                        let _ = tx.send(StreamEvent::ToolResult(result.to_string(), is_error));
                    }
                })),
                on_turn_complete: Some(Arc::new({
                    let tx = tx.clone();
                    move |stats: &TurnStats| {
                        let _ = tx.send(StreamEvent::TurnComplete(stats.clone()));
                    }
                })),
                ..Default::default()
            }
        } else {
            AgentCallbacks {
                on_text: Some(Arc::new({
                    let tx = tx.clone();
                    move |text: &str| {
                        let _ = tx.send(StreamEvent::Text(text.to_string()));
                    }
                })),
                on_tool_call: None,
                on_tool_result: None,
                on_turn_complete: Some(Arc::new({
                    let tx = tx.clone();
                    move |stats: &TurnStats| {
                        let _ = tx.send(StreamEvent::TurnComplete(stats.clone()));
                    }
                })),
                ..Default::default()
            }
        };
        
        // Create agent config
        let agent_config = AgentConfig {
            use_tools: true,
            auto_approve_all: self.app.auto_approve_all(),
            ..Default::default()
        };
        
        // Create agent
        let mut agent = crate::agent::Agent::new(AgentOptions {
            provider,
            tool_registry: self.tool_registry.clone(),
            system_prompt: None,
            config: agent_config,
            callbacks,
        });
        
        // Run chat in background with owned content
        let chat_handle = tokio::spawn(async move {
            agent.chat(&content_owned).await
        });
        
        // Print assistant prefix
        print_assistant_start();
        
        // Stream output
        let mut stdout = io::stdout();
        let start_time = Instant::now();
        let mut in_tool_call = false;
        
        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::Text(text) => {
                    if in_tool_call {
                        println!();
                        print_assistant_start();
                        in_tool_call = false;
                    }
                    print!("{}", text);
                    stdout.flush()?;
                }
                StreamEvent::ToolStart(name, _input) => {
                    in_tool_call = true;
                    println!();
                    print_tool_start(&name);
                }
                StreamEvent::ToolResult(_result, is_error) => {
                    if is_error {
                        print_tool_error();
                    } else {
                        print_tool_success();
                    }
                }
                StreamEvent::TurnComplete(_stats) => {
                    break;
                }
            }
        }
        
        // Wait for chat to complete
        let _ = chat_handle.await?;
        
        // Print elapsed time
        let elapsed = start_time.elapsed();
        if elapsed.as_secs() > 0 {
            print_elapsed(elapsed.as_secs_f64());
        }
        
        println!(); // Final newline
        
        Ok(())
    }
}

#[derive(Debug)]
enum StreamEvent {
    Text(String),
    ToolStart(String, serde_json::Value),
    ToolResult(String, bool),
    TurnComplete(TurnStats),
}

fn print_welcome(config: &ResolvedConfig) -> anyhow::Result<()> {
    use std::io::{self, Write};
    
    let mut stdout = io::stdout();
    stdout.execute(SetForegroundColor(Color::Cyan))?;
    stdout.execute(Print("╭─────────────────────────────────────╮\n"))?;
    stdout.execute(Print("│        Codi - AI Coding Wingman     │\n"))?;
    stdout.execute(Print("╰─────────────────────────────────────╯\n"))?;
    stdout.execute(ResetColor)?;
    
    writeln!(stdout, "Model: {}", config.provider)?;
    if let Some(ref model) = config.model {
        writeln!(stdout, "  → {}", model)?;
    }
    writeln!(stdout)?;
    writeln!(stdout, "Type /help for commands, /debug to toggle tool visibility, or just start chatting!")?;
    writeln!(stdout)?;
    stdout.flush()?;
    
    Ok(())
}

fn print_user_message(content: &str) {
    use crossterm::style::{Color, Print, ResetColor, SetForegroundColor};
    use crossterm::ExecutableCommand;
    use std::io::{self, Write};
    
    let mut stdout = io::stdout();
    let _ = stdout.execute(SetForegroundColor(Color::Cyan));
    let _ = stdout.execute(Print("› "));
    let _ = stdout.execute(ResetColor);
    let _ = stdout.execute(Print(content));
    let _ = stdout.execute(Print("\n"));
    let _ = stdout.flush();
}

fn print_assistant_start() {
    use crossterm::style::{Color, Print, ResetColor, SetForegroundColor};
    use crossterm::ExecutableCommand;
    use std::io::{self, Write};
    
    let mut stdout = io::stdout();
    let _ = stdout.execute(SetForegroundColor(Color::Grey));
    let _ = stdout.execute(Print("• "));
    let _ = stdout.execute(ResetColor);
    let _ = stdout.flush();
}

fn print_tool_start(name: &str) {
    use crossterm::style::{Color, Print, ResetColor, SetForegroundColor};
    use crossterm::ExecutableCommand;
    use std::io::{self, Write};
    
    let mut stdout = io::stdout();
    let _ = stdout.execute(SetForegroundColor(Color::Yellow));
    let _ = stdout.execute(Print(format!("◐ Running: {}...", name)));
    let _ = stdout.execute(ResetColor);
    let _ = stdout.flush();
}

fn print_tool_success() {
    use crossterm::style::{Color, Print, ResetColor, SetForegroundColor};
    use crossterm::ExecutableCommand;
    use std::io::{self, Write};
    
    let mut stdout = io::stdout();
    let _ = stdout.execute(Print("\r"));
    let _ = stdout.execute(SetForegroundColor(Color::Green));
    let _ = stdout.execute(Print("✓ Completed"));
    let _ = stdout.execute(ResetColor);
    let _ = stdout.execute(Print("\n"));
    let _ = stdout.flush();
}

fn print_tool_error() {
    use crossterm::style::{Color, Print, ResetColor, SetForegroundColor};
    use crossterm::ExecutableCommand;
    use std::io::{self, Write};
    
    let mut stdout = io::stdout();
    let _ = stdout.execute(Print("\r"));
    let _ = stdout.execute(SetForegroundColor(Color::Red));
    let _ = stdout.execute(Print("✗ Failed"));
    let _ = stdout.execute(ResetColor);
    let _ = stdout.execute(Print("\n"));
    let _ = stdout.flush();
}

fn print_elapsed(seconds: f64) {
    use crossterm::style::{Color, Print, ResetColor, SetForegroundColor};
    use crossterm::ExecutableCommand;
    use std::io::{self, Write};
    
    let mut stdout = io::stdout();
    let _ = stdout.execute(SetForegroundColor(Color::DarkGrey));
    let _ = stdout.execute(Print(format!(" ({:.1}s)", seconds)));
    let _ = stdout.execute(ResetColor);
    let _ = stdout.flush();
}
