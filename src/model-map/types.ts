// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Model Map Types
 *
 * Docker-compose style configuration for multi-model orchestration.
 */

/**
 * Named model definition with provider and settings.
 */
export interface ModelDefinition {
  /** Provider type (anthropic, openai, ollama, ollama-cloud, runpod) */
  provider: string;
  /** Model name/ID */
  model: string;
  /** Human-readable description */
  description?: string;
  /** Maximum output tokens */
  maxTokens?: number;
  /** Temperature setting (0-1) */
  temperature?: number;
  /** Custom API base URL */
  baseUrl?: string;
}

/**
 * Task category with associated model.
 */
export interface TaskDefinition {
  /** Model name reference (from models section) */
  model: string;
  /** Human-readable description */
  description?: string;
}

/**
 * Per-command configuration.
 */
export interface CommandConfig {
  /** Direct model reference (from models section) */
  model?: string;
  /** Task category reference (from tasks section) */
  task?: string;
  /** Pipeline reference (from pipelines section) */
  pipeline?: string;
}

/**
 * Provider context for role resolution.
 * Allows distinguishing between local and cloud Ollama instances.
 */
export type ProviderContext =
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'ollama-cloud'
  | string;

/**
 * Role definition mapping provider contexts to model names.
 * Enables provider-agnostic pipeline definitions.
 */
export type RoleMapping = Record<ProviderContext, string>;

/**
 * Collection of named roles with their provider mappings.
 */
export type ModelRoles = Record<string, RoleMapping>;

/**
 * Single step in a multi-model pipeline.
 */
export interface PipelineStep {
  /** Step name (for variable reference) */
  name: string;
  /** Model name reference (mutually exclusive with role) */
  model?: string;
  /** Role reference for provider-agnostic steps (mutually exclusive with model) */
  role?: string;
  /** Prompt template with variable substitution */
  prompt: string;
  /** Output variable name */
  output: string;
  /** Optional condition expression */
  condition?: string;

  // Agentic capabilities (V3)
  /** Tool names this step can use (enables agentic execution) */
  tools?: string[];
  /** Maximum tool loop iterations (default: 5) */
  maxIterations?: number;
  /** Enable tool use for this step (default: false) */
  allowToolUse?: boolean;
}

/**
 * Multi-model pipeline definition.
 */
export interface PipelineDefinition {
  /** Human-readable description */
  description?: string;
  /** Default provider context for role resolution (e.g., 'anthropic', 'openai', 'ollama') */
  provider?: string;
  /** Ordered list of steps */
  steps: PipelineStep[];
  /** Result template with variable substitution */
  result?: string;
}

/**
 * Complete model map configuration.
 */
export interface ModelMapConfig {
  /** Config version */
  version: string;
  /** Named model definitions */
  models: Record<string, ModelDefinition>;
  /** Role mappings for provider-agnostic pipelines */
  'model-roles'?: ModelRoles;
  /** Task categories */
  tasks?: Record<string, TaskDefinition>;
  /** Per-command overrides */
  commands?: Record<string, CommandConfig>;
  /** Fallback chains */
  fallbacks?: Record<string, string[]>;
  /** Multi-model pipelines */
  pipelines?: Record<string, PipelineDefinition>;
}

/**
 * Resolved model for execution.
 */
export interface ResolvedModel {
  /** Original model name from config */
  name: string;
  /** Provider type */
  provider: string;
  /** Model ID */
  model: string;
  /** Full model definition */
  definition: ModelDefinition;
}

/**
 * Pipeline execution context.
 */
export interface PipelineContext {
  /** Input value */
  input: string;
  /** Accumulated step outputs */
  variables: Record<string, string>;
}

/**
 * Pipeline execution result.
 */
export interface PipelineResult {
  /** Final output */
  output: string;
  /** All step outputs */
  steps: Record<string, string>;
  /** Models used in execution */
  modelsUsed: string[];
}

/**
 * Task types for built-in command categorization.
 */
