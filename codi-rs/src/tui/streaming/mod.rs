// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Streaming output support for the TUI.
//!
//! This module provides incremental text accumulation and markdown rendering
//! for streaming AI responses. It follows the newline-gated accumulator pattern
//! from Codex-RS:
//!
//! 1. Accumulate text deltas in a buffer
//! 2. On newline, commit complete lines for rendering
//! 3. Queue rendered lines for display
//! 4. Step through the queue at animation tick rate
//!
//! # Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────────┐
//! │                    StreamController                          │
//! │  (Manages animation timing, header emission, state machine)  │
//! └──────────────────────────────────────────────────────────────┘
//!                            │
//!                            ▼
//! ┌──────────────────────────────────────────────────────────────┐
//! │                      StreamState                             │
//! │  (Owns collector, manages line queue, tracks seen deltas)    │
//! └──────────────────────────────────────────────────────────────┘
//!                            │
//!                            ▼
//! ┌──────────────────────────────────────────────────────────────┐
//! │                 MarkdownStreamCollector                      │
//! │  (Buffer, line counting, incremental markdown rendering)     │
//! └──────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::tui::streaming::{StreamController, StreamStatus};
//!
//! let mut controller = StreamController::new(Some(80));
//!
//! // Push deltas as they arrive from the provider
//! if controller.push("Hello, ") {
//!     // Partial line, no complete lines yet
//! }
//!
//! if controller.push("world!\n") {
//!     // Complete line! Start animation
//!     while let StreamStatus::HasContent = controller.step() {
//!         let lines = controller.drain_step();
//!         // Render lines to UI
//!     }
//! }
//!
//! // When stream ends, finalize to get remaining content
//! controller.finalize();
//! let remaining = controller.drain_all();
//! ```

mod collector;

pub use collector::MarkdownStreamCollector;

use ratatui::text::Line;
use std::collections::VecDeque;

/// Status returned from step operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamStatus {
    /// There is content ready to display.
    HasContent,
    /// The queue is empty, waiting for more input.
    Idle,
    /// The stream has been finalized and fully drained.
    Complete,
}

/// State for managing streaming text accumulation and queuing.
#[derive(Debug)]
pub struct StreamState {
    /// The markdown collector that accumulates and renders text.
    collector: MarkdownStreamCollector,
    /// Queue of lines ready for display.
    queued_lines: VecDeque<Line<'static>>,
    /// Whether we've seen any deltas.
    has_seen_delta: bool,
    /// Whether the stream has been finalized.
    is_finalized: bool,
}

impl StreamState {
    /// Create a new stream state with optional width for text wrapping.
    pub fn new(width: Option<usize>) -> Self {
        Self {
            collector: MarkdownStreamCollector::new(width),
            queued_lines: VecDeque::new(),
            has_seen_delta: false,
            is_finalized: false,
        }
    }

    /// Push a text delta into the collector.
    ///
    /// Returns true if there are now complete lines ready to display.
    pub fn push(&mut self, delta: &str) -> bool {
        self.has_seen_delta = true;
        self.collector.push_delta(delta);

        // Check for complete lines
        if delta.contains('\n') {
            let new_lines = self.collector.commit_complete_lines();
            if !new_lines.is_empty() {
                for line in new_lines {
                    self.queued_lines.push_back(line);
                }
                return true;
            }
        }
        false
    }

    /// Step through the queue, returning one line.
    ///
    /// Returns None if the queue is empty.
    pub fn step(&mut self) -> Option<Line<'static>> {
        self.queued_lines.pop_front()
    }

    /// Drain all remaining lines from the queue.
    pub fn drain_all(&mut self) -> Vec<Line<'static>> {
        self.queued_lines.drain(..).collect()
    }

    /// Check if the queue is idle (empty with no pending content).
    pub fn is_idle(&self) -> bool {
        self.queued_lines.is_empty()
    }

    /// Check if any deltas have been seen.
    pub fn has_seen_delta(&self) -> bool {
        self.has_seen_delta
    }

    /// Finalize the stream, committing any remaining partial content.
    pub fn finalize(&mut self) {
        if !self.is_finalized {
            self.is_finalized = true;
            let remaining = self.collector.finalize_and_drain();
            for line in remaining {
                self.queued_lines.push_back(line);
            }
        }
    }

    /// Check if the stream has been finalized.
    pub fn is_finalized(&self) -> bool {
        self.is_finalized
    }

    /// Get current queue length.
    pub fn queue_len(&self) -> usize {
        self.queued_lines.len()
    }

    /// Get the current buffer content (for display purposes).
    pub fn buffer_preview(&self) -> &str {
        self.collector.buffer()
    }
}

/// Controller for streaming text with animation support.
///
/// Manages the stream state and provides a clean interface for:
/// - Pushing deltas
/// - Stepping through queued lines at animation rate
/// - Finalizing and draining remaining content
pub struct StreamController {
    /// The underlying stream state.
    state: StreamState,
    /// Whether header has been emitted for the current message.
    header_emitted: bool,
    /// Lines per tick for animation (default 1).
    lines_per_tick: usize,
}

impl StreamController {
    /// Create a new stream controller with optional width for text wrapping.
    pub fn new(width: Option<usize>) -> Self {
        Self {
            state: StreamState::new(width),
            header_emitted: false,
            lines_per_tick: 1,
        }
    }

