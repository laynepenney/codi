// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! LSP server configuration.
//!
//! This module provides configuration types for LSP servers, including
//! per-language defaults and user customization.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Configuration for an LSP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerConfig {
    /// Server name/identifier (e.g., "rust-analyzer", "typescript-language-server").
    pub name: String,
    /// Command to start the server.
    pub command: String,
    /// Command arguments.
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment variables.
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// File types this server handles (extensions without dot, e.g., "rs", "ts").
    #[serde(default)]
    pub file_types: Vec<String>,
    /// Root markers to detect project root (e.g., "Cargo.toml", "package.json").
    #[serde(default)]
    pub root_markers: Vec<String>,
    /// LSP initialization options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub init_options: Option<serde_json::Value>,
    /// Server-specific settings (workspace/configuration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Value>,
    /// Whether the server is disabled.
    #[serde(default)]
    pub disabled: bool,
    /// Startup timeout in milliseconds.
    #[serde(default = "default_startup_timeout")]
    pub startup_timeout_ms: u64,
    /// Request timeout in milliseconds.
    #[serde(default = "default_request_timeout")]
    pub request_timeout_ms: u64,
}

fn default_startup_timeout() -> u64 {
    30000 // 30 seconds
}

fn default_request_timeout() -> u64 {
    10000 // 10 seconds
}

impl LspServerConfig {
    /// Create a new server config.
    pub fn new(name: impl Into<String>, command: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            command: command.into(),
            args: Vec::new(),
            env: HashMap::new(),
            file_types: Vec::new(),
            root_markers: Vec::new(),
            init_options: None,
            settings: None,
            disabled: false,
            startup_timeout_ms: default_startup_timeout(),
            request_timeout_ms: default_request_timeout(),
        }
    }

    /// Add file types.
    pub fn with_file_types(mut self, types: &[&str]) -> Self {
        self.file_types = types.iter().map(|s| s.to_string()).collect();
        self
    }

    /// Add root markers.
    pub fn with_root_markers(mut self, markers: &[&str]) -> Self {
        self.root_markers = markers.iter().map(|s| s.to_string()).collect();
        self
    }

    /// Add command arguments.
    pub fn with_args(mut self, args: &[&str]) -> Self {
        self.args = args.iter().map(|s| s.to_string()).collect();
        self
    }

    /// Check if this server handles the given file extension.
    pub fn handles_extension(&self, ext: &str) -> bool {
        if self.file_types.is_empty() {
            return false;
        }
        let ext_lower = ext.to_lowercase();
        self.file_types.iter().any(|t| t.to_lowercase() == ext_lower)
    }

    /// Check if this server handles the given file path.
    pub fn handles_file(&self, path: &Path) -> bool {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| self.handles_extension(e))
            .unwrap_or(false)
    }

    /// Check if a root marker exists in the given directory.
    pub fn has_root_marker(&self, dir: &Path) -> bool {
        self.root_markers.iter().any(|marker| {
            // Support glob-like patterns
            if marker.contains('*') {
                // Simple glob matching - check if any file matches
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            if glob_matches(marker, name) {
                                return true;
                            }
                        }
                    }
                }
                false
            } else {
                dir.join(marker).exists()
            }
        })
    }
}

/// Simple glob matching (only supports * wildcard).
fn glob_matches(pattern: &str, name: &str) -> bool {
    if !pattern.contains('*') {
        return pattern == name;
    }

    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() != 2 {
        return false; // Only support single * for now
    }

    let (prefix, suffix) = (parts[0], parts[1]);
    name.starts_with(prefix) && name.ends_with(suffix)
}

/// Global LSP configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LspConfig {
    /// Whether to auto-detect LSP servers.
    #[serde(default = "default_true")]
    pub auto_detect: bool,
    /// LSP server configurations by name.
    #[serde(default)]
    pub servers: HashMap<String, LspServerConfig>,
    /// Whether to enable LSP debug logging.
    #[serde(default)]
    pub debug: bool,
}

fn default_true() -> bool {
    true
}

impl LspConfig {
    /// Create a new LSP config with defaults.
    pub fn new() -> Self {
        Self {
            auto_detect: true,
            servers: HashMap::new(),
            debug: false,
        }
    }

    /// Create a config with default server configurations.
    pub fn with_defaults() -> Self {
        let mut config = Self::new();

        // Add default server configurations
        for server in default_server_configs() {
            config.servers.insert(server.name.clone(), server);
        }

        config
    }

