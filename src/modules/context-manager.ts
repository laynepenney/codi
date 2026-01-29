// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Message } from '../types.js';
import type { ComputedContextConfig } from '../context-config.js';
import type { WorkingSet } from '../context-windowing.js';
import type { BaseProvider } from '../providers/base.js';
import type { AgentContextManager } from '../agent/context.js';
import { logger } from '../logger.js';
import { createSummarizationProvider, createAggressiveSummarizationProvider } from '../agent/context.js';

export class ContextManager {
  constructor(
    private contextManager: AgentContextManager,
    private memoryMonitor: any,
    private contextConfig: ComputedContextConfig
  ) {}

  /**
   * Compact context using smart windowing algorithm
   */
  async compactContext(messages: Message[], conversationSummary: string | null, workingSet: WorkingSet): Promise<void> {
    if (!this.contextManager.needsCompaction(messages)) {
      return;
    }

    // Implementation will be moved here from agent.ts
    await this.doCompactContext(messages, conversationSummary, workingSet);
  }

  /**
   * Proactive compaction triggered by high memory usage
   */
  async proactiveCompact(messages: Message[], conversationSummary: string | null, workingSet: WorkingSet): Promise<void> {
    // Use context manager for aggressive compaction
    const summarizationProvider = createAggressiveSummarizationProvider(this.getSummaryProvider());
    const result = await this.contextManager.compactAggressive(
      messages,
      conversationSummary,
      workingSet,
      summarizationProvider
    );

    // Update references
    messages.splice(0, messages.length, ...result.messages);
    const newSummary = result.summary;

    const savedPct = result.tokensBefore > 0
      ? ((result.tokensBefore - result.tokensAfter) / result.tokensBefore) * 100
      : 0;
    logger.debug(`Proactive compaction: ${result.messagesBefore} → ${result.messagesAfter} messages, ${result.tokensBefore} → ${result.tokensAfter} tokens (${savedPct.toFixed(1)}% saved)`);
    this.memoryMonitor.recordCompaction();
  }

  /**
   * Enforce message limits to prevent unbounded growth
   */
  enforceMessageLimit(messages: Message[], conversationSummary: string | null): void {
    const result = this.contextManager.enforceMessageLimit(messages, conversationSummary);
    messages.splice(0, messages.length, ...result.messages);
    // Return updated summary
  }

  /**
   * Get continuation prompt for ongoing conversations
   */
  buildContinuationPrompt(originalTask: string): string {
    return this.contextManager.buildContinuationPrompt(originalTask);
  }

  /**
   * Truncate tool results based on context configuration
   */
  truncateToolResult(content: string): string {
    return this.contextManager.truncateToolResult(content);
  }

  /**
   * Check if context needs compaction
   */
  needsCompaction(messages: Message[]): boolean {
    return this.contextManager.needsCompaction(messages);
  }

  /**
   * Apply compression to messages if beneficial
   */
  async applyCompression(
    messages: Message[],
    enableCompression: boolean,
    lastCompressionEntities: Map<string, any> | null,
    compressionBuffer: string
  ): {
    messages: Message[];
    entities: Map<string, any> | null;
    compressionBuffer: string;
  } {
    if (!enableCompression || messages.length <= 2) {
      return {
        messages,
        entities: lastCompressionEntities,
        compressionBuffer
      };
    }

    const { compressContext, generateEntityLegend, getCompressionStats } = await import('../compression.js');
    
    const compressed = compressContext(messages);
    if (compressed.entities.size === 0) {
      return {
        messages,
        entities: lastCompressionEntities,
        compressionBuffer
      };
    }

    const legend = generateEntityLegend(compressed.entities);
    const stats = getCompressionStats(compressed);

    // Calculate actual sizes
    const originalSize = messages.reduce((sum, m) =>
      sum + JSON.stringify(m.content).length, 0);
    const compressedSize = compressed.messages.reduce((sum, m) =>
      sum + JSON.stringify(m.content).length, 0) + legend.length;

    // Only use compression if it actually reduces size
    if (compressedSize < originalSize) {
      logger.compressionStats(stats.savings, stats.savingsPercent, stats.entityCount);
      logger.debug(`Compression saved ${originalSize - compressedSize} chars`);
      
      return {
        messages: compressed.messages,
        entities: compressed.entities,
        compressionBuffer
      };
    }

    logger.debug(`Compression skipped - no savings (${compressedSize} >= ${originalSize})`);
    return {
      messages,
      entities: lastCompressionEntities,
      compressionBuffer
    };
  }

  private async doCompactContext(messages: Message[], conversationSummary: string | null, workingSet: WorkingSet): Promise<void> {
    const totalTokens = (await import('../../../../utils/index.js')).countMessageTokens(messages);
    const isProactive = totalTokens <= this.contextConfig.maxContextTokens;
    
    logger.debug(
      isProactive
        ? `Proactive compaction: ${totalTokens} tokens at ${Math.round((totalTokens / this.contextConfig.maxContextTokens) * 100)}% of ${this.contextConfig.maxContextTokens} limit`
        : `Compacting: ${totalTokens} tokens exceeds ${this.contextConfig.maxContextTokens} limit`
    );

    const summarizationProvider = createSummarizationProvider(this.getSummaryProvider());
    logger.debug(`Using ${summarizationProvider.getName()} (${summarizationProvider.getModel()}) for summarization`);

    const result = await this.contextManager.compact(
      messages,
      conversationSummary,
      workingSet,
      summarizationProvider
    );

    messages.splice(0, messages.length, ...result.messages);
    // Update summary reference

    logger.debug(`Compacted: ${result.messagesBefore} → ${result.messagesAfter} messages, ${result.tokensBefore} → ${result.tokensAfter} tokens`);
  }

  private getSummaryProvider(): BaseProvider {
    // Implementation depends on secondary providers
    throw new Error('Summary provider resolution not implemented');
  }
}