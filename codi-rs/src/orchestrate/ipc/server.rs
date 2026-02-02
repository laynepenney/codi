// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC server for the commander.
//!
//! The server listens on a Unix domain socket and handles connections
//! from worker processes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{debug, error, info, warn};

use super::protocol::{
    decode, encode, CommanderMessage, WorkerMessage,
};

/// Error type for IPC operations.
#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Worker not connected: {0}")]
    WorkerNotConnected(String),

    #[error("Invalid handshake")]
    InvalidHandshake,

    #[error("Channel closed")]
    ChannelClosed,

    #[error("Server not started")]
    NotStarted,
}

/// A connected worker client.
struct ConnectedWorker {
    /// Write half of the socket.
    writer: tokio::io::WriteHalf<UnixStream>,
    /// Worker ID.
    worker_id: String,
}

/// IPC server for commander-worker communication.
pub struct IpcServer {
    /// Path to the Unix socket.
    socket_path: PathBuf,
    /// Listener (set after start).
    listener: Option<UnixListener>,
    /// Connected workers by ID.
    workers: Arc<RwLock<HashMap<String, Arc<Mutex<ConnectedWorker>>>>>,
    /// Channel for incoming messages (worker_id, message).
    incoming_tx: mpsc::Sender<(String, WorkerMessage)>,
    /// Receiver for incoming messages.
    incoming_rx: Option<mpsc::Receiver<(String, WorkerMessage)>>,
}

impl IpcServer {
    /// Create a new IPC server.
    pub fn new(socket_path: impl AsRef<Path>) -> Self {
        let (tx, rx) = mpsc::channel(100);
        Self {
            socket_path: socket_path.as_ref().to_path_buf(),
            listener: None,
            workers: Arc::new(RwLock::new(HashMap::new())),
            incoming_tx: tx,
            incoming_rx: Some(rx),
        }
    }

    /// Get the socket path.
    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Start the server.
    pub async fn start(&mut self) -> Result<(), IpcError> {
        // Remove existing socket file if present
        if self.socket_path.exists() {
            std::fs::remove_file(&self.socket_path)?;
        }

        // Create parent directory if needed
        if let Some(parent) = self.socket_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Bind the listener
        let listener = UnixListener::bind(&self.socket_path)?;
        info!("IPC server listening on {:?}", self.socket_path);
        self.listener = Some(listener);

        Ok(())
    }

    /// Stop the server.
    pub async fn stop(&mut self) -> Result<(), IpcError> {
        // Close all worker connections
        let mut workers = self.workers.write().await;
        workers.clear();

        // Remove socket file
        if self.socket_path.exists() {
            std::fs::remove_file(&self.socket_path)?;
        }

        self.listener = None;
        info!("IPC server stopped");
        Ok(())
    }

    /// Take the incoming message receiver.
    ///
    /// This can only be called once. Use this to process incoming messages
    /// in a separate task.
    pub fn take_receiver(&mut self) -> Option<mpsc::Receiver<(String, WorkerMessage)>> {
        self.incoming_rx.take()
    }

    /// Accept a new worker connection.
    ///
    /// Returns the worker ID after successful handshake.
    pub async fn accept(&self) -> Result<String, IpcError> {
        let listener = self.listener.as_ref().ok_or(IpcError::NotStarted)?;

        let (stream, _addr) = listener.accept().await?;
        debug!("New connection accepted");

        let (read_half, write_half) = tokio::io::split(stream);
        let mut reader = BufReader::new(read_half);

        // Read handshake message
        let mut line = String::new();
        reader.read_line(&mut line).await?;

        let msg: WorkerMessage = decode(&line)?;

        if let WorkerMessage::Handshake { worker_id, .. } = &msg {
            let worker_id = worker_id.clone();

            // Store the worker
            let worker = ConnectedWorker {
                writer: write_half,
                worker_id: worker_id.clone(),
            };

            {
                let mut workers = self.workers.write().await;
                workers.insert(worker_id.clone(), Arc::new(Mutex::new(worker)));
            }

            // Send the handshake message to the receiver
            let _ = self.incoming_tx.send((worker_id.clone(), msg)).await;

            // Spawn a task to read messages from this worker
            let workers = Arc::clone(&self.workers);
            let tx = self.incoming_tx.clone();
            let wid = worker_id.clone();

            tokio::spawn(async move {
                Self::read_worker_messages(reader, wid, workers, tx).await;
            });

            Ok(worker_id)
        } else {
            Err(IpcError::InvalidHandshake)
        }
    }

