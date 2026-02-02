// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Event handling for the TUI.

use std::time::Duration;

use crossterm::event::{self, Event as CrosstermEvent, KeyEvent, KeyModifiers, MouseEvent};
use tokio::sync::mpsc;
use tokio::time::interval;

/// Terminal events.
#[derive(Debug, Clone)]
pub enum Event {
    /// A tick event for periodic updates.
    Tick,
    /// A key press event.
    Key(KeyEvent),
    /// A mouse event.
    Mouse(MouseEvent),
    /// Terminal resize event.
    Resize(u16, u16),
}

/// Event handler that polls for terminal events.
pub struct EventHandler {
    /// Event receiver channel.
    rx: mpsc::UnboundedReceiver<Event>,
    /// Handle to the event sender task.
    _tx: mpsc::UnboundedSender<Event>,
}

impl EventHandler {
    /// Create a new event handler with the given tick rate in milliseconds.
    pub fn new(tick_rate_ms: u64) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let tx_clone = tx.clone();
        let tick_rate = Duration::from_millis(tick_rate_ms);

        // Spawn the event polling task
        tokio::spawn(async move {
            let mut ticker = interval(tick_rate);

            loop {
                let event = tokio::select! {
                    _ = ticker.tick() => Event::Tick,
                    event = poll_event() => event,
                };

                if tx_clone.send(event).is_err() {
                    break;
                }
            }
        });

        Self { rx, _tx: tx }
    }

    /// Get the next event, if available.
    pub async fn next(&mut self) -> Option<Event> {
        self.rx.recv().await
    }
}

/// Poll for a crossterm event.
async fn poll_event() -> Event {
    // Use a short poll timeout so we don't block too long
    loop {
        if event::poll(Duration::from_millis(50)).unwrap_or(false) {
            if let Ok(event) = event::read() {
                return match event {
                    CrosstermEvent::Key(key) => Event::Key(key),
                    CrosstermEvent::Mouse(mouse) => Event::Mouse(mouse),
                    CrosstermEvent::Resize(w, h) => Event::Resize(w, h),
                    _ => continue,
                };
            }
        }
        // Yield to allow other tasks to run
        tokio::task::yield_now().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_types() {
        let tick = Event::Tick;
        assert!(matches!(tick, Event::Tick));

        let resize = Event::Resize(80, 24);
        if let Event::Resize(w, h) = resize {
            assert_eq!(w, 80);
            assert_eq!(h, 24);
        }
    }
}
