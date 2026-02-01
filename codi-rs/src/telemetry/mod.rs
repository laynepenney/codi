// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Telemetry, tracing, and metrics infrastructure.
//!
//! This module provides observability infrastructure for Codi:
//!
//! - **Tracing**: Structured logging with spans for operation tracking
//! - **Metrics**: Counters, histograms, and gauges for performance monitoring
//! - **Correlation IDs**: Request tracing across async boundaries
//!
//! # Usage
//!
//! Initialize telemetry at application startup:
//!
//! ```rust,ignore
//! use codi::telemetry::{init_telemetry, TelemetryConfig};
//!
//! let config = TelemetryConfig::default();
//! init_telemetry(&config)?;
//! ```
//!
//! Use the `#[instrument]` attribute or manual spans in your code:
//!
//! ```rust,ignore
//! use tracing::{instrument, info_span};
//!
//! #[instrument(skip(content), fields(path = %path.display(), size = content.len()))]
//! async fn write_file(path: &Path, content: &str) -> Result<(), Error> {
//!     // Operation is automatically traced
//! }
//! ```
//!
//! # Integration Guidelines
//!
//! All new features should integrate telemetry from the start:
//!
//! 1. **Add `#[instrument]` to public async functions**
//! 2. **Record meaningful fields** (paths, sizes, counts, not secrets)
//! 3. **Use appropriate log levels** (trace for details, info for events, warn/error for issues)
//! 4. **Track metrics** for operations that should be monitored

mod correlation;
mod init;
pub mod metrics;
mod spans;

pub use correlation::{CorrelationId, CorrelationIdExt};
pub use init::{init_telemetry, TelemetryConfig, TelemetryGuard};
pub use metrics::{
    Histogram, Metrics, MetricsSnapshot, OperationMetrics, ToolMetrics, GLOBAL_METRICS,
};
pub use spans::{SpanExt, ToolSpan};