    /// Background task to read messages from a worker.
    async fn read_worker_messages(
        mut reader: BufReader<tokio::io::ReadHalf<UnixStream>>,
        worker_id: String,
        workers: Arc<RwLock<HashMap<String, Arc<Mutex<ConnectedWorker>>>>>,
        tx: mpsc::Sender<(String, WorkerMessage)>,
    ) {
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    // EOF - worker disconnected
                    info!("Worker {} disconnected", worker_id);
                    break;
                }
                Ok(_) => {
                    match decode::<WorkerMessage>(&line) {
                        Ok(msg) => {
                            if tx.send((worker_id.clone(), msg)).await.is_err() {
                                warn!("Failed to send message to receiver");
                                break;
                            }
                        }
                        Err(e) => {
                            error!("Failed to parse message from {}: {}", worker_id, e);
                        }
                    }
                }
                Err(e) => {
                    error!("Error reading from worker {}: {}", worker_id, e);
                    break;
                }
            }
        }

        // Remove worker from map
        let mut workers = workers.write().await;
        workers.remove(&worker_id);
    }

    /// Send a message to a specific worker.
    pub async fn send(&self, worker_id: &str, msg: &CommanderMessage) -> Result<(), IpcError> {
        let workers = self.workers.read().await;
        let worker = workers
            .get(worker_id)
            .ok_or_else(|| IpcError::WorkerNotConnected(worker_id.to_string()))?;

        let encoded = encode(msg)?;
        let mut worker = worker.lock().await;
        worker.writer.write_all(encoded.as_bytes()).await?;
        worker.writer.flush().await?;

        Ok(())
    }

    /// Broadcast a message to all connected workers.
    pub async fn broadcast(&self, msg: &CommanderMessage) -> Result<(), IpcError> {
        let encoded = encode(msg)?;
        let workers = self.workers.read().await;

        for (worker_id, worker) in workers.iter() {
            let mut worker = worker.lock().await;
            if let Err(e) = worker.writer.write_all(encoded.as_bytes()).await {
                warn!("Failed to send to worker {}: {}", worker_id, e);
            }
        }

        Ok(())
    }

    /// Check if a worker is connected.
    pub async fn is_connected(&self, worker_id: &str) -> bool {
        let workers = self.workers.read().await;
        workers.contains_key(worker_id)
    }

    /// Get list of connected worker IDs.
    pub async fn connected_workers(&self) -> Vec<String> {
        let workers = self.workers.read().await;
        workers.keys().cloned().collect()
    }

    /// Disconnect a specific worker.
    pub async fn disconnect(&self, worker_id: &str) -> Result<(), IpcError> {
        let mut workers = self.workers.write().await;
        workers.remove(worker_id);
        Ok(())
    }
}

impl Drop for IpcServer {
    fn drop(&mut self) {
        // Clean up socket file
        if self.socket_path.exists() {
            let _ = std::fs::remove_file(&self.socket_path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_server_lifecycle() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        assert!(!socket_path.exists());

        server.start().await.unwrap();
        assert!(socket_path.exists());

        server.stop().await.unwrap();
        assert!(!socket_path.exists());
    }

    #[tokio::test]
    async fn test_connected_workers_empty() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        server.start().await.unwrap();

        let workers = server.connected_workers().await;
        assert!(workers.is_empty());
    }
}
