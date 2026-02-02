// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Symbol index management tools.

use async_trait::async_trait;
use serde::Deserialize;

use crate::error::ToolError;
use crate::symbol_index::SymbolIndexService;
use crate::tools::{ToolHandler, ToolOutput};

/// Rebuild or manage the symbol index for the project.
#[derive(Debug, Clone, Default)]
pub struct ManageSymbolsHandler;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SymbolAction {
    Rebuild,
    Stats,
}

#[derive(Debug, Deserialize)]
struct ManageSymbolsArgs {
    action: SymbolAction,
    #[serde(default)]
    force: Option<bool>,
}

#[async_trait]
impl ToolHandler for ManageSymbolsHandler {
    fn definition(&self) -> crate::types::ToolDefinition {
        crate::types::ToolDefinition::new(
            "manage_symbols",
            "Manage the codebase symbol index for advanced navigation"
        )
    }

    fn is_mutating(&self) -> bool {
        true // This can modify the index
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args = serde_json::from_value::<ManageSymbolsArgs>(input)
            .map_err(|e| ToolError::InvalidInput(format!("Invalid arguments: {}", e)))?;
        
        let working_dir = std::env::current_dir()?;
        let working_dir_str = working_dir.to_str()
            .ok_or_else(|| ToolError::InvalidInput("Invalid working directory".to_string()))?;
        
        let service = SymbolIndexService::new(working_dir_str).await?;
        
        match args.action {
            SymbolAction::Rebuild => {
                eprintln!("Building symbol index...");
                let result = service.build(args.force.unwrap_or(false)).await?;
                Ok(ToolOutput::success(format!(
                    "Symbol index rebuilt:\n- {} files indexed\n- {} symbols found\n- {} definitions",
                    result.files_indexed, result.total_symbols, result.total_symbols
                )))
            }
            SymbolAction::Stats => {
                let stats = service.get_stats().await?;
                Ok(ToolOutput::success(format!(
                    "Symbol index statistics:\n- {} indexed files\n- {} symbols\n- {} imports",
                    stats.total_files,
                    stats.total_symbols,
                    stats.total_imports
                )))
            }
        }
    }
}