// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Enhanced keyboard input module.
//!
//! Provides CSI u protocol support for modern terminals.

pub mod enhanced;

pub use enhanced::{
    detect_terminal_capabilities, EnhancedInput, KeyCode, KeyEvent, KeyModifiers, SmartInput,
    TerminalCapabilities,
};
