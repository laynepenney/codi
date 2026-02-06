// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! UI rendering for the TUI.

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
    Frame,
};

use crate::types::Role;

use super::app::{App, AppMode};
use super::components::ExecCellWidget;

/// Draw the main UI with Codex-style layout.
pub fn draw(f: &mut Frame, app: &App) {
    let has_exec_cells = !app.exec_cells.cells().is_empty();

    let chunks = if has_exec_cells {
        // Split to show exec cells between messages and input
        let exec_height = app.exec_cells.total_height(f.area().width).min(10);
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(3),              // Messages area
                Constraint::Length(exec_height), // Tool execution cells
                Constraint::Length(1),           // Input area (minimal height)
                Constraint::Length(1),           // Status bar
            ])
            .split(f.area())
    } else {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(3),    // Messages area
                Constraint::Length(1), // Input area (minimal height)
                Constraint::Length(1), // Status bar
            ])
            .split(f.area())
    };

    draw_messages(f, app, chunks[0]);

    if has_exec_cells {
        draw_exec_cells(f, app, chunks[1]);
        draw_input(f, app, chunks[2]);
        draw_status(f, app, chunks[3]);
    } else {
        draw_input(f, app, chunks[1]);
        draw_status(f, app, chunks[2]);
    }

    // Draw overlays
    match app.mode {
        AppMode::Help => draw_help(f),
        AppMode::ConfirmTool => draw_confirmation(f, app),
        _ => {}
    }
}

/// Draw the messages area with Codex-style rendering.
fn draw_messages(f: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Conversation ")
        .title_style(
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        );

    let inner = block.inner(area);

    // Collect message lines
    let mut lines: Vec<Line> = Vec::new();

    for msg in &app.messages {
        // Codex-style prefixes: › for user, • for assistant
        let (prefix, prefix_style, content_style) = match msg.role {
            Role::User => (
                "› ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
                Style::default(),
            ),
            Role::Assistant => ("• ", Style::default().fg(Color::Gray), Style::default()),
            Role::System => (
                "⚠ ",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
                Style::default().fg(Color::Yellow),
            ),
        };

        // Use pre-rendered lines if available (from streaming)
        if !msg.rendered_lines.is_empty() {
            // First line gets the prefix
            let first_line = msg
                .rendered_lines
                .first()
                .cloned()
                .unwrap_or_else(|| Line::from(""));
            let mut prefixed_spans = vec![Span::styled(prefix, prefix_style)];
            prefixed_spans.extend(first_line.spans.clone());
            lines.push(Line::from(prefixed_spans));

            // Remaining lines get indentation
            for line in msg.rendered_lines.iter().skip(1) {
                lines.push(line.clone());
            }
        } else {
            // Render content line by line with prefix on first line
            let content_lines: Vec<&str> = msg.content.lines().collect();
            if !content_lines.is_empty() {
                // First line with prefix
                let mut prefixed_spans = vec![Span::styled(prefix, prefix_style)];
                prefixed_spans.push(Span::styled(content_lines[0].to_string(), content_style));
                lines.push(Line::from(prefixed_spans));

                // Remaining lines
                for line in content_lines.iter().skip(1) {
                    lines.push(Line::from(Span::styled(line.to_string(), content_style)));
                }
            }
        }

        // Add streaming indicator for active messages
        if msg.streaming {
            // Show partial buffer if available
            let buffer = app.streaming_buffer();
            if !buffer.is_empty() {
                lines.push(Line::from(Span::styled(
                    buffer.to_string(),
                    Style::default().fg(Color::DarkGray),
                )));
            }
            // Blinking cursor indicator
            lines.push(Line::from(Span::styled(
                "▌",
                Style::default().fg(Color::DarkGray),
            )));
        }

        // Add blank line between messages (compact spacing)
        lines.push(Line::from(""));
    }

    // Calculate scroll
    let visible_height = inner.height as usize;
    let total_lines = lines.len();

    let scroll_offset = if total_lines > visible_height {
        let max_offset = total_lines.saturating_sub(visible_height);
        // If scroll_offset is MAX, scroll to bottom
        if app.scroll_offset == u16::MAX {
            max_offset
        } else {
            (app.scroll_offset as usize).min(max_offset)
        }
    } else {
        0
    };

    let visible_lines: Vec<Line> = lines.into_iter().skip(scroll_offset).collect();

    let messages = Paragraph::new(visible_lines)
        .block(block)
        .wrap(Wrap { trim: false });

    f.render_widget(messages, area);
}

