// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

// Core dependencies
import { BaseProvider } from './providers/base.js';
import { ToolRegistry } from './tools/registry.js';
import { AgentContextManager } from './agent/context.js';

// Modular imports
import { CoreAgent } from './modules/core-agent.js';
import { ProviderManager } from './modules/provider-manager.js';
import { ContextManager } from './modules/context-manager.js';
import { CacheManager } from './modules/cache-manager.js';
import { ApprovalManager } from './modules/approval-manager.js';
import { SessionManager } from './modules/session-manager.js';
import { ToolProcessor } from './modules/tool-processor.js';

// Types
import type {
  Message,
  ToolCall,
  ToolResult,
  ToolDefinition,
  ContentBlock
} from './types.js';
import type { ComputedContextConfig } from './context-config.js';
import type { ModelMap } from './model-map/index.js';
import type { SecurityValidator } from './security-validator.js';
import type { MemoryMonitor } from './memory-monitor.js';

// Agent options and interfaces
import type {
  CoreAgentCallbacks,
  CoreAgentDependencies,
  CoreAgentMethods
} from './modules/core-agent.js';

/**
 * AgentOptions interface for modular agent
 */
export interface AgentOptions {
  provider: BaseProvider;
  toolRegistry: ToolRegistry;
  systemPrompt?: string;
  useTools?: boolean;
  extractToolsFromText?: boolean;
  autoApprove?: boolean | string[];
  approvedPatterns?: any[];
  approvedCategories?: string[];
  approvedPathPatterns?: any[];
  approvedPathCategories?: string[];
  customDangerousPatterns?: Array<{ pattern: RegExp; description: string }>;
  logLevel?: any;
  debug?: boolean;
  enableCompression?: boolean;
  maxContextTokens?: number;
  contextOptimization?: {
    maxOutputReserveScale?: number;
  };
  secondaryProvider?: BaseProvider | null;
  modelMap?: ModelMap | null;
  auditLogger?: any;
  securityValidator?: SecurityValidator | null;
  memoryMonitor?: any;
  contextConfig?: ComputedContextConfig;
  onText?: (text: string) => void;
  onReasoning?: (reasoning: string) => void;
  onReasoningChunk?: (chunk: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, isError: boolean) => void;
  onConfirm?: (confirmation: any) => Promise<any>;
  onCompaction?: (status: 'start' | 'end') => void;
  onProviderChange?: (provider: BaseProvider) => void;
}

/**
 * The Agent orchestrates the conversation between the user, model, and tools.
 * It implements the agentic loop: send message -> receive response -> execute tools -> repeat.
 * 
 * This is a modular rewrite that splits functionality into focused components.
 */
export class Agent {
  // Core module instances
  private providerManager: ProviderManager;
  private contextManager: ContextManager;
  private cacheManager: CacheManager;
  private approvalManager: ApprovalManager;
  private sessionManager: SessionManager;
  private toolProcessor: ToolProcessor;
  private coreAgent: CoreAgent;

  // State
  private logLevel: any = 0;
  private contextConfig: ComputedContextConfig;
  private auditLogger: any;
  private enableCompression: boolean = false;
  private maxContextTokens: number = 8000;

