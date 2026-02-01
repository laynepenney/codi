// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Correlation ID management for request tracing.

use std::fmt;
use uuid::Uuid;

/// A unique identifier for tracing operations across async boundaries.
///
/// Correlation IDs help trace related operations through logs and spans,
/// making it easier to debug issues in async code.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct CorrelationId(Uuid);

impl CorrelationId {
    /// Generate a new random correlation ID.
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Create a correlation ID from an existing UUID.
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }

    /// Get the underlying UUID.
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }

    /// Get a short representation (first 8 characters).
    pub fn short(&self) -> String {
        self.0.to_string()[..8].to_string()
    }
}

impl Default for CorrelationId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for CorrelationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl fmt::Debug for CorrelationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "CorrelationId({})", self.short())
    }
}

impl From<Uuid> for CorrelationId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl From<CorrelationId> for Uuid {
    fn from(id: CorrelationId) -> Self {
        id.0
    }
}

impl serde::Serialize for CorrelationId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.0.serialize(serializer)
    }
}

impl<'de> serde::Deserialize<'de> for CorrelationId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Uuid::deserialize(deserializer).map(Self)
    }
}

/// Extension trait for adding correlation IDs to tracing spans.
pub trait CorrelationIdExt {
    /// Record the correlation ID as a span field.
    fn record_correlation_id(&self, id: &CorrelationId);
}

impl CorrelationIdExt for tracing::Span {
    fn record_correlation_id(&self, id: &CorrelationId) {
        self.record("correlation_id", id.to_string().as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_correlation_id_new() {
        let id1 = CorrelationId::new();
        let id2 = CorrelationId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_correlation_id_short() {
        let id = CorrelationId::new();
        assert_eq!(id.short().len(), 8);
    }

    #[test]
    fn test_correlation_id_display() {
        let uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let id = CorrelationId::from_uuid(uuid);
        assert_eq!(id.to_string(), "550e8400-e29b-41d4-a716-446655440000");
    }

    #[test]
    fn test_correlation_id_debug() {
        let id = CorrelationId::new();
        let debug = format!("{:?}", id);
        assert!(debug.starts_with("CorrelationId("));
    }

    #[test]
    fn test_correlation_id_serde() {
        let id = CorrelationId::new();
        let json = serde_json::to_string(&id).unwrap();
        let parsed: CorrelationId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, parsed);
    }
}
