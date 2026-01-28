// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Agent Context Manager
 *
 * Handles context compaction, windowing, and summarization for the Agent.
 * This module manages the token budget and decides when/how to compact messages.
 */

import type { Message } from '../types.js';
import type { BaseProvider } from '../providers/base.js';
import type { ComputedContextConfig } from '../context-config.js';
import { FIXED_CONFIG } from '../context-config.js';
import type { WorkingSet, WindowingConfig } from '../context-windowing.js';
import { CONTEXT_OPTIMIZATION } from '../constants.js';
import { scoreMessages, extractFilePaths } from '../importance-scorer.js';
import {
  selectMessagesToKeep,
  applySelection,
  createWorkingSet,
} from '../context-windowing.js';
import {
  countMessageTokens,
  getMessageText,
  findSafeStartIndex,
  groupBySimilarity,
} from '../utils/index.js';
import { logger } from '../logger.js';
import { getDebugBridge, isDebugBridgeEnabled } from '../debug-bridge.js';
import type { BaseEmbeddingProvider } from '../rag/embeddings/base.js';

/**
 * Configuration for the context manager.
 */
export interface ContextManagerConfig {
  maxContextTokens: number;
  contextConfig: ComputedContextConfig;
  contextOptimization?: {
    maxOutputReserveScale?: number;
  };
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  messages: Message[];
  summary: string | null;
  tokensBefore: number;
  tokensAfter: number;
  messagesBefore: number;
  messagesAfter: number;
}

/**
 * Summarization provider interface - allows injecting the summarization logic.
 */
export interface SummarizationProvider {
  summarize(content: string, filesContext: string): Promise<string>;
}

/**
 * Context Manager handles compaction and windowing for agent conversations.
 */
export class AgentContextManager {
  private indexedFiles: Set<string> | null = null;
  private embeddingProvider: BaseEmbeddingProvider | null = null;

  constructor(private config: ContextManagerConfig) {}

  /**
   * Set indexed files from RAG for code relevance scoring.
   */
  setIndexedFiles(files: string[]): void {
    this.indexedFiles = new Set(files);
  }

