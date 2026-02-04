// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! TUI rendering integration tests using insta snapshots.

use ratatui::backend::TestBackend;
use ratatui::Terminal;

use codi::tui::components::{ExecCell, ExecCellWidget};

/// Test rendering of a pending exec cell.
#[test]
fn test_exec_cell_pending() {
    let cell = ExecCell::new(
        "test-1",
        "read_file",
        serde_json::json!({"path": "test.rs"}),
    );

    let backend = TestBackend::new(80, 20);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal
        .draw(|f| {
            let area = f.area();
            ExecCellWidget::render(&cell, area, f.buffer_mut());
        })
        .unwrap();

    insta::assert_snapshot!(terminal.backend());
}

/// Test rendering of a running exec cell with spinner.
#[test]
fn test_exec_cell_running() {
    let mut cell = ExecCell::new("test-1", "bash", serde_json::json!({"cmd": "echo hello"}));
    cell.mark_running();
    cell.add_output_line("Processing...");
    cell.add_output_line("Step 1 complete");

    let backend = TestBackend::new(80, 20);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal
        .draw(|f| {
            let area = f.area();
            ExecCellWidget::render(&cell, area, f.buffer_mut());
        })
        .unwrap();

    insta::assert_snapshot!(terminal.backend());
}

/// Test rendering of a completed exec cell.
#[test]
fn test_exec_cell_success() {
    let mut cell = ExecCell::new(
        "test-1",
        "read_file",
        serde_json::json!({"path": "test.rs"}),
    );
    cell.mark_running();
    cell.mark_success("File content here\nMultiple lines\nOf text");

    let backend = TestBackend::new(80, 20);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal
        .draw(|f| {
            let area = f.area();
            ExecCellWidget::render(&cell, area, f.buffer_mut());
        })
        .unwrap();

    insta::assert_snapshot!(terminal.backend());
}

/// Test rendering of a failed exec cell.
#[test]
fn test_exec_cell_error() {
    let mut cell = ExecCell::new(
        "test-1",
        "bash",
        serde_json::json!({"cmd": "invalid_command"}),
    );
    cell.mark_running();
    cell.mark_error("Command not found: invalid_command");

    let backend = TestBackend::new(80, 20);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal
        .draw(|f| {
            let area = f.area();
            ExecCellWidget::render(&cell, area, f.buffer_mut());
        })
        .unwrap();

    insta::assert_snapshot!(terminal.backend());
}

/// Test rendering of expanded exec cell.
#[test]
fn test_exec_cell_expanded() {
    let mut cell = ExecCell::new(
        "test-1",
        "write_file",
        serde_json::json!({
            "path": "output.txt",
            "content": "Hello World"
        }),
    );
    cell.mark_running();
    cell.mark_success("File written successfully");
    cell.toggle_expanded();

    let backend = TestBackend::new(80, 25);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal
        .draw(|f| {
            let area = f.area();
            ExecCellWidget::render(&cell, area, f.buffer_mut());
        })
        .unwrap();

    insta::assert_snapshot!(terminal.backend());
}

/// Test live output during execution.
#[test]
fn test_exec_cell_live_output() {
    let mut cell = ExecCell::new(
        "test-1",
        "bash",
        serde_json::json!({"cmd": "long_running_command"}),
    );
    cell.mark_running();

    // Add multiple output lines
    cell.add_output_line("Starting process...");
    cell.add_output_line("Loading configuration");
    cell.add_output_line("Connecting to database");
    cell.add_output_line("Executing query");
    cell.add_output_line("Processing results");

    let backend = TestBackend::new(80, 20);
    let mut terminal = Terminal::new(backend).unwrap();

    terminal
        .draw(|f| {
            let area = f.area();
            ExecCellWidget::render(&cell, area, f.buffer_mut());
        })
        .unwrap();

    insta::assert_snapshot!(terminal.backend());
}
