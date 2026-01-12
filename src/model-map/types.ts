/**
 * Model Map Types
 *
 * Docker-compose style configuration for multi-model orchestration.
 */

/**
 * Named model definition with provider and settings.
 */
export interface ModelDefinition {
  /** Provider type (anthropic, openai, ollama, ollama-native, runpod) */
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
  | 'ollama-local'
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
}

/**
 * Multi-model pipeline definition.
 */
export interface PipelineDefinition {
  /** Human-readable description */
  description?: string;
  /** Default provider context for role resolution (e.g., 'anthropic', 'openai', 'ollama-local') */
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
}
