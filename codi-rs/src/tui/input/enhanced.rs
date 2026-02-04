// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Enhanced keyboard input with CSI u protocol support.
//!
//! This module provides disambiguated key input for modern terminals,
//! fixing issues like Shift+Tab conflicts and enabling all modifier combinations.
//!
//! # CSI u Protocol
//!
//! The CSI u protocol (supported by kitty, ghostty, wezterm, foot, alacritty)
//! sends key events in the format:
//!
//! ```text
//! ESC [ unicode ; modifiers u
//! ```
//!
//! Where:
//! - `unicode`: Unicode codepoint of the key
//! - `modifiers`: Bitmask (1=Shift, 2=Alt, 4=Ctrl, 8=Meta)
//!
//! # Example
//!
//! ```rust,ignore
//! use codi::tui::input::{EnhancedInput, KeyEvent};
//!
//! let input = EnhancedInput::new();
//! if input.enable_enhanced_keys() {
//!     // Terminal supports CSI u
//! } else {
//!     // Fall back to standard input
//! }
//! ```

use std::io::{self, Write};

use crossterm::{
    cursor::Show,
    event::{KeyboardEnhancementFlags, PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode},
};

/// Represents a key event with full modifier information.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyEvent {
    /// The key code (character or special key).
    pub code: KeyCode,
    /// Modifiers pressed.
    pub modifiers: KeyModifiers,
    /// Raw escape sequence (for debugging).
    pub raw_sequence: String,
}

/// Key codes for special keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyCode {
    /// Regular character.
    Char(char),
    /// Function key F1-F24.
    F(u8),
    /// Escape key.
    Esc,
    /// Enter/Return key.
    Enter,
    /// Tab key.
    Tab,
    /// Backspace key.
    Backspace,
    /// Delete key.
    Delete,
    /// Insert key.
    Insert,
    /// Home key.
    Home,
    /// End key.
    End,
    /// Page up key.
    PageUp,
    /// Page down key.
    PageDown,
    /// Up arrow key.
    Up,
    /// Down arrow key.
    Down,
    /// Left arrow key.
    Left,
    /// Right arrow key.
    Right,
    /// Unknown key.
    Unknown,
}

/// Key modifier flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KeyModifiers {
    /// Shift key pressed.
    pub shift: bool,
    /// Control key pressed.
    pub ctrl: bool,
    /// Alt key pressed.
    pub alt: bool,
    /// Meta/Super/Command key pressed.
    pub meta: bool,
}

impl KeyModifiers {
    /// Create from CSI u modifier bitmask.
    fn from_csi_u_mask(mask: u8) -> Self {
        Self {
            shift: mask & 1 != 0,
            alt: mask & 2 != 0,
            ctrl: mask & 4 != 0,
            meta: mask & 8 != 0,
        }
    }

    /// Convert to crossterm modifier equivalent.
    pub fn to_crossterm(&self) -> crossterm::event::KeyModifiers {
        let mut mods = crossterm::event::KeyModifiers::empty();
        if self.shift {
            mods |= crossterm::event::KeyModifiers::SHIFT;
        }
        if self.ctrl {
            mods |= crossterm::event::KeyModifiers::CONTROL;
        }
        if self.alt {
            mods |= crossterm::event::KeyModifiers::ALT;
        }
        if self.meta {
            mods |= crossterm::event::KeyModifiers::META;
        }
        mods
    }
}

/// Enhanced keyboard input handler.
pub struct EnhancedInput {
    enabled: bool,
    supports_enhanced: bool,
}

impl EnhancedInput {
    /// Create a new enhanced input handler.
    pub fn new() -> Self {
        Self {
            enabled: false,
            supports_enhanced: false,
        }
    }

    /// Enable enhanced keyboard reporting.
    ///
    /// This sends the CSI u protocol enable sequence to the terminal.
    /// Returns true if the terminal supports enhanced keys.
    pub fn enable_enhanced_keys(&mut self) -> io::Result<bool> {
        // Try to enable keyboard enhancement flags
        let result = execute!(
            io::stdout(),
            PushKeyboardEnhancementFlags(
                KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                    | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
                    | KeyboardEnhancementFlags::REPORT_ALTERNATE_KEYS
                    | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
            )
        );

        match result {
            Ok(_) => {
                self.enabled = true;
                self.supports_enhanced = true;
                Ok(true)
            }
            Err(e) => {
                // Terminal doesn't support enhanced keys
                tracing::debug!("Terminal doesn't support enhanced keys: {}", e);
                Ok(false)
            }
        }
    }