export type TaskType = 'fast' | 'code' | 'complex' | 'summarize' | string;

/**
 * Default task assignments for built-in commands.
 */
export const DEFAULT_COMMAND_TASKS: Record<string, TaskType> = {
  // Fast tasks - quick, simple operations
  commit: 'fast',
  pr: 'fast',
  branch: 'fast',
  stash: 'fast',
  gitstatus: 'fast',
  log: 'fast',

  // Code tasks - standard coding operations
  explain: 'code',
  refactor: 'code',
  test: 'code',
  review: 'code',
  doc: 'code',
  optimize: 'code',

  // Complex tasks - require deeper reasoning
  fix: 'complex',
  debug: 'complex',
  scaffold: 'complex',
  migrate: 'complex',
};

// ============================================================================
// Intelligent File Grouping Types
// ============================================================================

/**
 * A group of related files for batch processing.
 */
export interface FileGroup {
  /** Group name (e.g., "commands", "providers", "tools") */
  name: string;
  /** Files in this group */
  files: string[];
  /** How the group was determined */
  source: 'hierarchy' | 'ai-classified' | 'manual';
  /** Optional description of what this group contains */
  description?: string;
}

/**
 * Options for file grouping.
 */
export interface GroupingOptions {
  /** Strategy for grouping files */
  strategy: 'hierarchy' | 'ai' | 'hybrid';
  /** Maximum files per group (default: 15) */
  maxGroupSize?: number;
  /** Minimum files to trigger AI classification for flat directories */
  aiThreshold?: number;
  /** Provider context for AI classification */
  providerContext?: ProviderContext;
}

/**
 * Result of file grouping operation.
 */
export interface GroupingResult {
  /** Groups of related files */
  groups: FileGroup[];
  /** Total files grouped */
  totalFiles: number;
  /** How long grouping took (ms) */
  duration?: number;
}

// ============================================================================
// Iterative Pipeline Execution Types
// ============================================================================

/**
 * Callbacks for pipeline step execution (base callbacks).
 */
export interface PipelineCallbacks {
  /** Called when a step starts */
  onStepStart?: (stepName: string, modelName: string) => void;
  /** Called when a step completes */
  onStepComplete?: (stepName: string, output: string) => void;
  /** Called for streaming text during step execution */
  onStepText?: (stepName: string, text: string) => void;
  /** Called when a step errors */
  onError?: (stepName: string, error: Error) => void;
}

/**
 * Extended callbacks for iterative pipeline execution.
 */
export interface IterativeCallbacks extends PipelineCallbacks {
  /** Called when processing of a file starts */
  onFileStart?: (file: string, index: number, total: number) => void;
  /** Called when processing of a file completes */
  onFileComplete?: (file: string, result: string) => void;
  /** Called when aggregation phase begins */
  onAggregationStart?: () => void;
  /** Called when a batch aggregation starts */
  onBatchStart?: (batchIndex: number, totalBatches: number, filesInBatch: number) => void;
  /** Called when a batch aggregation completes */
  onBatchComplete?: (batchIndex: number, summary: string) => void;
  /** Called when meta-aggregation starts (combining batch summaries) */
  onMetaAggregationStart?: (batchCount: number) => void;
  /** Called when file grouping starts */
  onGroupingStart?: (totalFiles: number) => void;
  /** Called when file grouping completes */
  onGroupingComplete?: (groups: FileGroup[]) => void;
  /** Called when a group starts processing */
  onGroupStart?: (group: FileGroup, index: number, total: number) => void;
  /** Called when a group completes processing */
  onGroupComplete?: (group: FileGroup, summary: string) => void;
}

/**
 * Aggregation options for iterative pipeline execution.
 */
