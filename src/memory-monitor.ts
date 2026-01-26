// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from './logger.js';
import { getHeapStatistics } from 'node:v8';

/**
 * Memory usage statistics from Node.js v8.getHeapStatistics()
 */
export interface HeapStats {
  total_heap_size: number;
  total_heap_size_executable: number;
  total_physical_size: number;
  total_available_size: number;
  used_heap_size: number;
  heap_size_limit: number;
  malloced_memory: number;
  peak_malloced_memory: number;
  does_zap_garbage: number;
  number_of_native_contexts: number;
  number_of_detached_contexts: number;
}

/**
 * Memory usage snapshot with metadata
 */
export interface MemorySnapshot {
  timestamp: Date;
  heapStats: HeapStats;
  usagePercent: number;
  formatted: string;
}

/**
 * Memory thresholds for proactive compaction
 */
export interface MemoryThresholds {
  warningPercent: number;   // Log warning when above this
  compactPercent: number;    // Trigger compaction when above this
  criticalPercent: number;   // Critical alert when above this
}

/**
 * Default memory thresholds
 */
export const DEFAULT_THRESHOLDS: MemoryThresholds = {
  warningPercent: 60,
  compactPercent: 70,
  criticalPercent: 85,
};

/**
 * Memory monitor for tracking heap usage and triggering cleanup.
 */
export class MemoryMonitor {
  private warningsIssued = 0;
  private compactionsTriggered = 0;
  private lastCompactionTime: Date | null = null;
  private minimumCompactionInterval = 30000; // 30 seconds between automatic compactions

  constructor(private thresholds: MemoryThresholds = DEFAULT_THRESHOLDS) {}

  /**
   * Get current heap statistics from Node.js.
   */
  getHeapStats(): HeapStats {
    return getHeapStatistics();
  }

  /**
   * Get a formatted memory snapshot.
   */
  getSnapshot(): MemorySnapshot {
    const heapStats = this.getHeapStats();
    const usagePercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;

    // Format sizes in MB
    const formatMB = (bytes: number): string => {
      return (bytes / 1024 / 1024).toFixed(1);
    };

    const formatted = `Heap: ${formatMB(heapStats.used_heap_size)}MB / ${formatMB(heapStats.heap_size_limit)}MB (${usagePercent.toFixed(1)}%)`;

    return {
      timestamp: new Date(),
      heapStats,
      usagePercent,
      formatted,
    };
  }

  /**
   * Check if memory usage is above a threshold.
   */
  isAboveThreshold(thresholdPercent: number): boolean {
    const snapshot = this.getSnapshot();
    return snapshot.usagePercent >= thresholdPercent;
  }

  /**
   * Check if compaction should be triggered based on memory usage.
   * Returns true if above compact threshold and minimum interval has passed.
   */
  shouldCompact(): boolean {
    if (!this.isAboveThreshold(this.thresholds.compactPercent)) {
      return false;
    }

    // Check minimum interval since last compaction
    if (this.lastCompactionTime) {
      const timeSinceLastCompaction = Date.now() - this.lastCompactionTime.getTime();
      if (timeSinceLastCompaction < this.minimumCompactionInterval) {
        return false;
      }
    }

    return true;
  }

  /**
   * Log memory status based on current usage.
   * Returns the usage level: 'normal', 'warning', 'compact', or 'critical'
   */
  logStatus(): 'normal' | 'warning' | 'compact' | 'critical' {
    const snapshot = this.getSnapshot();

    if (snapshot.usagePercent >= this.thresholds.criticalPercent) {
      logger.warn(`MEMORY CRITICAL: ${snapshot.formatted}`);
      return 'critical';
    }

    if (snapshot.usagePercent >= this.thresholds.compactPercent) {
      if (this.compactionsTriggered === 0) {
        // Only log warning the first time we hit compact threshold
        logger.warn(`Memory usage high: ${snapshot.formatted}`);
        this.warningsIssued++;
      }
      return 'compact';
    }

    if (snapshot.usagePercent >= this.thresholds.warningPercent) {
      if (this.warningsIssued === 0) {
        logger.debug(`Memory usage: ${snapshot.formatted}`);
        this.warningsIssued++;
      }
      return 'warning';
    }

    // Reset warning counter if we back to normal
    if (this.warningsIssued > 0 && snapshot.usagePercent < this.thresholds.warningPercent - 10) {
      this.warningsIssued = 0;
    }

    return 'normal';
  }