    /// Disable enhanced keyboard reporting.
    pub fn disable_enhanced_keys(&mut self) -> io::Result<()> {
        if self.enabled {
            execute!(io::stdout(), PopKeyboardEnhancementFlags)?;
            self.enabled = false;
        }
        Ok(())
    }

    /// Check if enhanced keys are enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Check if terminal supports enhanced keys.
    pub fn supports_enhanced(&self) -> bool {
        self.supports_enhanced
    }

    /// Parse a key sequence from terminal input.
    ///
    /// This handles both CSI u format and standard escape sequences.
    pub fn parse_key_sequence(data: &[u8]) -> Option<KeyEvent> {
        let seq = String::from_utf8_lossy(data);

        // Try CSI u format first (ESC [ unicode ; modifiers u)
        if let Some(event) = Self::parse_csi_u(&seq) {
            return Some(event);
        }

        // Fall back to standard escape sequence parsing
        Self::parse_standard_escape(&seq)
    }

    /// Parse CSI u format: ESC [ unicode ; modifiers u
    fn parse_csi_u(seq: &str) -> Option<KeyEvent> {
        // CSI u pattern: ESC [ <unicode> [ ; <modifiers> ] u
        let pattern = regex::Regex::new(r"^\x1b\[(\d+)(?:;(\d+))?u$").ok()?;

        if let Some(captures) = pattern.captures(seq) {
            let unicode: u32 = captures.get(1)?.as_str().parse().ok()?;
            let modifiers = captures
                .get(2)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0);

            let code = if unicode == 9 {
                KeyCode::Tab
            } else if unicode == 13 {
                KeyCode::Enter
            } else if unicode == 27 {
                KeyCode::Esc
            } else if unicode == 127 {
                KeyCode::Backspace
            } else {
                char::from_u32(unicode)
                    .map(KeyCode::Char)
                    .unwrap_or(KeyCode::Unknown)
            };

            return Some(KeyEvent {
                code,
                modifiers: KeyModifiers::from_csi_u_mask(modifiers),
                raw_sequence: seq.to_string(),
            });
        }

        None
    }

    /// Parse standard escape sequences.
    fn parse_standard_escape(seq: &str) -> Option<KeyEvent> {
        let code = match seq {
            "\x1b" => KeyCode::Esc,
            "\x1b[A" => KeyCode::Up,
            "\x1b[B" => KeyCode::Down,
            "\x1b[C" => KeyCode::Right,
            "\x1b[D" => KeyCode::Left,
            "\x1b[H" => KeyCode::Home,
            "\x1b[F" => KeyCode::End,
            "\x1b[5~" => KeyCode::PageUp,
            "\x1b[6~" => KeyCode::PageDown,
            "\x1b[3~" => KeyCode::Delete,
            "\x1b[2~" => KeyCode::Insert,
            "\x1bOP" => KeyCode::F(1),
            "\x1bOQ" => KeyCode::F(2),
            "\x1bOR" => KeyCode::F(3),
            "\x1bOS" => KeyCode::F(4),
            "\x1b[15~" => KeyCode::F(5),
            "\x1b[17~" => KeyCode::F(6),
            "\x1b[18~" => KeyCode::F(7),
            "\x1b[19~" => KeyCode::F(8),
            "\x1b[20~" => KeyCode::F(9),
            "\x1b[21~" => KeyCode::F(10),
            "\x1b[23~" => KeyCode::F(11),
            "\x1b[24~" => KeyCode::F(12),
            "\t" => KeyCode::Tab,
            "\n" | "\r" => KeyCode::Enter,
            "\x7f" => KeyCode::Backspace,
            _ => {
                // Single character
                if seq.len() == 1 {
                    KeyCode::Char(seq.chars().next().unwrap())
                } else {
                    return None;
                }
            }
        };

        Some(KeyEvent {
            code,
            modifiers: KeyModifiers::default(),
            raw_sequence: seq.to_string(),
        })
    }
}

impl Default for EnhancedInput {
    fn default() -> Self {
        Self::new()
    }
}

/// Detect terminal capabilities for enhanced keys.
pub fn detect_terminal_capabilities() -> TerminalCapabilities {
    let term = std::env::var("TERM").unwrap_or_default();
    let term_program = std::env::var("TERM_PROGRAM").unwrap_or_default();
    let termini = std::env::var("TERMINFO").unwrap_or_default();

    let supports_csi_u = [
        "ghostty",
        "kitty",
        "wezterm",
        "foot",
        "alacritty",
        "contour",
        "rio",
    ]
    .iter()
    .any(|t| {
        term.to_lowercase().contains(t)
            || term_program.to_lowercase().contains(t)
            || termini.to_lowercase().contains(t)
    });

    TerminalCapabilities {
        supports_csi_u,
        term: term.clone(),
        term_program,
    }
}

