// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tool execution visualization component.
//!
//! ExecCell provides rich visual display for tool calls with:
//! - Animated spinners during execution
//! - Live output streaming
//! - Duration tracking
//! - Collapsible full output
//! - Color-coded status (pending/running/success/error)

use std::time::{Duration, Instant};

use ratatui::{
    buffer::Buffer,
    layout::{Constraint, Direction, Layout, Margin, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph, StatefulWidget, Widget, Wrap},
};

/// Status of a tool execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolStatus {
    /// Tool is queued but not yet started.
    Pending,
    /// Tool is currently executing.
    Running,
    /// Tool completed successfully.
    Success,
    /// Tool failed with an error.
    Error,
}

impl ToolStatus {
    /// Get the color associated with this status.
    pub fn color(&self) -> Color {
        match self {
            ToolStatus::Pending => Color::Gray,
            ToolStatus::Running => Color::Yellow,
            ToolStatus::Success => Color::Green,
            ToolStatus::Error => Color::Red,
        }
    }

    /// Get the icon character for this status.
    pub fn icon(&self) -> char {
        match self {
            ToolStatus::Pending => '○',
            ToolStatus::Running => '◐',
            ToolStatus::Success => '✓',
            ToolStatus::Error => '✗',
        }
    }

    /// Check if the tool is in a terminal state.
    pub fn is_terminal(&self) -> bool {
        matches!(self, ToolStatus::Success | ToolStatus::Error)
    }
}

/// A single tool execution cell.
#[derive(Debug, Clone)]
pub struct ExecCell {
    /// Unique identifier for this execution.
    pub id: String,
    /// Name of the tool being executed.
    pub tool_name: String,
    /// Input parameters (JSON value).
    pub input: serde_json::Value,
    /// Current execution status.
    pub status: ToolStatus,
    /// When execution started.
    pub start_time: Instant,
    /// When execution completed (if finished).
    pub end_time: Option<Instant>,
    /// Live output lines (captured during execution).
    pub live_output: Vec<String>,
    /// Maximum number of live output lines to keep.
    max_live_output: usize,
    /// Full result output (shown when expanded).
    pub result: Option<String>,
    /// Whether the cell is expanded to show full output.
    pub expanded: bool,
    /// Current spinner frame (for animation).
    pub spinner_frame: usize,
}

impl ExecCell {
    /// Spinner animation characters.
    const SPINNER_CHARS: [char; 10] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

    /// Create a new exec cell for a pending tool call.
    pub fn new(
        id: impl Into<String>,
        tool_name: impl Into<String>,
        input: serde_json::Value,
    ) -> Self {
        Self {
            id: id.into(),
            tool_name: tool_name.into(),
            input,
            status: ToolStatus::Pending,
            start_time: Instant::now(),
            end_time: None,
            live_output: Vec::new(),
            max_live_output: 5,
            result: None,
            expanded: false,
            spinner_frame: 0,
        }
    }

    /// Mark the tool as running.
    pub fn mark_running(&mut self) {
        self.status = ToolStatus::Running;
        self.start_time = Instant::now();
    }

    /// Mark the tool as completed successfully.
    pub fn mark_success(&mut self, result: impl Into<String>) {
        self.status = ToolStatus::Success;
        self.end_time = Some(Instant::now());
        self.result = Some(result.into());
    }

    /// Mark the tool as failed.
    pub fn mark_error(&mut self, error: impl Into<String>) {
        self.status = ToolStatus::Error;
        self.end_time = Some(Instant::now());
        self.result = Some(error.into());
    }

    /// Add a line of live output during execution.
    pub fn add_output_line(&mut self, line: impl Into<String>) {
        if self.live_output.len() >= self.max_live_output {
            self.live_output.remove(0);
        }
        self.live_output.push(line.into());
    }

    /// Add multiple lines of live output.
    pub fn add_output_lines(&mut self, lines: impl Iterator<Item = impl Into<String>>) {
        for line in lines {
            self.add_output_line(line);
        }
    }

    /// Toggle expanded state.
    pub fn toggle_expanded(&mut self) {
        self.expanded = !self.expanded;
    }

    /// Get the current duration of execution.
    pub fn duration(&self) -> Duration {
        match self.end_time {
            Some(end) => end.duration_since(self.start_time),
            None => self.start_time.elapsed(),
        }
    }

