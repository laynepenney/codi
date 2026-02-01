// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Metrics collection for performance monitoring.
//!
//! Provides lightweight metrics collection without external dependencies.
//! Suitable for CLI tools where full observability stacks are overkill.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;

/// Global metrics instance.
pub static GLOBAL_METRICS: Lazy<Metrics> = Lazy::new(Metrics::new);

/// Central metrics collection.
#[derive(Debug)]
pub struct Metrics {
    /// Tool execution metrics by tool name.
    tools: RwLock<HashMap<String, ToolMetrics>>,

    /// General operation metrics.
    operations: RwLock<HashMap<String, OperationMetrics>>,

    /// Token usage tracking.
    tokens: TokenMetrics,

    /// Start time for calculating uptime.
    start_time: Instant,
}

impl Metrics {
    /// Create a new metrics collector.
    pub fn new() -> Self {
        Self {
            tools: RwLock::new(HashMap::new()),
            operations: RwLock::new(HashMap::new()),
            tokens: TokenMetrics::new(),
            start_time: Instant::now(),
        }
    }

    /// Record a tool execution.
    pub fn record_tool(&self, name: &str, duration: Duration, success: bool) {
        let mut tools = self.tools.write().unwrap();
        let metrics = tools.entry(name.to_string()).or_insert_with(ToolMetrics::new);
        metrics.record(duration, success);
    }

    /// Record a generic operation.
    pub fn record_operation(&self, name: &str, duration: Duration) {
        let mut ops = self.operations.write().unwrap();
        let metrics = ops.entry(name.to_string()).or_insert_with(OperationMetrics::new);
        metrics.record(duration);
    }

    /// Record token usage.
    pub fn record_tokens(&self, input: u64, output: u64) {
        self.tokens.add_input(input);
        self.tokens.add_output(output);
    }

    /// Get metrics for a specific tool.
    pub fn tool_metrics(&self, name: &str) -> Option<ToolMetrics> {
        self.tools.read().unwrap().get(name).cloned()
    }

    /// Get metrics for a specific operation.
    pub fn operation_metrics(&self, name: &str) -> Option<OperationMetrics> {
        self.operations.read().unwrap().get(name).cloned()
    }

    /// Get total token counts.
    pub fn token_counts(&self) -> (u64, u64) {
        (self.tokens.input_total(), self.tokens.output_total())
    }

    /// Get uptime since metrics were initialized.
    pub fn uptime(&self) -> Duration {
        self.start_time.elapsed()
    }

    /// Take a snapshot of all metrics.
    pub fn snapshot(&self) -> MetricsSnapshot {
        let tools = self.tools.read().unwrap();
        let operations = self.operations.read().unwrap();

        MetricsSnapshot {
            tools: tools.clone(),
            operations: operations.clone(),
            input_tokens: self.tokens.input_total(),
            output_tokens: self.tokens.output_total(),
            uptime: self.uptime(),
        }
    }

