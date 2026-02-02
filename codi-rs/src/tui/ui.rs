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

/// Draw the main UI.
pub fn draw(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(3),    // Messages area
            Constraint::Length(3), // Input area
            Constraint::Length(1), // Status bar
        ])
        .split(f.area());

    draw_messages(f, app, chunks[0]);
    draw_input(f, app, chunks[1]);
    draw_status(f, app, chunks[2]);

    // Draw help overlay if in help mode
    if app.mode == AppMode::Help {
        draw_help(f);
    }
}

/// Draw the messages area.
fn draw_messages(f: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Conversation ")
        .title_style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD));

    let inner = block.inner(area);

    // Collect message lines
    let mut lines: Vec<Line> = Vec::new();

    for msg in &app.messages {
        let (prefix, style) = match msg.role {
            Role::User => ("You: ", Style::default().fg(Color::Green)),
            Role::Assistant => ("Codi: ", Style::default().fg(Color::Blue)),
            Role::System => ("System: ", Style::default().fg(Color::Yellow)),
        };

        // Add prefix line
        lines.push(Line::from(vec![
            Span::styled(prefix, style.add_modifier(Modifier::BOLD)),
        ]));

        // Add content lines with word wrap
        for line in msg.content.lines() {
            lines.push(Line::from(Span::raw(format!("  {}", line))));
        }

        // Add streaming indicator
        if msg.streaming {
            lines.push(Line::from(Span::styled(
                "  ▌",
                Style::default().fg(Color::DarkGray),
            )));
        }

        // Add blank line between messages
        lines.push(Line::from(""));
    }

    // Apply scroll offset
    let visible_height = inner.height as usize;
    let total_lines = lines.len();
    let scroll_offset = if total_lines > visible_height {
        let max_offset = total_lines.saturating_sub(visible_height);
        (app.scroll_offset as usize).min(max_offset)
    } else {
        0
    };

    let visible_lines: Vec<Line> = lines.into_iter().skip(scroll_offset).collect();

    let messages = Paragraph::new(visible_lines)
        .block(block)
        .wrap(Wrap { trim: false });

    f.render_widget(messages, area);
}

/// Draw the input area.
fn draw_input(f: &mut Frame, app: &App, area: Rect) {
    let (title, border_style) = match app.mode {
        AppMode::Normal => (" Input (Esc to quit, /help for commands) ", Style::default()),
        AppMode::Waiting => (" Waiting... (Esc to cancel) ", Style::default().fg(Color::Yellow)),
        AppMode::Help => (" Help ", Style::default().fg(Color::Cyan)),
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(border_style);

    let input = Paragraph::new(app.input.as_str())
        .block(block)
        .style(Style::default());

    f.render_widget(input, area);

    // Show cursor in normal mode
    if app.mode == AppMode::Normal {
        f.set_cursor_position((
            area.x + 1 + app.cursor_pos as u16,
            area.y + 1,
        ));
    }
}

/// Draw the status bar.
fn draw_status(f: &mut Frame, app: &App, area: Rect) {
    let status_text = app.status.as_deref().unwrap_or_else(|| {
        if app.has_provider() {
            "Ready"
        } else {
            "No provider configured"
        }
    });

    let provider_info = if app.has_provider() {
        // TODO: Show provider/model info
        ""
    } else {
        ""
    };

    let status = Paragraph::new(Line::from(vec![
        Span::styled(" ", Style::default()),
        Span::styled(status_text, Style::default().fg(Color::Gray)),
        Span::styled(provider_info, Style::default().fg(Color::DarkGray)),
    ]))
    .style(Style::default().bg(Color::DarkGray));

    f.render_widget(status, area);
}

/// Draw the help overlay.
fn draw_help(f: &mut Frame) {
    let area = centered_rect(60, 60, f.area());

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
            Span::raw("     - Show this help"),
        ]),
        Line::from(vec![
            Span::styled("/clear", Style::default().fg(Color::Yellow)),
            Span::raw("    - Clear conversation"),
        ]),
        Line::from(vec![
            Span::styled("/exit", Style::default().fg(Color::Yellow)),
            Span::raw("     - Exit Codi"),
        ]),
        Line::from(vec![
            Span::styled("/quit", Style::default().fg(Color::Yellow)),
            Span::raw("     - Exit Codi"),
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
            Span::raw("       - Quit / Cancel"),
        ]),
        Line::from(vec![
            Span::styled("Enter", Style::default().fg(Color::Yellow)),
            Span::raw("     - Send message"),
        ]),
        Line::from(vec![
            Span::styled("Up/Down", Style::default().fg(Color::Yellow)),
            Span::raw("   - Scroll messages"),
        ]),
        Line::from(vec![
            Span::styled("PgUp/PgDn", Style::default().fg(Color::Yellow)),
            Span::raw(" - Scroll faster"),
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
