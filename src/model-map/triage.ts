// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * File Triage System (V3)
 *
 * Uses a fast model to score files by risk, complexity, and importance
 * before deep analysis. This allows adaptive processing where critical
 * files get more attention and low-priority files are quickly scanned.
 */

import { statSync } from 'node:fs';
import { dirname, basename, extname } from 'node:path';
import type {
  FileScore,
  TriageResult,
  TriageOptions,
  ProviderContext,
  RiskLevel,
  CodebaseStructure,
} from './types.js';
import type { ModelRegistry } from './registry.js';
import type { TaskRouter } from './router.js';
import { logger } from '../logger.js';

/** Default thresholds for file categorization */
const DEFAULT_DEEP_THRESHOLD = 6;
const DEFAULT_SKIP_THRESHOLD = 3;

/** Risk weights for priority calculation */
const RISK_WEIGHTS: Record<RiskLevel, number> = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 1,
};

/** File patterns that suggest higher risk */
const HIGH_RISK_PATTERNS = [
  /auth/i,
  /login/i,
  /password/i,
  /secret/i,
  /crypt/i,
  /token/i,
  /session/i,
  /permission/i,
  /access/i,
  /admin/i,
  /security/i,
  /sql/i,
  /query/i,
  /exec/i,
  /eval/i,
  /shell/i,
  /command/i,
];

/** File patterns that suggest entry points / high importance */
const ENTRY_POINT_PATTERNS = [
  /index\.[jt]sx?$/i,
  /main\.[jt]sx?$/i,
  /app\.[jt]sx?$/i,
  /server\.[jt]sx?$/i,
  /cli\.[jt]sx?$/i,
  /^src\/[^/]+\.[jt]sx?$/,  // Top-level src files
];

/**
 * Build a directory tree summary for the triage prompt.
 */