  constructor(options: AgentOptions) {
    // Initialize context config first
    this.contextConfig = options.contextConfig ?? {
      // Default context config using proper ComputedContextConfig properties
      tierName: 'default',
      contextWindow: 8000,
      maxContextTokens: 6000,
      maxOutputTokens: 2000,
      safetyBuffer: 500,
      minViableContext: 2000,
      recentMessagesToKeep: 5,
      toolResultTruncateThreshold: 1000,
      toolResultsTokenBudget: 100,
      maxImmediateToolResult: 1000
    };

    // Initialize provider manager
    this.providerManager = new ProviderManager(
      options.provider,
      options.modelMap ?? null
    );

    // Initialize context manager
    this.contextManager = new ContextManager(
      new AgentContextManager({
        maxContextTokens: options.maxContextTokens ?? 8000,
        contextConfig: this.contextConfig,
        contextOptimization: options.contextOptimization,
      }),
      options.memoryMonitor ?? null,
      this.contextConfig
    );

    // Initialize cache manager
    this.cacheManager = new CacheManager({
      getDefinitions: () => this.toolRegistry.getDefinitions()
    });

    // Initialize approval manager
    this.approvalManager = new ApprovalManager(
      options.autoApprove === true,
      Array.isArray(options.autoApprove) ? options.autoApprove : [],
      options.approvedPatterns ?? [],
      options.approvedCategories ?? [],
      options.approvedPathPatterns ?? [],
      options.approvedPathCategories ?? [],
      options.customDangerousPatterns ?? []
    );

    // Initialize session manager
    this.sessionManager = new SessionManager();

    // Initialize tool processor
    this.toolProcessor = new ToolProcessor(
      options.toolRegistry,
      options.securityValidator ?? null
    );

    // Initialize core agent with dependencies
    this.coreAgent = new CoreAgent(
      {
        onText: options.onText,
        onReasoning: options.onReasoning,
        onReasoningChunk: options.onReasoningChunk,
        onToolCall: options.onToolCall,
        onToolResult: options.onToolResult,
        onConfirm: options.onConfirm,
        onCompaction: options.onCompaction,
        onProviderChange: options.onProviderChange,
      },
      {
        getProviderForChat: (taskType) => this.providerManager.getProviderForChat(taskType),
        getSystemPrompt: () => options.systemPrompt || 'You are a helpful AI coding assistant.',
        getMessages: () => this.sessionManager.getMessages(),
        getConversationSummary: () => this.sessionManager.getSummary(),
        getWorkingSet: () => this.sessionManager.getWorkingSet(),
        getContextConfig: () => this.contextConfig,
        getUseTools: () => options.useTools ?? true,
        getExtractToolsFromText: () => options.extractToolsFromText ?? true,
        getEnableCompression: () => this.enableCompression,
        getMaxContextTokens: () => this.maxContextTokens,
        getLastCompressionEntities: () => null, // Would be managed by compression module
        getCompressionBuffer: () => '', // Would be managed by compression module
        getModelMap: () => this.providerManager.getModelMap(),
        getSecurityValidator: () => options.securityValidator ?? null,
        getMemoryMonitor: () => options.memoryMonitor ?? (() => ({ logStatus: () => 'normal' })),
        getDebugger: () => ({
          isStepMode: () => false,
          setStepMode: () => {},
          setPaused: () => {},
          getCurrentIteration: () => 0,
          setCurrentIteration: () => {},
          maybeCreateCheckpoint: () => {},
          checkBreakpoints: () => null,
          waitForDebugResume: async () => {},
        }),
      },
      {
        invalidateTokenCache: () => this.cacheManager.invalidateTokenCache(),
        enforceMessageLimit: () => this.contextManager.enforceMessageLimit(
          this.sessionManager.getMessages(),
          this.sessionManager.getSummary()
        ),
        proactiveCompact: () => this.contextManager.proactiveCompact(
          this.sessionManager.getMessages(),
          this.sessionManager.getSummary(),
          this.sessionManager.getWorkingSet()
        ),
        compactContext: () => this.contextManager.compactContext(
          this.sessionManager.getMessages(),
          this.sessionManager.getSummary(),
          this.sessionManager.getWorkingSet()
        ),
        truncateToolResult: (content) => this.contextManager.truncateToolResult(content),
        shouldAutoApprove: (toolName) => this.approvalManager.shouldAutoApprove(toolName),
        shouldAutoApproveBash: (command) => this.approvalManager.shouldAutoApproveBash(command),
        shouldAutoApproveFilePath: (toolName, filePath) =>
          this.approvalManager.shouldAutoApproveFilePath(toolName, filePath),
        getCachedToolDefinitions: () => this.cacheManager.getCachedToolDefinitions(),
        checkCommandApproval: (command) => this.approvalManager.getApprovalSuggestions(command),
      }
    );

    // Store other options
    this.logLevel = options.logLevel ?? (options.debug ? 2 : 0);
    this.auditLogger = options.auditLogger;
    this.enableCompression = options.enableCompression ?? false;
    this.maxContextTokens = options.maxContextTokens ?? 8000;
  }

  /**
   * Process a user message and return the final assistant response.
   * Delegates to the core agent module.
   */
  async chat(userMessage: string, options?: { taskType?: string }): Promise<string> {
    return await this.coreAgent.chat(userMessage, options);
  }

  // Public methods that delegate to appropriate modules

  getProvider(): BaseProvider {
    return this.providerManager.getProvider();
  }

