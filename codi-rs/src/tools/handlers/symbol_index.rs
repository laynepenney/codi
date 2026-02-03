// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Symbol index tools for advanced code navigation.

use async_trait::async_trait;
use serde::Deserialize;

use crate::error::ToolError;
use crate::symbol_index::SymbolIndexService;
use crate::tools::{ToolHandler, ToolOutput};

/// Find symbols matching a query across the codebase.
#[derive(Debug, Clone, Default)]
pub struct FindSymbolHandler;

#[derive(Debug, Deserialize)]
struct FindSymbolArgs {
    /// Symbol name to search for.
    query: String,
    /// Maximum number of results to return.
    #[serde(default)]
    limit: Option<usize>,
    /// Search in a specific file only.
    #[serde(default)]
    file: Option<String>,
}

#[async_trait]
impl ToolHandler for FindSymbolHandler {
    fn definition(&self) -> crate::types::ToolDefinition {
        crate::types::ToolDefinition::new(
            "find_symbol",
            "Find symbols matching a query across the codebase using fuzzy search"
        )
    }

    fn is_mutating(&self) -> bool {
        false
    }

    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args = serde_json::from_value::<FindSymbolArgs>(input)
            .map_err(|e| ToolError::InvalidInput(format!("Invalid arguments: {}", e)))?;
        
        let working_dir = std::env::current_dir()?;
        
        // Create symbol index service
        let working_dir_str = working_dir.to_str()
            .ok_or_else(|| ToolError::InvalidInput("Invalid working directory".to_string()))?;
            
        let service = SymbolIndexService::new(working_dir_str).await?;
        
        // Check if we need to initialize
        let is_empty = service.is_empty().await?;
        if is_empty {
            eprintln!("Symbol index not built. Building it now...");
            let result = service.build(true).await?;
            eprintln!("Indexed {} files, {} symbols", result.files_indexed, result.total_symbols);
        }
        
        let results = if let Some(file_path) = &args.file {
            service.find_symbols_in_file(file_path).await?
        } else {
            service.find_symbols(&args.query, args.limit).await?
        };
            
        if results.is_empty() {
            return Ok(ToolOutput::success("No symbols found matching the query"));
        }
        
        let mut output = format!("Found {} symbols:\n\n", results.len());
        for (i, result) in results.iter().enumerate() {
            if i > 0 { output.push('\n'); }
            output.push_str(&format!(
                "🔍 {} `{}` in {}\n  📄 {}:{}{} (score: {:.2}){}",
                result.kind,
                &result.name,
                result.visibility,
                &result.file,
                result.line,
                result.end_line.map(|l| format!("-{}", l)).unwrap_or_default(),
                result.score,
                result.signature
                    .as_ref()
                    .map(|s| format!("\n  📝 {}", s))
                    .unwrap_or_default()
            ));
        }
        
        Ok(ToolOutput::success(output))
    }
}