    /// Get the server config for a file extension.
    pub fn server_for_extension(&self, ext: &str) -> Option<&LspServerConfig> {
        self.servers
            .values()
            .find(|s| !s.disabled && s.handles_extension(ext))
    }

    /// Get the server config for a file path.
    pub fn server_for_file(&self, path: &Path) -> Option<&LspServerConfig> {
        path.extension()
            .and_then(|e| e.to_str())
            .and_then(|ext| self.server_for_extension(ext))
    }

    /// Get all enabled servers.
    pub fn enabled_servers(&self) -> impl Iterator<Item = &LspServerConfig> {
        self.servers.values().filter(|s| !s.disabled)
    }

    /// Find servers that match the project (have root markers).
    pub fn servers_for_project(&self, project_root: &Path) -> Vec<&LspServerConfig> {
        self.servers
            .values()
            .filter(|s| !s.disabled && s.has_root_marker(project_root))
            .collect()
    }

    /// Merge user config over defaults.
    pub fn merge(&mut self, other: &LspConfig) {
        self.auto_detect = other.auto_detect;
        self.debug = other.debug;

        // Merge server configs
        for (name, server) in &other.servers {
            if let Some(existing) = self.servers.get_mut(name) {
                // Merge: user config overrides defaults
                if !server.command.is_empty() {
                    existing.command = server.command.clone();
                }
                if !server.args.is_empty() {
                    existing.args = server.args.clone();
                }
                if !server.env.is_empty() {
                    existing.env.extend(server.env.clone());
                }
                if !server.file_types.is_empty() {
                    existing.file_types = server.file_types.clone();
                }
                if !server.root_markers.is_empty() {
                    existing.root_markers = server.root_markers.clone();
                }
                if server.init_options.is_some() {
                    existing.init_options = server.init_options.clone();
                }
                if server.settings.is_some() {
                    existing.settings = server.settings.clone();
                }
                existing.disabled = server.disabled;
            } else {
                // Add new server
                self.servers.insert(name.clone(), server.clone());
            }
        }
    }
}

/// Get default LSP server configurations.
pub fn default_server_configs() -> Vec<LspServerConfig> {
    vec![
        // Rust
        LspServerConfig::new("rust-analyzer", "rust-analyzer")
            .with_file_types(&["rs"])
            .with_root_markers(&["Cargo.toml", "rust-project.json"]),

        // TypeScript/JavaScript
        LspServerConfig::new("typescript-language-server", "typescript-language-server")
            .with_args(&["--stdio"])
            .with_file_types(&["ts", "tsx", "js", "jsx", "mts", "mjs", "cts", "cjs"])
            .with_root_markers(&["tsconfig.json", "jsconfig.json", "package.json"]),

        // Python
        LspServerConfig::new("pyright", "pyright-langserver")
            .with_args(&["--stdio"])
            .with_file_types(&["py", "pyi"])
            .with_root_markers(&["pyproject.toml", "setup.py", "requirements.txt", "pyrightconfig.json"]),

        // Go
        LspServerConfig::new("gopls", "gopls")
            .with_file_types(&["go", "mod"])
            .with_root_markers(&["go.mod", "go.work"]),

        // C/C++
        LspServerConfig::new("clangd", "clangd")
            .with_file_types(&["c", "cpp", "cc", "cxx", "h", "hpp", "hxx"])
            .with_root_markers(&["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt"]),

        // JSON
        LspServerConfig::new("vscode-json-languageserver", "vscode-json-languageserver")
            .with_args(&["--stdio"])
            .with_file_types(&["json", "jsonc"]),

        // YAML
        LspServerConfig::new("yaml-language-server", "yaml-language-server")
            .with_args(&["--stdio"])
            .with_file_types(&["yaml", "yml"]),

        // Lua
        LspServerConfig::new("lua-language-server", "lua-language-server")
            .with_file_types(&["lua"])
            .with_root_markers(&[".luarc.json", ".luarc.jsonc", ".luacheckrc"]),

        // Zig
        LspServerConfig::new("zls", "zls")
            .with_file_types(&["zig"])
            .with_root_markers(&["build.zig", "zls.json"]),
    ]
}

