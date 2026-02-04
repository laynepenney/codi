// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! TUI components module.
//!
//! This module provides reusable UI components for the Codi TUI.

pub mod exec_cell;

pub use exec_cell::{ExecCell, ExecCellManager, ExecCellWidget, ToolStatus};

/// Snapshot testing utilities for TUI components.
#[cfg(test)]
pub mod testing {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    /// Create a test terminal for snapshot testing.
    pub fn test_terminal(width: u16, height: u16) -> Terminal<TestBackend> {
        let backend = TestBackend::new(width, height);
        Terminal::new(backend).unwrap()
    }
}
