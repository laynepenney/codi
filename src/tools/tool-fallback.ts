// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic Tool Fallback System
 *
 * Handles tool name matching and parameter mapping when exact matches fail.
 * - Suggests similar tools for typos/misnamed tools
 * - Auto-corrects high-similarity matches (configurable)
 * - Maps common parameter aliases to canonical forms
 */

import { stringSimilarity } from '../entity-normalization.js';
import type { ToolDefinition } from '../types.js';

/**
 * Configuration for tool fallback behavior.
 */
export interface ToolFallbackConfig {
  /** Enable/disable fallback system */
  enabled: boolean;
  /** Threshold above which tool is auto-corrected (0-1) */
  autoCorrectThreshold: number;
  /** Threshold above which tool is suggested (0-1) */
  suggestionThreshold: number;
  /** Auto-execute corrected tools without confirmation */
  autoExecute: boolean;
  /** Enable parameter aliasing */
  parameterAliasing: boolean;
}

/**
 * Default fallback configuration.
 */
export const DEFAULT_FALLBACK_CONFIG: ToolFallbackConfig = {
  enabled: true,
  autoCorrectThreshold: 0.85,
  suggestionThreshold: 0.6,
  autoExecute: false,
  parameterAliasing: true,
};

/**
 * Result of a tool name match attempt.
 */
export interface ToolMatchResult {
  /** Whether an exact match was found */
  exactMatch: boolean;
  /** The matched tool name (may differ from requested) */
  matchedName: string | null;
  /** Similarity score (1.0 for exact match) */
  score: number;
  /** All candidates above suggestion threshold */
  suggestions: Array<{ name: string; score: number; description: string }>;
  /** Whether auto-correction should be applied */
  shouldAutoCorrect: boolean;
}

/**
 * Find the best matching tool for a given name.
 */
export function findBestToolMatch(
  requestedName: string,
  availableTools: ToolDefinition[],
  config: ToolFallbackConfig = DEFAULT_FALLBACK_CONFIG
): ToolMatchResult {
  // Check for exact match first
  const exactMatch = availableTools.find((t) => t.name === requestedName);
  if (exactMatch) {
    return {
      exactMatch: true,
      matchedName: requestedName,
      score: 1.0,
      suggestions: [],
      shouldAutoCorrect: false,
    };
  }

  if (!config.enabled) {
    return {
      exactMatch: false,
      matchedName: null,
      score: 0,
      suggestions: [],
      shouldAutoCorrect: false,
    };
  }

  // Calculate similarity scores for all tools
  const scores = availableTools.map((tool) => ({
    name: tool.name,
    score: stringSimilarity(requestedName.toLowerCase(), tool.name.toLowerCase()),
    description: tool.description.slice(0, 80) + (tool.description.length > 80 ? '...' : ''),
  }));

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Filter to suggestions above threshold
  const suggestions = scores.filter((s) => s.score >= config.suggestionThreshold);
  const bestMatch = scores[0];

  // Only auto-correct if:
  // 1. Best match is above auto-correct threshold
  // 2. There's a clear winner (no other match within 0.05 of the best)
  let shouldAutoCorrect = false;
  if (bestMatch && bestMatch.score >= config.autoCorrectThreshold) {
    const closeMatches = scores.filter((s) => s.score >= bestMatch.score - 0.05);
    // Only auto-correct if there's exactly one clear winner
    shouldAutoCorrect = closeMatches.length === 1;
  }

  return {
    exactMatch: false,
    matchedName: shouldAutoCorrect ? bestMatch.name : null,
    score: bestMatch?.score ?? 0,
    suggestions,
    shouldAutoCorrect,
  };
}

/**
 * Global parameter aliases.
 * Maps canonical parameter names to their common aliases.
 */
export const GLOBAL_PARAMETER_ALIASES: Map<string, string[]> = new Map([
  // Search/query related
  ['pattern', ['query', 'search', 'search_term', 'search_query', 'regex', 'expression', 'search_pattern']],
  ['path', ['file', 'file_path', 'filepath', 'directory', 'dir', 'folder', 'location']],

  // Result limiting
  ['head_limit', ['max_results', 'max', 'limit', 'count', 'num_results', 'top_k', 'k', 'n']],
  ['depth', ['max_depth', 'level', 'levels']],

  // Flags
  ['ignore_case', ['case_insensitive', 'i', 'insensitive', 'no_case']],
  ['recursive', ['recurse', 'r']],
  ['show_hidden', ['hidden', 'all', 'include_hidden', 'show_all']],
  ['show_files', ['include_files', 'files']],

  // Content
  ['content', ['text', 'body', 'data', 'value']],
  ['new_content', ['replacement', 'replace_with', 'new_text', 'new_value']],
  ['old_content', ['original', 'old_text', 'find', 'search']],

  // File operations
  ['file_pattern', ['glob', 'include', 'glob_pattern', 'filter']],

  // Bash specific
  ['command', ['cmd', 'script', 'shell_command', 'exec']],
]);

