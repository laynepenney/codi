// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Span helpers for consistent instrumentation.

use std::time::Instant;
use tracing::{info_span, Span};

/// Extension trait for enhanced span functionality.
pub trait SpanExt {
    /// Record the result of an operation (success/error).
    fn record_result<T, E>(&self, result: &Result<T, E>);

    /// Record a numeric value.
    fn record_value(&self, name: &'static str, value: i64);

    /// Record a string value.
    fn record_str(&self, name: &'static str, value: &str);
}

impl SpanExt for Span {
    fn record_result<T, E>(&self, result: &Result<T, E>) {
        self.record("success", result.is_ok());
        self.record("error", result.is_err());
    }

    fn record_value(&self, name: &'static str, value: i64) {
        self.record(name, value);
    }

    fn record_str(&self, name: &'static str, value: &str) {
        self.record(name, value);
    }
}

/// RAII guard for timing tool execution.
///
/// Records the tool name, duration, and success/failure to metrics.
pub struct ToolSpan {
    tool_name: String,
    start: Instant,
    span: Span,
}

impl ToolSpan {
    /// Start a new tool execution span.
    pub fn start(tool_name: &str) -> Self {
        let span = info_span!(
            "tool",
            tool = %tool_name,
            duration_ms = tracing::field::Empty,
            success = tracing::field::Empty,
            input_size = tracing::field::Empty,
            output_size = tracing::field::Empty,
        );

        Self {
            tool_name: tool_name.to_string(),
            start: Instant::now(),
            span,
        }
    }

    /// Get the underlying tracing span.
    pub fn span(&self) -> &Span {
        &self.span
    }

    /// Enter the span context.
    pub fn enter(&self) -> tracing::span::Entered<'_> {
        self.span.enter()
    }

    /// Record input size.
    pub fn record_input_size(&self, size: usize) {
        self.span.record("input_size", size as i64);
    }

    /// Record output size.
    pub fn record_output_size(&self, size: usize) {
        self.span.record("output_size", size as i64);
    }

    /// Finish the span, recording duration and success.
    pub fn finish(self, success: bool) {
        let duration = self.start.elapsed();
        let duration_ms = duration.as_secs_f64() * 1000.0;

        self.span.record("duration_ms", duration_ms);
        self.span.record("success", success);

        // Record to global metrics
        super::metrics::GLOBAL_METRICS.record_tool(&self.tool_name, duration, success);

        tracing::info!(
            parent: &self.span,
            "Tool execution complete"
        );
    }

    /// Finish with a result, automatically determining success.
    pub fn finish_with_result<T, E>(self, result: &Result<T, E>) {
        self.finish(result.is_ok());
    }
}

/// RAII guard for timing any operation.
///
/// Records the operation name and duration to metrics.
#[allow(dead_code)]
pub struct TimedOperation {
    name: String,
    start: Instant,
    span: Span,
}

#[allow(dead_code)]
impl TimedOperation {
    /// Start a new timed operation.
    pub fn start(name: &str) -> Self {
        let span = info_span!(
            "operation",
            op = %name,
            duration_ms = tracing::field::Empty,
        );

        Self {
            name: name.to_string(),
            start: Instant::now(),
            span,
        }
    }

    /// Get elapsed time so far.
    pub fn elapsed(&self) -> std::time::Duration {
        self.start.elapsed()
    }

    /// Get the underlying span.
    pub fn span(&self) -> &Span {
        &self.span
    }

    /// Finish and record the operation.
    pub fn finish(self) {
        let duration = self.start.elapsed();
        let duration_ms = duration.as_secs_f64() * 1000.0;

        self.span.record("duration_ms", duration_ms);
        super::metrics::GLOBAL_METRICS.record_operation(&self.name, duration);
    }
}

impl Drop for TimedOperation {
    fn drop(&mut self) {
        // Record duration if not explicitly finished
        // This ensures we always capture timing even on panics
        let duration = self.start.elapsed();
        let duration_ms = duration.as_secs_f64() * 1000.0;
        self.span.record("duration_ms", duration_ms);
    }
}

/// Macro for creating an instrumented tool execution.
///
/// # Example
///
/// ```rust,ignore
/// use codi::telemetry::tool_span;
///
/// async fn my_tool(input: Input) -> Result<Output, Error> {
///     let span = tool_span!("my_tool", input_size = input.len());
///     let _guard = span.enter();
///
///     let result = do_work().await;
///
///     span.finish_with_result(&result);
///     result
/// }
/// ```
#[macro_export]
macro_rules! tool_span {
    ($name:expr) => {
        $crate::telemetry::ToolSpan::start($name)
    };
    ($name:expr, $($field:ident = $value:expr),* $(,)?) => {{
        let span = $crate::telemetry::ToolSpan::start($name);
        $(
            span.span().record(stringify!($field), &$value as &dyn tracing::Value);
        )*
        span
    }};
}

/// Macro for timing an operation.
///
/// # Example
///
/// ```rust,ignore
/// use codi::telemetry::timed;
///
/// fn expensive_work() {
///     let _timer = timed!("expensive_work");
///     // ... work happens ...
/// } // Timer automatically records on drop
/// ```
#[macro_export]
macro_rules! timed {
    ($name:expr) => {
        $crate::telemetry::spans::TimedOperation::start($name)
    };
}

// Re-export macros for convenience
#[allow(unused_imports)]
pub use timed;
#[allow(unused_imports)]
pub use tool_span;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_span_lifecycle() {
        let span = ToolSpan::start("test_tool");
        span.record_input_size(100);
        span.record_output_size(50);
        span.finish(true);
    }

    #[test]
    fn test_tool_span_with_result() {
        let span = ToolSpan::start("test_tool");
        let result: Result<(), &str> = Ok(());
        span.finish_with_result(&result);
    }

    #[test]
    fn test_timed_operation() {
        let op = TimedOperation::start("test_op");
        std::thread::sleep(std::time::Duration::from_millis(1));
        assert!(op.elapsed().as_micros() > 0);
        op.finish();
    }

    #[test]
    fn test_span_ext() {
        let span = info_span!("test", success = tracing::field::Empty);
        let result: Result<i32, &str> = Ok(42);
        span.record_result(&result);
    }
}