    /// Set the number of lines to emit per animation tick.
    pub fn with_lines_per_tick(mut self, lines: usize) -> Self {
        self.lines_per_tick = lines.max(1);
        self
    }

    /// Push a text delta.
    ///
    /// Returns true if there are complete lines ready for animation.
    pub fn push(&mut self, delta: &str) -> bool {
        self.state.push(delta)
    }

    /// Check if header has been emitted.
    pub fn header_emitted(&self) -> bool {
        self.header_emitted
    }

    /// Mark header as emitted.
    pub fn set_header_emitted(&mut self) {
        self.header_emitted = true;
    }

    /// Step through the queue, returning up to `lines_per_tick` lines.
    ///
    /// Returns the status and any lines ready for display.
    pub fn step(&mut self) -> (StreamStatus, Vec<Line<'static>>) {
        if self.state.is_idle() {
            if self.state.is_finalized() {
                return (StreamStatus::Complete, Vec::new());
            }
            return (StreamStatus::Idle, Vec::new());
        }

        let mut lines = Vec::with_capacity(self.lines_per_tick);
        for _ in 0..self.lines_per_tick {
            if let Some(line) = self.state.step() {
                lines.push(line);
            } else {
                break;
            }
        }

        let status = if self.state.is_idle() {
            if self.state.is_finalized() {
                StreamStatus::Complete
            } else {
                StreamStatus::Idle
            }
        } else {
            StreamStatus::HasContent
        };

        (status, lines)
    }

    /// Finalize the stream and commit any remaining content.
    pub fn finalize(&mut self) {
        self.state.finalize();
    }

    /// Drain all remaining lines at once (skip animation).
    pub fn drain_all(&mut self) -> Vec<Line<'static>> {
        self.state.drain_all()
    }

    /// Check if the controller is idle (no pending content).
    pub fn is_idle(&self) -> bool {
        self.state.is_idle()
    }

    /// Check if any content has been received.
    pub fn has_content(&self) -> bool {
        self.state.has_seen_delta()
    }

    /// Get the buffer preview (current incomplete line).
    pub fn buffer_preview(&self) -> &str {
        self.state.buffer_preview()
    }

    /// Get the queue length.
    pub fn queue_len(&self) -> usize {
        self.state.queue_len()
    }

    /// Reset the controller for a new message.
    pub fn reset(&mut self, width: Option<usize>) {
        self.state = StreamState::new(width);
        self.header_emitted = false;
    }
}

impl Default for StreamController {
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_state_basic() {
        let mut state = StreamState::new(Some(80));

        // Partial line
        assert!(!state.push("Hello"));
        assert!(state.is_idle());
        assert!(!state.is_finalized());

        // Complete line
        assert!(state.push(", world!\n"));
        assert!(!state.is_idle());

        // Step through
        let line = state.step();
        assert!(line.is_some());
        assert!(state.is_idle());
    }

    #[test]
    fn test_stream_state_finalize() {
        let mut state = StreamState::new(Some(80));

        // Push partial content
        state.push("Incomplete content");
        assert!(state.is_idle()); // No newline, nothing queued

        // Finalize should commit remaining
        state.finalize();
        assert!(!state.is_idle()); // Now we have content
        assert!(state.is_finalized());

        let lines = state.drain_all();
        assert!(!lines.is_empty());
    }

    #[test]
    fn test_stream_controller_animation() {
        let mut controller = StreamController::new(Some(80));

        // Push multiple lines
        controller.push("Line 1\nLine 2\nLine 3\n");

        // Step through one at a time
        let (status, lines) = controller.step();
        assert_eq!(status, StreamStatus::HasContent);
        assert_eq!(lines.len(), 1);

        let (status, lines) = controller.step();
        assert_eq!(status, StreamStatus::HasContent);
        assert_eq!(lines.len(), 1);

        let (status, lines) = controller.step();
        assert_eq!(status, StreamStatus::Idle);
        assert_eq!(lines.len(), 1);

        // Now idle
        let (status, _) = controller.step();
        assert_eq!(status, StreamStatus::Idle);
    }

    #[test]
    fn test_stream_controller_lines_per_tick() {
        let mut controller = StreamController::new(Some(80))
            .with_lines_per_tick(2);

        controller.push("Line 1\nLine 2\nLine 3\n");

        // Get 2 lines at once
        let (status, lines) = controller.step();
        assert_eq!(status, StreamStatus::HasContent);
        assert_eq!(lines.len(), 2);

        // Get remaining 1 line
        let (status, lines) = controller.step();
        assert_eq!(status, StreamStatus::Idle);
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn test_stream_controller_reset() {
        let mut controller = StreamController::new(Some(80));

        controller.push("Content\n");
        controller.set_header_emitted();
        assert!(controller.has_content());
        assert!(controller.header_emitted());

        controller.reset(Some(100));
        assert!(!controller.has_content());
        assert!(!controller.header_emitted());
    }

    #[test]
    fn test_stream_controller_finalize_complete() {
        let mut controller = StreamController::new(Some(80));

        controller.push("Line 1\nPartial");
        controller.finalize();

        // Drain everything
        let lines = controller.drain_all();
        assert!(!lines.is_empty());

        // Should be complete now
        let (status, _) = controller.step();
        assert_eq!(status, StreamStatus::Complete);
    }
}