/**
 * Result of parameter mapping.
 */
export interface ParameterMapResult {
  /** The mapped parameters */
  mappedInput: Record<string, unknown>;
  /** Any parameters that couldn't be mapped */
  unmappedParams: string[];
  /** Mapping details for logging */
  mappings: Array<{ from: string; to: string }>;
}

/**
 * Map parameters using global aliases and tool-specific schema.
 */
export function mapParameters(
  input: Record<string, unknown>,
  toolSchema: ToolDefinition['input_schema'],
  config: ToolFallbackConfig = DEFAULT_FALLBACK_CONFIG
): ParameterMapResult {
  if (!config.parameterAliasing) {
    return {
      mappedInput: input,
      unmappedParams: [],
      mappings: [],
    };
  }

  const mappedInput: Record<string, unknown> = {};
  const unmappedParams: string[] = [];
  const mappings: Array<{ from: string; to: string }> = [];
  const schemaProps = Object.keys(toolSchema.properties || {});

  for (const [key, value] of Object.entries(input)) {
    // If key exists in schema, use it directly
    if (schemaProps.includes(key)) {
      mappedInput[key] = value;
      continue;
    }

    // Try to find a mapping from global aliases
    let mapped = false;
    for (const [canonical, aliases] of GLOBAL_PARAMETER_ALIASES) {
      if (schemaProps.includes(canonical) && aliases.includes(key.toLowerCase())) {
        // Only map if we haven't already set this canonical parameter
        if (!(canonical in mappedInput)) {
          mappedInput[canonical] = value;
          mappings.push({ from: key, to: canonical });
          mapped = true;
        }
        break;
      }
    }

    // Try semantic similarity as fallback
    if (!mapped) {
      const bestMatch = findBestParameterMatch(key, schemaProps);
      if (bestMatch && bestMatch.score >= 0.7) {
        // Only map if we haven't already set this parameter
        if (!(bestMatch.name in mappedInput)) {
          mappedInput[bestMatch.name] = value;
          mappings.push({ from: key, to: bestMatch.name });
          mapped = true;
        }
      }
    }

    if (!mapped) {
      unmappedParams.push(key);
      // Still include unmapped params - the tool might handle them
      mappedInput[key] = value;
    }
  }

  return { mappedInput, unmappedParams, mappings };
}

/**
 * Find best matching parameter name using similarity.
 */
function findBestParameterMatch(
  paramName: string,
  schemaProps: string[]
): { name: string; score: number } | null {
  let bestMatch: { name: string; score: number } | null = null;

  for (const prop of schemaProps) {
    const score = stringSimilarity(paramName.toLowerCase(), prop.toLowerCase());
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { name: prop, score };
    }
  }

  return bestMatch;
}

/**
 * Format an error message with suggestions.
 */
export function formatFallbackError(requestedTool: string, matchResult: ToolMatchResult): string {
  const lines: string[] = [`Error: Unknown tool "${requestedTool}"`];

  if (matchResult.suggestions.length > 0) {
    lines.push('');
    lines.push('Did you mean:');
    // Show up to 3 suggestions
    for (const suggestion of matchResult.suggestions.slice(0, 3)) {
      const percent = Math.round(suggestion.score * 100);
      lines.push(`  - ${suggestion.name} (${percent}% match): ${suggestion.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format parameter mapping info for prepending to tool result.
 */
export function formatMappingInfo(
  toolCorrection: { from: string; to: string } | null,
  paramMappings: Array<{ from: string; to: string }>
): string | null {
  const parts: string[] = [];

  if (toolCorrection) {
    parts.push(`Tool: "${toolCorrection.from}" → "${toolCorrection.to}"`);
  }

  if (paramMappings.length > 0) {
    const mappingStr = paramMappings.map((m) => `${m.from}→${m.to}`).join(', ');
    parts.push(`Params: ${mappingStr}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `(Mapped: ${parts.join('; ')})`;
}
