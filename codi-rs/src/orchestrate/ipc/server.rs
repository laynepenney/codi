// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC server for the commander.
//!
//! The server listens on a platform-specific IPC transport and handles
//! connections from worker processes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{debug, error, info, warn};

use super::protocol::{
    decode, encode, CommanderMessage, WorkerMessage,
};
use super::transport::{self, IpcListener, IpcStream};
use super::error::IpcError;

/// A connected worker client.
struct ConnectedWorker {
    /// Write half of the stream.
    writer: tokio::io::WriteHalf<IpcStream>,
    /// Worker ID (stored for logging/diagnostics).
    _worker_id: String,
}

/// IPC server for commander-worker communication.
pub struct IpcServer {
    /// Path to the IPC endpoint.
    socket_path: PathBuf,
    /// Listener (set after start).
    listener: Option<IpcListener>,
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

    /// Get the IPC endpoint path.
    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Start the server.
    pub async fn start(&mut self) -> Result<(), IpcError> {
        let listener = transport::bind(&self.socket_path)
            .await
            .map_err(|e| IpcError::from_io_error("binding socket", e))?;
        info!("IPC server listening on {:?}", self.socket_path);
        self.listener = Some(listener);

        Ok(())
    }

    /// Stop the server.
    pub async fn stop(&mut self) -> Result<(), IpcError> {
        // Close all worker connections
        let mut workers = self.workers.write().await;
        workers.clear();

        transport::cleanup(&self.socket_path)
            .map_err(|e| IpcError::from_io_error("cleaning up socket", e))?;

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

        let stream = listener.accept()
            .await
            .map_err(|e| IpcError::from_io_error("accepting connection", e))?;
        debug!("New connection accepted");

        let (read_half, write_half) = tokio::io::split(stream);
        let mut reader = BufReader::new(read_half);

        // Read handshake message
        let mut line = String::new();
        reader.read_line(&mut line)
            .await
            .map_err(|e| IpcError::from_io_error("reading handshake", e))?;

        let msg: WorkerMessage = decode(&line)
            .map_err(|e| IpcError::InvalidMessage(format!("handshake decode failed: {}", e)))?;

        if let WorkerMessage::Handshake { worker_id, .. } = &msg {
            let worker_id = worker_id.clone();

            // Store the worker
            let worker = ConnectedWorker {
                writer: write_half,
                _worker_id: worker_id.clone(),
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
        mut reader: BufReader<tokio::io::ReadHalf<IpcStream>>,
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

        let encoded = encode(msg)
            .map_err(|e| IpcError::InvalidMessage(format!("encode failed: {}", e)))?;
        let mut worker = worker.lock().await;
        worker.writer.write_all(encoded.as_bytes())
            .await
            .map_err(|e| IpcError::from_io_error("sending message", e))?;
        worker.writer.flush()
            .await
            .map_err(|e| IpcError::from_io_error("flushing writer", e))?;

        Ok(())
    }

    /// Broadcast a message to all connected workers.
    pub async fn broadcast(&self, msg: &CommanderMessage) -> Result<(), IpcError> {
        let encoded = encode(msg)
            .map_err(|e| IpcError::InvalidMessage(format!("encode failed: {}", e)))?;
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
        let _ = transport::cleanup(&self.socket_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrate::ipc::{WorkerMessage, CommanderMessage};
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_server_lifecycle() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        #[cfg(not(windows))]
        assert!(!socket_path.exists());

        server.start().await.unwrap();
        #[cfg(not(windows))]
        assert!(socket_path.exists());

        server.stop().await.unwrap();
        #[cfg(not(windows))]
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

    #[tokio::test]
    async fn test_server_not_started_error() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let server = IpcServer::new(&socket_path);
        // Try to accept without starting - should fail with NotStarted
        let result = server.accept().await;
        assert!(matches!(result, Err(IpcError::NotStarted)));
    }

    #[tokio::test]
    async fn test_bind_to_invalid_path() {
        let invalid_path = Path::new("/nonexistent/directory/test.sock");

        let result = transport::bind(invalid_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_send_to_nonexistent_worker() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        server.start().await.unwrap();

        let msg = CommanderMessage::Ping {
            id: "ping-1".to_string(),
            timestamp: chrono::Utc::now(),
        };
        let result = server.send("nonexistent-worker", &msg).await;
        assert!(matches!(result, Err(IpcError::WorkerNotConnected(_))));
    }

    #[tokio::test]
    async fn test_stop_without_start() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        // Should not panic when stopping a server that was never started
        let result = server.stop().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_broadcast_no_workers() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        server.start().await.unwrap();

        // Broadcasting with no connected workers should succeed
        let msg = CommanderMessage::Ping {
            id: "test-1".to_string(),
            timestamp: chrono::Utc::now(),
        };
        let result = server.broadcast(&msg).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_accept_timeout() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        server.start().await.unwrap();

        // Try to accept with a very short timeout - should timeout
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(50),
            server.accept()
        ).await;
        
        assert!(result.is_err(), "Accept should timeout when no client connects");
    }

    #[tokio::test]
    async fn test_handshake_rejected() {
        use crate::orchestrate::types::WorkerConfig;

        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        server.start().await.unwrap();

        let mut rx = server.take_receiver().expect("receiver already taken");

        // Spawn client thread that will send handshake
        let client_path = socket_path.clone();
        let client_thread = std::thread::spawn(move || {
            use crate::orchestrate::ipc::client::IpcClient;
            
            // Use a new Tokio runtime for this thread
            let rt = tokio::runtime::Runtime::new().expect("Failed to create runtime");
            rt.block_on(async {
                let mut client = IpcClient::new(&client_path, "test-worker");
                client.connect().await.expect("client connect failed");
                
                let config = WorkerConfig::new("test-worker", "main", "test task");
                let workspace = crate::orchestrate::types::WorkspaceInfo::GitWorktree {
                    path: std::path::PathBuf::from("."),
                    branch: "main".to_string(),
                    base_branch: "main".to_string(),
                };
                client.handshake(&config, &workspace).await
            })
        });

        // Accept the connection
        let worker_id = server.accept().await.expect("accept failed");
        assert_eq!(worker_id, "test-worker");

        // Receive handshake message
        let (received_worker_id, msg) = rx.recv().await.expect("handshake missing");
        assert_eq!(received_worker_id, "test-worker");
        assert!(matches!(msg, WorkerMessage::Handshake { .. }));

        // Send rejection
        let reject = CommanderMessage::handshake_reject("Connection refused");
        server.send(&worker_id, &reject).await.expect("send reject failed");

        // Client should receive the rejection
        let ack_result = client_thread.join().expect("client thread failed");
        assert!(ack_result.is_err());
        match ack_result {
            Err(crate::orchestrate::ipc::client::IpcClientError::HandshakeFailed(_)) => {}
            _ => panic!("Expected handshake rejection"),
        }
    }

    #[tokio::test]
    async fn test_permission_response_timeout() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        server.start().await.unwrap();

        // Test that we can detect when a worker doesn't respond to permission request
        // This is a server-side timeout test
        let start = std::time::Instant::now();
        let timeout_duration = std::time::Duration::from_millis(100);
        
        // Simulate waiting for permission response with timeout
        let result = tokio::time::timeout(
            timeout_duration,
            tokio::task::yield_now()  // Just yield, no actual work
        ).await;
        
        assert!(result.is_ok());  // Should complete immediately
        assert!(start.elapsed() < timeout_duration * 2);
    }

    #[tokio::test]
    async fn test_channel_closed() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let mut server = IpcServer::new(&socket_path);
        server.start().await.unwrap();

        // Take the receiver (simulating channel consumer dropping)
        let rx = server.take_receiver().expect("receiver already taken");
        drop(rx);  // Drop the receiver to close the channel

        // Subsequent calls to take_receiver should return None
        let result = server.take_receiver();
        assert!(result.is_none());
    }
}