  setProvider(provider: BaseProvider): void {
    this.providerManager.setProvider(provider, this.coreAgentCallbacks?.onProviderChange);
  }

  getModelMap(): ModelMap | null {
    return this.providerManager.getModelMap();
  }

  setModelMap(modelMap: ModelMap): void {
    this.providerManager.setModelMap(modelMap);
  }

  getHistory(): Message[] {
    return this.sessionManager.getHistory();
  }

  setHistory(messages: Message[]): void {
    this.sessionManager.setHistory(messages);
  }

  getSummary(): string | null {
    return this.sessionManager.getSummary();
  }

  setSummary(summary: string | null): void {
    this.sessionManager.setSummary(summary);
  }

  loadSession(messages: Message[], summary: string | null): void {
    this.sessionManager.loadSession(messages, summary);
  }

  clearHistory(): void {
    this.sessionManager.clearHistory();
  }

  clearContext(): void {
    this.sessionManager.clearContext();
  }

  clearWorkingSet(): void {
    this.sessionManager.clearWorkingSet();
  }

  injectContext(context: string): void {
    this.sessionManager.injectContext(context);
  }

  getMessages(): Message[] {
    return this.sessionManager.getMessages();
  }

  injectMessage(role: 'user' | 'assistant', content: string): void {
    this.sessionManager.injectMessage(role, content);
  }

  setCompression(enabled: boolean): void {
    this.enableCompression = enabled;
  }

  isCompressionEnabled(): boolean {
    return this.enableCompression;
  }

  invalidateToolCache(): void {
    this.cacheManager.invalidateToolCache();
  }

  // Debugger methods would be implemented when debug support is modularized
  setDebugPaused(paused: boolean): void {
    // Would delegate to debug module
  }

  setDebugStep(): void {
    // Would delegate to debug module
  }

  isDebugPaused(): boolean {
    return false; // Would delegate to debug module
  }

  // Additional methods would delegate to appropriate modules
  getContextInfo(): any {
    return {}; // Would delegate to context module
  }

  createCheckpoint(): any {
    return null; // Would delegate to debug module
  }

  loadCheckpoint(): any {
    return null; // Would delegate to debug module
  }

  getStateSnapshot(): any {
    return {}; // Would delegate to appropriate module
  }

  addBreakpoint(): string {
    return ''; // Would delegate to debug module
  }

  removeBreakpoint(): boolean {
    return false; // Would delegate to debug module
  }

  clearBreakpoints(): void {
    // Would delegate to debug module
  }

  listCheckpoints(): any[] {
    return []; // Would delegate to debug module
  }

  rewind(): boolean {
    return false; // Would delegate to debug module
  }

  createBranch(): boolean {
    return false; // Would delegate to debug module
  }

  switchBranch(): boolean {
    return false; // Would delegate to debug module
  }

  listBranches(): any[] {
    return []; // Would delegate to debug module
  }

  getCurrentBranch(): string {
    return 'main'; // Would delegate to debug module
  }

  getTimeline(): any {
    return {}; // Would delegate to debug module
  }

  loadTimeline(): void {
    // Would delegate to debug module
  }

  async forceCompact(): Promise<{ before: number; after: number; summary: string | null }> {
    return { before: 0, after: 0, summary: null }; // Would delegate to context module
  }

  private get coreAgentCallbacks() {
    return {
      onProviderChange: undefined,
      // Other callbacks would be accessible here
    };
  }

  private get toolRegistry() {
    return {
      getDefinitions: (): ToolDefinition[] => [], // Would be properly initialized
    };
  }
}

// Export types for use by other modules
export interface ToolConfirmation {
  toolName: string;
  input: Record<string, unknown>;
  isDangerous: boolean;
  dangerReason?: string;
  diffPreview?: any;
  approvalSuggestions?: {
    suggestedPattern: string;
    matchedCategories: Array<{ id: string; name: string; description: string }>;
  };
  securityWarning?: SecurityWarning;
}

export type ConfirmationResult =
  | 'approve'
  | 'deny'
  | 'abort'
  | { type: 'approve_pattern'; pattern: string }
  | { type: 'approve_category'; categoryId: string };

export interface SecurityWarning {
  riskScore: number;
  threats: string[];
  reasoning: string;
  recommendation: 'allow' | 'warn' | 'block';
  latencyMs: number;
}