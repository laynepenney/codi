// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! LSP client implementation.
//!
//! This module provides an LSP client that manages communication with
//! language servers using JSON-RPC over stdio.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

use super::config::{language_id_for_extension, LspServerConfig};
use super::diagnostics::DiagnosticCache;
use super::error::{LspError, LspResult};
use super::types::{
    Diagnostic, DiagnosticCounts, DiagnosticSeverity, DiagnosticTag, DocumentSymbol, Location,
    LspSymbolKind, Position, Range, ServerState, WorkspaceSymbol,
};

/// Callback for diagnostic updates.
pub type DiagnosticCallback = Arc<dyn Fn(&DiagnosticCounts) + Send + Sync>;

/// An LSP client for a single language server.
pub struct LspClient {
    /// Server configuration.
    config: LspServerConfig,
    /// Working directory (project root).
    work_dir: PathBuf,
    /// Server process.
    process: Mutex<Option<Child>>,
    /// Server state.
    state: Arc<RwLock<ServerState>>,
    /// Request ID counter.
    request_id: AtomicU64,
    /// Pending requests waiting for responses.
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    /// Diagnostic cache.
    diagnostics: Arc<DiagnosticCache>,
    /// Open files tracking (uri -> version).
    open_files: RwLock<HashMap<String, i32>>,
    /// Diagnostic callback.
    diagnostic_callback: Arc<RwLock<Option<DiagnosticCallback>>>,
    /// Message sender channel.
    tx: Mutex<Option<mpsc::Sender<String>>>,
    /// Server capabilities.
    capabilities: RwLock<Option<serde_json::Value>>,
}

impl LspClient {
    /// Create a new LSP client.
    pub fn new(config: LspServerConfig, work_dir: impl Into<PathBuf>) -> Self {
        Self {
            config,
            work_dir: work_dir.into(),
            process: Mutex::new(None),
            state: Arc::new(RwLock::new(ServerState::Starting)),
            request_id: AtomicU64::new(1),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            diagnostics: Arc::new(DiagnosticCache::new()),
            open_files: RwLock::new(HashMap::new()),
            diagnostic_callback: Arc::new(RwLock::new(None)),
            tx: Mutex::new(None),
            capabilities: RwLock::new(None),
        }
    }

    /// Get the server name.
    pub fn name(&self) -> &str {
        &self.config.name
    }

    /// Get the current server state.
    pub async fn state(&self) -> ServerState {
        *self.state.read().await
    }

    /// Check if the server is ready.
    pub async fn is_ready(&self) -> bool {
        *self.state.read().await == ServerState::Ready
    }

    /// Set the diagnostic callback.
    pub async fn set_diagnostic_callback(&self, callback: DiagnosticCallback) {
        *self.diagnostic_callback.write().await = Some(callback);
    }

    /// Get diagnostic counts.
    pub fn diagnostic_counts(&self) -> DiagnosticCounts {
        self.diagnostics.counts()
    }

    /// Get diagnostics for a file.
    pub fn file_diagnostics(&self, uri: &str) -> Vec<Diagnostic> {
        self.diagnostics.get(uri)
    }

    /// Get all diagnostics.
    pub fn all_diagnostics(&self) -> HashMap<String, Vec<Diagnostic>> {
        self.diagnostics.all()
    }

    /// Format diagnostics for display.
    pub fn format_diagnostics(&self, max_per_severity: Option<usize>) -> String {
        self.diagnostics.format(max_per_severity)
    }