    /// Format duration as human-readable string.
    pub fn format_duration(&self) -> String {
        let dur = self.duration();
        if dur.as_secs() > 0 {
            format!("{:.1}s", dur.as_secs_f64())
        } else {
            format!("{}ms", dur.as_millis())
        }
    }

    /// Get a preview of the input (truncated).
    pub fn input_preview(&self, max_len: usize) -> String {
        let input_str = self.input.to_string();
        if input_str.len() <= max_len {
            input_str
        } else {
            format!("{}...", &input_str[..max_len.saturating_sub(3)])
        }
    }

    /// Advance the spinner animation.
    pub fn tick_spinner(&mut self) {
        self.spinner_frame = (self.spinner_frame + 1) % Self::SPINNER_CHARS.len();
    }

    /// Get the current spinner character.
    pub fn spinner_char(&self) -> char {
        if self.status == ToolStatus::Running {
            Self::SPINNER_CHARS[self.spinner_frame]
        } else {
            self.status.icon()
        }
    }

    /// Calculate the height needed to render this cell.
    pub fn required_height(&self, width: u16) -> u16 {
        let base_height = 3; // Header + border

        let input_height = if self.expanded {
            // Full input JSON
            let input_str = self.input.to_string();
            let lines = input_str.lines().count() as u16;
            lines + 1 // +1 for label
        } else {
            1 // Single line preview
        };

        let output_height = if self.expanded && self.result.is_some() {
            let result_lines = self.result.as_ref().unwrap().lines().count() as u16;
            result_lines.min(20) + 1 // +1 for label, max 20 lines
        } else if !self.live_output.is_empty() && self.status == ToolStatus::Running {
            // Show live output preview
            (self.live_output.len() as u16).min(self.max_live_output as u16) + 2
        // +2 for border
        } else if self.status.is_terminal() {
            1 // Result summary line
        } else {
            0
        };

        base_height + input_height + output_height + 2 // +2 for padding
    }
}

/// A widget for rendering an exec cell.
pub struct ExecCellWidget;

