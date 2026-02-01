# Telemetry, Tracing, and Benchmarks

This document describes the observability infrastructure in codi-rs and provides guidelines for integrating telemetry into new features.

## Overview

Codi uses a lightweight observability stack suitable for CLI applications:

- **Tracing**: Structured logging with spans via the `tracing` crate
- **Metrics**: In-memory metrics collection for tool execution
- **Benchmarks**: Criterion-based benchmarks for performance testing

## Architecture

```
src/telemetry/
├── mod.rs          # Module exports
├── correlation.rs  # Request correlation IDs
├── init.rs         # Telemetry initialization
├── metrics.rs      # Metrics collection (ToolMetrics, Histogram)
└── spans.rs        # Span helpers (ToolSpan, TimedOperation)

benches/
├── config.rs       # Configuration loading benchmarks
└── tools.rs        # Tool execution benchmarks
```

## Quick Start

### Initialization

At application startup:

```rust
use codi::telemetry::{init_telemetry, TelemetryConfig};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Choose config preset or customize
    let config = TelemetryConfig::default();  // or ::development() / ::production()
    let _guard = init_telemetry(&config)?;

    // Application code...

    Ok(())
}
```

### Instrumenting Functions

Use the `#[instrument]` attribute for automatic span creation:

```rust
use tracing::{debug, instrument};

#[instrument(skip(self, input), fields(path, result_size))]
async fn my_function(&self, input: Input) -> Result<Output, Error> {
    // Record span fields
    let span = tracing::Span::current();
    span.record("path", &input.path);

    // Do work...
    let result = do_work().await?;

    // Record additional fields
    span.record("result_size", result.len());
    debug!(path = %input.path, "Operation complete");

    Ok(result)
}
```

### Recording Metrics

Metrics are automatically recorded by the tool registry, but you can also record custom metrics:

```rust
use codi::telemetry::metrics::GLOBAL_METRICS;
use std::time::Duration;

// Record tool execution
GLOBAL_METRICS.record_tool("my_tool", duration, success);

// Record generic operation
GLOBAL_METRICS.record_operation("api_call", duration);

// Record token usage
GLOBAL_METRICS.record_tokens(input_tokens, output_tokens);
```

## Guidelines for New Features

### 1. Add `#[instrument]` to Public Async Functions

Every public async function that performs significant work should be instrumented:

```rust
#[instrument(skip(self, input), fields(relevant_field1, relevant_field2))]
async fn execute(&self, input: Value) -> Result<Output, Error> {
    // ...
}
```

**Skip large or sensitive data:**
- Use `skip(self)` to avoid serializing the entire struct
- Use `skip(input)` for potentially large inputs
- Never log secrets, API keys, or passwords

### 2. Record Meaningful Fields

Choose fields that help with debugging and monitoring:

```rust
// Good: Helps understand what happened
span.record("file_path", path.to_str().unwrap());
span.record("bytes_written", content.len());
span.record("matches_found", results.len());

// Bad: Too much detail or sensitive
span.record("content", &content);  // Could be huge
span.record("api_key", &key);      // Security risk
```

### 3. Use Appropriate Log Levels

| Level | Use For |
|-------|---------|
| `error!` | Unrecoverable failures |
| `warn!` | Recoverable issues, timeouts |
| `info!` | Significant events (tool complete, session start) |
| `debug!` | Detailed operation info (file read, command executed) |
| `trace!` | Very verbose debugging |

### 4. Integrate with Metrics

For operations that should be monitored, record metrics:

```rust
use std::time::Instant;

let start = Instant::now();
let result = perform_operation().await;
let duration = start.elapsed();

GLOBAL_METRICS.record_tool("operation_name", duration, result.is_ok());
```

### 5. Add Benchmarks for Performance-Critical Code

For new tools or performance-sensitive code, add benchmarks:

```rust
// benches/my_feature.rs
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

fn bench_my_operation(c: &mut Criterion) {
    let mut group = c.benchmark_group("my_feature");

    group.bench_function("operation_name", |b| {
        b.iter(|| {
            black_box(my_operation(args))
        });
    });

    group.finish();
}

criterion_group!(benches, bench_my_operation);
criterion_main!(benches);
```

## Configuration

### Log Levels

Control log verbosity via `RUST_LOG` environment variable:

```bash
# Show only warnings and errors
RUST_LOG=warn codi

# Show info level for codi, warnings for everything else
RUST_LOG=codi=info,warn codi

# Debug mode for development
RUST_LOG=codi=debug codi

# Trace everything
RUST_LOG=trace codi
```

### TelemetryConfig Options

```rust
TelemetryConfig {
    default_level: Level::INFO,       // Default log level
    include_span_events: false,       // Log span enter/exit
    include_file_line: false,         // Include source location
    include_target: true,             // Include module path
    ansi_colors: true,                // Terminal colors
    compact: true,                    // Compact log format
    filter_directive: None,           // Custom filter
}
```

## Metrics API

### ToolMetrics

Tracked automatically for all tool executions:

```rust
pub struct ToolMetrics {
    pub invocations: u64,
    pub successes: u64,
    pub failures: u64,
    pub total_duration: Duration,
    pub min_duration: Duration,
    pub max_duration: Duration,
}
```

### MetricsSnapshot

Get a point-in-time snapshot of all metrics:

```rust
let snapshot = GLOBAL_METRICS.snapshot();
println!("{}", snapshot.format_report());
```

### Histogram

Latency distribution tracking with percentiles:

```rust
let metrics = GLOBAL_METRICS.operation_metrics("my_op").unwrap();
println!("p50: {:?}", metrics.histogram.p50());
println!("p99: {:?}", metrics.histogram.p99());
```

## Running Benchmarks

```bash
# Run all benchmarks
cargo bench

# Run specific benchmark
cargo bench --bench tools

# Run with specific test
cargo bench -- glob

# Generate HTML report
cargo bench -- --plotting-backend plotters
```

## Example: Full Feature Integration

Here's a complete example of integrating telemetry into a new tool:

```rust
use async_trait::async_trait;
use tracing::{debug, instrument, warn};
use crate::error::ToolError;
use crate::tools::registry::{ToolHandler, ToolOutput};
use crate::types::ToolDefinition;

pub struct MyNewTool;

#[async_trait]
impl ToolHandler for MyNewTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new("my_tool", "Does something useful")
            // ... schema
    }

    #[instrument(skip(self, input), fields(input_param, result_count))]
    async fn execute(&self, input: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: MyArgs = parse_arguments(&input)?;

        // Record input parameters
        let span = tracing::Span::current();
        span.record("input_param", &args.param);

        // Perform operation
        let results = match do_work(&args).await {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "Operation failed");
                return Err(ToolError::ExecutionFailed(e.to_string()));
            }
        };

        // Record results
        span.record("result_count", results.len());
        debug!(count = results.len(), "Operation complete");

        Ok(ToolOutput::success(format_results(&results)))
    }
}
```

## Future Enhancements

The telemetry system is designed to be extended:

- **OpenTelemetry export**: Add OTLP exporter for distributed tracing
- **Prometheus metrics**: Export metrics in Prometheus format
- **Custom exporters**: JSON file logging, cloud provider integrations
- **Sampling**: Configurable sampling for high-volume operations