    /// Check if this client handles the given file.
    pub fn handles_file(&self, path: &Path) -> bool {
        // Check if file is within working directory
        if let Ok(rel) = path.strip_prefix(&self.work_dir) {
            // Check extension
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                return self.config.handles_extension(ext);
            }
            // If no extension but file is in workdir and we handle all files
            return self.config.file_types.is_empty() && !rel.to_string_lossy().starts_with("..");
        }
        false
    }

    /// Start the language server.
    pub async fn start(&self) -> LspResult<()> {
        // Set state to starting
        *self.state.write().await = ServerState::Starting;

        // Build command
        let mut cmd = Command::new(&self.config.command);
        cmd.args(&self.config.args)
            .current_dir(&self.work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Set environment variables
        for (key, value) in &self.config.env {
            cmd.env(key, value);
        }

        // Spawn process
        let mut process = cmd.spawn().map_err(|e| {
            LspError::StartupFailed(format!("Failed to spawn {}: {}", self.config.command, e))
        })?;

        // Get stdio handles
        let stdin = process.stdin.take().ok_or_else(|| {
            LspError::StartupFailed("Failed to get stdin".to_string())
        })?;
        let stdout = process.stdout.take().ok_or_else(|| {
            LspError::StartupFailed("Failed to get stdout".to_string())
        })?;

        // Store process
        *self.process.lock().await = Some(process);

        // Create message channel
        let (tx, mut rx) = mpsc::channel::<String>(100);
        *self.tx.lock().await = Some(tx);

        // Spawn writer task
        let mut writer = stdin;
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                let header = format!("Content-Length: {}\r\n\r\n", msg.len());
                if writer.write_all(header.as_bytes()).await.is_err() {
                    break;
                }
                if writer.write_all(msg.as_bytes()).await.is_err() {
                    break;
                }
                if writer.flush().await.is_err() {
                    break;
                }
            }
        });

        // Spawn reader task
        let pending = Arc::clone(&self.pending_requests);
        let diagnostics = Arc::clone(&self.diagnostics);
        let callback = Arc::clone(&self.diagnostic_callback);
        let state = Arc::clone(&self.state);

        let reader = BufReader::new(stdout);
        tokio::spawn(Self::read_messages(reader, pending, diagnostics, callback, state));

        // Send initialize request
        self.initialize().await?;

        Ok(())
    }

    /// Stop the language server.
    pub async fn stop(&self) -> LspResult<()> {
        // Send shutdown request if ready
        if *self.state.read().await == ServerState::Ready {
            let _ = self.request("shutdown", serde_json::Value::Null).await;
            self.notify("exit", serde_json::Value::Null).await?;
        }

        // Kill process
        if let Some(mut process) = self.process.lock().await.take() {
            let _ = process.kill().await;
        }

        *self.state.write().await = ServerState::Shutdown;
        Ok(())
    }

    /// Restart the language server.
    pub async fn restart(&self) -> LspResult<()> {
        self.stop().await?;
        self.start().await?;

        // Reopen files that were previously open
        let files: Vec<_> = self.open_files.read().await.keys().cloned().collect();
        for uri in files {
            // Try to read and reopen
            if let Some(path) = uri.strip_prefix("file://") {
                if let Ok(content) = tokio::fs::read_to_string(path).await {
                    let ext = Path::new(path)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");
                    self.did_open(&uri, language_id_for_extension(ext), 0, &content).await?;
                }
            }
        }

        Ok(())
    }

    /// Initialize the LSP connection.
    async fn initialize(&self) -> LspResult<()> {
        let root_uri = format!("file://{}", self.work_dir.display());

        let params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "rootPath": self.work_dir.display().to_string(),
            "capabilities": {
                "textDocument": {
                    "synchronization": {
                        "dynamicRegistration": false,
                        "willSave": false,
                        "willSaveWaitUntil": false,
                        "didSave": true
                    },
                    "completion": {
                        "dynamicRegistration": false,
                        "completionItem": {
                            "snippetSupport": false
                        }
                    },
                    "hover": {
                        "dynamicRegistration": false,
                        "contentFormat": ["plaintext", "markdown"]
                    },
                    "signatureHelp": {
                        "dynamicRegistration": false
                    },
                    "definition": {
                        "dynamicRegistration": false
                    },
                    "references": {
                        "dynamicRegistration": false
                    },
                    "documentSymbol": {
                        "dynamicRegistration": false,
                        "hierarchicalDocumentSymbolSupport": true
                    },
                    "publishDiagnostics": {
                        "relatedInformation": true,
                        "tagSupport": {
                            "valueSet": [1, 2]
                        }
                    }
                },
                "workspace": {
                    "workspaceFolders": true,
                    "symbol": {
                        "dynamicRegistration": false
                    }
                }
            },
            "workspaceFolders": [{
                "uri": root_uri,
                "name": self.work_dir.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("workspace")
            }]
        });

        // Merge init options if provided
        let params = if let Some(ref init_options) = self.config.init_options {
            let mut p = params;
            p["initializationOptions"] = init_options.clone();
            p
        } else {
            params
        };

        let response = self.request("initialize", params).await?;

        // Store capabilities
        if let Some(capabilities) = response.get("capabilities") {
            *self.capabilities.write().await = Some(capabilities.clone());
        }

        // Send initialized notification
        self.notify("initialized", serde_json::json!({})).await?;

        // Update state
        *self.state.write().await = ServerState::Ready;

        Ok(())
    }

    /// Send a request to the server.
    async fn request(&self, method: &str, params: serde_json::Value) -> LspResult<serde_json::Value> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        // Create response channel
        let (tx, rx) = oneshot::channel();
        self.pending_requests.lock().await.insert(id, tx);

        // Send request
        let msg = serde_json::to_string(&request)?;
        if let Some(ref sender) = *self.tx.lock().await {
            sender.send(msg).await.map_err(|_| {
                LspError::CommunicationError("Failed to send request".to_string())
            })?;
        } else {
            return Err(LspError::NotReady("Server not started".to_string()));
        }

        // Wait for response with timeout
        let timeout = tokio::time::Duration::from_millis(self.config.request_timeout_ms);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(response)) => {
                // Check for error
                if let Some(error) = response.get("error") {
                    let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(-1) as i32;
                    let message = error.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error");
                    return Err(LspError::server_error(code, message));
                }
                Ok(response.get("result").cloned().unwrap_or(serde_json::Value::Null))
            }
            Ok(Err(_)) => Err(LspError::CommunicationError("Channel closed".to_string())),
            Err(_) => {
                // Remove pending request
                self.pending_requests.lock().await.remove(&id);
                Err(LspError::Timeout(self.config.request_timeout_ms))
            }
        }
    }

    /// Send a notification to the server.
    async fn notify(&self, method: &str, params: serde_json::Value) -> LspResult<()> {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });

        let msg = serde_json::to_string(&notification)?;
        if let Some(ref sender) = *self.tx.lock().await {
            sender.send(msg).await.map_err(|_| {
                LspError::CommunicationError("Failed to send notification".to_string())
            })?;
        }

        Ok(())
    }

    /// Read messages from the server.
    async fn read_messages(
        mut reader: BufReader<tokio::process::ChildStdout>,
        pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
        diagnostics: Arc<DiagnosticCache>,
        callback: Arc<RwLock<Option<DiagnosticCallback>>>,
        state: Arc<RwLock<ServerState>>,
    ) {
        let mut content_length: Option<usize> = None;
        let mut line_buf = String::new();

        loop {
            line_buf.clear();
            match reader.read_line(&mut line_buf).await {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let line = line_buf.trim();

                    // Parse headers
                    if line.starts_with("Content-Length:") {
                        if let Ok(len) = line[15..].trim().parse() {
                            content_length = Some(len);
                        }
                    } else if line.is_empty() {
                        // End of headers, read content
                        if let Some(len) = content_length.take() {
                            let mut content = vec![0u8; len];
                            if reader.read_exact(&mut content).await.is_err() {
                                break;
                            }

                            if let Ok(msg) = serde_json::from_slice::<serde_json::Value>(&content) {
                                Self::handle_message(msg, &pending, &diagnostics, &callback).await;
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }

        // Server disconnected
        *state.write().await = ServerState::Error;
    }

    /// Handle a received message.
    async fn handle_message(
        msg: serde_json::Value,
        pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
        diagnostics: &Arc<DiagnosticCache>,
        callback: &Arc<RwLock<Option<DiagnosticCallback>>>,
    ) {
        // Check if it's a response
        if let Some(id) = msg.get("id").and_then(|i| i.as_u64()) {
            if let Some(tx) = pending.lock().await.remove(&id) {
                let _ = tx.send(msg);
            }
            return;
        }

        // Check if it's a notification
        if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
            match method {
                "textDocument/publishDiagnostics" => {
                    if let Some(params) = msg.get("params") {
                        Self::handle_diagnostics(params, diagnostics, callback).await;
                    }
                }
                "window/showMessage" | "window/logMessage" => {
                    // Could log these
                }
                _ => {}
            }
        }
    }

    /// Handle publishDiagnostics notification.
    async fn handle_diagnostics(
        params: &serde_json::Value,
        cache: &Arc<DiagnosticCache>,
        callback: &Arc<RwLock<Option<DiagnosticCallback>>>,
    ) {
        let uri = params.get("uri").and_then(|u| u.as_str()).unwrap_or("");
        let diags = params.get("diagnostics").and_then(|d| d.as_array());

        let diagnostics: Vec<Diagnostic> = diags
            .map(|arr| {
                arr.iter()
                    .filter_map(|d| parse_diagnostic(d))
                    .collect()
            })
            .unwrap_or_default();

        cache.set(uri, diagnostics);

        // Notify callback
        if let Some(ref cb) = *callback.read().await {
            let counts = cache.counts();
            cb(&counts);
        }
    }

    // === Document Synchronization ===

    /// Notify server that a document was opened.
    pub async fn did_open(
        &self,
        uri: &str,
        language_id: &str,
        version: i32,
        text: &str,
    ) -> LspResult<()> {
        self.open_files.write().await.insert(uri.to_string(), version);

        self.notify(
            "textDocument/didOpen",
            serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": version,
                    "text": text
                }
            }),
        ).await
    }

    /// Notify server that a document was changed.
    pub async fn did_change(&self, uri: &str, version: i32, text: &str) -> LspResult<()> {
        self.open_files.write().await.insert(uri.to_string(), version);

        self.notify(
            "textDocument/didChange",
            serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "version": version
                },
                "contentChanges": [{
                    "text": text
                }]
            }),
        ).await
    }

    /// Notify server that a document was saved.
    pub async fn did_save(&self, uri: &str, text: Option<&str>) -> LspResult<()> {
        let mut params = serde_json::json!({
            "textDocument": {
                "uri": uri
            }
        });

        if let Some(text) = text {
            params["text"] = serde_json::Value::String(text.to_string());
        }

        self.notify("textDocument/didSave", params).await
    }

    /// Notify server that a document was closed.
    pub async fn did_close(&self, uri: &str) -> LspResult<()> {
        self.open_files.write().await.remove(uri);

        self.notify(
            "textDocument/didClose",
            serde_json::json!({
                "textDocument": {
                    "uri": uri
                }
            }),
        ).await
    }

    /// Open a file on demand if not already open.
    pub async fn open_file_on_demand(&self, path: &Path) -> LspResult<String> {
        let uri = format!("file://{}", path.display());

        if !self.open_files.read().await.contains_key(&uri) {
            let content = tokio::fs::read_to_string(path).await.map_err(|e| {
                LspError::FileNotFound(format!("{}: {}", path.display(), e))
            })?;

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let language_id = language_id_for_extension(ext);

            self.did_open(&uri, language_id, 0, &content).await?;
        }

        Ok(uri)
    }

    // === Language Features ===

    /// Get hover information.
    pub async fn hover(&self, uri: &str, line: u32, character: u32) -> LspResult<Option<String>> {
        let result = self.request(
            "textDocument/hover",
            serde_json::json!({
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character }
            }),
        ).await?;

        // Extract hover content
        if result.is_null() {
            return Ok(None);
        }

        let contents = result.get("contents");
        let text = match contents {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(serde_json::Value::Object(obj)) => {
                obj.get("value").and_then(|v| v.as_str()).map(String::from)
            }
            Some(serde_json::Value::Array(arr)) => {
                let parts: Vec<String> = arr.iter()
                    .filter_map(|v| {
                        match v {
                            serde_json::Value::String(s) => Some(s.clone()),
                            serde_json::Value::Object(obj) => {
                                obj.get("value").and_then(|v| v.as_str()).map(String::from)
                            }
                            _ => None,
                        }
                    })
                    .collect();
                if parts.is_empty() { None } else { Some(parts.join("\n\n")) }
            }
            _ => None,
        };

        Ok(text)
    }

    /// Go to definition.
    pub async fn definition(&self, uri: &str, line: u32, character: u32) -> LspResult<Vec<Location>> {
        let result = self.request(
            "textDocument/definition",
            serde_json::json!({
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character }
            }),
        ).await?;

        parse_locations(&result)
    }

    /// Find references.
    pub async fn references(
        &self,
        uri: &str,
        line: u32,
        character: u32,
        include_declaration: bool,
    ) -> LspResult<Vec<Location>> {
        let result = self.request(
            "textDocument/references",
            serde_json::json!({
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character },
                "context": { "includeDeclaration": include_declaration }
            }),
        ).await?;

        parse_locations(&result)
    }

    /// Get document symbols.
    pub async fn document_symbols(&self, uri: &str) -> LspResult<Vec<DocumentSymbol>> {
        let result = self.request(
            "textDocument/documentSymbol",
            serde_json::json!({
                "textDocument": { "uri": uri }
            }),
        ).await?;

        parse_document_symbols(&result)
    }

    /// Search workspace symbols.
    pub async fn workspace_symbols(&self, query: &str) -> LspResult<Vec<WorkspaceSymbol>> {
        let result = self.request(
            "workspace/symbol",
            serde_json::json!({
                "query": query
            }),
        ).await?;

        parse_workspace_symbols(&result)
    }
}