/// Language ID for a file extension (as expected by LSP servers).
pub fn language_id_for_extension(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "rs" => "rust",
        "ts" => "typescript",
        "tsx" => "typescriptreact",
        "js" => "javascript",
        "jsx" => "javascriptreact",
        "mts" | "cts" => "typescript",
        "mjs" | "cjs" => "javascript",
        "py" | "pyi" => "python",
        "go" => "go",
        "c" => "c",
        "cpp" | "cc" | "cxx" => "cpp",
        "h" => "c",
        "hpp" | "hxx" => "cpp",
        "json" => "json",
        "jsonc" => "jsonc",
        "yaml" | "yml" => "yaml",
        "lua" => "lua",
        "zig" => "zig",
        "md" | "markdown" => "markdown",
        "toml" => "toml",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "sql" => "sql",
        "sh" | "bash" => "shellscript",
        "ps1" => "powershell",
        "rb" => "ruby",
        "php" => "php",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "cs" => "csharp",
        "fs" | "fsx" => "fsharp",
        "ex" | "exs" => "elixir",
        "erl" | "hrl" => "erlang",
        "hs" => "haskell",
        "ml" | "mli" => "ocaml",
        "vim" => "vim",
        "xml" | "xsd" | "xsl" => "xml",
        _ => "plaintext",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_server_config_handles_extension() {
        let config = LspServerConfig::new("rust-analyzer", "rust-analyzer")
            .with_file_types(&["rs"]);

        assert!(config.handles_extension("rs"));
        assert!(config.handles_extension("RS"));
        assert!(!config.handles_extension("py"));
    }

    #[test]
    fn test_server_config_handles_file() {
        let config = LspServerConfig::new("rust-analyzer", "rust-analyzer")
            .with_file_types(&["rs"]);

        assert!(config.handles_file(Path::new("/foo/bar.rs")));
        assert!(!config.handles_file(Path::new("/foo/bar.py")));
    }

    #[test]
    fn test_server_config_has_root_marker() {
        let temp = tempdir().unwrap();
        let dir = temp.path();

        // Create a Cargo.toml
        std::fs::write(dir.join("Cargo.toml"), "[package]").unwrap();

        let config = LspServerConfig::new("rust-analyzer", "rust-analyzer")
            .with_root_markers(&["Cargo.toml"]);

        assert!(config.has_root_marker(dir));
    }

    #[test]
    fn test_lsp_config_server_for_extension() {
        let config = LspConfig::with_defaults();

        let rust = config.server_for_extension("rs");
        assert!(rust.is_some());
        assert_eq!(rust.unwrap().name, "rust-analyzer");

        let ts = config.server_for_extension("ts");
        assert!(ts.is_some());
        assert_eq!(ts.unwrap().name, "typescript-language-server");
    }

    #[test]
    fn test_lsp_config_merge() {
        let mut config = LspConfig::with_defaults();

        let mut user = LspConfig::new();
        user.servers.insert(
            "rust-analyzer".to_string(),
            LspServerConfig::new("rust-analyzer", "/custom/path/rust-analyzer"),
        );

        config.merge(&user);

        let rust = config.servers.get("rust-analyzer").unwrap();
        assert_eq!(rust.command, "/custom/path/rust-analyzer");
    }

    #[test]
    fn test_language_id_for_extension() {
        assert_eq!(language_id_for_extension("rs"), "rust");
        assert_eq!(language_id_for_extension("ts"), "typescript");
        assert_eq!(language_id_for_extension("tsx"), "typescriptreact");
        assert_eq!(language_id_for_extension("py"), "python");
        assert_eq!(language_id_for_extension("go"), "go");
        assert_eq!(language_id_for_extension("unknown"), "plaintext");
    }

    #[test]
    fn test_glob_matches() {
        assert!(glob_matches("*.go", "main.go"));
        assert!(glob_matches("*.go", "test.go"));
        assert!(!glob_matches("*.go", "main.rs"));
        assert!(glob_matches("Cargo*", "Cargo.toml"));
        assert!(glob_matches("Cargo*", "Cargo.lock"));
    }

    #[test]
    fn test_default_server_configs() {
        let configs = default_server_configs();

        // Should have at least the main servers
        assert!(configs.iter().any(|c| c.name == "rust-analyzer"));
        assert!(configs.iter().any(|c| c.name == "typescript-language-server"));
        assert!(configs.iter().any(|c| c.name == "gopls"));
        assert!(configs.iter().any(|c| c.name == "pyright"));
    }
}