/// Draw the input area with Codex-style minimal design.
fn draw_input(f: &mut Frame, app: &App, area: Rect) {
    let (_title, border_style) = match app.mode {
        AppMode::Normal => ("", Style::default().fg(Color::DarkGray)),
        AppMode::Waiting => ("", Style::default().fg(Color::Yellow)),
        AppMode::Help => ("", Style::default().fg(Color::Cyan)),
        AppMode::ConfirmTool => ("", Style::default().fg(Color::Red)),
    };

    let block = Block::default()
        .borders(Borders::TOP)
        .border_style(border_style);

    let inner = block.inner(area);

    // Show input with prefix indicator
    let input_text = if app.input.is_empty() {
        if app.mode == AppMode::Normal {
            Line::from(vec![
                Span::styled(
                    "› ",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    "Type a message or / for commands...",
                    Style::default().fg(Color::DarkGray),
                ),
            ])
        } else {
            Line::from("")
        }
    } else {
        let prefix = match app.mode {
            AppMode::Normal => "› ",
            _ => "  ",
        };
        Line::from(vec![
            Span::styled(
                prefix,
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(&app.input),
        ])
    };

    let input = Paragraph::new(input_text).block(block);

    f.render_widget(input, area);

    // Show cursor in normal mode
    if app.mode == AppMode::Normal {
        let cursor_x = inner.x + 2 + app.cursor_pos as u16; // +2 for "› " prefix
        let cursor_y = inner.y;
        f.set_cursor_position((cursor_x, cursor_y));
    }
}

/// Draw the status bar with Codex-style working indicator.
fn draw_status(f: &mut Frame, app: &App, area: Rect) {
    let mut spans: Vec<Span> = Vec::new();

    // Show working indicator when waiting (Codex-style)
    if app.mode == AppMode::Waiting {
        // Animated spinner characters
        let spinner_frames = ["◐", "◓", "◑", "◒"];
        let frame_idx = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            / 250) as usize
            % spinner_frames.len();
        let spinner = spinner_frames[frame_idx];

        spans.push(Span::styled(
            format!("{} Working ", spinner),
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ));

        // Show elapsed time if available
        if let Some(start_time) = app.turn_start_time {
            let elapsed = std::time::Instant::now().duration_since(start_time);
            let elapsed_str = format!("({}.{})", elapsed.as_secs(), elapsed.subsec_millis() / 100);
            spans.push(Span::styled(
                elapsed_str,
                Style::default().fg(Color::DarkGray),
            ));
            spans.push(Span::raw(" "));
        }

        // Show interrupt hint
        spans.push(Span::styled(
            "Esc to cancel",
            Style::default().fg(Color::DarkGray),
        ));
        spans.push(Span::styled(" | ", Style::default().fg(Color::DarkGray)));
    }

    // Show session info if available
    if let Some(session_status) = app.session_status() {
        spans.push(Span::styled(
            session_status,
            Style::default().fg(Color::Cyan),
        ));
        spans.push(Span::styled(" | ", Style::default().fg(Color::DarkGray)));
    }

    // Show status message or default
    let status_text = app.status.as_deref().unwrap_or_else(|| {
        if app.has_provider() {
            "Ready"
        } else {
            "No provider configured"
        }
    });

    if app.mode != AppMode::Waiting {
        spans.push(Span::styled(status_text, Style::default().fg(Color::Gray)));
    }

    // Show turn stats if available and no custom status
    if app.status.is_none() && app.mode != AppMode::Waiting {
        if let Some(ref stats) = app.last_turn_stats {
            spans.push(Span::styled(
                format!(
                    " | {} tools, {} in, {} out",
                    stats.tool_call_count, stats.input_tokens, stats.output_tokens
                ),
                Style::default().fg(Color::DarkGray),
            ));
        }
    }

    let status = Paragraph::new(Line::from(spans)).style(Style::default().bg(Color::Black));

    f.render_widget(status, area);
}

