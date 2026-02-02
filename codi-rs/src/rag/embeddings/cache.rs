// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Embedding cache with LRU eviction and TTL.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::rag::types::EmbeddingVector;

/// Default cache TTL (60 minutes).
const DEFAULT_TTL: Duration = Duration::from_secs(60 * 60);

/// Default max cache size.
const DEFAULT_MAX_SIZE: usize = 1000;

/// Cache entry with timestamp.
struct CacheEntry {
    embedding: EmbeddingVector,
    created_at: Instant,
    last_accessed: Instant,
}

impl CacheEntry {
    fn new(embedding: EmbeddingVector) -> Self {
        let now = Instant::now();
        Self {
            embedding,
            created_at: now,
            last_accessed: now,
        }
    }

    fn is_expired(&self, ttl: Duration) -> bool {
        self.created_at.elapsed() > ttl
    }
}

/// Thread-safe embedding cache.
pub struct EmbeddingCache {
    entries: RwLock<HashMap<String, CacheEntry>>,
    ttl: Duration,
    max_size: usize,
}

impl EmbeddingCache {
    /// Create a new cache with default settings.
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            ttl: DEFAULT_TTL,
            max_size: DEFAULT_MAX_SIZE,
        }
    }

    /// Create a cache with custom TTL and max size.
    pub fn with_config(ttl: Duration, max_size: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            ttl,
            max_size,
        }
    }

    /// Generate a cache key for a text.
    pub fn make_key(provider: &str, model: &str, text: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        format!("{}:{}:{}", provider, model, &hash[..16])
    }

    /// Get an embedding from cache.
    pub fn get(&self, key: &str) -> Option<EmbeddingVector> {
        let mut entries = self.entries.write().ok()?;

        // Check if entry exists and is not expired
        if let Some(entry) = entries.get_mut(key) {
            if entry.is_expired(self.ttl) {
                entries.remove(key);
                return None;
            }
            entry.last_accessed = Instant::now();
            return Some(entry.embedding.clone());
        }

        None
    }

    /// Put an embedding into cache.
    pub fn put(&self, key: String, embedding: EmbeddingVector) {
        let mut entries = match self.entries.write() {
            Ok(e) => e,
            Err(_) => return,
        };

        // Evict if at capacity
        if entries.len() >= self.max_size {
            self.evict_oldest(&mut entries);
        }

        entries.insert(key, CacheEntry::new(embedding));
    }

    /// Evict the oldest entry based on last access time.
    fn evict_oldest(&self, entries: &mut HashMap<String, CacheEntry>) {
        // First, remove expired entries
        let expired: Vec<_> = entries
            .iter()
            .filter(|(_, entry)| entry.is_expired(self.ttl))
            .map(|(k, _)| k.clone())
            .collect();

        for key in expired {
            entries.remove(&key);
        }

        // If still at capacity, remove oldest by access time
        if entries.len() >= self.max_size {
            if let Some(oldest_key) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_accessed)
                .map(|(k, _)| k.clone())
            {
                entries.remove(&oldest_key);
            }
        }
    }

    /// Get cache statistics.
    pub fn stats(&self) -> CacheStats {
        let entries = match self.entries.read() {
            Ok(e) => e,
            Err(_) => return CacheStats::default(),
        };

        let total = entries.len();
        let expired = entries
            .values()
            .filter(|e| e.is_expired(self.ttl))
            .count();

        CacheStats {
            total_entries: total,
            expired_entries: expired,
            max_size: self.max_size,
        }
    }

    /// Clear all cached embeddings.
    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.write() {
            entries.clear();
        }
    }

    /// Remove expired entries.
    pub fn prune(&self) {
        if let Ok(mut entries) = self.entries.write() {
            let expired: Vec<_> = entries
                .iter()
                .filter(|(_, entry)| entry.is_expired(self.ttl))
                .map(|(k, _)| k.clone())
                .collect();

            for key in expired {
                entries.remove(&key);
            }
        }
    }
}

impl Default for EmbeddingCache {
    fn default() -> Self {
        Self::new()
    }
}

/// Cache statistics.
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    /// Total entries in cache.
    pub total_entries: usize,
    /// Number of expired entries.
    pub expired_entries: usize,
    /// Maximum cache size.
    pub max_size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_key_generation() {
        let key1 = EmbeddingCache::make_key("openai", "text-embedding-3-small", "hello world");
        let key2 = EmbeddingCache::make_key("openai", "text-embedding-3-small", "hello world");
        let key3 = EmbeddingCache::make_key("openai", "text-embedding-3-small", "different text");
        let key4 = EmbeddingCache::make_key("ollama", "nomic-embed-text", "hello world");

        assert_eq!(key1, key2, "Same inputs should produce same key");
        assert_ne!(key1, key3, "Different text should produce different key");
        assert_ne!(key1, key4, "Different provider should produce different key");
    }

    #[test]
    fn test_cache_put_get() {
        let cache = EmbeddingCache::new();
        let embedding = EmbeddingVector::new(vec![1.0, 2.0, 3.0]);
        let key = "test:model:abc123".to_string();

        cache.put(key.clone(), embedding.clone());

        let retrieved = cache.get(&key);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().values, embedding.values);
    }

    #[test]
    fn test_cache_miss() {
        let cache = EmbeddingCache::new();
        let result = cache.get("nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_cache_expiry() {
        let cache = EmbeddingCache::with_config(Duration::from_millis(1), 100);
        let embedding = EmbeddingVector::new(vec![1.0, 2.0, 3.0]);
        let key = "test:model:abc123".to_string();

        cache.put(key.clone(), embedding);

        // Wait for expiry
        std::thread::sleep(Duration::from_millis(10));

        let result = cache.get(&key);
        assert!(result.is_none(), "Entry should have expired");
    }

    #[test]
    fn test_cache_eviction() {
        let cache = EmbeddingCache::with_config(Duration::from_secs(3600), 3);

        for i in 0..5 {
            let key = format!("key{}", i);
            let embedding = EmbeddingVector::new(vec![i as f32]);
            cache.put(key, embedding);
        }

        let stats = cache.stats();
        assert!(stats.total_entries <= 3, "Cache should have evicted entries");
    }

    #[test]
    fn test_cache_clear() {
        let cache = EmbeddingCache::new();
        cache.put("key1".to_string(), EmbeddingVector::new(vec![1.0]));
        cache.put("key2".to_string(), EmbeddingVector::new(vec![2.0]));

        cache.clear();

        let stats = cache.stats();
        assert_eq!(stats.total_entries, 0);
    }
}
