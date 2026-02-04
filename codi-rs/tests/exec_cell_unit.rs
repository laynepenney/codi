// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Comprehensive tests for ExecCell and ExecCellManager.

use std::time::Duration;

use codi::tui::components::{ExecCell, ExecCellManager, ToolStatus};

// ============================================================================
// ToolStatus Tests
// ============================================================================

#[test]
fn test_tool_status_color() {
    assert_eq!(ToolStatus::Pending.color(), ratatui::style::Color::Gray);
    assert_eq!(ToolStatus::Running.color(), ratatui::style::Color::Yellow);
    assert_eq!(ToolStatus::Success.color(), ratatui::style::Color::Green);
    assert_eq!(ToolStatus::Error.color(), ratatui::style::Color::Red);
}

#[test]
fn test_tool_status_icon() {
    assert_eq!(ToolStatus::Pending.icon(), '○');
    assert_eq!(ToolStatus::Running.icon(), '◐');
    assert_eq!(ToolStatus::Success.icon(), '✓');
    assert_eq!(ToolStatus::Error.icon(), '✗');
}

#[test]
fn test_tool_status_is_terminal() {
    assert!(!ToolStatus::Pending.is_terminal());
    assert!(!ToolStatus::Running.is_terminal());
    assert!(ToolStatus::Success.is_terminal());
    assert!(ToolStatus::Error.is_terminal());
}

// ============================================================================
// ExecCell Lifecycle Tests
// ============================================================================

#[test]
fn test_exec_cell_new() {
    let cell = ExecCell::new(
        "test-id",
        "read_file",
        serde_json::json!({"path": "test.rs"}),
    );

    assert_eq!(cell.id, "test-id");
    assert_eq!(cell.tool_name, "read_file");
    assert_eq!(cell.status, ToolStatus::Pending);
    assert!(cell.end_time.is_none());
    assert!(cell.result.is_none());
    assert!(!cell.expanded);
    assert!(cell.live_output.is_empty());
}

#[test]
fn test_exec_cell_mark_running() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();

    assert_eq!(cell.status, ToolStatus::Running);
    assert!(cell.end_time.is_none());
}

#[test]
fn test_exec_cell_mark_success() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();
    cell.mark_success("result content");

    assert_eq!(cell.status, ToolStatus::Success);
    assert!(cell.end_time.is_some());
    assert_eq!(cell.result, Some("result content".to_string()));
}

#[test]
fn test_exec_cell_mark_error() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();
    cell.mark_error("something went wrong");

    assert_eq!(cell.status, ToolStatus::Error);
    assert!(cell.end_time.is_some());
    assert_eq!(cell.result, Some("something went wrong".to_string()));
}

// ============================================================================
// ExecCell Output Tests
// ============================================================================

#[test]
fn test_exec_cell_add_output_line() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));

    cell.add_output_line("line 1");
    assert_eq!(cell.live_output.len(), 1);
    assert_eq!(cell.live_output[0], "line 1");

    cell.add_output_line("line 2");
    assert_eq!(cell.live_output.len(), 2);
    assert_eq!(cell.live_output[1], "line 2");
}

#[test]
fn test_exec_cell_live_output_max_size() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));

    // Add more than 5 lines (max)
    for i in 0..7 {
        cell.add_output_line(format!("line {}", i));
    }

    assert_eq!(cell.live_output.len(), 5);
    // First two should be removed (FIFO)
    assert_eq!(cell.live_output[0], "line 2");
    assert_eq!(cell.live_output[4], "line 6");
}

#[test]
fn test_exec_cell_add_output_lines() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));

    let lines = vec!["a", "b", "c"];
    cell.add_output_lines(lines.into_iter().map(|s| s.to_string()));

    assert_eq!(cell.live_output.len(), 3);
    assert_eq!(cell.live_output[0], "a");
    assert_eq!(cell.live_output[2], "c");
}

// ============================================================================
// ExecCell Display Tests
// ============================================================================

#[test]
fn test_exec_cell_input_preview_short() {
    let cell = ExecCell::new("id", "tool", serde_json::json!({"key": "value"}));

    let preview = cell.input_preview(100);
    assert!(preview.contains("key"));
    assert!(preview.contains("value"));
}