/// Terminal capability detection result.
#[derive(Debug, Clone)]
pub struct TerminalCapabilities {
    /// Terminal supports CSI u protocol.
    pub supports_csi_u: bool,
    /// TERM environment variable.
    pub term: String,
    /// TERM_PROGRAM environment variable.
    pub term_program: String,
}

/// Use smart input that adapts to terminal capabilities.
pub struct SmartInput {
    enhanced: EnhancedInput,
    capabilities: TerminalCapabilities,
}

impl SmartInput {
    /// Create a new smart input handler.
    pub fn new() -> Self {
        Self {
            enhanced: EnhancedInput::new(),
            capabilities: detect_terminal_capabilities(),
        }
    }

    /// Initialize input handling.
    ///
    /// This enables enhanced keys if the terminal supports it,
    /// otherwise falls back to standard input.
    pub fn init(&mut self) -> io::Result<()> {
        if self.capabilities.supports_csi_u {
            tracing::info!(
                "Terminal '{}' supports enhanced keys, enabling CSI u protocol",
                self.capabilities.term_program
            );
            self.enhanced.enable_enhanced_keys()?;
        } else {
            tracing::info!(
                "Terminal '{}' does not support enhanced keys, using standard input",
                self.capabilities.term
            );
        }
        Ok(())
    }

    /// Parse a key sequence.
    pub fn parse(&self, data: &[u8]) -> Option<KeyEvent> {
        EnhancedInput::parse_key_sequence(data)
    }

    /// Check if enhanced keys are active.
    pub fn is_enhanced(&self) -> bool {
        self.enhanced.is_enabled()
    }
}

impl Default for SmartInput {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_csi_u_tab() {
        // Tab with Shift: ESC [ 9 ; 1 u
        let seq = "\x1b[9;1u";
        let event = EnhancedInput::parse_key_sequence(seq.as_bytes()).unwrap();
        assert_eq!(event.code, KeyCode::Tab);
        assert!(event.modifiers.shift);
        assert!(!event.modifiers.ctrl);
    }

    #[test]
    fn test_parse_csi_u_ctrl_c() {
        // Ctrl+C: ESC [ 99 ; 5 u
        let seq = "\x1b[99;5u";
        let event = EnhancedInput::parse_key_sequence(seq.as_bytes()).unwrap();
        assert_eq!(event.code, KeyCode::Char('c'));
        assert!(event.modifiers.ctrl);
        assert!(!event.modifiers.shift);
    }

    #[test]
    fn test_parse_csi_u_shift_tab() {
        // Shift+Tab: ESC [ 9 ; 1 u
        let seq = "\x1b[9;1u";
        let event = EnhancedInput::parse_key_sequence(seq.as_bytes()).unwrap();
        assert_eq!(event.code, KeyCode::Tab);
        assert!(event.modifiers.shift);
    }

    #[test]
    fn test_parse_standard_tab() {
        // Plain Tab
        let seq = "\t";
        let event = EnhancedInput::parse_key_sequence(seq.as_bytes()).unwrap();
        assert_eq!(event.code, KeyCode::Tab);
        assert!(!event.modifiers.shift);
    }

    #[test]
    fn test_parse_standard_arrow() {
        // Up arrow
        let seq = "\x1b[A";
        let event = EnhancedInput::parse_key_sequence(seq.as_bytes()).unwrap();
        assert_eq!(event.code, KeyCode::Up);
    }

    #[test]
    fn test_modifiers_from_csi_u_mask() {
        // Mask 1 = Shift
        let mods = KeyModifiers::from_csi_u_mask(1);
        assert!(mods.shift);
        assert!(!mods.ctrl);
        assert!(!mods.alt);

        // Mask 5 = Shift + Ctrl
        let mods = KeyModifiers::from_csi_u_mask(5);
        assert!(mods.shift);
        assert!(mods.ctrl);
        assert!(!mods.alt);

        // Mask 15 = Shift + Alt + Ctrl + Meta
        let mods = KeyModifiers::from_csi_u_mask(15);
        assert!(mods.shift);
        assert!(mods.alt);
        assert!(mods.ctrl);
        assert!(mods.meta);
    }

    #[test]
    fn test_detect_terminal_capabilities() {
        // Can't test actual detection without controlling env vars,
        // but we can test the function doesn't panic
        let caps = detect_terminal_capabilities();
        // Result depends on current terminal
        assert!(!caps.term.is_empty() || !caps.term_program.is_empty());
    }
}