function buildDirectoryTree(files: string[]): string {
  const dirs = new Map<string, number>();

  for (const file of files) {
    const dir = dirname(file);
    dirs.set(dir, (dirs.get(dir) || 0) + 1);
  }

  const sortedDirs = Array.from(dirs.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  return sortedDirs
    .map(([dir, count]) => `${dir}/ (${count} files)`)
    .join('\n');
}

/**
 * Build file metadata for triage prompt.
 */
function buildFileMetadata(files: string[]): string {
  const metadata: string[] = [];

  for (const file of files) {
    try {
      const stats = statSync(file);
      const size = stats.size;
      const sizeKB = (size / 1024).toFixed(1);
      const ext = extname(file).slice(1) || 'unknown';
      const name = basename(file);

      // Detect potential risk indicators
      const riskIndicators: string[] = [];
      for (const pattern of HIGH_RISK_PATTERNS) {
        if (pattern.test(file)) {
          riskIndicators.push(pattern.source.replace(/[/\\]/g, ''));
          break;  // Only add first match
        }
      }

      // Detect entry points
      const isEntryPoint = ENTRY_POINT_PATTERNS.some(p => p.test(file));
      if (isEntryPoint) {
        riskIndicators.push('entry-point');
      }

      const indicators = riskIndicators.length > 0
        ? ` [${riskIndicators.join(', ')}]`
        : '';

      metadata.push(`- ${file} (${sizeKB}KB, ${ext})${indicators}`);
    } catch {
      metadata.push(`- ${file} (unknown size)`);
    }
  }

  return metadata.join('\n');
}

/**
 * Build the triage prompt for the fast model.
 */
function buildTriagePrompt(
  files: string[],
  options: TriageOptions
): string {
  const directoryTree = buildDirectoryTree(files);
  const fileMetadata = buildFileMetadata(files);

  const customCriteria = options.criteria?.length
    ? `\n\n## Custom Scoring Criteria\n${options.criteria.map(c => `- ${c}`).join('\n')}`
    : '';

  return `You are triaging source code files for code review. Analyze the file list and score each file.

## Codebase Structure
${directoryTree}

## Files to Score (${files.length} total)
${fileMetadata}
${customCriteria}

## Scoring Instructions
For each file, provide:
- **risk**: critical | high | medium | low
  - critical: Security-sensitive (auth, crypto, input handling, SQL, shell commands)
  - high: Data manipulation, API endpoints, state management
  - medium: Business logic, utilities
  - low: Types, constants, tests, documentation

- **complexity**: 1-10
  - Based on file size, likely logic complexity, number of dependencies

- **importance**: 1-10
  - Based on whether it's an entry point, core functionality, or utility

- **reasoning**: One sentence explaining the scores

- **suggestedModel**: "fast" | "capable" | "reasoning"
  - fast: Simple files, type definitions, constants
  - capable: Standard code review
  - reasoning: Complex logic, security-critical code

## Output Format
Respond with ONLY a JSON object in this exact format:
{
  "summary": "Brief description of the codebase structure and key areas",
  "scores": [
    {
      "file": "path/to/file.ts",
      "risk": "medium",
      "complexity": 5,
      "importance": 7,
      "reasoning": "Core business logic with moderate complexity",
      "suggestedModel": "capable"
    }
  ]
}

Analyze all ${files.length} files. Be concise in reasoning.`;
}

/**
 * Parse the triage response from the model.
 */
function parseTriageResponse(
  response: string,
  files: string[],
  options: TriageOptions
): TriageResult {
  const deepThreshold = options.deepThreshold ?? DEFAULT_DEEP_THRESHOLD;
  const skipThreshold = options.skipThreshold ?? DEFAULT_SKIP_THRESHOLD;

  // Extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('No JSON found in triage response, using fallback scoring');
    return createFallbackResult(files, options);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      scores?: Array<{
        file: string;
        risk?: string;
        complexity?: number;
        importance?: number;
        reasoning?: string;
        suggestedModel?: string;
      }>;
    };

    const scores: FileScore[] = [];
    const scoredFiles = new Set<string>();

    // Process parsed scores
    for (const score of parsed.scores || []) {
      if (!score.file || !files.includes(score.file)) continue;

      const risk = validateRisk(score.risk);
      const complexity = Math.min(10, Math.max(1, score.complexity || 5));
      const importance = Math.min(10, Math.max(1, score.importance || 5));

      // Calculate priority: risk weight + (complexity + importance) / 2
      const priority = RISK_WEIGHTS[risk] + (complexity + importance) / 2;

      scores.push({
        file: score.file,
        risk,
        complexity,
        importance,
        reasoning: score.reasoning || 'No reasoning provided',
        suggestedModel: score.suggestedModel,
        priority,
      });

      scoredFiles.add(score.file);
    }

    // Add fallback scores for any files not in response
    for (const file of files) {
      if (!scoredFiles.has(file)) {
        scores.push(createFallbackScore(file));
      }
    }

    // Sort by priority (highest first)
    scores.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Categorize files
    const criticalPaths: string[] = [];
    const normalPaths: string[] = [];
    const skipPaths: string[] = [];

    for (const score of scores) {
      const p = score.priority || 0;
      if (p >= deepThreshold) {
        criticalPaths.push(score.file);
      } else if (p <= skipThreshold) {
        skipPaths.push(score.file);
      } else {
        normalPaths.push(score.file);
      }
    }

    return {
      scores,
      summary: parsed.summary || 'Codebase triage completed',
      criticalPaths,
      normalPaths,
      skipPaths,
    };
  } catch (error) {
    logger.warn(`Failed to parse triage response: ${error}`);
    return createFallbackResult(files, options);
  }
}

/**
 * Validate risk level string.
 */
function validateRisk(risk: string | undefined): RiskLevel {
  if (risk && ['critical', 'high', 'medium', 'low'].includes(risk.toLowerCase())) {
    return risk.toLowerCase() as RiskLevel;
  }
  return 'medium';
}

/**
 * Create a fallback score for a file based on heuristics.
 */