#[test]
fn test_exec_cell_input_preview_truncated() {
    let cell = ExecCell::new("id", "tool", serde_json::json!({"long": "a".repeat(200)}));

    let preview = cell.input_preview(50);
    assert!(preview.ends_with("..."));
    assert_eq!(preview.len(), 50);
}

#[test]
fn test_exec_cell_format_duration_milliseconds() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();

    // Very short duration
    std::thread::sleep(Duration::from_millis(5));
    let dur = cell.format_duration();
    assert!(dur.ends_with("ms"));
}

#[test]
fn test_exec_cell_format_duration_seconds() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();

    // Mock a longer duration by setting end_time
    std::thread::sleep(Duration::from_millis(1500));
    cell.mark_success("done");

    let dur = cell.format_duration();
    assert!(dur.ends_with("s"));
}

// ============================================================================
// ExecCell State Tests
// ============================================================================

#[test]
fn test_exec_cell_toggle_expanded() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));

    assert!(!cell.expanded);
    cell.toggle_expanded();
    assert!(cell.expanded);
    cell.toggle_expanded();
    assert!(!cell.expanded);
}

#[test]
fn test_exec_cell_spinner_animation() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();

    let frame1 = cell.spinner_frame;
    let char1 = cell.spinner_char();

    cell.tick_spinner();

    let frame2 = cell.spinner_frame;
    let char2 = cell.spinner_char();

    assert_ne!(frame1, frame2);
    assert_ne!(char1, char2);

    // Should cycle back
    for _ in 0..10 {
        cell.tick_spinner();
    }
    assert_eq!(cell.spinner_frame, frame1);
}

#[test]
fn test_exec_cell_spinner_not_running() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    // Not running - should show status icon

    let char1 = cell.spinner_char();
    cell.tick_spinner();
    let char2 = cell.spinner_char();

    // When not running, spinner doesn't change
    assert_eq!(char1, char2);
    assert_eq!(char1, '○'); // Pending icon
}

#[test]
fn test_exec_cell_duration_calculation() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();

    std::thread::sleep(Duration::from_millis(10));
    let dur1 = cell.duration();

    std::thread::sleep(Duration::from_millis(10));
    let dur2 = cell.duration();

    assert!(dur2 > dur1);
}

// ============================================================================
// ExecCellManager Tests
// ============================================================================

#[test]
fn test_manager_new() {
    let manager = ExecCellManager::new();
    assert!(manager.cells().is_empty());
    assert_eq!(manager.running_count(), 0);
}

#[test]
fn test_manager_add() {
    let mut manager = ExecCellManager::new();
    let cell = ExecCell::new("test-1", "tool", serde_json::json!({}));

    let id = manager.add(cell);
    assert_eq!(id, "test-1");
    assert_eq!(manager.cells().len(), 1);
}

#[test]
fn test_manager_get() {
    let mut manager = ExecCellManager::new();
    let cell = ExecCell::new("test-1", "tool", serde_json::json!({}));
    manager.add(cell);

    let retrieved = manager.get("test-1");
    assert!(retrieved.is_some());
    assert_eq!(retrieved.unwrap().id, "test-1");

    let not_found = manager.get("nonexistent");
    assert!(not_found.is_none());
}

#[test]
fn test_manager_get_mut() {
    let mut manager = ExecCellManager::new();
    let cell = ExecCell::new("test-1", "tool", serde_json::json!({}));
    manager.add(cell);

    let cell_mut = manager.get_mut("test-1").unwrap();
    cell_mut.mark_running();

    let retrieved = manager.get("test-1").unwrap();
    assert_eq!(retrieved.status, ToolStatus::Running);
}

#[test]
fn test_manager_remove() {
    let mut manager = ExecCellManager::new();
    let cell = ExecCell::new("test-1", "tool", serde_json::json!({}));
    manager.add(cell);

    let removed = manager.remove("test-1");
    assert!(removed.is_some());
    assert_eq!(removed.unwrap().id, "test-1");
    assert!(manager.get("test-1").is_none());

    let not_found = manager.remove("nonexistent");
    assert!(not_found.is_none());
}