// === Parsing Helpers ===

fn parse_diagnostic(value: &serde_json::Value) -> Option<Diagnostic> {
    let range = parse_range(value.get("range"))?;
    let message = value.get("message")?.as_str()?.to_string();
    let severity = value
        .get("severity")
        .and_then(|s| s.as_i64())
        .and_then(|s| DiagnosticSeverity::from_lsp(s as i32))
        .unwrap_or(DiagnosticSeverity::Information);

    let code = value.get("code").and_then(|c| {
        match c {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    });

    let source = value.get("source").and_then(|s| s.as_str()).map(String::from);

    let tags: Vec<DiagnosticTag> = value
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_i64().and_then(|t| DiagnosticTag::from_lsp(t as i32)))
                .collect()
        })
        .unwrap_or_default();

    let mut diag = Diagnostic::new(range, severity, message);
    diag.code = code;
    diag.source = source;
    diag.tags = tags;

    Some(diag)
}

fn parse_range(value: Option<&serde_json::Value>) -> Option<Range> {
    let obj = value?;
    let start = parse_position(obj.get("start")?)?;
    let end = parse_position(obj.get("end")?)?;
    Some(Range::new(start, end))
}

fn parse_position(value: &serde_json::Value) -> Option<Position> {
    let line = value.get("line")?.as_u64()? as u32;
    let character = value.get("character")?.as_u64()? as u32;
    Some(Position::new(line, character))
}