impl ExecCellWidget {
    /// Render the cell at the given area.
    pub fn render(cell: &ExecCell, area: Rect, buf: &mut Buffer) {
        // Determine border style based on status
        let border_color = cell.status.color();
        let border_style = Style::default().fg(border_color);

        // Create block with title
        let title = format!(" {} ", cell.tool_name);
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(border_style)
            .title(Span::styled(
                title,
                Style::default().add_modifier(Modifier::BOLD),
            ))
            .title_alignment(ratatui::layout::Alignment::Left);

        // Render block
        block.render(area, buf);

        // Get inner area
        let inner = area.inner(Margin::new(2, 1));

        // Split inner area into sections
        let sections = if cell.expanded {
            // Expanded: show full input and output
            Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(1), // Header (icon + duration)
                    Constraint::Min(1),    // Input
                    Constraint::Min(1),    // Output (if available)
                ])
                .split(inner)
        } else {
            // Collapsed: compact view
            let has_output = !cell.live_output.is_empty() || cell.result.is_some();
            if has_output && cell.status == ToolStatus::Running {
                Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(1), // Header
                        Constraint::Length(1), // Input preview
                        Constraint::Min(1),    // Live output
                    ])
                    .split(inner)
            } else {
                Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(1), // Header
                        Constraint::Length(1), // Input preview
                        Constraint::Length(1), // Result summary (if terminal)
                    ])
                    .split(inner)
            }
        };

        // Render header line (icon + status + duration)
        Self::render_header(cell, sections[0], buf);

        // Render input section
        Self::render_input(cell, sections[1], buf);

        // Render output section if applicable
        if sections.len() > 2 {
            Self::render_output(cell, sections[2], buf);
        }
    }

    fn render_header(cell: &ExecCell, area: Rect, buf: &mut Buffer) {
        let spinner = cell.spinner_char();
        let duration = cell.format_duration();

        let header_text = if cell.status.is_terminal() {
            format!("{} {} ({})", spinner, cell.status_icon_text(), duration)
        } else {
            format!("{} Running... ({})", spinner, duration)
        };

        let header_style = Style::default().fg(cell.status.color());
        let header = Paragraph::new(Line::from(vec![
            Span::styled(
                format!("{} ", spinner),
                header_style.add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                if cell.status.is_terminal() {
                    cell.status_icon_text()
                } else {
                    "Running...".to_string()
                },
                header_style,
            ),
            Span::styled(format!(" ({})", duration), Style::default().fg(Color::Gray)),
        ]));

        header.render(area, buf);
    }

    fn render_input(cell: &ExecCell, area: Rect, buf: &mut Buffer) {
        if cell.expanded {
            // Show full input as JSON
            let input_str = serde_json::to_string_pretty(&cell.input).unwrap_or_default();
            let input_paragraph = Paragraph::new(input_str)
                .wrap(Wrap { trim: true })
                .style(Style::default().fg(Color::Gray));
            input_paragraph.render(area, buf);
        } else {
            // Show truncated preview
            let preview = cell.input_preview(area.width as usize);
            let preview_line = Line::from(vec![
                Span::styled("Input: ", Style::default().fg(Color::DarkGray)),
                Span::styled(preview, Style::default().fg(Color::Gray)),
            ]);
            buf.set_line(area.x, area.y, &preview_line, area.width);
        }
    }

    fn render_output(cell: &ExecCell, area: Rect, buf: &mut Buffer) {
        if cell.expanded && cell.result.is_some() {
            // Show full result
            let result = cell.result.as_ref().unwrap();
            let lines: Vec<Line> = result
                .lines()
                .take(20) // Limit to 20 lines in expanded view
                .map(|line| Line::from(Span::raw(line.to_string())))
                .collect();

            let output_block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Gray))
                .title(" Output ");

            let output_area = area;
            output_block.render(output_area, buf);

            let inner = output_area.inner(Margin::new(2, 1));
            let output_text = Text::from(lines);
            let output_paragraph = Paragraph::new(output_text).wrap(Wrap { trim: true });
            output_paragraph.render(inner, buf);
        } else if !cell.live_output.is_empty() && cell.status == ToolStatus::Running {
            // Show live output preview
            let output_block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray));

            let output_area = area;
            output_block.render(output_area, buf);

            let inner = output_area.inner(Margin::new(2, 1));
            let lines: Vec<Line> = cell
                .live_output
                .iter()
                .map(|line| {
                    Line::from(Span::styled(line.clone(), Style::default().fg(Color::Gray)))
                })
                .collect();

            let output_text = Text::from(lines);
            let output_paragraph = Paragraph::new(output_text).wrap(Wrap { trim: true });
            output_paragraph.render(inner, buf);
        } else if cell.status.is_terminal() {
            // Show result summary
            let summary = if let Some(ref result) = cell.result {
                let lines = result.lines().count();
                let preview: String = result.chars().take(100).collect();
                if result.len() > 100 {
                    format!("{} lines | {}...", lines, preview)
                } else {
                    format!("{} lines | {}", lines, preview)
                }
            } else {
                "No output".to_string()
            };

            let summary_line = Line::from(vec![
                Span::styled("Result: ", Style::default().fg(Color::DarkGray)),
                Span::styled(summary, Style::default().fg(Color::Gray)),
            ]);
            buf.set_line(area.x, area.y, &summary_line, area.width);
        }
    }
}

impl ExecCell {
    fn status_icon_text(&self) -> String {
        match self.status {
            ToolStatus::Pending => "Pending".to_string(),
            ToolStatus::Running => "Running".to_string(),
            ToolStatus::Success => "Success".to_string(),
            ToolStatus::Error => "Error".to_string(),
        }
    }
}

/// Manager for multiple exec cells.
#[derive(Debug, Default)]
pub struct ExecCellManager {
    cells: Vec<ExecCell>,
}

impl ExecCellManager {
    /// Create a new empty manager.
    pub fn new() -> Self {
        Self { cells: Vec::new() }
    }

    /// Add a new exec cell.
    pub fn add(&mut self, cell: ExecCell) -> String {
        let id = cell.id.clone();
        self.cells.push(cell);
        id
    }

    /// Get a cell by ID.
    pub fn get(&self, id: &str) -> Option<&ExecCell> {
        self.cells.iter().find(|c| c.id == id)
    }