#[test]
fn test_manager_running_count() {
    let mut manager = ExecCellManager::new();

    let mut cell1 = ExecCell::new("1", "tool", serde_json::json!({}));
    cell1.mark_running();
    manager.add(cell1);

    let mut cell2 = ExecCell::new("2", "tool", serde_json::json!({}));
    cell2.mark_success("done");
    manager.add(cell2);

    let mut cell3 = ExecCell::new("3", "tool", serde_json::json!({}));
    cell3.mark_running();
    manager.add(cell3);

    assert_eq!(manager.running_count(), 2);
}

#[test]
fn test_manager_running_cells() {
    let mut manager = ExecCellManager::new();

    let mut cell1 = ExecCell::new("1", "tool", serde_json::json!({}));
    cell1.mark_running();
    manager.add(cell1);

    let cell2 = ExecCell::new("2", "tool", serde_json::json!({}));
    manager.add(cell2);

    let running = manager.running_cells();
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].id, "1");
}

#[test]
fn test_manager_tick_all_spinners() {
    let mut manager = ExecCellManager::new();

    let mut cell1 = ExecCell::new("1", "tool", serde_json::json!({}));
    cell1.mark_running();
    manager.add(cell1);

    let cell2 = ExecCell::new("2", "tool", serde_json::json!({}));
    manager.add(cell2);

    let frame_before = manager.get("1").unwrap().spinner_frame;
    manager.tick_all_spinners();
    let frame_after = manager.get("1").unwrap().spinner_frame;

    assert_ne!(frame_before, frame_after);
}

#[test]
fn test_manager_clear_old_completed() {
    let mut manager = ExecCellManager::new();

    // Old completed cell (mock by creating and completing immediately)
    let mut cell1 = ExecCell::new("1", "tool", serde_json::json!({}));
    cell1.mark_running();
    cell1.mark_success("done");
    // Manually set end_time to be old
    cell1.end_time = Some(std::time::Instant::now() - Duration::from_secs(100));
    manager.add(cell1);

    // Recent running cell
    let mut cell2 = ExecCell::new("2", "tool", serde_json::json!({}));
    cell2.mark_running();
    manager.add(cell2);

    manager.clear_old_completed(Duration::from_secs(10));

    assert!(manager.get("1").is_none()); // Old cell cleared
    assert!(manager.get("2").is_some()); // Running cell kept
}

#[test]
fn test_manager_total_height() {
    let mut manager = ExecCellManager::new();

    let cell1 = ExecCell::new("1", "tool", serde_json::json!({}));
    manager.add(cell1);

    let mut cell2 = ExecCell::new("2", "tool", serde_json::json!({}));
    cell2.mark_success("result\nwith\nmultiple\nlines");
    manager.add(cell2);

    let height = manager.total_height(80);
    assert!(height > 0);
}

// ============================================================================
// Edge Cases
// ============================================================================

#[test]
fn test_exec_cell_empty_result() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();
    cell.mark_success("");

    assert_eq!(cell.result, Some("".to_string()));
    assert_eq!(cell.status, ToolStatus::Success);
}

#[test]
fn test_exec_cell_multiline_result() {
    let mut cell = ExecCell::new("id", "tool", serde_json::json!({}));
    cell.mark_running();

    let multiline = "line 1\nline 2\nline 3\nline 4\nline 5";
    cell.mark_success(multiline);

    assert_eq!(cell.result.unwrap().lines().count(), 5);
}

#[test]
fn test_exec_cell_complex_json_input() {
    let cell = ExecCell::new(
        "id",
        "write_file",
        serde_json::json!({
            "path": "test.txt",
            "content": "Hello World",
            "options": {
                "overwrite": true,
                "backup": false
            }
        }),
    );

    let preview = cell.input_preview(1000);
    assert!(preview.contains("path"));
    assert!(preview.contains("content"));
    assert!(preview.contains("options"));
}

#[test]
fn test_manager_cells_mut() {
    let mut manager = ExecCellManager::new();
    let cell = ExecCell::new("1", "tool", serde_json::json!({}));
    manager.add(cell);

    for cell in manager.cells_mut() {
        cell.mark_running();
    }

    assert_eq!(manager.get("1").unwrap().status, ToolStatus::Running);
}
