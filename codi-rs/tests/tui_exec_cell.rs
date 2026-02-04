// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! TUI rendering integration tests using insta snapshots.

use ratatui::buffer::Buffer;
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use regex::Regex;

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

    let snapshot = render_exec_cell_snapshot(&terminal);
    insta::assert_snapshot!("exec_cell_pending", snapshot);
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

    let snapshot = render_exec_cell_snapshot(&terminal);
    insta::assert_snapshot!("exec_cell_running", snapshot);
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

    let snapshot = render_exec_cell_snapshot(&terminal);
    insta::assert_snapshot!("exec_cell_success", snapshot);
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

    let snapshot = render_exec_cell_snapshot(&terminal);
    insta::assert_snapshot!("exec_cell_error", snapshot);
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

    let snapshot = render_exec_cell_snapshot(&terminal);
    insta::assert_snapshot!("exec_cell_expanded", snapshot);
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

    let snapshot = render_exec_cell_snapshot(&terminal);
    insta::assert_snapshot!("exec_cell_live_output", snapshot);
}

fn render_exec_cell_snapshot(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    let width = buffer.area.width as usize;
    let lines = buffer_to_lines(buffer, width);
    normalize_snapshot(lines)
}

fn buffer_to_lines(buffer: &Buffer, width: usize) -> Vec<String> {
    let mut lines = Vec::with_capacity(buffer.area.height as usize);
    for row in buffer.content.chunks(width) {
        let mut line = String::with_capacity(width);
        for cell in row {
            line.push_str(cell.symbol());
        }
        lines.push(line);
    }
    lines
}

fn normalize_snapshot(lines: Vec<String>) -> String {
    let duration_re = Regex::new(r"\((\d+(?:\.\d+)?)(ms|s)\)").unwrap();

    lines
        .into_iter()
        .map(|line| {
            let redacted = duration_re.replace_all(&line, |caps: &regex::Captures<'_>| {
                let redacted_num: String = caps[1]
                    .chars()
                    .map(|ch| if ch == '.' { '.' } else { '#' })
                    .collect();
                format!("({}{})", redacted_num, &caps[2])
            });
            let stripped = strip_right_padding(redacted.as_ref());
            format!("\"{}\"", stripped)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn strip_right_padding(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() < 2 {
        return line.to_string();
    }
    if chars.first() != Some(&'│') || chars.last() != Some(&'│') {
        return line.to_string();
    }

    let mut end = chars.len() - 1;
    while end > 1 && chars[end - 1] == ' ' {
        end -= 1;
    }

    let mut out = String::with_capacity(end + 1);
    out.push('│');
    for ch in &chars[1..end] {
        out.push(*ch);
    }
    out.push('│');
    out
}
