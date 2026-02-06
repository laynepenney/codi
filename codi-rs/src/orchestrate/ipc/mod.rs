// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC (Inter-Process Communication) module for commander-worker communication.
//!
//! This module provides cross-platform IPC between the commander (orchestrator)
//! and worker (child agent) processes.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────┐              ┌─────────────────┐
//! │    Commander    │              │     Worker      │
//! │                 │              │                 │
//! │  ┌───────────┐  │  Socket/     │  ┌───────────┐  │
//! │  │  Server   │◄─┼──Pipe────────┼──│  Client   │  │
//! │  └───────────┘  │              │  └───────────┘  │
//! └─────────────────┘              └─────────────────┘
//! ```
//!
//! # Protocol
//!
//! Messages are newline-delimited JSON (NDJSON). Each message is a complete
//! JSON object followed by a newline character.
//!
//! Transport:
//! - Unix: domain sockets
//! - Windows: named pipes
//!
//! ## Worker → Commander Messages
//!
//! - `handshake` - Initial connection from worker
//! - `permission_request` - Request approval for a tool operation
//! - `status_update` - Progress update
//! - `task_complete` - Successful completion
//! - `task_error` - Task failed
//! - `log` - Log output
//! - `pong` - Response to ping
//!
//! ## Commander → Worker Messages
//!
//! - `handshake_ack` - Accept/reject worker connection
//! - `permission_response` - Approve/deny/abort tool operation
//! - `inject_context` - Add context to worker's conversation
//! - `cancel` - Cancel the worker
//! - `ping` - Health check

pub mod protocol;
pub mod server;
pub mod client;
pub mod transport;

pub use protocol::{
    WorkerMessage, CommanderMessage, PermissionResult,
    WorkerStatusUpdate, LogLevel,
    encode, decode, decode_messages,
};
pub use server::IpcServer;
pub use client::IpcClient;