  /**
   * Set embedding provider for semantic message deduplication.
   */
  setEmbeddingProvider(provider: BaseEmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Check if context compaction is needed.
   * Uses proactive threshold (85% of limit) to avoid hitting hard limits.
   */
  needsCompaction(messages: Message[]): boolean {
    const totalTokens = countMessageTokens(messages);
    const proactiveThreshold = Math.floor(this.config.maxContextTokens * 0.85);
    return totalTokens > proactiveThreshold;
  }

  /**
   * Check if proactive compaction is needed (based on token count).
   * Returns true if at 85% of max context tokens.
   */
  needsProactiveCompaction(messages: Message[]): boolean {
    return this.needsCompaction(messages);
  }

  /**
   * Compact the conversation context using smart windowing.
   * Returns the compacted messages and updated summary.
   */
  async compact(
    messages: Message[],
    currentSummary: string | null,
    workingSet: WorkingSet,
    summarizationProvider: SummarizationProvider
  ): Promise<CompactionResult> {
    const tokensBefore = countMessageTokens(messages);
    const messagesBefore = messages.length;

    // Score messages by importance
    const scores = scoreMessages(
      messages,
      CONTEXT_OPTIMIZATION.WEIGHTS,
      undefined,
      this.indexedFiles ?? undefined
    );

    // Configure windowing
    const windowConfig: WindowingConfig = {
      minRecentMessages: CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES,
      maxMessages: CONTEXT_OPTIMIZATION.MAX_MESSAGES,
      importanceThreshold: CONTEXT_OPTIMIZATION.IMPORTANCE_THRESHOLD,
      preserveToolPairs: CONTEXT_OPTIMIZATION.PRESERVE_TOOL_PAIRS,
      preserveWorkingSet: CONTEXT_OPTIMIZATION.PRESERVE_WORKING_SET,
    };

    // Select what to keep using smart windowing
    const selection = selectMessagesToKeep(messages, scores, workingSet, windowConfig);

    logger.debug(`Smart windowing: keeping ${selection.keep.length}/${messages.length} messages, summarizing ${selection.summarize.length}`);

    // If nothing to summarize, just apply selection
    if (selection.summarize.length === 0) {
      const newMessages = applySelection(messages, selection);
      const tokensAfter = countMessageTokens(newMessages);
      return {
        messages: newMessages,
        summary: currentSummary,
        tokensBefore,
        tokensAfter,
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    }

    // Get messages to summarize
    const messagesToSummarize = selection.summarize.map(i => messages[i]);

    // Extract file paths for context
    const discussedFiles = new Set<string>();
    for (const msg of messagesToSummarize) {
      const text = getMessageText(msg);
      const paths = extractFilePaths(text);
      paths.forEach(p => discussedFiles.add(p));
    }

    // Format content for summarization
    const oldContent = await this.formatForSummarization(messagesToSummarize);

    // Include existing summary if present
    const contextToSummarize = currentSummary
      ? `Previous summary:\n${currentSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    const filesContext = discussedFiles.size > 0
      ? `\n\nFiles discussed: ${[...discussedFiles].join(', ')}`
      : '';

    try {
      const newSummary = await summarizationProvider.summarize(contextToSummarize, filesContext);
      const newMessages = applySelection(messages, selection);
      const tokensAfter = countMessageTokens(newMessages);

      logger.debug(`Compacted to ${tokensAfter} tokens. Summary: ${newSummary?.slice(0, 100)}...`);

      // Debug bridge: context compaction
      if (isDebugBridgeEnabled()) {
        getDebugBridge().contextCompaction(tokensBefore, tokensAfter, messagesBefore, newMessages.length);
      }

      return {
        messages: newMessages,
        summary: newSummary,
        tokensBefore,
        tokensAfter,
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    } catch (error) {
      // If summarization fails, apply selection without summary update
      logger.debug(`Summarization failed, using selection only: ${error}`);
      const newMessages = applySelection(messages, selection);
      const tokensAfter = countMessageTokens(newMessages);

      if (isDebugBridgeEnabled()) {
        getDebugBridge().contextCompaction(tokensBefore, tokensAfter, messagesBefore, newMessages.length);
      }

      return {
        messages: newMessages,
        summary: currentSummary,
        tokensBefore,
        tokensAfter,
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    }
  }

  /**
   * Perform aggressive compaction (for high memory situations).
   */
  async compactAggressive(
    messages: Message[],
    currentSummary: string | null,
    workingSet: WorkingSet,
    summarizationProvider: SummarizationProvider
  ): Promise<CompactionResult> {
    const tokensBefore = countMessageTokens(messages);
    const messagesBefore = messages.length;

    // More aggressive scoring weights
    const scores = scoreMessages(
      messages,
      {
        recency: 0.3, // Less weight on recent - compact more
        referenceCount: CONTEXT_OPTIMIZATION.WEIGHTS.referenceCount,
        userEmphasis: CONTEXT_OPTIMIZATION.WEIGHTS.userEmphasis,
        actionRelevance: CONTEXT_OPTIMIZATION.WEIGHTS.actionRelevance,
        codeRelevance: CONTEXT_OPTIMIZATION.WEIGHTS.codeRelevance,
      },
      undefined,
      this.indexedFiles ?? undefined
    );

    // More aggressive windowing config
    const windowConfig: WindowingConfig = {
      minRecentMessages: Math.max(CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES - 2, 3),
      maxMessages: Math.min(CONTEXT_OPTIMIZATION.MAX_MESSAGES, 30),
      importanceThreshold: CONTEXT_OPTIMIZATION.IMPORTANCE_THRESHOLD + 0.1,
      preserveToolPairs: CONTEXT_OPTIMIZATION.PRESERVE_TOOL_PAIRS,
      preserveWorkingSet: CONTEXT_OPTIMIZATION.PRESERVE_WORKING_SET,
    };

    const selection = selectMessagesToKeep(messages, scores, workingSet, windowConfig);

    logger.debug(`Aggressive compaction: keeping ${selection.keep.length}/${messagesBefore} messages, summarizing ${selection.summarize.length}`);

    if (selection.summarize.length === 0) {
      const newMessages = applySelection(messages, selection);
      return {
        messages: newMessages,
        summary: currentSummary,
        tokensBefore,
        tokensAfter: countMessageTokens(newMessages),
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    }

    const messagesToSummarize = selection.summarize.map(i => messages[i]);
    const oldContent = messagesToSummarize
      .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 400)}`)
      .join('\n\n');

    const contextToSummarize = currentSummary
      ? `Previous summary:\n${currentSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    try {
      const newSummary = await summarizationProvider.summarize(
        contextToSummarize,
        '' // No files context for aggressive compaction
      );
      const newMessages = applySelection(messages, selection);
      const tokensAfter = countMessageTokens(newMessages);

      logger.debug(`Aggressive compaction: ${messagesBefore} → ${newMessages.length} messages, ${tokensBefore} → ${tokensAfter} tokens`);

      return {
        messages: newMessages,
        summary: newSummary,
        tokensBefore,
        tokensAfter,
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    } catch (error) {
      logger.debug(`Aggressive compaction summarization failed: ${error}`);
      const newMessages = applySelection(messages, selection);
      return {
        messages: newMessages,
        summary: currentSummary,
        tokensBefore,
        tokensAfter: countMessageTokens(newMessages),
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    }
  }

  /**
   * Force compaction regardless of current size.
   */
  async forceCompact(
    messages: Message[],
    currentSummary: string | null,
    workingSet: WorkingSet,
    summarizationProvider: SummarizationProvider
  ): Promise<CompactionResult> {
    const tokensBefore = countMessageTokens(messages);
    const messagesBefore = messages.length;

    if (messages.length <= CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES) {
      return {
        messages,
        summary: currentSummary,
        tokensBefore,
        tokensAfter: tokensBefore,
        messagesBefore,
        messagesAfter: messages.length,
      };
    }

    // Score and window with reduced max messages
    const scores = scoreMessages(
      messages,
      CONTEXT_OPTIMIZATION.WEIGHTS,
      undefined,
      this.indexedFiles ?? undefined
    );

    const windowConfig: WindowingConfig = {
      minRecentMessages: CONTEXT_OPTIMIZATION.MIN_RECENT_MESSAGES,
      maxMessages: Math.min(CONTEXT_OPTIMIZATION.MAX_MESSAGES, Math.ceil(messages.length / 2)),
      importanceThreshold: CONTEXT_OPTIMIZATION.IMPORTANCE_THRESHOLD,
      preserveToolPairs: CONTEXT_OPTIMIZATION.PRESERVE_TOOL_PAIRS,
      preserveWorkingSet: CONTEXT_OPTIMIZATION.PRESERVE_WORKING_SET,
    };

    const selection = selectMessagesToKeep(messages, scores, workingSet, windowConfig);

    if (selection.summarize.length === 0) {
      const newMessages = applySelection(messages, selection);
      return {
        messages: newMessages,
        summary: currentSummary,
        tokensBefore,
        tokensAfter: countMessageTokens(newMessages),
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    }

    const messagesToSummarize = selection.summarize.map(i => messages[i]);

    // Extract file paths
    const discussedFiles = new Set<string>();
    for (const msg of messagesToSummarize) {
      const text = getMessageText(msg);
      const paths = extractFilePaths(text);
      paths.forEach(p => discussedFiles.add(p));
    }

    const oldContent = messagesToSummarize
      .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
      .join('\n\n');

    const contextToSummarize = currentSummary
      ? `Previous summary:\n${currentSummary}\n\nNew messages:\n${oldContent}`
      : oldContent;

    const filesContext = discussedFiles.size > 0
      ? `\n\nFiles discussed: ${[...discussedFiles].join(', ')}`
      : '';

    try {
      const newSummary = await summarizationProvider.summarize(contextToSummarize, filesContext);
      const newMessages = applySelection(messages, selection);
      return {
        messages: newMessages,
        summary: newSummary,
        tokensBefore,
        tokensAfter: countMessageTokens(newMessages),
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    } catch (error) {
      logger.debug(`Force compaction summarization failed: ${error}`);
      const newMessages = applySelection(messages, selection);
      return {
        messages: newMessages,
        summary: currentSummary,
        tokensBefore,
        tokensAfter: countMessageTokens(newMessages),
        messagesBefore,
        messagesAfter: newMessages.length,
      };
    }
  }

  /**
   * Enforce the message limit to prevent unbounded memory growth.
   * Returns pruned messages and updated summary.
   */
  enforceMessageLimit(
    messages: Message[],
    currentSummary: string | null
  ): { messages: Message[]; summary: string | null } {
    if (messages.length <= FIXED_CONFIG.MAX_MESSAGES) {
      return { messages, summary: currentSummary };
    }

    logger.debug(`Enforcing message limit: ${messages.length} > ${FIXED_CONFIG.MAX_MESSAGES}`);

    // Calculate how many to remove (keep some buffer below the limit)
    const targetSize = Math.floor(FIXED_CONFIG.MAX_MESSAGES * 0.8);
    const removeCount = messages.length - targetSize;

    // Find a safe start point that doesn't break tool call/result pairs
    const recentMessages = messages.slice(removeCount);
    const safeStart = findSafeStartIndex(recentMessages);

    const actualRemoveCount = removeCount + safeStart;
    const pruned = actualRemoveCount;

    if (pruned <= 0) {
      return { messages, summary: currentSummary };
    }

    // Update summary to note pruning
    const pruneNote = `[Note: ${pruned} older messages were automatically pruned to stay within memory limits]`;
    const newSummary = currentSummary
      ? `${pruneNote}\n\n${currentSummary}`
      : pruneNote;

    const newMessages = messages.slice(actualRemoveCount);
    logger.debug(`Pruned ${pruned} messages, now have ${newMessages.length}`);

    return { messages: newMessages, summary: newSummary };
  }

  /**
   * Build a continuation prompt that reminds the model of the original task.
   */
  buildContinuationPrompt(originalTask: string): string {
    const taskPreview = originalTask.length > 150
      ? originalTask.slice(0, 150) + '...'
      : originalTask;
    return `\n\nOriginal request: "${taskPreview}"\n\nIf you have completed the user's request, respond with your final answer. Do NOT continue calling tools unless the task is incomplete.`;
  }

  /**
   * Truncate a tool result if it exceeds the maximum size.
   */
  truncateToolResult(content: string): string {
    const maxSize = this.config.contextConfig.maxImmediateToolResult;
    if (content.length <= maxSize) {
      return content;
    }
    const halfLimit = Math.floor(maxSize / 2);
    const truncated = content.slice(0, halfLimit) +
      `\n\n... [${content.length - maxSize} characters truncated] ...\n\n` +
      content.slice(-halfLimit);
    return truncated;
  }

  /**
   * Format messages for summarization, using semantic deduplication if available.
   */
  private async formatForSummarization(messages: Message[]): Promise<string> {
    // Try semantic deduplication if embedding provider is available
    if (this.embeddingProvider && messages.length > 2) {
      try {
        const messageTexts = messages.map(m => getMessageText(m).slice(0, 1000));
        const embeddings = await this.embeddingProvider.embed(messageTexts);

        const groups = groupBySimilarity(embeddings, 0.85);
        logger.debug(`Semantic dedup: ${messages.length} messages → ${groups.length} groups`);

        return groups.map((group, i) => {
          if (group.length === 1) {
            const msg = messages[group[0]];
            return `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`;
          } else {
            const groupMessages = group.map(idx => {
              const msg = messages[idx];
              return `  - [${msg.role}]: ${getMessageText(msg).slice(0, 200)}`;
            }).join('\n');
            return `[Similar discussion #${i + 1}, ${group.length} messages]:\n${groupMessages}`;
          }
        }).join('\n\n');
      } catch (err) {
        logger.debug(`Semantic dedup failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Standard formatting without semantic deduplication
    return messages
      .map((msg) => `[${msg.role}]: ${getMessageText(msg).slice(0, 500)}`)
      .join('\n\n');
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current max context tokens.
   */
  getMaxContextTokens(): number {
    return this.config.maxContextTokens;
  }
}

/**
 * Create a summarization provider from a BaseProvider.
 */
export function createSummarizationProvider(
  provider: BaseProvider,
  summaryPromptPrefix: string = ''
): SummarizationProvider {
  return {
    async summarize(content: string, filesContext: string): Promise<string> {
      const response = await provider.streamChat(
        [{
          role: 'user',
          content: `${summaryPromptPrefix}Create a concise summary of this conversation for context preservation.

## What to Include
- **Goal**: What task is the user trying to accomplish?
- **Progress**: What has been done so far?
- **Files Modified**: List any files that were created, edited, or deleted
- **Key Decisions**: Any important choices made during the conversation
- **Current State**: Where did the conversation leave off?

## Format
Write 3-5 short paragraphs. Use bullet points for file lists. Be factual and specific.
${filesContext}

## Conversation to Summarize
${content}`,
        }],
        undefined,
        undefined
      );
      return response.content;
    },
  };
}

/**
 * Create a summarization provider for aggressive compaction (shorter summaries).
 */
export function createAggressiveSummarizationProvider(
  provider: BaseProvider
): SummarizationProvider {
  return {
    async summarize(content: string, _filesContext: string): Promise<string> {
      const response = await provider.streamChat(
        [{
          role: 'user',
          content: `Create a brief summary for context preservation due to high memory usage.

## What to Include
- **Goal**: What task is being worked on?
- **Progress**: What has been done?
- **Key State**: Where did we leave off?

## Format
Write 2-3 short paragraphs. Be concise.

## Conversation to Summarize
${content}`,
        }],
        undefined,
        undefined
      );
      return response.content;
    },
  };
}
