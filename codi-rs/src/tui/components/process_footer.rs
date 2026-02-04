// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Process footer component for showing running tool executions.
//!
//! Displays a compact footer at the bottom of the TUI showing:
//! - Count of running vs completed processes
//! - Mini status indicators for each process
//! - Expandable detailed view

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Widget},
};

use crate::tui::components::{ExecCell, ToolStatus};

/// Information about a running process for the footer.
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    /// Unique process ID.
    pub id: String,
    /// Process name (tool name).
    pub name: String,
    /// Current status.
    pub status: ToolStatus,
    /// Optional progress (0.0 - 1.0).
    pub progress: Option<f32>,
}

/// Footer showing all running processes.
pub struct ProcessFooter {
    processes: Vec<ProcessInfo>,
}

impl ProcessFooter {
    /// Create a new empty process footer.
    pub fn new() -> Self {
        Self {
            processes: Vec::new(),
        }
    }

    /// Update with current exec cells.
    pub fn from_exec_cells(cells: &[ExecCell]) -> Self {
        let processes = cells
            .iter()
            .map(|cell| ProcessInfo {
                id: cell.id.clone(),
                name: cell.tool_name.clone(),
                status: cell.status,
                progress: None, // Could be calculated from output lines
            })
            .collect();

        Self { processes }
    }

    /// Get running count.
    pub fn running_count(&self) -> usize {
        self.processes
            .iter()
            .filter(|p| p.status == ToolStatus::Running)
            .count()
    }

    /// Get completed count.
    pub fn completed_count(&self) -> usize {
        self.processes
            .iter()
            .filter(|p| p.status == ToolStatus::Success || p.status == ToolStatus::Error)
            .count()
    }

    /// Check if there are any processes.
    pub fn has_processes(&self) -> bool {
        !self.processes.is_empty()
    }

    /// Get status icon for a process.
    fn status_icon(status: ToolStatus) -> char {
        match status {
            ToolStatus::Pending => '○',
            ToolStatus::Running => '◐',
            ToolStatus::Success => '✓',
            ToolStatus::Error => '✗',
        }
    }

    /// Get status color.
    fn status_color(status: ToolStatus) -> Color {
        match status {
            ToolStatus::Pending => Color::Gray,
            ToolStatus::Running => Color::Yellow,
            ToolStatus::Success => Color::Green,
            ToolStatus::Error => Color::Red,
        }
    }
}

impl Default for ProcessFooter {
    fn default() -> Self {
        Self::new()
    }
}

impl Widget for ProcessFooter {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if !self.has_processes() {
            return;
        }

        let running = self.running_count();
        let completed = self.completed_count();
        let total = self.processes.len();

        // Build status line
        let mut status_spans = vec![
            Span::styled(
                format!("⏳ {} running ", running),
                Style::default().fg(Color::Yellow),
            ),
            Span::styled(
                format!("✓ {} completed ", completed),
                Style::default().fg(Color::Green),
            ),
            Span::styled(
                format!("({} total)", total),
                Style::default().fg(Color::Gray),
            ),
        ];

        // Add mini process indicators
        status_spans.push(Span::raw("  |  "));

        for (i, process) in self.processes.iter().take(5).enumerate() {
            if i > 0 {
                status_spans.push(Span::raw(" "));
            }
            status_spans.push(Span::styled(
                format!("{}", Self::status_icon(process.status)),
                Style::default().fg(Self::status_color(process.status)),
            ));
            status_spans.push(Span::styled(
                format!(" {}", process.name),
                Style::default().fg(Color::White),
            ));
        }

        if self.processes.len() > 5 {
            status_spans.push(Span::styled(
                format!(" +{} more", self.processes.len() - 5),
                Style::default().fg(Color::Gray),
            ));
        }

        // Render footer
        let block = Block::default()
            .borders(Borders::TOP)
            .border_style(Style::default().fg(Color::Gray));

        let inner = block.inner(area);
        block.render(area, buf);

        let line = Line::from(status_spans);
        buf.set_line(inner.x, inner.y, &line, inner.width);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;

    #[test]
    fn test_process_footer_empty() {
        let footer = ProcessFooter::new();
        assert!(!footer.has_processes());
        assert_eq!(footer.running_count(), 0);
        assert_eq!(footer.completed_count(), 0);
    }

    #[test]
    fn test_process_footer_counts() {
        let mut footer = ProcessFooter::new();
        footer.processes = vec![
            ProcessInfo {
                id: "1".to_string(),
                name: "bash".to_string(),
                status: ToolStatus::Running,
                progress: None,
            },
            ProcessInfo {
                id: "2".to_string(),
                name: "read_file".to_string(),
                status: ToolStatus::Success,
                progress: None,
            },
            ProcessInfo {
                id: "3".to_string(),
                name: "grep".to_string(),
                status: ToolStatus::Error,
                progress: None,
            },
        ];

        assert!(footer.has_processes());
        assert_eq!(footer.running_count(), 1);
        assert_eq!(footer.completed_count(), 2);
    }

    #[test]
    fn test_process_footer_render() {
        let mut footer = ProcessFooter::new();
        footer.processes = vec![ProcessInfo {
            id: "1".to_string(),
            name: "bash".to_string(),
            status: ToolStatus::Running,
            progress: None,
        }];

        let backend = TestBackend::new(80, 3);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();

        terminal
            .draw(|f| {
                let area = f.area();
                footer.render(area, f.buffer_mut());
            })
            .unwrap();

        // Should render without panic
        let buffer = terminal.backend().buffer().clone();
        assert!(buffer.content.len() > 0);
    }
}