fn parse_locations(value: &serde_json::Value) -> LspResult<Vec<Location>> {
    let mut locations = Vec::new();

    match value {
        serde_json::Value::Null => {}
        serde_json::Value::Object(_) => {
            if let Some(loc) = parse_location(value) {
                locations.push(loc);
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(loc) = parse_location(item) {
                    locations.push(loc);
                }
            }
        }
        _ => {}
    }

    Ok(locations)
}

fn parse_location(value: &serde_json::Value) -> Option<Location> {
    let uri = value.get("uri")?.as_str()?.to_string();
    let range = parse_range(value.get("range"))?;
    Some(Location::new(uri, range))
}

fn parse_document_symbols(value: &serde_json::Value) -> LspResult<Vec<DocumentSymbol>> {
    let mut symbols = Vec::new();

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(sym) = parse_document_symbol(item) {
                symbols.push(sym);
            }
        }
    }

    Ok(symbols)
}

fn parse_document_symbol(value: &serde_json::Value) -> Option<DocumentSymbol> {
    let name = value.get("name")?.as_str()?.to_string();
    let kind_num = value.get("kind")?.as_i64()? as i32;
    let kind = LspSymbolKind::from_lsp(kind_num)?;
    let range = parse_range(value.get("range"))?;
    let selection_range = parse_range(value.get("selectionRange")).unwrap_or(range);
    let detail = value.get("detail").and_then(|d| d.as_str()).map(String::from);

    let children: Vec<DocumentSymbol> = value
        .get("children")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| parse_document_symbol(item))
                .collect()
        })
        .unwrap_or_default();

    Some(DocumentSymbol {
        name,
        kind,
        range,
        selection_range,
        detail,
        children,
    })
}