function createFallbackScore(file: string): FileScore {
  let risk: RiskLevel = 'medium';
  let complexity = 5;
  let importance = 5;

  // Check for high-risk patterns
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(file)) {
      risk = 'high';
      importance = 7;
      break;
    }
  }

  // Check for entry points
  if (ENTRY_POINT_PATTERNS.some(p => p.test(file))) {
    importance = 8;
  }

  // Check for test files (lower priority)
  if (/\.test\.|\.spec\.|__tests__/i.test(file)) {
    risk = 'low';
    importance = 3;
  }

  // Check for type definitions
  if (/\.d\.ts$|types?\.[jt]s$/i.test(file)) {
    complexity = 3;
    importance = 4;
  }

  const priority = RISK_WEIGHTS[risk] + (complexity + importance) / 2;

  return {
    file,
    risk,
    complexity,
    importance,
    reasoning: 'Scored using heuristics (model response missing)',
    priority,
  };
}

/**
 * Create a fallback result when model response is invalid.
 */
function createFallbackResult(
  files: string[],
  options: TriageOptions
): TriageResult {
  const deepThreshold = options.deepThreshold ?? DEFAULT_DEEP_THRESHOLD;
  const skipThreshold = options.skipThreshold ?? DEFAULT_SKIP_THRESHOLD;

  const scores = files.map(createFallbackScore);
  scores.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const criticalPaths: string[] = [];
  const normalPaths: string[] = [];
  const skipPaths: string[] = [];

  for (const score of scores) {
    const p = score.priority || 0;
    if (p >= deepThreshold) {
      criticalPaths.push(score.file);
    } else if (p <= skipThreshold) {
      skipPaths.push(score.file);
    } else {
      normalPaths.push(score.file);
    }
  }

  return {
    scores,
    summary: 'Triage completed using heuristics (model response unavailable)',
    criticalPaths,
    normalPaths,
    skipPaths,
  };
}

/**
 * Triage files using a fast model to score by risk, complexity, and importance.
 *
 * @param files List of file paths to triage
 * @param registry Model registry for provider access
 * @param router Task router for role resolution
 * @param options Triage options
 * @returns Triage result with scores and categorized file lists
 */
export async function triageFiles(
  files: string[],
  registry: ModelRegistry,
  router: TaskRouter,
  options: TriageOptions = {}
): Promise<TriageResult> {
  const startTime = Date.now();

  if (files.length === 0) {
    return {
      scores: [],
      summary: 'No files to triage',
      criticalPaths: [],
      normalPaths: [],
      skipPaths: [],
      duration: 0,
    };
  }

  // Resolve the fast model for triage
  const role = options.role || 'fast';
  const providerContext = options.providerContext || 'openai';
  const resolved = router.resolveRole(role, providerContext);

  if (!resolved) {
    logger.warn(`No model available for role "${role}" in context "${providerContext}", using heuristics`);
    const result = createFallbackResult(files, options);
    result.duration = Date.now() - startTime;
    return result;
  }

  try {
    const provider = registry.getProvider(resolved.name);
    const prompt = buildTriagePrompt(files, options);

    logger.debug(`Triaging ${files.length} files with ${resolved.name}`);

    const response = await provider.chat([{ role: 'user', content: prompt }]);
    let result = parseTriageResponse(response.content, files, options);

    // Enhance with connectivity if structure is provided
    if (options.structure) {
      result = enhanceWithConnectivity(result, options.structure, options);
    }

    result.duration = Date.now() - startTime;

    logger.info(`Triage complete: ${result.criticalPaths.length} critical, ${result.normalPaths.length} normal, ${result.skipPaths.length} skip`);

    return result;
  } catch (error) {
    logger.warn(`Triage failed: ${error}, using heuristics`);
    let result = createFallbackResult(files, options);

    // Enhance with connectivity if structure is provided
    if (options.structure) {
      result = enhanceWithConnectivity(result, options.structure, options);
    }

    result.duration = Date.now() - startTime;
    return result;
  }
}

/**
 * Enhance triage scores with codebase connectivity metrics.
 * Files with high connectivity get boosted importance.
 */