  /**
   * Mark that compaction was triggered.
   */
  recordCompaction(): void {
    this.compactionsTriggered++;
    this.lastCompactionTime = new Date();
  }

  /**
   * Reset compaction counters (useful after explicit user compaction).
   */
  resetCompactionCounters(): void {
    this.compactionsTriggered = 0;
    this.lastCompactionTime = null;
  }

  /**
   * Get statistics about memory monitoring.
   */
  getStats(): {
    warningsIssued: number;
    compactionsTriggered: number;
    lastCompactionTime: Date | null;
  } {
    return {
      warningsIssued: this.warningsIssued,
      compactionsTriggered: this.compactionsTriggered,
      lastCompactionTime: this.lastCompactionTime,
    };
  }

  /**
   * Format heap statistics for debugging.
   */
  formatHeapStats(stats = this.getHeapStats()): string {
    const formatMB = (bytes: number): string => {
      return (bytes / 1024 / 1024).toFixed(1);
    };

    return [
      `Total Heap: ${formatMB(stats.total_heap_size)}MB`,
      `Used Heap: ${formatMB(stats.used_heap_size)}MB`,
      `Heap Limit: ${formatMB(stats.heap_size_limit)}MB`,
      `Physical: ${formatMB(stats.total_physical_size)}MB`,
      `Available: ${formatMB(stats.total_available_size)}MB`,
      `Malloced: ${formatMB(stats.malloced_memory)}MB`,
    ].join(', ');
  }

  /**
   * Get the Node.js heap size limit in bytes.
   */
  getHeapSizeLimit(): number {
    return this.getHeapStats().heap_size_limit;
  }

  /**
   * Check if the heap size limit is the default Node.js limit (near 2GB on 64-bit).
   */
  isDefaultHeapLimit(): boolean {
    const limit = this.getHeapSizeLimit();
    // Default is typically around 2GB on 64-bit systems
    return limit < 3 * 1024 * 1024 * 1024; // Less than 3GB
  }

  /**
   * Check if heap limit is large enough for Node 22's default heap.
   * Node 22 typically needs at least 4GB of heap.
   */
  isHeapLimitAdequate(): boolean {
    const limit = this.getHeapSizeLimit();
    return limit >= 4 * 1024 * 1024 * 1024; // At least 4GB
  }

  /**
   * Check if the memory usage is in critical state.
   */
  isCritical(): boolean {
    return this.isAboveThreshold(this.thresholds.criticalPercent);
  }

  /**
   * Get a more detailed snapshot for debugging.
   */
  getDetailedSnapshot(): MemorySnapshot & { isCritical: boolean; canCompact: boolean } {
    const snapshot = this.getSnapshot();
    return {
      ...snapshot,
      isCritical: this.isCritical(),
      canCompact: this.shouldCompact(),
    };
  }
}

/**
 * Global memory monitor instance.
 */
let globalMemoryMonitor: MemoryMonitor | null = null;

/**
 * Get or create the global memory monitor instance.
 */
export function getMemoryMonitor(thresholds?: MemoryThresholds): MemoryMonitor {
  if (!globalMemoryMonitor) {
    globalMemoryMonitor = new MemoryMonitor(thresholds);
  }
  return globalMemoryMonitor;
}

/**
 * Reset the global memory monitor instance.
 */
export function resetMemoryMonitor(): void {
  globalMemoryMonitor = null;
}

/**
 * Get current memory usage as a formatted string.
 */
export function getMemoryStatus(): string {
  const monitor = getMemoryMonitor();
  return monitor.getSnapshot().formatted;
}

/**
 * Log a one-time memory warning with details.
 */
export function logMemoryWarning(): void {
  const monitor = getMemoryMonitor();
  const snapshot = monitor.getSnapshot();
  logger.warn(
    `${snapshot.formatted}\n` +
    `${monitor.formatHeapStats()}\n` +
    `Recommendation: Use /clear to reset session or /compact to reduce context`
  );
}