fn parse_workspace_symbols(value: &serde_json::Value) -> LspResult<Vec<WorkspaceSymbol>> {
    let mut symbols = Vec::new();

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(sym) = parse_workspace_symbol(item) {
                symbols.push(sym);
            }
        }
    }

    Ok(symbols)
}

fn parse_workspace_symbol(value: &serde_json::Value) -> Option<WorkspaceSymbol> {
    let name = value.get("name")?.as_str()?.to_string();
    let kind_num = value.get("kind")?.as_i64()? as i32;
    let kind = LspSymbolKind::from_lsp(kind_num)?;
    let location = parse_location(value.get("location")?)?;
    let container_name = value
        .get("containerName")
        .and_then(|c| c.as_str())
        .map(String::from);

    Some(WorkspaceSymbol {
        name,
        kind,
        location,
        container_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_position() {
        let json = serde_json::json!({
            "line": 10,
            "character": 5
        });
        let pos = parse_position(&json).unwrap();
        assert_eq!(pos.line, 10);
        assert_eq!(pos.character, 5);
    }

    #[test]
    fn test_parse_range() {
        let json = serde_json::json!({
            "start": { "line": 10, "character": 0 },
            "end": { "line": 10, "character": 20 }
        });
        let range = parse_range(Some(&json)).unwrap();
        assert_eq!(range.start.line, 10);
        assert_eq!(range.end.character, 20);
    }

    #[test]
    fn test_parse_diagnostic() {
        let json = serde_json::json!({
            "range": {
                "start": { "line": 5, "character": 0 },
                "end": { "line": 5, "character": 10 }
            },
            "severity": 1,
            "code": "E0001",
            "source": "rustc",
            "message": "expected `;`"
        });

        let diag = parse_diagnostic(&json).unwrap();
        assert_eq!(diag.severity, DiagnosticSeverity::Error);
        assert_eq!(diag.code, Some("E0001".to_string()));
        assert_eq!(diag.source, Some("rustc".to_string()));
        assert_eq!(diag.message, "expected `;`");
    }

    #[test]
    fn test_parse_location() {
        let json = serde_json::json!({
            "uri": "file:///test.rs",
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 10 }
            }
        });

        let loc = parse_location(&json).unwrap();
        assert_eq!(loc.uri, "file:///test.rs");
        assert_eq!(loc.file_path(), Some("/test.rs"));
    }

    #[test]
    fn test_client_handles_file() {
        let config = LspServerConfig::new("rust-analyzer", "rust-analyzer")
            .with_file_types(&["rs"]);
        let client = LspClient::new(config, "/project");

        assert!(client.handles_file(Path::new("/project/src/main.rs")));
        assert!(!client.handles_file(Path::new("/project/src/main.py")));
        assert!(!client.handles_file(Path::new("/other/main.rs")));
    }
}
