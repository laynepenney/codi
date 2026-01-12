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
 * Single step in a multi-model pipeline.
 */
export interface PipelineStep {
  /** Step name (for variable reference) */
  name: string;
  /** Model name reference */
  model: string;
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