    /// Get a mutable cell by ID.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut ExecCell> {
        self.cells.iter_mut().find(|c| c.id == id)
    }

    /// Remove a cell by ID.
    pub fn remove(&mut self, id: &str) -> Option<ExecCell> {
        if let Some(index) = self.cells.iter().position(|c| c.id == id) {
            Some(self.cells.remove(index))
        } else {
            None
        }
    }

    /// Get all cells.
    pub fn cells(&self) -> &[ExecCell] {
        &self.cells
    }

    /// Get mutable access to all cells.
    pub fn cells_mut(&mut self) -> &mut [ExecCell] {
        &mut self.cells
    }

    /// Clear completed cells older than a given duration.
    pub fn clear_old_completed(&mut self, max_age: Duration) {
        let now = Instant::now();
        self.cells.retain(|c| {
            if c.status.is_terminal() {
                if let Some(end_time) = c.end_time {
                    now.duration_since(end_time) < max_age
                } else {
                    true
                }
            } else {
                true
            }
        });
    }

    /// Get cells that are still running.
    pub fn running_cells(&self) -> Vec<&ExecCell> {
        self.cells
            .iter()
            .filter(|c| c.status == ToolStatus::Running)
            .collect()
    }

    /// Get count of running cells.
    pub fn running_count(&self) -> usize {
        self.cells
            .iter()
            .filter(|c| c.status == ToolStatus::Running)
            .count()
    }

    /// Tick all running cell spinners.
    pub fn tick_all_spinners(&mut self) {
        for cell in self.cells.iter_mut() {
            if cell.status == ToolStatus::Running {
                cell.tick_spinner();
            }
        }
    }

    /// Calculate total height needed for all cells.
    pub fn total_height(&self, width: u16) -> u16 {
        self.cells
            .iter()
            .map(|c| c.required_height(width) + 1)
            .sum::<u16>() // +1 for spacing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_status_colors() {
        assert_eq!(ToolStatus::Pending.color(), Color::Gray);
        assert_eq!(ToolStatus::Running.color(), Color::Yellow);
        assert_eq!(ToolStatus::Success.color(), Color::Green);
        assert_eq!(ToolStatus::Error.color(), Color::Red);
    }

    #[test]
    fn test_exec_cell_lifecycle() {
        let mut cell = ExecCell::new("1", "bash", serde_json::json!({"cmd": "echo hi"}));

        assert_eq!(cell.status, ToolStatus::Pending);
        assert!(cell.end_time.is_none());

        cell.mark_running();
        assert_eq!(cell.status, ToolStatus::Running);

        cell.mark_success("output");
        assert_eq!(cell.status, ToolStatus::Success);
        assert!(cell.end_time.is_some());
        assert_eq!(cell.result, Some("output".to_string()));
    }

    #[test]
    fn test_exec_cell_live_output() {
        let mut cell = ExecCell::new("1", "bash", serde_json::json!({}));

        cell.add_output_line("line 1");
        cell.add_output_line("line 2");
        cell.add_output_line("line 3");

        assert_eq!(cell.live_output.len(), 3);

        // Add more than max
        cell.add_output_line("line 4");
        cell.add_output_line("line 5");
        cell.add_output_line("line 6");

        // Should only keep last 5
        assert_eq!(cell.live_output.len(), 5);
        assert_eq!(cell.live_output[0], "line 2");
    }

    #[test]
    fn test_manager_add_and_get() {
        let mut manager = ExecCellManager::new();
        let cell = ExecCell::new(
            "test-1",
            "read_file",
            serde_json::json!({"path": "test.rs"}),
        );

        let id = manager.add(cell);
        assert_eq!(id, "test-1");

        let retrieved = manager.get("test-1");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().tool_name, "read_file");
    }

    #[test]
    fn test_manager_running_count() {
        let mut manager = ExecCellManager::new();

        let mut cell1 = ExecCell::new("1", "bash", serde_json::json!({}));
        cell1.mark_running();
        manager.add(cell1);

        let mut cell2 = ExecCell::new("2", "grep", serde_json::json!({}));
        cell2.mark_success("done");
        manager.add(cell2);

        assert_eq!(manager.running_count(), 1);
    }

    #[test]
    fn test_spinner_animation() {
        let mut cell = ExecCell::new("1", "bash", serde_json::json!({}));
        cell.mark_running();

        let frame1 = cell.spinner_frame;
        cell.tick_spinner();
        let frame2 = cell.spinner_frame;

        assert_ne!(frame1, frame2);
        assert!(cell.spinner_char() != '○');
    }
}