    /// Reset all metrics.
    pub fn reset(&self) {
        self.tools.write().unwrap().clear();
        self.operations.write().unwrap().clear();
        self.tokens.reset();
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Metrics for a specific tool.
#[derive(Debug, Clone)]
pub struct ToolMetrics {
    /// Total number of invocations.
    pub invocations: u64,

    /// Number of successful invocations.
    pub successes: u64,

    /// Number of failed invocations.
    pub failures: u64,

    /// Total time spent in this tool.
    pub total_duration: Duration,

    /// Minimum execution time.
    pub min_duration: Duration,

    /// Maximum execution time.
    pub max_duration: Duration,
}

impl ToolMetrics {
    /// Create new empty tool metrics.
    pub fn new() -> Self {
        Self {
            invocations: 0,
            successes: 0,
            failures: 0,
            total_duration: Duration::ZERO,
            min_duration: Duration::MAX,
            max_duration: Duration::ZERO,
        }
    }

    /// Record a tool execution.
    pub fn record(&mut self, duration: Duration, success: bool) {
        self.invocations += 1;
        if success {
            self.successes += 1;
        } else {
            self.failures += 1;
        }
        self.total_duration += duration;
        self.min_duration = self.min_duration.min(duration);
        self.max_duration = self.max_duration.max(duration);
    }

    /// Calculate average execution time.
    pub fn avg_duration(&self) -> Duration {
        if self.invocations == 0 {
            Duration::ZERO
        } else {
            self.total_duration / self.invocations as u32
        }
    }

    /// Calculate success rate (0.0 to 1.0).
    pub fn success_rate(&self) -> f64 {
        if self.invocations == 0 {
            1.0
        } else {
            self.successes as f64 / self.invocations as f64
        }
    }
}

impl Default for ToolMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Generic operation metrics with histogram.
#[derive(Debug, Clone)]
pub struct OperationMetrics {
    /// Number of operations.
    pub count: u64,

    /// Total duration.
    pub total_duration: Duration,

    /// Minimum duration.
    pub min_duration: Duration,

    /// Maximum duration.
    pub max_duration: Duration,

    /// Histogram buckets for latency distribution.
    pub histogram: Histogram,
}

impl OperationMetrics {
    /// Create new operation metrics.
    pub fn new() -> Self {
        Self {
            count: 0,
            total_duration: Duration::ZERO,
            min_duration: Duration::MAX,
            max_duration: Duration::ZERO,
            histogram: Histogram::default(),
        }
    }

    /// Record an operation.
    pub fn record(&mut self, duration: Duration) {
        self.count += 1;
        self.total_duration += duration;
        self.min_duration = self.min_duration.min(duration);
        self.max_duration = self.max_duration.max(duration);
        self.histogram.record(duration);
    }

    /// Calculate average duration.
    pub fn avg_duration(&self) -> Duration {
        if self.count == 0 {
            Duration::ZERO
        } else {
            self.total_duration / self.count as u32
        }
    }
}

impl Default for OperationMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Simple histogram with fixed buckets for latency tracking.
#[derive(Debug, Clone)]
pub struct Histogram {
    /// Bucket boundaries in microseconds.
    /// Default: [100us, 1ms, 10ms, 100ms, 1s, 10s, +inf]
    buckets: Vec<u64>,

    /// Count per bucket.
    counts: Vec<u64>,
}

impl Histogram {
    /// Create a histogram with custom bucket boundaries (in microseconds).
    pub fn with_buckets(buckets: Vec<u64>) -> Self {
        let counts = vec![0; buckets.len() + 1];
        Self { buckets, counts }
    }

    /// Record a duration value.
    pub fn record(&mut self, duration: Duration) {
        let micros = duration.as_micros() as u64;
        let bucket_idx = self
            .buckets
            .iter()
            .position(|&b| micros <= b)
            .unwrap_or(self.buckets.len());
        self.counts[bucket_idx] += 1;
    }

    /// Get counts for each bucket.
    pub fn counts(&self) -> &[u64] {
        &self.counts
    }

    /// Get bucket boundaries.
    pub fn buckets(&self) -> &[u64] {
        &self.buckets
    }

    /// Calculate approximate percentile (p50, p90, p99, etc.).
    pub fn percentile(&self, p: f64) -> Duration {
        let total: u64 = self.counts.iter().sum();
        if total == 0 {
            return Duration::ZERO;
        }

        let target = (total as f64 * p / 100.0).ceil() as u64;
        let mut cumulative = 0u64;

        for (i, &count) in self.counts.iter().enumerate() {
            cumulative += count;
            if cumulative >= target {
                // Return the bucket boundary (or a large value for the overflow bucket)
                let micros = if i < self.buckets.len() {
                    self.buckets[i]
                } else {
                    self.buckets.last().copied().unwrap_or(0) * 10
                };
                return Duration::from_micros(micros);
            }
        }

        Duration::ZERO
    }

    /// Get p50 (median) latency.
    pub fn p50(&self) -> Duration {
        self.percentile(50.0)
    }

    /// Get p90 latency.
    pub fn p90(&self) -> Duration {
        self.percentile(90.0)
    }

    /// Get p99 latency.
    pub fn p99(&self) -> Duration {
        self.percentile(99.0)
    }
}

impl Default for Histogram {
    fn default() -> Self {
        // Default buckets: 100us, 1ms, 10ms, 100ms, 1s, 10s
        Self::with_buckets(vec![100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000])
    }
}

/// Thread-safe token usage tracking.
#[derive(Debug)]
struct TokenMetrics {
    input: AtomicU64,
    output: AtomicU64,
}

impl TokenMetrics {
    fn new() -> Self {
        Self {
            input: AtomicU64::new(0),
            output: AtomicU64::new(0),
        }
    }

    fn add_input(&self, count: u64) {
        self.input.fetch_add(count, Ordering::Relaxed);
    }

    fn add_output(&self, count: u64) {
        self.output.fetch_add(count, Ordering::Relaxed);
    }

    fn input_total(&self) -> u64 {
        self.input.load(Ordering::Relaxed)
    }

    fn output_total(&self) -> u64 {
        self.output.load(Ordering::Relaxed)
    }

    fn reset(&self) {
        self.input.store(0, Ordering::Relaxed);
        self.output.store(0, Ordering::Relaxed);
    }
}

/// A snapshot of all metrics at a point in time.
#[derive(Debug, Clone)]
pub struct MetricsSnapshot {
    /// Tool metrics by name.
    pub tools: HashMap<String, ToolMetrics>,

    /// Operation metrics by name.
    pub operations: HashMap<String, OperationMetrics>,

    /// Total input tokens.
    pub input_tokens: u64,

    /// Total output tokens.
    pub output_tokens: u64,

    /// Uptime when snapshot was taken.
    pub uptime: Duration,
}

impl MetricsSnapshot {
    /// Format as a human-readable report.
    pub fn format_report(&self) -> String {
        let mut report = String::new();

        report.push_str("=== Metrics Report ===\n\n");
        report.push_str(&format!("Uptime: {:.2?}\n", self.uptime));
        report.push_str(&format!(
            "Tokens: {} input, {} output\n\n",
            self.input_tokens, self.output_tokens
        ));

        if !self.tools.is_empty() {
            report.push_str("Tool Metrics:\n");
            for (name, metrics) in &self.tools {
                report.push_str(&format!(
                    "  {}: {} calls, {:.1}% success, avg {:.2?}\n",
                    name,
                    metrics.invocations,
                    metrics.success_rate() * 100.0,
                    metrics.avg_duration()
                ));
            }
            report.push_str("\n");
        }

        if !self.operations.is_empty() {
            report.push_str("Operation Metrics:\n");
            for (name, metrics) in &self.operations {
                report.push_str(&format!(
                    "  {}: {} ops, avg {:.2?}, p99 {:.2?}\n",
                    name,
                    metrics.count,
                    metrics.avg_duration(),
                    metrics.histogram.p99()
                ));
            }
        }

        report
    }
}

/// Convenience function to record a tool execution to global metrics.
pub fn record_tool(name: &str, duration: Duration, success: bool) {
    GLOBAL_METRICS.record_tool(name, duration, success);
}

/// Convenience function to record an operation to global metrics.
pub fn record_operation(name: &str, duration: Duration) {
    GLOBAL_METRICS.record_operation(name, duration);
}

/// Convenience function to record token usage to global metrics.
pub fn record_tokens(input: u64, output: u64) {
    GLOBAL_METRICS.record_tokens(input, output);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metrics() {
        let mut metrics = ToolMetrics::new();
        metrics.record(Duration::from_millis(100), true);
        metrics.record(Duration::from_millis(200), true);
        metrics.record(Duration::from_millis(50), false);

        assert_eq!(metrics.invocations, 3);
        assert_eq!(metrics.successes, 2);
        assert_eq!(metrics.failures, 1);
        assert!((metrics.success_rate() - 0.666).abs() < 0.01);
    }

    #[test]
    fn test_operation_metrics() {
        let mut metrics = OperationMetrics::new();
        metrics.record(Duration::from_millis(10));
        metrics.record(Duration::from_millis(20));
        metrics.record(Duration::from_millis(30));

        assert_eq!(metrics.count, 3);
        assert_eq!(metrics.avg_duration(), Duration::from_millis(20));
    }

    #[test]
    fn test_histogram() {
        let mut hist = Histogram::default();

        // Record some values in different buckets
        hist.record(Duration::from_micros(50)); // bucket 0 (<=100us)
        hist.record(Duration::from_micros(500)); // bucket 1 (<=1ms)
        hist.record(Duration::from_millis(5)); // bucket 2 (<=10ms)
        hist.record(Duration::from_millis(50)); // bucket 3 (<=100ms)
        hist.record(Duration::from_millis(500)); // bucket 4 (<=1s)

        assert_eq!(hist.counts()[0], 1);
        assert_eq!(hist.counts()[1], 1);
        assert_eq!(hist.counts()[2], 1);
    }

    #[test]
    fn test_histogram_percentiles() {
        let mut hist = Histogram::default();

        // Add 100 samples, all in the 1ms bucket
        for _ in 0..100 {
            hist.record(Duration::from_micros(500));
        }

        assert_eq!(hist.p50(), Duration::from_micros(1_000));
        assert_eq!(hist.p90(), Duration::from_micros(1_000));
        assert_eq!(hist.p99(), Duration::from_micros(1_000));
    }

    #[test]
    fn test_global_metrics() {
        let metrics = Metrics::new();

        metrics.record_tool("test_tool", Duration::from_millis(100), true);
        metrics.record_tokens(1000, 500);

        let snapshot = metrics.snapshot();
        assert!(snapshot.tools.contains_key("test_tool"));
        assert_eq!(snapshot.input_tokens, 1000);
        assert_eq!(snapshot.output_tokens, 500);
    }

    #[test]
    fn test_metrics_reset() {
        let metrics = Metrics::new();

        metrics.record_tool("test", Duration::from_millis(100), true);
        metrics.record_tokens(100, 50);

        metrics.reset();

        assert!(metrics.tool_metrics("test").is_none());
        assert_eq!(metrics.token_counts(), (0, 0));
    }
}
