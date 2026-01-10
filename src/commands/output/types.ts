/**
 * Typed command output system.
 * Replaces magic string parsing with structured types.
 */

import type { Session, SessionInfo } from '../../session.js';
import type { HistoryEntry } from '../../history.js';
import type { ResolvedConfig } from '../../config.js';

// ============================================================================
// Session Command Outputs
// ============================================================================

export interface SessionSavedOutput {
  type: 'session';
  action: 'saved';
  name: string;
  isNew: boolean;
  messageCount: number;
}

export interface SessionLoadedOutput {
  type: 'session';
  action: 'loaded';
  name: string;
  messageCount: number;
  hasSummary: boolean;
}

export interface SessionNotFoundOutput {
  type: 'session';
  action: 'not_found';
  name: string;
}

export interface SessionListOutput {
  type: 'session';
  action: 'list';
  sessions: Array<{
    name: string;
    updatedAt: string;
    messages: number;
    isCurrent: boolean;
  }>;
}

export interface SessionMultipleOutput {
  type: 'session';
  action: 'multiple';
  query: string;
  matches: string[];
}

export interface SessionDeletedOutput {
  type: 'session';
  action: 'deleted';
  name: string;
}

export interface SessionInfoOutput {
  type: 'session';
  action: 'info';
  info: {
    name: string;
    provider: string;
    model: string;
    messages: number;
    projectName?: string;
    projectPath?: string;
    hasSummary: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

export interface SessionClearedOutput {
  type: 'session';
  action: 'cleared';
  count: number;
}

export interface SessionDirOutput {
  type: 'session';
  action: 'dir';
  path: string;
}

export interface SessionErrorOutput {
  type: 'session';
  action: 'error';
  error: 'no_name' | 'no_current' | 'unknown_action';
  details?: string;
}

export type SessionOutput =
  | SessionSavedOutput
  | SessionLoadedOutput
  | SessionNotFoundOutput
  | SessionListOutput
  | SessionMultipleOutput
  | SessionDeletedOutput
  | SessionInfoOutput
  | SessionClearedOutput
  | SessionDirOutput
  | SessionErrorOutput;

// ============================================================================
// Config Command Outputs
// ============================================================================

export interface ConfigInitOutput {
  type: 'config';
  action: 'init';
  success: boolean;
  path?: string;
  error?: string;
}

export interface ConfigShowOutput {
  type: 'config';
  action: 'show';
  path: string;
  config: ResolvedConfig;
  warnings: string[];
}

export interface ConfigExampleOutput {
  type: 'config';
  action: 'example';
  content: string;
}

export interface ConfigNotFoundOutput {
  type: 'config';
  action: 'not_found';
}

export type ConfigOutput =
  | ConfigInitOutput
  | ConfigShowOutput
  | ConfigExampleOutput
  | ConfigNotFoundOutput;

// ============================================================================
// History Command Outputs
// ============================================================================

export interface UndoSuccessOutput {
  type: 'history';
  action: 'undo';
  success: true;
  fileName: string;
  operation: string;
  description: string;
}

export interface UndoNothingOutput {
  type: 'history';
  action: 'undo';
  success: false;
}

export interface RedoSuccessOutput {
  type: 'history';
  action: 'redo';
  success: true;
  fileName: string;
  operation: string;
  description: string;
}

export interface RedoNothingOutput {
  type: 'history';
  action: 'redo';
  success: false;
}

export interface HistoryListOutput {
  type: 'history';
  action: 'list';
  entries: Array<{
    operation: string;
    description: string;
    timestamp: string;
    fileName: string;
  }>;
  undoCount: number;
  redoCount: number;
}

export interface HistoryFileOutput {
  type: 'history';
  action: 'file';
  fileName: string;
  entries: Array<{
    operation: string;
    description: string;
    timestamp: string;
  }>;
}

export interface HistoryClearedOutput {
  type: 'history';
  action: 'cleared';
  count: number;
}

export interface HistoryDirOutput {
  type: 'history';
  action: 'dir';
  path: string;
}

export interface HistoryStatusOutput {
  type: 'history';
  action: 'status';
  undoCount: number;
  redoCount: number;
}

export type HistoryOutput =
  | UndoSuccessOutput
  | UndoNothingOutput
  | RedoSuccessOutput
  | RedoNothingOutput
  | HistoryListOutput
  | HistoryFileOutput
  | HistoryClearedOutput
  | HistoryDirOutput
  | HistoryStatusOutput;

// ============================================================================
// Usage Command Outputs
// ============================================================================

export interface UsageSessionOutput {
  type: 'usage';
  action: 'session';
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requests: number;
  startTime: string;
}

export interface UsageStatsOutput {
  type: 'usage';
  action: 'stats';
  period: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requests: number;
  days: number;
  avgCostPerDay: number;
  avgRequestsPerDay: number;
  modelBreakdown: Array<{
    key: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    requests: number;
  }>;
}

export interface UsageRecentOutput {
  type: 'usage';
  action: 'recent';
  records: Array<{
    timestamp: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
}

export interface UsageResetOutput {
  type: 'usage';
  action: 'reset';
}

export interface UsageClearedOutput {
  type: 'usage';
  action: 'cleared';
  count: number;
}

export interface UsagePathOutput {
  type: 'usage';
  action: 'path';
  path: string;
}

export type UsageOutput =
  | UsageSessionOutput
  | UsageStatsOutput
  | UsageRecentOutput
  | UsageResetOutput
  | UsageClearedOutput
  | UsagePathOutput;

// ============================================================================
// Plugin Command Outputs
// ============================================================================

export interface PluginsListOutput {
  type: 'plugin';
  action: 'list';
  plugins: Array<{
    name: string;
    version: string;
    tools: number;
    commands: number;
    providers: number;
  }>;
}

export interface PluginInfoOutput {
  type: 'plugin';
  action: 'info';
  name: string;
  version: string;
  description: string;
  toolCount: number;
  commandCount: number;
  providerCount: number;
  path: string;
  loadedAt: string;
}

export interface PluginNotFoundOutput {
  type: 'plugin';
  action: 'not_found';
  name: string;
}

export interface PluginsDirOutput {
  type: 'plugin';
  action: 'dir';
  path: string;
}

export type PluginOutput =
  | PluginsListOutput
  | PluginInfoOutput
  | PluginNotFoundOutput
  | PluginsDirOutput;

// ============================================================================
// Combined Command Output Type
// ============================================================================

/**
 * All possible typed command outputs.
 * Commands should return one of these types instead of magic strings.
 */
export type CommandOutput =
  | SessionOutput
  | ConfigOutput
  | HistoryOutput
  | UsageOutput
  | PluginOutput
  | { type: 'prompt'; content: string }  // Send to AI
  | null;  // No special output (command handled itself)

/**
 * Type guard to check if a value is a typed CommandOutput
 */
export function isTypedOutput(value: unknown): value is CommandOutput {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string';
}
