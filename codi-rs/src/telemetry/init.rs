// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Telemetry initialization and configuration.

use std::io;
use tracing::Level;
use tracing_subscriber::{
    fmt::{self, format::FmtSpan},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Configuration for telemetry initialization.
#[derive(Debug, Clone)]
pub struct TelemetryConfig {
    /// Default log level if RUST_LOG is not set.
    pub default_level: Level,

    /// Whether to include span events (enter/exit).
    pub include_span_events: bool,

    /// Whether to include file/line information.
    pub include_file_line: bool,

    /// Whether to include target module path.
    pub include_target: bool,

    /// Whether to use ANSI colors in output.
    pub ansi_colors: bool,

    /// Whether to use compact log format.
    pub compact: bool,

    /// Custom filter directive (overrides default_level).
    pub filter_directive: Option<String>,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            default_level: Level::INFO,
            include_span_events: false,
            include_file_line: false,
            include_target: true,
            ansi_colors: true,
            compact: true,
            filter_directive: None,
        }
    }
}

impl TelemetryConfig {
    /// Create a config suitable for development with verbose output.
    pub fn development() -> Self {
        Self {
            default_level: Level::DEBUG,
            include_span_events: true,
            include_file_line: true,
            include_target: true,
            ansi_colors: true,
            compact: false,
            filter_directive: None,
        }
    }

    /// Create a config suitable for production with minimal output.
    pub fn production() -> Self {
        Self {
            default_level: Level::WARN,
            include_span_events: false,
            include_file_line: false,
            include_target: false,
            ansi_colors: false,
            compact: true,
            filter_directive: None,
        }
    }

    /// Create a config for testing with trace-level output.
    pub fn testing() -> Self {
        Self {
            default_level: Level::TRACE,
            include_span_events: true,
            include_file_line: true,
            include_target: true,
            ansi_colors: false,
            compact: false,
            filter_directive: Some("codi=trace".to_string()),
        }
    }

    /// Set the default log level.
    pub fn with_level(mut self, level: Level) -> Self {
        self.default_level = level;
        self
    }

    /// Set a custom filter directive.
    pub fn with_filter(mut self, filter: impl Into<String>) -> Self {
        self.filter_directive = Some(filter.into());
        self
    }

    /// Enable or disable ANSI colors.
    pub fn with_ansi(mut self, ansi: bool) -> Self {
        self.ansi_colors = ansi;
        self
    }
}

/// Guard that flushes telemetry on drop.
///
/// Keep this guard alive for the duration of your program.
pub struct TelemetryGuard {
    _private: (),
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        // Flush any pending telemetry data
        // Currently a no-op but reserved for future use
    }
}

/// Initialize telemetry with the given configuration.
///
/// This should be called once at application startup.
///
/// # Example
///
/// ```rust,ignore
/// use codi::telemetry::{init_telemetry, TelemetryConfig};
///
/// fn main() -> Result<(), Box<dyn std::error::Error>> {
///     let _guard = init_telemetry(&TelemetryConfig::default())?;
///
///     // Your application code here
///
///     Ok(())
/// }
/// ```
pub fn init_telemetry(config: &TelemetryConfig) -> io::Result<TelemetryGuard> {
    // Build the filter - RUST_LOG env var takes precedence
    let filter = match &config.filter_directive {
        Some(directive) => EnvFilter::try_new(directive).unwrap_or_else(|_| {
            EnvFilter::new(format!("{}", config.default_level))
        }),
        None => EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new(format!("{}", config.default_level))
        }),
    };

    // Build span events
    let span_events = if config.include_span_events {
        FmtSpan::ENTER | FmtSpan::CLOSE
    } else {
        FmtSpan::NONE
    };

    // Build the formatter layer
    let fmt_layer = fmt::layer()
        .with_ansi(config.ansi_colors)
        .with_target(config.include_target)
        .with_file(config.include_file_line)
        .with_line_number(config.include_file_line)
        .with_span_events(span_events);

    // Apply compact format if requested
    if config.compact {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt_layer.compact())
            .try_init()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt_layer)
            .try_init()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    }

    Ok(TelemetryGuard { _private: () })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telemetry_config_default() {
        let config = TelemetryConfig::default();
        assert_eq!(config.default_level, Level::INFO);
        assert!(config.ansi_colors);
        assert!(config.compact);
    }

    #[test]
    fn test_telemetry_config_development() {
        let config = TelemetryConfig::development();
        assert_eq!(config.default_level, Level::DEBUG);
        assert!(config.include_span_events);
    }

    #[test]
    fn test_telemetry_config_production() {
        let config = TelemetryConfig::production();
        assert_eq!(config.default_level, Level::WARN);
        assert!(!config.include_span_events);
    }

    #[test]
    fn test_telemetry_config_builder() {
        let config = TelemetryConfig::default()
            .with_level(Level::DEBUG)
            .with_filter("codi=trace")
            .with_ansi(false);

        assert_eq!(config.default_level, Level::DEBUG);
        assert_eq!(config.filter_directive, Some("codi=trace".to_string()));
        assert!(!config.ansi_colors);
    }
}