/// Draw the help overlay.
fn draw_help(f: &mut Frame) {
    let area = centered_rect(65, 80, f.area());

    let help_text = vec![
        Line::from(Span::styled(
            " Codi Commands ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(vec![
            Span::styled("/help", Style::default().fg(Color::Yellow)),
            Span::raw("           - Show this help"),
        ]),
        Line::from(vec![
            Span::styled("/clear", Style::default().fg(Color::Yellow)),
            Span::raw("          - Clear conversation"),
        ]),
        Line::from(vec![
            Span::styled("/exit", Style::default().fg(Color::Yellow)),
            Span::raw("           - Exit Codi"),
        ]),
        Line::from(vec![
            Span::styled("/version", Style::default().fg(Color::Yellow)),
            Span::raw("        - Show version"),
        ]),
        Line::from(vec![
            Span::styled("/status", Style::default().fg(Color::Yellow)),
            Span::raw("         - Show context status"),
        ]),
        Line::from(vec![
            Span::styled("/compact", Style::default().fg(Color::Yellow)),
            Span::raw("        - Context management"),
        ]),
        Line::from(vec![
            Span::styled("/model", Style::default().fg(Color::Yellow)),
            Span::raw("          - Show/switch model"),
        ]),
        Line::from(vec![
            Span::styled("/session", Style::default().fg(Color::Yellow)),
            Span::raw("        - Session management"),
        ]),
        Line::from(vec![
            Span::styled("/debug", Style::default().fg(Color::Yellow)),
            Span::raw("          - Show debug info"),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            " Session Commands ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(vec![
            Span::styled("/session new", Style::default().fg(Color::Yellow)),
            Span::raw("     - Start new session"),
        ]),
        Line::from(vec![
            Span::styled("/session save", Style::default().fg(Color::Yellow)),
            Span::raw("    - Save current session"),
        ]),
        Line::from(vec![
            Span::styled("/session load", Style::default().fg(Color::Yellow)),
            Span::raw("    - Load a session"),
        ]),
        Line::from(vec![
            Span::styled("/session list", Style::default().fg(Color::Yellow)),
            Span::raw("    - List saved sessions"),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            " Orchestration (Multi-Agent) ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(vec![
            Span::styled("/delegate", Style::default().fg(Color::Yellow)),
            Span::raw("       - Spawn worker: /delegate <branch> <task>"),
        ]),
        Line::from(vec![
            Span::styled("/workers", Style::default().fg(Color::Yellow)),
            Span::raw("        - List workers, cancel: /workers [cancel <id>]"),
        ]),
        Line::from(vec![
            Span::styled("/worktrees", Style::default().fg(Color::Yellow)),
            Span::raw("      - List/cleanup: /worktrees [cleanup]"),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            " Keyboard Shortcuts ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(vec![
            Span::styled("Esc", Style::default().fg(Color::Yellow)),
            Span::raw("             - Quit / Cancel"),
        ]),
        Line::from(vec![
            Span::styled("Enter", Style::default().fg(Color::Yellow)),
            Span::raw("           - Send message"),
        ]),
        Line::from(vec![
            Span::styled("Shift+Enter", Style::default().fg(Color::Yellow)),
            Span::raw("     - New line in input"),
        ]),
        Line::from(vec![
            Span::styled("Ctrl+C/D", Style::default().fg(Color::Yellow)),
            Span::raw("        - Quit"),
        ]),
        Line::from(vec![
            Span::styled("Up/Down", Style::default().fg(Color::Yellow)),
            Span::raw("         - Navigate input history"),
        ]),
        Line::from(vec![
            Span::styled("PgUp/PgDn", Style::default().fg(Color::Yellow)),
            Span::raw("       - Scroll messages"),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            "Press Esc or Enter to close",
            Style::default().fg(Color::DarkGray),
        )),
    ];

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Help ")
        .title_style(Style::default().fg(Color::Cyan))
        .style(Style::default().bg(Color::Black));

    let help = Paragraph::new(help_text).block(block);

    f.render_widget(Clear, area);
    f.render_widget(help, area);
}

/// Draw the tool confirmation overlay.
fn draw_confirmation(f: &mut Frame, app: &App) {
    let area = centered_rect(70, 50, f.area());

    let (tool_name, input_preview) = if let Some(confirmation) = app.get_pending_confirmation() {
        let preview = serde_json::to_string_pretty(&confirmation.input)
            .unwrap_or_else(|_| format!("{:?}", confirmation.input));
        (confirmation.tool_name.as_str(), preview)
    } else {
        ("Unknown", "{}".to_string())
    };

    let mut lines = vec![
        Line::from(Span::styled(
            " Tool Confirmation Required ",
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(vec![
            Span::raw("Tool: "),
            Span::styled(
                tool_name,
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(""),
        Line::from(Span::styled("Input:", Style::default().fg(Color::Cyan))),
    ];

    // Add input preview lines
    for line in input_preview.lines().take(10) {
        lines.push(Line::from(Span::styled(
            format!("  {}", line),
            Style::default().fg(Color::Yellow),
        )));
    }
    if input_preview.lines().count() > 10 {
        lines.push(Line::from(Span::styled(
            "  ...",
            Style::default().fg(Color::DarkGray),
        )));
    }

    lines.extend(vec![
        Line::from(""),
        Line::from(vec![
            Span::styled(
                "[Y]",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" Approve  "),
            Span::styled(
                "[N]",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" Deny  "),
            Span::styled(
                "[A]",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" Abort"),
        ]),
    ]);

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Confirm ")
        .title_style(Style::default().fg(Color::Red))
        .style(Style::default().bg(Color::Black));

    let confirmation_widget = Paragraph::new(lines).block(block);

    f.render_widget(Clear, area);
    f.render_widget(confirmation_widget, area);
}

/// Draw the exec cells area.
fn draw_exec_cells(f: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Tools ")
        .title_style(
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        );

    let inner = block.inner(area);
    f.render_widget(block, area);

    // Render each exec cell
    let mut current_y = inner.y;
    for cell in app.exec_cells.cells() {
        let cell_height = cell.required_height(inner.width);
        if current_y + cell_height > inner.bottom() {
            break; // Don't overflow
        }

        let cell_area = Rect {
            x: inner.x,
            y: current_y,
            width: inner.width,
            height: cell_height,
        };

        ExecCellWidget::render(cell, cell_area, f.buffer_mut());
        current_y += cell_height + 1; // +1 for spacing
    }
}

/// Create a centered rectangle.
fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}