export interface AggregationOptions {
  /** Whether to run aggregation (default: true) */
  enabled?: boolean;
  /** Model role for aggregation (default: 'capable') */
  role?: string;
  /** Custom aggregation prompt template */
  prompt?: string;
  /** Batch size for batched aggregation (default: 15, 0 = no batching) */
  batchSize?: number;
  /** Custom batch aggregation prompt template */
  batchPrompt?: string;
  /** Custom meta-aggregation prompt template (for combining batch summaries) */
  metaPrompt?: string;
}

/**
 * Options for iterative pipeline execution.
 */
export interface IterativeOptions {
  /** Provider context for role resolution */
  providerContext?: ProviderContext;
  /** Callbacks for progress tracking */
  callbacks?: IterativeCallbacks;
  /** Aggregation configuration */
  aggregation?: AggregationOptions;
  /** Number of files to process in parallel (default: 1) */
  concurrency?: number;
  /** File grouping configuration */
  grouping?: GroupingOptions;
  /** Use two-phase pipeline: fast scan all, deep analysis on flagged only */
  twoPhase?: boolean;
}

/**
 * Result from iterative pipeline execution.
 */
export interface IterativeResult {
  /** Per-file pipeline results */
  fileResults: Map<string, PipelineResult>;
  /** Aggregated output from all files */
  aggregatedOutput?: string;
  /** Number of files successfully processed */
  filesProcessed: number;
  /** Total number of files */
  totalFiles: number;
  /** List of models used across all executions */
  modelsUsed: string[];
  /** Files that were skipped (with reasons) */
  skippedFiles?: Array<{ file: string; reason: string }>;
  /** Batch summaries (when batched aggregation is used) */
  batchSummaries?: string[];
  /** File groups (when intelligent grouping is used) */
  groups?: FileGroup[];
  /** Group summaries (when group-based aggregation is used) */
  groupSummaries?: Map<string, string>;
  /** Execution timing stats */
  timing?: {
    /** Total execution time (ms) */
    total: number;
    /** Time spent on grouping (ms) */
    grouping?: number;
    /** Time spent on file processing (ms) */
    processing: number;
    /** Time spent on aggregation (ms) */
    aggregation?: number;
    /** Time spent on triage (ms) */
    triage?: number;
  };
  /** Triage results (when triage is enabled) */
  triageResult?: TriageResult;
}

// ============================================================================
// File Triage Types (V3)
// ============================================================================

/**
 * Risk level for a file based on triage analysis.
 */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * Score for a single file from triage analysis.
 */
export interface FileScore {
  /** File path */
  file: string;
  /** Risk level based on security sensitivity, data handling, etc. */
  risk: RiskLevel;
  /** Complexity score (1-10) based on size, logic complexity */
  complexity: number;
  /** Importance score (1-10) based on core functionality, entry points */
  importance: number;
  /** Brief explanation of the scores */
  reasoning: string;
  /** Suggested model role for this file ('fast', 'capable', 'reasoning') */
  suggestedModel?: string;
  /** Combined priority score for sorting (calculated) */
  priority?: number;
}

/**
 * Result from file triage analysis.
 */
export interface TriageResult {
  /** Scores for all files */
  scores: FileScore[];
  /** Summary of codebase structure and patterns */
  summary: string;
  /** Files that need deep analysis (critical/high risk or high importance) */
  criticalPaths: string[];
  /** Files to scan with standard analysis (medium priority) */
  normalPaths: string[];
  /** Files to quick scan or skip (low priority) */
  skipPaths: string[];
  /** Time spent on triage (ms) */
  duration?: number;
}

/**
 * Options for file triage.
 */
export interface TriageOptions {
  /** Model role for triage (default: 'fast') */
  role?: string;
  /** Custom scoring criteria to include in prompt */
  criteria?: string[];
  /** Minimum priority score for deep analysis (default: 6) */
  deepThreshold?: number;
  /** Maximum priority score for quick scan (default: 3) */
  skipThreshold?: number;
  /** Provider context for role resolution */
  providerContext?: ProviderContext;
  /** Include git history in scoring (default: false) */
  useGitHistory?: boolean;
  /** Optional codebase structure for connectivity-enhanced scoring */
  structure?: CodebaseStructure;
}

