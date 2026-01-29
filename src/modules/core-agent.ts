// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Message, ToolCall, ToolResult, ContentBlock } from '../../types.js';
import type { BaseProvider } from '../../providers/base.js';
import { LogLevel, logger } from '../../logger.js';
import type { ComputedContextConfig } from '../../context-config.js';
import type { WorkingSet } from '../../context-windowing.js';
import type { ModelMap } from '../../model-map/index.js';
import type { SecurityValidator } from '../../security-validator.js';
import type { MemoryMonitor } from '../../memory-monitor.js';
import type { ToolConfirmation, ConfirmationResult, SecurityWarning } from '../agent.js';

/**
 * Core Agent - Handles the primary chat loop and tool execution flow
 */
export interface CoreAgentCallbacks {
  onText?: (text: string) => void;
  onReasoning?: (reasoning: string) => void;
  onReasoningChunk?: (chunk: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, isError: boolean) => void;
  onConfirm?: (confirmation: ToolConfirmation) => Promise<ConfirmationResult>;
  onCompaction?: (status: 'start' | 'end') => void;
  onProviderChange?: (provider: BaseProvider) => void;
}

export interface CoreAgentDependencies {
  getProviderForChat: (taskType?: string) => BaseProvider;
  getSystemPrompt: () => string;
  getMessages: () => Message[];
  getConversationSummary: () => string | null;
  getWorkingSet: () => WorkingSet;
  getContextConfig: () => ComputedContextConfig;
  getUseTools: () => boolean;
  getExtractToolsFromText: () => boolean;
  getEnableCompression: () => boolean;
  getMaxContextTokens: () => number;
  getLastCompressionEntities: () => Map<string, any> | null;
  getCompressionBuffer: () => string;
  getModelMap: () => ModelMap | null;
  getSecurityValidator: () => SecurityValidator | null;
  getMemoryMonitor: () => MemoryMonitor;
  getDebugger: () => {
    isStepMode: () => boolean;
    setStepMode: (mode: boolean) => void;
    setPaused: (paused: boolean) => void;
    getCurrentIteration: () => number;
    setCurrentIteration: (iteration: number) => void;
    maybeCreateCheckpoint: (state: any) => void;
    checkBreakpoints: (breakpoint: any) => any;
    waitForDebugResume: (messagesLength: number) => Promise<void>;
  };
}

export interface CoreAgentMethods {
  invalidateTokenCache: () => void;
  enforceMessageLimit: () => void;
  proactiveCompact: () => Promise<void>;
  compactContext: () => Promise<void>;
  truncateToolResult: (content: string) => string;
  shouldAutoApprove: (toolName: string) => boolean;
  shouldAutoApproveBash: (command: string) => boolean;
  shouldAutoApproveFilePath: (toolName: string, filePath: string) => boolean;
  getCachedToolDefinitions: () => any[];
  checkCommandApproval: (command: string) => any;
}

export class CoreAgent {
  constructor(
    private callbacks: CoreAgentCallbacks,
    private dependencies: CoreAgentDependencies,
    private methods: CoreAgentMethods
  ) {}

  /**
   * Process a user message and return the final assistant response.
   * This runs the full agentic loop until the model stops calling tools.
   */
  async chat(userMessage: string, options?: { taskType?: string }): Promise<string> {
    // This method will be extracted from the main agent.ts file
    // It will maintain the same functionality but reference dependencies
    
    // Implementation will be moved here once we extract the functionality
    throw new Error('CoreAgent.chat method not yet implemented');
  }

  /**
   * Handle API response processing including tool call extraction
   */
  private handleApiResponse(
    response: any,
    chatProvider: BaseProvider,
    originalTask: string
  ): { hasToolCalls: boolean; toolCalls: ToolCall[] } {
    // Implementation will be moved here
    return { hasToolCalls: false, toolCalls: [] };
  }

  /**
   * Process tool calls with confirmation and execution
   */
  private async processToolCalls(
    toolCalls: ToolCall[],
    originalTask: string
  ): Promise<{ toolResults: ToolResult[]; aborted: boolean; hasError: boolean }> {
    // Implementation will be moved here
    return { toolResults: [], aborted: false, hasError: false };
  }

  /**
   * Apply compression to messages if beneficial
   */
  private applyCompression(messagesToSend: Message[]): {
    messages: Message[];
    entities: Map<string, any> | null;
    compressionBuffer: string;
  } {
    // Implementation will be moved here
    return { messages: messagesToSend, entities: null, compressionBuffer: '' };
  }
}