function enhanceWithConnectivity(
  result: TriageResult,
  structure: CodebaseStructure,
  options: TriageOptions
): TriageResult {
  const deepThreshold = options.deepThreshold ?? DEFAULT_DEEP_THRESHOLD;
  const skipThreshold = options.skipThreshold ?? DEFAULT_SKIP_THRESHOLD;

  const enhancedScores = result.scores.map((score) => {
    const connectivity = structure.connectivity.get(score.file);
    if (!connectivity) return score;

    // Boost importance for high-connectivity files
    let importanceBoost = 0;

    // Files imported by many others are more important
    if (connectivity.inDegree >= 5) {
      importanceBoost += 2;
    } else if (connectivity.inDegree >= 2) {
      importanceBoost += 1;
    }

    // Entry points are critical
    if (structure.dependencyGraph.entryPoints.includes(score.file)) {
      importanceBoost += 2;
    }

    // High transitive reach = high importance
    if (connectivity.transitiveImporters >= 10) {
      importanceBoost += 1;
    }

    // Boost complexity for files in cycles
    const inCycle = structure.dependencyGraph.cycles.some((cycle) =>
      cycle.includes(score.file)
    );
    const complexityBoost = inCycle ? 1 : 0;

    const newImportance = Math.min(10, score.importance + importanceBoost);
    const newComplexity = Math.min(10, score.complexity + complexityBoost);
    const riskWeight = RISK_WEIGHTS[score.risk];
    const newPriority = (newImportance + newComplexity + riskWeight) / 3;

    const connectivityNote = `[in=${connectivity.inDegree}, out=${connectivity.outDegree}${inCycle ? ', cycle' : ''}]`;

    return {
      ...score,
      importance: newImportance,
      complexity: newComplexity,
      priority: newPriority,
      reasoning: score.reasoning.includes('[in=') ? score.reasoning : `${score.reasoning} ${connectivityNote}`,
    };
  });

  // Re-sort by priority
  enhancedScores.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Re-categorize based on new priorities
  const criticalPaths = enhancedScores
    .filter((s) => (s.priority || 0) >= deepThreshold)
    .map((s) => s.file);

  const normalPaths = enhancedScores
    .filter((s) => {
      const p = s.priority || 0;
      return p < deepThreshold && p > skipThreshold;
    })
    .map((s) => s.file);

  const skipPaths = enhancedScores
    .filter((s) => (s.priority || 0) <= skipThreshold)
    .map((s) => s.file);

  return {
    ...result,
    scores: enhancedScores,
    criticalPaths,
    normalPaths,
    skipPaths,
    summary: result.summary + ' (enhanced with connectivity)',
  };
}

/**
 * Get a model role suggestion for a file based on its triage score.
 */
export function getSuggestedModel(score: FileScore): string {
  if (score.suggestedModel) {
    return score.suggestedModel;
  }

  // Derive from risk and complexity
  if (score.risk === 'critical' || score.complexity >= 8) {
    return 'reasoning';
  }
  if (score.risk === 'low' && score.complexity <= 3) {
    return 'fast';
  }
  return 'capable';
}

/**
 * Format triage result for display.
 */
export function formatTriageResult(result: TriageResult): string {
  const lines: string[] = [];

  lines.push(`## Triage Summary`);
  lines.push(result.summary);
  lines.push('');

  lines.push(`### File Categories`);
  lines.push(`- Critical (deep analysis): ${result.criticalPaths.length} files`);
  lines.push(`- Normal (standard review): ${result.normalPaths.length} files`);
  lines.push(`- Skip (quick scan): ${result.skipPaths.length} files`);
  lines.push('');

  if (result.criticalPaths.length > 0) {
    lines.push(`### Critical Files`);
    for (const file of result.criticalPaths.slice(0, 10)) {
      const score = result.scores.find(s => s.file === file);
      if (score) {
        lines.push(`- ${file} [${score.risk}] - ${score.reasoning}`);
      }
    }
    if (result.criticalPaths.length > 10) {
      lines.push(`  ... and ${result.criticalPaths.length - 10} more`);
    }
    lines.push('');
  }

  if (result.duration) {
    lines.push(`*Triage completed in ${(result.duration / 1000).toFixed(1)}s*`);
  }

  return lines.join('\n');
}