/**
 * Extended callbacks for V3 iterative pipeline with triage.
 */
export interface V3Callbacks extends IterativeCallbacks {
  /** Called when triage phase starts */
  onTriageStart?: (totalFiles: number) => void;
  /** Called when triage phase completes */
  onTriageComplete?: (result: TriageResult) => void;
  /** Called when a tool is about to be used in agentic step */
  onToolCall?: (stepName: string, toolName: string, input: unknown) => void;
  /** Called when a tool completes in agentic step */
  onToolResult?: (stepName: string, toolName: string, result: string) => void;
  /** Called to confirm destructive tool use (return true to allow) */
  onToolConfirm?: (toolCall: { name: string; input: unknown }) => Promise<boolean>;
}

/**
 * Extended options for V3 iterative pipeline.
 */
export interface V3Options extends IterativeOptions {
  /** Triage configuration */
  triage?: TriageOptions;
  /** Whether to enable triage phase (default: true for V3) */
  enableTriage?: boolean;
  /** Enable agentic steps with tool access for critical files */
  enableAgenticSteps?: boolean;
  /** Override callbacks with V3 callbacks */
  callbacks?: V3Callbacks;
  /** Dynamic model override based on triage (file -> role mapping) */
  modelOverrides?: Map<string, string>;
}

// ============================================================================
// V4 Symbolication Types
// ============================================================================

// Import symbolication types (re-exported for convenience)
import type {
  CodebaseStructure,
  SymbolicationOptions,
  SymbolicationResult,
} from './symbols/types.js';

export type { CodebaseStructure, SymbolicationOptions, SymbolicationResult };

/**
 * Extended callbacks for V4 iterative pipeline with symbolication.
 */
export interface V4Callbacks extends V3Callbacks {
  /** Called when Phase 0 symbolication starts */
  onSymbolicationStart?: (totalFiles: number) => void;
  /** Called when Phase 0 symbolication completes */
  onSymbolicationComplete?: (result: SymbolicationResult) => void;
  /** Called for each file during symbolication */
  onSymbolicationProgress?: (processed: number, total: number, file: string) => void;
}

/**
 * Extended options for V4 iterative pipeline with symbolication.
 */
export interface V4Options extends V3Options {
  /** Enable Phase 0 symbolication (default: true for V4) */
  enableSymbolication?: boolean;
  /** Symbolication configuration */
  symbolicationOptions?: Partial<SymbolicationOptions>;
  /** Pre-built codebase structure (skip Phase 0 if provided) */
  structure?: CodebaseStructure;
  /** Include navigation context in file analysis prompts */
  includeNavigationContext?: boolean;
  /** Include related file context in analysis prompts */
  includeRelatedContext?: boolean;
  /** Process files in dependency order (leaves first, default: true) */
  useDependencyOrder?: boolean;
  /** Two-pass analysis configuration */
  twoPass?: TwoPassOptions;
  /** Override callbacks with V4 callbacks */
  callbacks?: V4Callbacks;
}

/**
 * Configuration for two-pass analysis (fast scan + deep analysis).
 */
export interface TwoPassOptions {
  /** Enable two-pass mode (default: false) */
  enabled: boolean;
  /** Role for fast scanning (default: 'fast') */
  fastRole?: string;
  /** Role for deep analysis (default: 'capable') */
  deepRole?: string;
  /** Score threshold for triggering deep analysis (default: 5) */
  deepThreshold?: number;
  /** Maximum percentage of files for deep analysis (default: 30) */
  maxDeepPercent?: number;
}

/**
 * Result from fast scan phase of two-pass analysis.
 */
export interface FastScanResult {
  /** File that was scanned */
  file: string;
  /** Complexity/issue score from fast scan */
  score: number;
  /** Flags for deep analysis */
  flags: string[];
  /** Brief summary from fast scan */
  summary: string;
  /** Whether deep analysis is recommended */
  needsDeep: boolean;
}
